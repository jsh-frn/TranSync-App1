<?php
error_reporting(E_ALL);
ini_set('display_errors', 0);
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$data           = json_decode(file_get_contents("php://input"), true);
$operator_id    = (int)($data['operator_id']    ?? 0);
$association_id = ($data['association_id'] ?? 0) ? (int)$data['association_id'] : null;
$name           = trim($data['name']            ?? '');
$from_location  = trim($data['from_location']   ?? '');
$to_location    = trim($data['to_location']     ?? '');
$description    = trim($data['description']     ?? '');
$direction_type = trim($data['direction_type']  ?? 'one_way');
if (!in_array($direction_type, ['one_way', 'vice_versa'], true)) $direction_type = 'one_way';
$color          = trim($data['color']           ?? '#1a4a52');
$waypoints      = $data['waypoints']            ?? [];
$route_id       = (int)($data['route_id']       ?? 0);

// Terminal: either reuse an existing one (terminal_id) or create a new one
// (terminal_name + terminal_lat + terminal_lng + terminal_vehicle_type) — the point
// the route departs from. A terminal can host more than one route.
$terminal_id_in       = (int)($data['terminal_id']            ?? 0);
$terminal_name        = trim($data['terminal_name']           ?? '');
$terminal_lat         = isset($data['terminal_lat']) ? (float)$data['terminal_lat'] : null;
$terminal_lng         = isset($data['terminal_lng']) ? (float)$data['terminal_lng'] : null;
$terminal_vehicle_type= trim($data['terminal_vehicle_type']   ?? '');

// Stopovers: other existing terminals this route passes by along the way.
$stopoverIds = array_values(array_unique(array_filter(array_map('intval', $data['stopover_terminal_ids'] ?? []))));

// Routes are association-owned for every vehicle type now (this mirrors what
// was already true for Bus specifically — see Do Not Break rule #25 — the
// operator-owned path below is kept only so legacy rows already in the DB
// keep working, never reachable for a *new* route creation from the UI).
if (!$association_id) {
    echo json_encode(["success" => false, "message" => "Routes can only be created by an association — ask your association to add this route."]);
    exit;
}

if (!$name || count($waypoints) < 2) {
    echo json_encode([
        "success" => false,
        "message" => "Route name and at least 2 waypoints are required.",
        "debug"   => ["name" => $name, "waypoint_count" => count($waypoints)],
    ]);
    exit;
}

// A brand-new route must depart from a terminal — either an existing one or a freshly
// pinpointed one. Editing an existing route (route_id > 0) can leave its terminal as-is.
$hasNewTerminal = $terminal_name !== '' && $terminal_lat !== null && $terminal_lng !== null;
if ($route_id === 0 && !$terminal_id_in && !$hasNewTerminal) {
    echo json_encode([
        "success" => false,
        "message" => "A terminal must be pinpointed before a route can be drawn.",
    ]);
    exit;
}

// Resolve terminal_id to write onto the route (null = leave existing value untouched on update).
// The route's vehicle_type is derived from the terminal it departs from — not
// from any per-account type field (operators.operator_type/associations.association_type
// are deprecated and don't reflect multi-vehicle-type membership — see Core Flow 8)
// — since the terminal is the one place the association explicitly picks a
// type per route, via the terminal-placement step in route-builder.tsx.
$resolvedTerminalId   = null;
$resolvedVehicleType  = null; // null = leave the route's existing vehicle_type untouched (edit, no terminal change)
$validVehicleTypes    = ['Jeepney', 'UV Express', 'Bus'];

if ($terminal_id_in > 0) {
    // Reusing an existing terminal (possibly already serving other routes too) —
    // verify it belongs to the same owner.
    $ts = $conn->prepare("SELECT id, terminal_name, vehicle_type FROM terminals WHERE id = ? AND (association_id <=> ?) AND (operator_id <=> ?)");
    $ownerOperatorId = $association_id ? null : ($operator_id ?: null);
    $ts->bind_param("iii", $terminal_id_in, $association_id, $ownerOperatorId);
    $ts->execute();
    $tr = $ts->get_result()->fetch_assoc();
    $ts->close();
    if (!$tr) {
        echo json_encode(["success" => false, "message" => "Terminal not found or not owned by this account."]);
        exit;
    }
    $resolvedTerminalId = (int)$tr['id'];
    if (in_array($tr['vehicle_type'], $validVehicleTypes, true)) $resolvedVehicleType = $tr['vehicle_type'];
    if ($from_location === '') $from_location = $tr['terminal_name'];
} elseif ($hasNewTerminal) {
    $ownerOperatorId = $association_id ? null : ($operator_id ?: null);
    $vt = in_array($terminal_vehicle_type, $validVehicleTypes, true) ? $terminal_vehicle_type : null;
    $ts = $conn->prepare("INSERT INTO terminals (operator_id, association_id, terminal_name, vehicle_type, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)");
    $ts->bind_param("iissdd", $ownerOperatorId, $association_id, $terminal_name, $vt, $terminal_lat, $terminal_lng);
    $ts->execute();
    $resolvedTerminalId = (int)$conn->insert_id;
    $ts->close();
    $resolvedVehicleType = $vt;
    if ($from_location === '') $from_location = $terminal_name;
}

// A brand-new route always resolves a terminal above (enforced earlier), so
// vehicle_type is always known by this point for an INSERT.
if ($route_id === 0 && !$resolvedVehicleType) {
    echo json_encode(["success" => false, "message" => "Could not determine this route's vehicle type from its terminal."]);
    exit;
}
$vehicle_type = $resolvedVehicleType;

$waypoints_json = json_encode($waypoints);
$finalRouteId   = null;

if ($route_id > 0) {
    // UPDATE — verify ownership and refresh vehicle_type
    if ($resolvedTerminalId !== null) {
        if ($association_id) {
            $stmt = $conn->prepare("
                UPDATE routes
                SET name=?, from_location=?, to_location=?, description=?, color=?, waypoints=?,
                    vehicle_type=COALESCE(?, vehicle_type), direction_type=?, terminal_id=?, has_waypoints=1, updated_at=NOW()
                WHERE id=? AND association_id=?
            ");
            if (!$stmt) { echo json_encode(["success" => false, "message" => "Prepare failed: " . $conn->error]); exit; }
            $stmt->bind_param("ssssssssiii", $name, $from_location, $to_location, $description, $color, $waypoints_json, $vehicle_type, $direction_type, $resolvedTerminalId, $route_id, $association_id);
        } else {
            $stmt = $conn->prepare("
                UPDATE routes
                SET name=?, from_location=?, to_location=?, description=?, color=?, waypoints=?,
                    vehicle_type=COALESCE(?, vehicle_type), direction_type=?, terminal_id=?, has_waypoints=1, updated_at=NOW()
                WHERE id=? AND operator_id=?
            ");
            if (!$stmt) { echo json_encode(["success" => false, "message" => "Prepare failed: " . $conn->error]); exit; }
            $stmt->bind_param("ssssssssiii", $name, $from_location, $to_location, $description, $color, $waypoints_json, $vehicle_type, $direction_type, $resolvedTerminalId, $route_id, $operator_id);
        }
    } else {
        if ($association_id) {
            $stmt = $conn->prepare("
                UPDATE routes
                SET name=?, from_location=?, to_location=?, description=?, color=?, waypoints=?,
                    vehicle_type=COALESCE(?, vehicle_type), direction_type=?, has_waypoints=1, updated_at=NOW()
                WHERE id=? AND association_id=?
            ");
            if (!$stmt) { echo json_encode(["success" => false, "message" => "Prepare failed: " . $conn->error]); exit; }
            $stmt->bind_param("ssssssssii", $name, $from_location, $to_location, $description, $color, $waypoints_json, $vehicle_type, $direction_type, $route_id, $association_id);
        } else {
            $stmt = $conn->prepare("
                UPDATE routes
                SET name=?, from_location=?, to_location=?, description=?, color=?, waypoints=?,
                    vehicle_type=COALESCE(?, vehicle_type), direction_type=?, has_waypoints=1, updated_at=NOW()
                WHERE id=? AND operator_id=?
            ");
            if (!$stmt) { echo json_encode(["success" => false, "message" => "Prepare failed: " . $conn->error]); exit; }
            $stmt->bind_param("ssssssssii", $name, $from_location, $to_location, $description, $color, $waypoints_json, $vehicle_type, $direction_type, $route_id, $operator_id);
        }
    }
    try { $stmt->execute(); } catch (Exception $e) { echo json_encode(["success" => false, "message" => $e->getMessage()]); exit; }
    $finalRouteId = $route_id;
} else {
    // INSERT — set owner, vehicle_type, and terminal_id (already validated/created above)
    $stmt = $conn->prepare("
        INSERT INTO routes (operator_id, association_id, terminal_id, name, from_location, to_location, description, color, vehicle_type, direction_type, waypoints, has_waypoints)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ");
    if (!$stmt) { echo json_encode(["success" => false, "message" => "Prepare failed: " . $conn->error]); exit; }
    $stmt->bind_param("iiissssssss", $operator_id, $association_id, $resolvedTerminalId, $name, $from_location, $to_location, $description, $color, $vehicle_type, $direction_type, $waypoints_json);
    try { $stmt->execute(); } catch (Exception $e) { echo json_encode(["success" => false, "message" => $e->getMessage()]); exit; }
    $finalRouteId = (int)$conn->insert_id;
}

// Stopovers — replace wholesale (simplest correct way to handle both create and edit)
$del = $conn->prepare("DELETE FROM route_stopovers WHERE route_id = ?");
$del->bind_param("i", $finalRouteId);
$del->execute();
if (!empty($stopoverIds)) {
    $ins = $conn->prepare("INSERT INTO route_stopovers (route_id, terminal_id) VALUES (?, ?)");
    foreach ($stopoverIds as $stopoverTerminalId) {
        $ins->bind_param("ii", $finalRouteId, $stopoverTerminalId);
        try { $ins->execute(); } catch (Exception $e) { /* skip invalid terminal ids */ }
    }
}

echo json_encode(["success" => true, "route_id" => $finalRouteId, "terminal_id" => $resolvedTerminalId]);
