<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$slot_id = (int)($_GET['slot_id'] ?? 0);
if (!$slot_id) {
    echo json_encode(["success" => false, "message" => "slot_id is required."]);
    exit;
}

// See bus_trips/get_trip_bookings.php's own note — same rebook-request flag,
// same reasoning (no notification system in this app, so the manifest is
// the only place a commuter's request can surface).
$stmt = $conn->prepare("
    SELECT r.id, r.passenger_name, r.passenger_phone, r.passenger_age, r.fare_amount,
           r.discount_type, r.boarding_status, r.boarded_at, r.created_at,
           (rr.id IS NOT NULL) AS rebook_requested
    FROM reservations r
    LEFT JOIN rebook_requests rr ON rr.reservation_id = r.id AND rr.status = 'pending'
    WHERE r.uv_slot_id = ? AND r.status != 'cancelled'
    ORDER BY r.id ASC
");
$stmt->bind_param("i", $slot_id);
$stmt->execute();
$result = $stmt->get_result();

$bookings = [];
while ($row = $result->fetch_assoc()) {
    $bookings[] = [
        "id"              => (int)$row["id"],
        "passenger_name"  => $row["passenger_name"],
        "passenger_phone" => $row["passenger_phone"],
        "passenger_age"   => $row["passenger_age"] !== null ? (int)$row["passenger_age"] : null,
        "fare_amount"     => (float)$row["fare_amount"],
        "discount_type"   => $row["discount_type"],
        "boarding_status" => $row["boarding_status"],
        "boarded_at"      => $row["boarded_at"],
        "created_at"      => $row["created_at"],
        "rebook_requested" => (bool)$row["rebook_requested"],
    ];
}

echo json_encode(["success" => true, "bookings" => $bookings]);
