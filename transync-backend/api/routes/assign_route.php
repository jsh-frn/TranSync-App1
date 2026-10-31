<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Operator assigns one of their own association's routes to one of their own
// drivers — the association creates/owns the route (see Core Flow 8/13,
// save_route.php), the operator just picks it for their fleet. Mirrors
// associations/assign_association_driver.php's exact validation shape, just
// scoped by operator_id instead of association_id.
$data        = json_decode(file_get_contents("php://input"), true);
$operator_id = (int)($data['operator_id'] ?? 0);
$route_id    = (int)($data['route_id']    ?? 0);
$driver_id   = (int)($data['driver_id']   ?? 0);
$action      = trim($data['action']       ?? 'assign'); // 'assign' or 'unassign'

if (!$operator_id || !$driver_id) {
    echo json_encode(["success" => false, "message" => "operator_id and driver_id are required."]);
    exit;
}

// Driver must belong to this operator
$stmt = $conn->prepare("SELECT id FROM drivers WHERE id = ? AND operator_id = ?");
$stmt->bind_param("ii", $driver_id, $operator_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "Driver not found under your account."]);
    exit;
}
$stmt->close();

// route_assignments is vehicle-keyed (migration 056) — every reader joins on
// vehicle_id, so this endpoint must write/delete by the driver's current
// vehicle too, or the assignment is invisible everywhere.
$stmt = $conn->prepare("SELECT vehicle_id FROM drivers WHERE id = ?");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$vehicle_id = (int)($stmt->get_result()->fetch_assoc()["vehicle_id"] ?? 0);
$stmt->close();

if ($action === 'unassign') {
    if ($vehicle_id) {
        $stmt = $conn->prepare("DELETE FROM route_assignments WHERE vehicle_id = ?");
        $stmt->bind_param("i", $vehicle_id);
        $stmt->execute();
    }
    echo json_encode(["success" => true, "action" => "unassigned"]);
    exit;
}

if (!$route_id) {
    echo json_encode(["success" => false, "message" => "Missing route_id"]);
    exit;
}

// Route must belong to an association where this operator has an approved
// membership matching the driver's own assigned vehicle's type — a driver
// with no vehicle assigned yet has no type to match against, so can't be
// assigned a route until a vehicle is assigned (Vehicles tab).
$stmt = $conn->prepare("
    SELECT r.id FROM routes r
    JOIN drivers d ON d.id = ?
    JOIN vehicles v ON v.id = d.vehicle_id
    JOIN operator_association_applications oaa
        ON oaa.association_id = r.association_id AND oaa.vehicle_type = v.type AND oaa.status = 'approved'
    WHERE r.id = ? AND oaa.operator_id = ? AND r.vehicle_type = v.type
");
$stmt->bind_param("iii", $driver_id, $route_id, $operator_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "This route isn't available to this driver — check the driver has a vehicle assigned and your operator account is approved for its type at the route's association."]);
    exit;
}
$stmt->close();

// Upsert — replace the existing assignment for this driver's vehicle
// (validated above: the driver has a vehicle, so $vehicle_id is set).
$stmt = $conn->prepare("
    INSERT INTO route_assignments (route_id, vehicle_id)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE route_id = VALUES(route_id), assigned_at = NOW()
");
$stmt->bind_param("ii", $route_id, $vehicle_id);
$stmt->execute();

echo json_encode(["success" => true, "action" => "assigned", "route_id" => $route_id, "driver_id" => $driver_id]);
