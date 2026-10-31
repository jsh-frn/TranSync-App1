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

$driver_id = intval($_GET['driver_id'] ?? 0);

if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "Missing driver_id"]);
    exit;
}

// Get the route assigned to this driver — a read-through of whichever
// vehicle the driver currently holds (routes belong to vehicles, not
// drivers; see migration 056). Waypoints are stored as a JSON string
// directly in routes.waypoints column.
$stmt = $conn->prepare("
    SELECT
        r.id,
        r.name,
        r.color,
        r.waypoints,
        r.from_location,
        r.to_location
    FROM drivers d
    JOIN route_assignments ra ON ra.vehicle_id = d.vehicle_id
    JOIN routes r ON r.id = ra.route_id
    WHERE d.id = ?
    LIMIT 1
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row) {
    echo json_encode(["success" => true, "assigned" => false]);
    exit;
}

// Decode the JSON waypoints stored directly in the routes table
$waypoints = [];
if (!empty($row['waypoints'])) {
    $decoded = json_decode($row['waypoints'], true);
    if (is_array($decoded)) {
        foreach ($decoded as $wp) {
            // Support both {latitude, longitude} and {lat, lng} key formats
            $lat = floatval($wp['latitude']  ?? $wp['lat'] ?? 0);
            $lng = floatval($wp['longitude'] ?? $wp['lng'] ?? 0);
            if ($lat !== 0.0 && $lng !== 0.0) {
                $waypoints[] = ["latitude" => $lat, "longitude" => $lng];
            }
        }
    }
}

// Need at least 2 points to draw a meaningful route line
if (count($waypoints) < 2) {
    echo json_encode(["success" => true, "assigned" => false]);
    exit;
}

echo json_encode([
    "success"  => true,
    "assigned" => true,
    "route"    => [
        "id"        => (int)$row['id'],
        "name"      => $row['name'] ?? ($row['from_location'] . ' → ' . $row['to_location']),
        "color"     => $row['color'] ?? '#1a4a52',
        "waypoints" => $waypoints,
    ],
]);
