<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$operator_id = (int)($_GET['operator_id'] ?? 0);

if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

// ── 1. Operator-owned routes (legacy — drawn by the operator themselves,
// before route creation moved to being association-only; kept working for
// any pre-existing rows, never produced by current route creation) ──────────
$stmt = $conn->prepare("
    SELECT id, name, color, waypoints, created_at, from_location, to_location, vehicle_type, status
    FROM routes
    WHERE operator_id = ?
      AND (association_id IS NULL OR association_id = 0)
      AND waypoints IS NOT NULL
    ORDER BY created_at DESC
");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$operator_routes = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// ── 2. Association-owned routes assigned to this operator's vehicles ──────────
// Routes belong to vehicles now (migration 056), not whoever's driving —
// find all vehicles owned by this operator that have a route assigned
// belonging to an association.
$stmt = $conn->prepare("
    SELECT DISTINCT r.id, r.name, r.color, r.waypoints, r.created_at,
                    r.from_location, r.to_location, r.vehicle_type, r.status, a.name AS association_name
    FROM vehicles v
    JOIN route_assignments ra ON ra.vehicle_id = v.id
    JOIN routes r             ON r.id = ra.route_id
    LEFT JOIN associations a  ON a.id = r.association_id
    WHERE v.operator_id = ?
      AND r.association_id IS NOT NULL
      AND r.waypoints IS NOT NULL
");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$assoc_routes = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// ── Build response — merge both sets ─────────────────────────────────────────
$routes    = [];
$seen_ids  = [];

$buildRoute = function($route, $conn, $assoc_name = null) use (&$seen_ids) {
    $route_id = (int)$route['id'];
    if (in_array($route_id, $seen_ids)) return null;
    $seen_ids[] = $route_id;

    // Drivers "on" a route are derived from whichever vehicle the route is
    // assigned to (migration 056) — a vehicle with no driver yet simply
    // contributes no rows here.
    $stmt2 = $conn->prepare("
        SELECT d.id, d.name, d.latitude, d.longitude, d.is_online, d.is_full
        FROM route_assignments ra
        JOIN vehicles v ON v.id = ra.vehicle_id
        JOIN drivers d  ON d.vehicle_id = v.id
        WHERE ra.route_id = ?
    ");
    $stmt2->bind_param("i", $route_id);
    $stmt2->execute();
    $drivers = $stmt2->get_result()->fetch_all(MYSQLI_ASSOC);

    return [
        "id"               => $route_id,
        "name"             => $route['name'] ?? ($route['from_location'] . ' → ' . $route['to_location']),
        "color"            => $route['color'] ?? '#1a4a52',
        "vehicle_type"     => $route['vehicle_type'] ?? null,
        "status"           => $route['status'] ?? 'active',
        "waypoints"        => $route['waypoints'] ? json_decode($route['waypoints'], true) : [],
        "created_at"       => $route['created_at'],
        "association_name" => $assoc_name,
        "drivers"          => $drivers,
    ];
};

foreach ($operator_routes as $route) {
    $r = $buildRoute($route, $conn, null);
    if ($r) $routes[] = $r;
}

foreach ($assoc_routes as $route) {
    $r = $buildRoute($route, $conn, $route['association_name'] ?? null);
    if ($r) $routes[] = $r;
}

echo json_encode(["success" => true, "routes" => $routes]);