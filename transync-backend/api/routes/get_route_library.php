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

function waypointHash(array $waypoints): string {
    $normalized = array_map(function ($wp) {
        return [round($wp['latitude'], 5), round($wp['longitude'], 5)];
    }, $waypoints);
    return md5(json_encode($normalized));
}

$stmt = $conn->prepare("
    SELECT
        r.id,
        r.name,
        r.from_location,
        r.to_location,
        r.color,
        r.vehicle_type,
        r.description,
        r.direction_type,
        r.waypoints,
        r.operator_id,
        r.association_id,
        o.name          AS operator_name,
        o.operator_type,
        a.name          AS association_name
    FROM routes r
    LEFT JOIN operators    o ON o.id = r.operator_id
    LEFT JOIN associations a ON a.id = r.association_id
    WHERE r.status    = 'active'
      AND r.waypoints IS NOT NULL
      AND r.waypoints != '[]'
      AND r.waypoints != ''
    ORDER BY r.id ASC
");
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$seen   = [];   // hash → true, for deduplication
$routes = [];

foreach ($rows as $row) {
    $decoded = json_decode($row['waypoints'], true);
    if (!is_array($decoded) || count($decoded) < 2) continue;

    $waypoints = [];
    foreach ($decoded as $wp) {
        $lat = floatval($wp['latitude'] ?? $wp['lat'] ?? 0);
        $lng = floatval($wp['longitude'] ?? $wp['lng'] ?? 0);
        if ($lat !== 0.0 && $lng !== 0.0) {
            $waypoints[] = ["latitude" => $lat, "longitude" => $lng];
        }
    }
    if (count($waypoints) < 2) continue;

    $hash = waypointHash($waypoints);
    if (isset($seen[$hash])) continue;   // identical path already in list
    $seen[$hash] = true;

    if (!empty($row['association_id'])) {
        $contributor = $row['association_name'] ?? "Association";
    } elseif (!empty($row['operator_id'])) {
        $contributor = ($row['operator_name'] ?? "Operator")
            . ($row['operator_type'] ? " · " . $row['operator_type'] : "");
    } else {
        $contributor = null;
    }

    $routes[] = [
        "id"            => (int)$row['id'],
        "name"          => $row['name'],
        "from_location" => $row['from_location'],
        "to_location"   => $row['to_location'],
        "color"         => $row['color'] ?? "#1a4a52",
        "vehicle_type"  => $row['vehicle_type'] ?? "Jeepney",
        "description"   => $row['description'] ?? null,
        "direction_type"=> $row['direction_type'] ?? 'one_way',
        "waypoints"     => $waypoints,
        "operator_id"    => $row['operator_id']    !== null ? (int)$row['operator_id']    : null,
        "association_id" => $row['association_id'] !== null ? (int)$row['association_id'] : null,
        "contributor"   => $contributor,
        "waypoint_count"=> count($waypoints),
    ];
}

// Return newest-first for display, while deduplication used oldest-first selection
$routes = array_reverse($routes);

echo json_encode(["success" => true, "routes" => $routes, "total" => count($routes)]);
