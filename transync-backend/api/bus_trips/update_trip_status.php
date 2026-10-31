<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";

$body      = json_decode(file_get_contents("php://input"), true);
$trip_id   = (int)($body["trip_id"] ?? 0);
$action    = trim($body["action"] ?? "");
$driver_id = isset($body["driver_id"]) ? (int)$body["driver_id"] : null;
$operator_id = isset($body["operator_id"]) ? (int)$body["operator_id"] : null;

$valid_actions = ["start_boarding", "depart", "complete", "cancel"];
if (!$trip_id || !in_array($action, $valid_actions) || (!$driver_id && !$operator_id)) {
    echo json_encode(["success" => false, "message" => "Invalid request."]);
    exit;
}

$stmt = $conn->prepare("SELECT id, driver_id, operator_id, status FROM trips WHERE id = ?");
$stmt->bind_param("i", $trip_id);
$stmt->execute();
$trip = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$trip) {
    echo json_encode(["success" => false, "message" => "Trip not found."]);
    exit;
}

$authorized = ($driver_id && (int)$trip["driver_id"] === $driver_id)
           || ($operator_id && (int)$trip["operator_id"] === $operator_id);
if (!$authorized) {
    echo json_encode(["success" => false, "message" => "Not authorized to update this trip."]);
    exit;
}

$current = $trip["status"];

$transitions = [
    "start_boarding" => ["from" => ["scheduled"],            "to" => "boarding"],
    "depart"         => ["from" => ["scheduled", "boarding"], "to" => "departed"],
    "complete"       => ["from" => ["departed"],              "to" => "completed"],
    "cancel"         => ["from" => ["scheduled", "boarding"], "to" => "cancelled"],
];
$t = $transitions[$action];
if (!in_array($current, $t["from"])) {
    echo json_encode(["success" => false, "message" => "Cannot $action a trip that is currently '$current'."]);
    exit;
}

// Cancelling before boarding starts returns the trip to Pending Assignment
// instead of a terminal state — the trip (route/date/departure/fare/
// schedule) is never deleted, only its assignment is undone, so another
// vehicle/driver/conductor can claim it without regenerating a duplicate.
// Once boarding has begun (or the trip is already departed/completed),
// cancel keeps the old terminal 'cancelled' outcome — the operator's
// commitment to run this specific trip is no longer undoable at that point.
$returnToPending = ($action === "cancel" && $current === "scheduled");
$new_status = $returnToPending ? "pending_assignment" : $t["to"];

$conn->begin_transaction();
try {
    if ($returnToPending) {
        // Reset every assignment-owned field back to its freshly-generated
        // shape (Core Flow 12a point 2) — route_id/schedule_id/departure_time/
        // boarding_time/fare_override stay untouched, only what an operator's
        // own assignment set gets cleared. capacity is vehicle-derived (Do Not
        // Break rule #43) so it must go back to NULL alongside vehicle_id;
        // seats_booked resets to 0 since every booking on this assignment is
        // being refunded below — a stale count would undercount availability
        // once a new vehicle is assigned.
        $stmt = $conn->prepare("
            UPDATE trips
            SET status = 'pending_assignment', operator_id = NULL, vehicle_id = NULL, driver_id = NULL,
                conductor_name = NULL, conductor_phone = NULL, capacity = NULL, seats_booked = 0
            WHERE id = ?
        ");
        $stmt->bind_param("i", $trip_id);
    } else {
        $stmt = $conn->prepare("UPDATE trips SET status = ? WHERE id = ?");
        $stmt->bind_param("si", $new_status, $trip_id);
    }
    $stmt->execute();
    $stmt->close();

    // "depart" no longer expires unboarded reservations immediately — the QR
    // grace period (departure_time + 30min, see board_reservation.php) means a
    // passenger can still board after departure. Unclaimed reservations are
    // swept to no_show/forfeited once the grace period actually passes (see
    // sweep_departed_trips.php). "cancel" is different — the trip isn't
    // happening at all, so there's nothing to wait out.
    if ($action === "cancel") {
        // Operator-cancelled trips refund every still-reserved passenger — this
        // wasn't the commuter's fault, unlike a plain no-show.
        $stmt = $conn->prepare("
            SELECT id, commuter_id, fare_amount FROM reservations
            WHERE trip_id = ? AND boarding_status = 'reserved'
        ");
        $stmt->bind_param("i", $trip_id);
        $stmt->execute();
        $toRefund = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();

        foreach ($toRefund as $res) {
            $fare = (float)$res["fare_amount"];

            $stmt = $conn->prepare("SELECT balance FROM wallets WHERE commuter_id = ?");
            $stmt->bind_param("i", $res["commuter_id"]);
            $stmt->execute();
            $balance = (float)($stmt->get_result()->fetch_assoc()["balance"] ?? 0);
            $stmt->close();

            $new_balance = round($balance + $fare, 2);
            $stmt = $conn->prepare("UPDATE wallets SET balance = ? WHERE commuter_id = ?");
            $stmt->bind_param("di", $new_balance, $res["commuter_id"]);
            $stmt->execute();
            $stmt->close();

            $note = "Refund — trip cancelled by operator (booking #{$res["id"]})";
            $stmt = $conn->prepare("
                INSERT INTO wallet_transactions
                    (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
                VALUES ('commuter', ?, 'credit', ?, 'refund', ?, ?, ?)
            ");
            $stmt->bind_param("idids", $res["commuter_id"], $fare, $res["id"], $new_balance, $note);
            $stmt->execute();
            $stmt->close();

            $stmt = $conn->prepare("
                UPDATE reservations
                SET boarding_status = 'no_show', status = 'expired',
                    cancellation_type = 'operator_cancelled', payment_status = 'refunded',
                    refund_amount = ?, refund_pct = 100.00, resolved_at = NOW()
                WHERE id = ?
            ");
            $stmt->bind_param("di", $fare, $res["id"]);
            $stmt->execute();
            $stmt->close();
        }
    }

    if ($action === "complete") {
        $stmt = $conn->prepare("
            UPDATE reservations SET boarding_status = 'completed', status = 'completed', resolved_at = NOW()
            WHERE trip_id = ? AND boarding_status = 'boarded'
        ");
        $stmt->bind_param("i", $trip_id);
        $stmt->execute();
        $stmt->close();

        // Marking a trip complete is a hard signal nothing is left to wait for —
        // don't leave any still-reserved bookings stranded past the sweep's reach
        // (the sweep only matches status='departed', not 'completed').
        $stmt = $conn->prepare("
            UPDATE reservations
            SET boarding_status = 'no_show', status = 'expired',
                cancellation_type = 'no_show', payment_status = 'forfeited', resolved_at = NOW()
            WHERE trip_id = ? AND boarding_status = 'reserved'
        ");
        $stmt->bind_param("i", $trip_id);
        $stmt->execute();
        $stmt->close();
    }

    $conn->commit();
    echo json_encode(["success" => true, "status" => $new_status]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to update trip status."]);
}
