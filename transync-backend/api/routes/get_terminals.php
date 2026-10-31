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

// Public (no auth) — feeds the commuter map's always-visible terminal pins. A terminal
// can host more than one route (e.g. a shared hub), so this returns one row per
// terminal with a nested list of every route departing from there, each carrying its
// own description and stopover terminals (other terminals_it passes by along the way).

$terminalRes = $conn->query("
    SELECT id, terminal_name, vehicle_type, latitude, longitude
    FROM terminals
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY id ASC
");
$terminals = [];
while ($row = $terminalRes->fetch_assoc()) {
    $terminals[(int)$row['id']] = [
        "terminal_id"   => (int)$row['id'],
        "terminal_name" => $row['terminal_name'],
        "vehicle_type"  => $row['vehicle_type'],
        "latitude"      => (float)$row['latitude'],
        "longitude"     => (float)$row['longitude'],
        "routes"        => [],
    ];
}

if (!empty($terminals)) {
    $routeRes = $conn->query("
        SELECT r.id, r.terminal_id, r.name, r.vehicle_type, r.color, r.description, r.direction_type
        FROM routes r
        WHERE r.status = 'active' AND r.terminal_id IS NOT NULL
        ORDER BY r.id ASC
    ");

    $routesById = [];
    while ($row = $routeRes->fetch_assoc()) {
        $tId = (int)$row['terminal_id'];
        if (!isset($terminals[$tId])) continue; // terminal has no coords, skip
        $routeEntry = [
            "route_id"       => (int)$row['id'],
            "route_name"     => $row['name'],
            "vehicle_type"   => $row['vehicle_type'],
            "color"          => $row['color'] ?? '#1a4a52',
            "description"    => $row['description'],
            "direction_type" => $row['direction_type'] ?? 'one_way',
            "stopovers"      => [],
        ];
        $routesById[(int)$row['id']] = $routeEntry;
        $terminals[$tId]['routes'][] = &$routesById[(int)$row['id']];
    }

    if (!empty($routesById)) {
        $ids = implode(',', array_map('intval', array_keys($routesById)));
        $stopRes = $conn->query("
            SELECT rs.route_id, t.id AS terminal_id, t.terminal_name
            FROM route_stopovers rs
            JOIN terminals t ON t.id = rs.terminal_id
            WHERE rs.route_id IN ($ids)
        ");
        while ($row = $stopRes->fetch_assoc()) {
            $rId = (int)$row['route_id'];
            if (isset($routesById[$rId])) {
                $routesById[$rId]['stopovers'][] = [
                    "terminal_id"   => (int)$row['terminal_id'],
                    "terminal_name" => $row['terminal_name'],
                ];
            }
        }
    }
}

// Drop terminals that ended up with no active routes (orphaned pins)
$terminals = array_values(array_filter($terminals, fn($t) => !empty($t['routes'])));

echo json_encode([
    "success"   => true,
    "terminals" => $terminals,
]);
