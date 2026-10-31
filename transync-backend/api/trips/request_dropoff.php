<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$data        = json_decode(file_get_contents("php://input"), true);
$ride_id     = intval($data['ride_id']      ?? 0);
$dropoff_lat = floatval($data['dropoff_lat'] ?? 0);
$dropoff_lng = floatval($data['dropoff_lng'] ?? 0);

if (!$ride_id) {
    echo json_encode(["success" => false, "message" => "Missing ride_id"]);
    exit;
}

// Mark ride as dropoff_requested and store the commuter's current location
$stmt = $conn->prepare("
    UPDATE jeepney_rides
    SET status = 'dropoff_requested',
        dropoff_lat = ?,
        dropoff_lng = ?
    WHERE id = ? AND status = 'active'
");
$stmt->bind_param("ddi", $dropoff_lat, $dropoff_lng, $ride_id);
$stmt->execute();

if ($stmt->affected_rows === 0) {
    echo json_encode(["success" => false, "message" => "Ride not found or already ended"]);
    exit;
}

echo json_encode(["success" => true, "message" => "Drop off requested"]);