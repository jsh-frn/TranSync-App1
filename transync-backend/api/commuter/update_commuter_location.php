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

$data            = json_decode(file_get_contents("php://input"), true);
$commuter_id     = $data["commuter_id"]     ?? null;
$latitude        = $data["latitude"]        ?? null;
$longitude       = $data["longitude"]       ?? null;
$destination_lat = $data["destination_lat"] ?? null;
$destination_lng = $data["destination_lng"] ?? null;
$is_looking      = isset($data["is_looking"]) ? (int)$data["is_looking"] : 1;

if (!$commuter_id || $latitude === null || $longitude === null) {
    http_response_code(400);
    echo json_encode(["message" => "commuter_id, latitude, and longitude are required."]);
    exit;
}

$stmt = $conn->prepare("
    UPDATE commuters
    SET
        latitude            = ?,
        longitude           = ?,
        destination_lat     = ?,
        destination_lng     = ?,
        is_looking          = ?,
        location_updated_at = NOW()
    WHERE id = ?
");
$stmt->bind_param(
    "dddiii",
    $latitude,
    $longitude,
    $destination_lat,
    $destination_lng,
    $is_looking,
    $commuter_id
);

if ($stmt->execute()) {
    echo json_encode(["message" => "Location updated."]);
} else {
    http_response_code(500);
    echo json_encode(["message" => "Failed to update location.", "error" => $conn->error]);
}