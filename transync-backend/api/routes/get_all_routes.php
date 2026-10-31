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

// Returns only routes that have at least one driver currently online and
// assigned to them. This ensures the commuter map only shows routes that
// are actually being served right now.
//
// If no drivers are online at all, falls back to returning all active
// routes so the commuter can still see where jeepneys normally go.

$stmt = $conn->prepare("
    SELECT DISTINCT
        r.id,
        r.name,
        r.color,
        r.waypoints,
        r.from_location,
        r.to_location,
        r.operator_id,
        r.direction_type,
        o.name          AS operator_name,
        o.operator_type
    FROM routes r
    LEFT JOIN operators o     ON o.id       = r.operator_id
    JOIN route_assignments ra ON ra.route_id = r.id
    JOIN vehicles v           ON v.id        = ra.vehicle_id
    JOIN drivers d            ON d.vehicle_id = v.id
    WHERE r.status       = 'active'
      AND r.waypoints    IS NOT NULL
      AND r.waypoints    != '[]'
      AND r.waypoints    != ''
      AND d.is_online    = 1
      AND d.latitude     IS NOT NULL
      AND d.longitude    IS NOT NULL
      AND d.location_updated_at >= NOW() - INTERVAL 2 MINUTE
    ORDER BY r.id ASC
");
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// If no drivers are online, fall back to all active routes
if (empty($rows)) {
    $stmt2 = $conn->prepare("
        SELECT
            r.id,
            r.name,
            r.color,
            r.waypoints,
            r.from_location,
            r.to_location,
            r.operator_id,
            r.direction_type,
            o.name          AS operator_name,
            o.operator_type
        FROM routes r
        LEFT JOIN operators o ON o.id = r.operator_id
        WHERE r.status    = 'active'
          AND r.waypoints IS NOT NULL
          AND r.waypoints != '[]'
          AND r.waypoints != ''
          AND (r.operator_id IS NOT NULL OR r.association_id IS NOT NULL)
        ORDER BY r.id ASC
    ");
    $stmt2->execute();
    $rows = $stmt2->get_result()->fetch_all(MYSQLI_ASSOC);
}

$routes = [];

foreach ($rows as $row) {
    $decoded = json_decode($row['waypoints'], true);
    if (!is_array($decoded) || count($decoded) < 2) continue;

    // Normalise waypoints — support {latitude,longitude} and {lat,lng}
    $waypoints = [];
    foreach ($decoded as $wp) {
        $lat = floatval($wp['latitude']  ?? $wp['lat'] ?? 0);
        $lng = floatval($wp['longitude'] ?? $wp['lng'] ?? 0);
        if ($lat !== 0.0 && $lng !== 0.0) {
            $waypoints[] = ["latitude" => $lat, "longitude" => $lng];
        }
    }
    if (count($waypoints) < 2) continue;

    $routes[] = [
        "id"            => (int)$row['id'],
        "name"          => $row['name'] ?? ($row['from_location'] . ' → ' . $row['to_location']),
        "color"         => $row['color'] ?? '#1a4a52',
        "from_location" => $row['from_location'],
        "to_location"   => $row['to_location'],
        "operator_id"   => (int)$row['operator_id'],
        "operator_name" => $row['operator_name'],
        "operator_type" => $row['operator_type'],
        "direction_type"=> $row['direction_type'] ?? 'one_way',
        "waypoints"     => $waypoints,
    ];
}

echo json_encode([
    "success" => true,
    "routes"  => $routes,
]);