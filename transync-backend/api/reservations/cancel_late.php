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
require_once __DIR__ . "/../../config/policy.php";
require_once __DIR__ . "/../../config/remittance.php";

// DEPRECATED IN PLACE (2026-08-11) — superseded by reservations/request_refund.php,
// which now implements the full tiered refund policy (100%/50%/0%, see
// config/refund.php's computeRefundOutcome()) as the single commuter-facing
// cancellation endpoint. Nothing in the mobile client calls this file
// anymore. Left functional, frozen at the OLD binary policy it always had
// (100% refund outside a flat per-vehicle-type cutoff, 0% inside it, no 50%
// tier, no 30-minute post-booking grace period) for any historical/direct
// caller — matching this codebase's established deprecate-in-place
// convention (see uv_slots/create_slot.php, bus_trips/create_trip.php). The
// cutoff hours below are hardcoded rather than read from
// config/policy.php's REFUND_TIERS, since that constant now represents the
// current (different) policy, not this frozen one.
//
// Cancelling inside the refund cutoff but before departure — the commuter
// gets no refund; the fare is distributed to the driver/operator/system via
// the normal remittance split instead, same as a real boarding would.
$body           = json_decode(file_get_contents("php://input"), true);
$reservation_id = (int)($body["reservation_id"] ?? 0);
$commuter_id    = (int)($body["commuter_id"] ?? 0);

if (!$reservation_id || !$commuter_id) {
    echo json_encode(["success" => false, "message" => "Invalid request."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, trip_id, uv_session_id, uv_slot_id, fare_amount, departure_time, boarding_status, vehicle_category
    FROM reservations WHERE id = ? AND commuter_id = ?
");
$stmt->bind_param("ii", $reservation_id, $commuter_id);
$stmt->execute();
$res = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$res) {
    echo json_encode(["success" => false, "message" => "Booking not found."]);
    exit;
}
if ($res["uv_session_id"]) {
    echo json_encode(["success" => false, "message" => "Live UV Express bookings can't be cancelled this way."]);
    exit;
}
if ($res["boarding_status"] !== "reserved") {
    echo json_encode(["success" => false, "message" => "This booking can no longer be cancelled."]);
    exit;
}

// DB clock, not PHP's — see board_reservation.php for why mixing time()/date()
// with strtotime() on a DB datetime string is unsafe here. Hardcoded, frozen
// values — see the deprecation note above.
$FROZEN_CUTOFF_HOURS = ["Bus" => 72, "UV Express" => 24];
$cutoff_hours = $FROZEN_CUTOFF_HOURS[$res["vehicle_category"]] ?? 24;
$db_now       = $conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"];
$db_now_ts    = strtotime($db_now);
$departure_ts = strtotime($res["departure_time"]);

if ($departure_ts <= $db_now_ts) {
    echo json_encode(["success" => false, "message" => "This booking's departure has already passed."]);
    exit;
}
if ($departure_ts - $db_now_ts >= $cutoff_hours * 3600) {
    echo json_encode([
        "success" => false,
        "message" => "This booking is still eligible for a full refund — use Cancel & Refund instead.",
    ]);
    exit;
}

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("
        UPDATE reservations
        SET status = 'cancelled', boarding_status = 'cancelled', cancellation_type = 'late_cancelled', payment_status = 'forfeited', resolved_at = NOW()
        WHERE id = ? AND boarding_status = 'reserved'
    ");
    $stmt->bind_param("i", $reservation_id);
    $stmt->execute();
    $cancelled = $stmt->affected_rows > 0;
    $stmt->close();

    if (!$cancelled) {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "This booking can no longer be cancelled."]);
        exit;
    }

    // Release the seat — a same-day rebooking by another commuter is still
    // possible if there's time left before departure.
    if ($res["trip_id"]) {
        $stmt = $conn->prepare("UPDATE trips SET seats_booked = GREATEST(0, seats_booked - 1) WHERE id = ?");
        $stmt->bind_param("i", $res["trip_id"]);
    } else {
        $stmt = $conn->prepare("UPDATE uv_slots SET seats_booked = GREATEST(0, seats_booked - 1) WHERE id = ?");
        $stmt->bind_param("i", $res["uv_slot_id"]);
    }
    $stmt->execute();
    $stmt->close();

    // Resolve driver/operator to pay. Bus trips have a fixed driver_id from
    // creation; UV slots don't (queue-based rollover — no specific driver was
    // ever committed to this booking), so driver_id is left null and its
    // share folds into the operator's credit (see config/remittance.php).
    $driver_id   = null;
    $operator_id = 0;
    if ($res["trip_id"]) {
        $stmt = $conn->prepare("SELECT t.driver_id, v.operator_id FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = ?");
        $stmt->bind_param("i", $res["trip_id"]);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $driver_id   = $row ? (int)$row["driver_id"] : null;
        $operator_id = $row ? (int)$row["operator_id"] : 0;
    } else {
        $stmt = $conn->prepare("SELECT operator_id FROM uv_slots WHERE id = ?");
        $stmt->bind_param("i", $res["uv_slot_id"]);
        $stmt->execute();
        $operator_id = (int)($stmt->get_result()->fetch_assoc()["operator_id"] ?? 0);
        $stmt->close();
    }

    // Derive the specific association this fare's route belongs to (see
    // board_reservation.php for why this goes through routes.association_id
    // rather than the vehicle/operator).
    if ($res["trip_id"]) {
        $stmt = $conn->prepare("SELECT r.association_id FROM trips t JOIN routes r ON r.id = t.route_id WHERE t.id = ?");
        $stmt->bind_param("i", $res["trip_id"]);
    } else {
        $stmt = $conn->prepare("SELECT r.association_id FROM uv_slots s JOIN routes r ON r.id = s.route_id WHERE s.id = ?");
        $stmt->bind_param("i", $res["uv_slot_id"]);
    }
    $stmt->execute();
    $assocRow = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $association_id = ($assocRow && $assocRow["association_id"] !== null) ? (int)$assocRow["association_id"] : null;

    $split = creditRemittanceSplit($conn, $driver_id, $operator_id, $association_id, $res["vehicle_category"], (float)$res["fare_amount"], $reservation_id, "Late cancellation forfeiture");

    $conn->commit();

    echo json_encode([
        "success"         => true,
        "message"         => "Booking cancelled — no refund past the cutoff.",
        "driver_credited" => $split["driver_net"],
        "operator_fee"    => $split["operator_fee"],
        "system_fee"      => $split["system_fee"],
    ]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to process cancellation."]);
}
