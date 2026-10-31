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

$stmt = $conn->prepare("SELECT id, capacity, seats_booked, status FROM uv_sessions WHERE driver_id = ? AND status IN ('open', 'full') LIMIT 1");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$session = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$session) {
    echo json_encode(["success" => true, "session" => null, "passengers" => []]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, passenger_name, passenger_phone, passenger_age, fare_amount,
           discount_type, boarding_status, queue_number, boarded_at
    FROM reservations
    WHERE uv_session_id = ? AND status != 'cancelled'
    ORDER BY queue_number ASC
");
$stmt->bind_param("i", $session["id"]);
$stmt->execute();
$result = $stmt->get_result();

$passengers = [];
while ($row = $result->fetch_assoc()) {
    $passengers[] = [
        "id"              => (int)$row["id"],
        "passenger_name"  => $row["passenger_name"],
        "passenger_phone" => $row["passenger_phone"],
        "passenger_age"   => $row["passenger_age"] !== null ? (int)$row["passenger_age"] : null,
        "fare_amount"     => (float)$row["fare_amount"],
        "discount_type"   => $row["discount_type"],
        "boarding_status" => $row["boarding_status"],
        "queue_number"    => $row["queue_number"] !== null ? (int)$row["queue_number"] : null,
        "boarded_at"      => $row["boarded_at"],
    ];
}

echo json_encode([
    "success" => true,
    "session" => [
        "id"           => (int)$session["id"],
        "capacity"     => (int)$session["capacity"],
        "seats_booked" => (int)$session["seats_booked"],
        "status"       => $session["status"],
    ],
    "passengers" => $passengers,
]);
