<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";

$data      = json_decode(file_get_contents("php://input"), true);
$driver_id = $data["driver_id"] ?? null;
$latitude  = $data["latitude"]  ?? null;
$longitude = $data["longitude"] ?? null;
$heading   = $data["heading"]   ?? 0;
$is_online = $data["is_online"] ?? 1;
$is_full   = isset($data["is_full"]) ? (int)$data["is_full"] : null;

if (!$driver_id || $latitude === null || $longitude === null) {
    http_response_code(400);
    echo json_encode(["message" => "driver_id, latitude, and longitude are required."]);
    exit;
}

// Build dynamic update query
if ($is_full !== null) {
    $stmt = $conn->prepare("
        UPDATE drivers
        SET latitude = ?, longitude = ?, heading = ?,
            is_online = ?, is_full = ?,
            location_updated_at = NOW()
        WHERE id = ?
    ");
    $stmt->bind_param("dddiii", $latitude, $longitude, $heading, $is_online, $is_full, $driver_id);
} else {
    $stmt = $conn->prepare("
        UPDATE drivers
        SET latitude = ?, longitude = ?, heading = ?,
            is_online = ?,
            location_updated_at = NOW()
        WHERE id = ?
    ");
    $stmt->bind_param("dddii", $latitude, $longitude, $heading, $is_online, $driver_id);
}

if ($stmt->execute()) {
    echo json_encode(["message" => "Location updated."]);
} else {
    http_response_code(500);
    echo json_encode(["message" => "Failed to update location.", "error" => $conn->error]);
}