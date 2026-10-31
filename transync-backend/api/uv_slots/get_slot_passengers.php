<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$driver_id = (int)($_GET['driver_id'] ?? 0);
if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "driver_id is required."]);
    exit;
}

// A driver is only authorized to see (and board) slot passengers while they
// are the currently-dispatched driver for a route-scoped queue — same
// authorization board_reservation.php checks at scan time.
$stmt = $conn->prepare("
    SELECT operator_id, route_id FROM dispatch_queue
    WHERE driver_id = ? AND status = 'dispatched' AND route_id IS NOT NULL
    LIMIT 1
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$dispatch = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$dispatch) {
    echo json_encode(["success" => true, "dispatched" => false, "passengers" => []]);
    exit;
}

$operator_id = (int)$dispatch["operator_id"];
$route_id    = (int)$dispatch["route_id"];

$stmt = $conn->prepare("
    SELECT r.id, r.uv_slot_id, r.passenger_name, r.passenger_phone, r.passenger_age,
           r.fare_amount, r.discount_type, r.boarding_status, r.boarded_at,
           s.departure_time
    FROM reservations r
    JOIN uv_slots s ON s.id = r.uv_slot_id
    WHERE s.operator_id = ? AND s.route_id = ? AND s.status = 'scheduled'
      AND r.boarding_status = 'reserved'
    ORDER BY s.departure_time ASC, r.id ASC
");
$stmt->bind_param("ii", $operator_id, $route_id);
$stmt->execute();
$result = $stmt->get_result();

// DB clock, not PHP's — see board_reservation.php for why mixing time()/date()
// with strtotime() on a DB-sourced datetime string is unsafe on this server.
$now = strtotime($conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"]);
$passengers = [];
while ($row = $result->fetch_assoc()) {
    $qr_active_at = strtotime($row["departure_time"]) - 1800;
    $passengers[] = [
        "id"              => (int)$row["id"],
        "uv_slot_id"      => (int)$row["uv_slot_id"],
        "passenger_name"  => $row["passenger_name"],
        "passenger_phone" => $row["passenger_phone"],
        "passenger_age"   => $row["passenger_age"] !== null ? (int)$row["passenger_age"] : null,
        "fare_amount"     => (float)$row["fare_amount"],
        "discount_type"   => $row["discount_type"],
        "boarding_status" => $row["boarding_status"],
        "boarded_at"      => $row["boarded_at"],
        "departure_time"  => $row["departure_time"],
        "qr_active_at"    => date("Y-m-d H:i:s", $qr_active_at),
        "qr_active"       => $now >= $qr_active_at,
    ];
}

echo json_encode(["success" => true, "dispatched" => true, "passengers" => $passengers]);
