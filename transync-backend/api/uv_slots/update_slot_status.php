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

$body        = json_decode(file_get_contents("php://input"), true);
$slot_id     = (int)($body["slot_id"] ?? 0);
$action      = trim($body["action"] ?? "");
$operator_id = isset($body["operator_id"]) ? (int)$body["operator_id"] : null;
$driver_id   = isset($body["driver_id"])   ? (int)$body["driver_id"]   : null;

$valid_actions = ["start_boarding", "depart", "complete", "cancel"];
if (!$slot_id || !in_array($action, $valid_actions) || (!$operator_id && !$driver_id)) {
    echo json_encode(["success" => false, "message" => "Invalid request."]);
    exit;
}

$stmt = $conn->prepare("SELECT id, operator_id, route_id, status FROM uv_slots WHERE id = ?");
$stmt->bind_param("i", $slot_id);
$stmt->execute();
$slot = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$slot) {
    echo json_encode(["success" => false, "message" => "Slot not found."]);
    exit;
}

// The operator that owns the slot can always manage it (legacy operator-
// created slots). A route-level pooled slot (operator_id NULL, or even a
// legacy one) can also be managed by any operator currently active on that
// route's schedule — see Core Flow 8b's UV scheduling rewrite. A driver may
// manage it too, but only if they're the currently-dispatched driver for
// that route (any operator — pooled slots aren't tied to one), same rule
// board_reservation.php uses to authorize boarding scans.
$authorized = $operator_id && $slot["operator_id"] !== null && (int)$slot["operator_id"] === $operator_id;
if (!$authorized && $operator_id) {
    $stmt = $conn->prepare("
        SELECT a.id FROM uv_schedule_activations a
        JOIN uv_operating_hours h ON h.id = a.uv_operating_hours_id
        WHERE h.route_id = ? AND a.operator_id = ? AND a.status = 'active'
    ");
    $stmt->bind_param("ii", $slot["route_id"], $operator_id);
    $stmt->execute();
    $authorized = (bool)$stmt->get_result()->fetch_assoc();
    $stmt->close();
}
if (!$authorized && $driver_id) {
    $stmt = $conn->prepare("
        SELECT id FROM dispatch_queue
        WHERE route_id = ? AND status = 'dispatched' AND driver_id = ?
    ");
    $stmt->bind_param("ii", $slot["route_id"], $driver_id);
    $stmt->execute();
    $authorized = (bool)$stmt->get_result()->fetch_assoc();
    $stmt->close();
}
if (!$authorized) {
    echo json_encode(["success" => false, "message" => "Not authorized to update this slot."]);
    exit;
}

$current = $slot["status"];

$transitions = [
    "start_boarding" => ["from" => ["scheduled"],             "to" => "boarding"],
    "depart"         => ["from" => ["scheduled", "boarding"], "to" => "departed"],
    "complete"       => ["from" => ["departed"],               "to" => "completed"],
    "cancel"         => ["from" => ["scheduled", "boarding"], "to" => "cancelled"],
];
$t = $transitions[$action];
if (!in_array($current, $t["from"])) {
    echo json_encode(["success" => false, "message" => "Cannot $action a slot that is currently '$current'."]);
    exit;
}
$new_status = $t["to"];

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("UPDATE uv_slots SET status = ? WHERE id = ?");
    $stmt->bind_param("si", $new_status, $slot_id);
    $stmt->execute();
    $stmt->close();

    if ($action === "cancel") {
        // Operator-cancelled slots refund every still-reserved passenger.
        $stmt = $conn->prepare("
            SELECT id, commuter_id, fare_amount FROM reservations
            WHERE uv_slot_id = ? AND boarding_status = 'reserved'
        ");
        $stmt->bind_param("i", $slot_id);
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

            $note = "Refund — slot cancelled by operator (booking #{$res["id"]})";
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
            WHERE uv_slot_id = ? AND boarding_status = 'boarded'
        ");
        $stmt->bind_param("i", $slot_id);
        $stmt->execute();
        $stmt->close();

        // Same reasoning as update_trip_status.php: "complete" is a hard signal,
        // don't strand any still-reserved bookings past the sweep's reach.
        $stmt = $conn->prepare("
            UPDATE reservations
            SET boarding_status = 'no_show', status = 'expired',
                cancellation_type = 'no_show', payment_status = 'forfeited', resolved_at = NOW()
            WHERE uv_slot_id = ? AND boarding_status = 'reserved'
        ");
        $stmt->bind_param("i", $slot_id);
        $stmt->execute();
        $stmt->close();
    }

    $conn->commit();
    echo json_encode(["success" => true, "status" => $new_status]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to update slot status."]);
}
