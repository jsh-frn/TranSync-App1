<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$data    = json_decode(file_get_contents("php://input"), true);
$ride_id = intval($data['ride_id'] ?? 0);

if (!$ride_id) {
    echo json_encode(["success" => false, "message" => "Missing ride_id"]);
    exit;
}

$stmt = $conn->prepare("
    UPDATE jeepney_rides
    SET status = 'active', dropoff_lat = NULL, dropoff_lng = NULL
    WHERE id = ? AND status = 'dropoff_requested'
");
$stmt->bind_param("i", $ride_id);
$stmt->execute();

echo json_encode(["success" => true]);