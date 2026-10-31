<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$association_id = (int)($_GET['association_id'] ?? 0);

if (!$association_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "association_id is required."]);
    exit;
}

// Fetch all routes belonging to this association
$stmt = $conn->prepare("
    SELECT r.id, r.name, r.color, r.waypoints, r.has_waypoints, r.status, r.from_location, r.to_location,
           r.description, r.fare, r.vehicle_type, r.direction_type,
           t.id AS terminal_id, t.terminal_name, t.vehicle_type AS terminal_vehicle_type,
           t.latitude AS terminal_lat, t.longitude AS terminal_lng
    FROM routes r
    LEFT JOIN terminals t ON t.id = r.terminal_id
    WHERE r.association_id = ?
    ORDER BY r.name ASC
");
$stmt->bind_param("i", $association_id);
$stmt->execute();
$result = $stmt->get_result();

$routes = [];
while ($row = $result->fetch_assoc()) {
    $waypoints = [];
    if ($row['waypoints']) {
        $decoded = json_decode($row['waypoints'], true);
        if (is_array($decoded)) $waypoints = $decoded;
    }

    // Fetch assigned drivers for this route — a read-through of whichever
    // vehicle is assigned to it (routes belong to vehicles now, migration 056).
    $dStmt = $conn->prepare("
        SELECT d.id, d.name, d.latitude, d.longitude, d.is_online, d.is_full
        FROM route_assignments ra
        JOIN vehicles v ON v.id = ra.vehicle_id
        JOIN drivers d  ON d.vehicle_id = v.id
        WHERE ra.route_id = ?
    ");
    $dStmt->bind_param("i", $row['id']);
    $dStmt->execute();
    $dResult = $dStmt->get_result();
    $drivers = [];
    while ($d = $dResult->fetch_assoc()) {
        $drivers[] = [
            "id"        => (int)$d['id'],
            "name"      => $d['name'],
            "latitude"  => (float)$d['latitude'],
            "longitude" => (float)$d['longitude'],
            "is_online" => (int)$d['is_online'],
            "is_full"   => (int)$d['is_full'],
        ];
    }

    // Stopover terminals this route passes by along the way
    $sStmt = $conn->prepare("
        SELECT t.id, t.terminal_name
        FROM route_stopovers rs
        JOIN terminals t ON t.id = rs.terminal_id
        WHERE rs.route_id = ?
    ");
    $sStmt->bind_param("i", $row['id']);
    $sStmt->execute();
    $sResult = $sStmt->get_result();
    $stopovers = [];
    while ($s = $sResult->fetch_assoc()) {
        $stopovers[] = ["terminal_id" => (int)$s['id'], "terminal_name" => $s['terminal_name']];
    }

    $routes[] = [
        "id"                    => (int)$row['id'],
        "name"                  => $row['name'],
        "color"                 => $row['color'],
        "waypoints"             => $waypoints,
        "has_waypoints"         => (int)$row['has_waypoints'],
        "status"                => $row['status'],
        "from_location"         => $row['from_location'],
        "to_location"           => $row['to_location'],
        "description"           => $row['description'],
        "fare"                  => $row['fare'] !== null ? (float)$row['fare'] : null,
        "vehicle_type"          => $row['vehicle_type'],
        "direction_type"        => $row['direction_type'] ?? 'one_way',
        "drivers"               => $drivers,
        "terminal_id"           => $row['terminal_id']  !== null ? (int)$row['terminal_id'] : null,
        "terminal_name"         => $row['terminal_name'] ?? null,
        "terminal_vehicle_type" => $row['terminal_vehicle_type'] ?? null,
        "terminal_lat"          => $row['terminal_lat']  !== null ? (float)$row['terminal_lat'] : null,
        "terminal_lng"          => $row['terminal_lng']  !== null ? (float)$row['terminal_lng'] : null,
        "stopovers"             => $stopovers,
    ];
}

echo json_encode(["success" => true, "routes" => $routes]);