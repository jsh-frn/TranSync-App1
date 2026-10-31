<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/policy.php";
require_once __DIR__ . "/../../config/sweep.php";

$reservation_id = (int)($_GET["reservation_id"] ?? 0);
if (!$reservation_id) {
    echo json_encode(["success" => false, "message" => "reservation_id is required."]);
    exit;
}

// Opportunistic sweep so status/QR reads are never stale by more than one
// poll — shares the exact same logic (and remittance crediting) as
// bus_trips/sweep_departed_trips.php via config/sweep.php. Must NOT be its
// own separate raw-SQL status flip: doing so here without also crediting the
// driver/operator/system split would both leave them unpaid for a seat that
// was held and never resold, AND make the row invisible to the "real" sweep
// afterward (boarding_status would no longer be 'reserved').
sweepDepartedReservations($conn);

$stmt = $conn->prepare("
    SELECT r.id, r.trip_id, r.uv_session_id, r.uv_slot_id, r.status, r.boarding_status,
           r.payment_status, r.departure_time, r.vehicle_category,
           t.status AS trip_status, s.status AS slot_status
    FROM reservations r
    LEFT JOIN trips    t ON t.id = r.trip_id
    LEFT JOIN uv_slots s ON s.id = r.uv_slot_id
    WHERE r.id = ?
");
$stmt->bind_param("i", $reservation_id);
$stmt->execute();
$res = $stmt->get_result()->fetch_assoc();

if (!$res) {
    echo json_encode(["success" => false, "message" => "Booking not found."]);
    exit;
}

$vehicle_status = $res["trip_id"] ? $res["trip_status"] : ($res["uv_slot_id"] ? $res["slot_status"] : null);

$db_now_ts     = strtotime($conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"]);
$departure_ts  = strtotime($res["departure_time"]);
$grace_minutes = QR_GRACE_MINUTES[$res["vehicle_category"]] ?? 30;
$expires_at    = $departure_ts + $grace_minutes * 60;

// Time-based, not vehicle_status-based — the grace countdown must still show
// (and the QR still expire) even if the driver never tapped Depart.
$grace_seconds_remaining = null;
if ($res["boarding_status"] === "reserved" && $db_now_ts >= $departure_ts) {
    $grace_seconds_remaining = max(0, $expires_at - $db_now_ts);
}

echo json_encode([
    "success"                 => true,
    "id"                      => (int)$res["id"],
    "status"                  => $res["status"],
    "boarding_status"         => $res["boarding_status"],
    "payment_status"          => $res["payment_status"],
    "vehicle_status"          => $vehicle_status,
    "qr_expires_at"           => date("Y-m-d H:i:s", $expires_at),
    "grace_seconds_remaining" => $grace_seconds_remaining,
]);
