<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";

$driver_id = $_GET['driver_id'] ?? null;
$lat       = floatval($_GET['lat'] ?? 0);
$lng       = floatval($_GET['lng'] ?? 0);

if (!$driver_id || !$lat || !$lng) {
    http_response_code(400);
    echo json_encode(["message" => "driver_id, lat, and lng are required."]);
    exit;
}

// 1. Verify the driver exists
$stmt = $conn->prepare("SELECT id FROM drivers WHERE id = ?");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$driver = $stmt->get_result()->fetch_assoc();

if (!$driver) {
    http_response_code(404);
    echo json_encode(["message" => "Driver not found."]);
    exit;
}

// 2. Get commuters who are:
//    - actively looking (is_looking = 1)
//    - location updated within last 30 seconds (still on screen)
//    - within 10km of driver's current position
$stmt = $conn->prepare("
    SELECT
        c.id,
        c.name,
        c.category,
        c.latitude,
        c.longitude,
        c.destination_lat,
        c.destination_lng,
        c.location_updated_at,
        (
            6371 * ACOS(
                LEAST(1.0, COS(RADIANS(?)) * COS(RADIANS(c.latitude))
                * COS(RADIANS(c.longitude) - RADIANS(?))
                + SIN(RADIANS(?)) * SIN(RADIANS(c.latitude)))
            )
        ) AS distance_km
    FROM commuters c
    WHERE
        c.is_looking    = 1
        AND c.latitude  IS NOT NULL
        AND c.longitude IS NOT NULL
        AND c.location_updated_at >= NOW() - INTERVAL 30 SECOND
    HAVING distance_km <= 10
    ORDER BY distance_km ASC
");
$stmt->bind_param("ddd", $lat, $lng, $lat);
$stmt->execute();
$result    = $stmt->get_result();
$commuters = [];

while ($row = $result->fetch_assoc()) {
    $commuters[] = [
        "id"                  => (int)$row["id"],
        "name"                => $row["name"],
        "category"            => $row["category"],
        "latitude"            => (float)$row["latitude"],
        "longitude"           => (float)$row["longitude"],
        "destination_lat"     => $row["destination_lat"] ? (float)$row["destination_lat"] : null,
        "destination_lng"     => $row["destination_lng"] ? (float)$row["destination_lng"] : null,
        "distance_km"         => round((float)$row["distance_km"], 3),
        "location_updated_at" => $row["location_updated_at"],
    ];
}

echo json_encode([
    "commuters" => $commuters,
]);