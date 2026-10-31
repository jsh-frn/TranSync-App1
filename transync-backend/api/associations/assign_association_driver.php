<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$data           = json_decode(file_get_contents("php://input"), true);
$association_id = (int)($data['association_id'] ?? 0);
$route_id       = (int)($data['route_id']       ?? 0);
$driver_id      = (int)($data['driver_id']      ?? 0);
$action         = trim($data['action']          ?? ''); // 'assign' | 'unassign'

if (!$association_id || !$driver_id || !in_array($action, ['assign', 'unassign'])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Missing required fields."]);
    exit;
}

// Verify the driver's own vehicle type is approved for this operator at this
// association — membership is per-vehicle-type now (operator_association_applications),
// not a single operators.association_id, so a Bus-approved operator's Jeepney
// driver (if any) still isn't manageable by a Bus association.
$stmt = $conn->prepare("
    SELECT d.id FROM drivers d
    JOIN vehicles v ON v.id = d.vehicle_id
    JOIN operator_association_applications oaa
        ON oaa.operator_id = d.operator_id AND oaa.vehicle_type = v.type AND oaa.status = 'approved'
    WHERE oaa.association_id = ? AND d.id = ?
");
$stmt->bind_param("ii", $association_id, $driver_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    http_response_code(403);
    echo json_encode(["success" => false, "message" => "This driver is not approved under your association."]);
    exit;
}

// A route belongs to the driver's currently-assigned VEHICLE now (migration
// 056), not the driver directly — this endpoint resolves that vehicle and
// writes/clears route_assignments keyed by vehicle_id, so a route set here
// is reflected everywhere else the same way one set from Add/Edit Vehicle is.
$stmt = $conn->prepare("SELECT vehicle_id FROM drivers WHERE id = ?");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$vehicle_id = $stmt->get_result()->fetch_assoc()["vehicle_id"] ?? null;
if (!$vehicle_id) {
    http_response_code(409);
    echo json_encode(["success" => false, "message" => "This driver has no vehicle assigned yet."]);
    exit;
}

if ($action === 'unassign') {
    $stmt = $conn->prepare("DELETE FROM route_assignments WHERE vehicle_id = ?");
    $stmt->bind_param("i", $vehicle_id);
    $stmt->execute();
    echo json_encode(["success" => true, "message" => "Driver unassigned."]);
    exit;
}

// Assign — verify route belongs to this association
$stmt = $conn->prepare("SELECT id FROM routes WHERE id = ? AND association_id = ?");
$stmt->bind_param("ii", $route_id, $association_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    http_response_code(403);
    echo json_encode(["success" => false, "message" => "Route not found or does not belong to your association."]);
    exit;
}

// Upsert — replace any existing assignment for this vehicle
$stmt = $conn->prepare("
    INSERT INTO route_assignments (route_id, vehicle_id)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE route_id = VALUES(route_id), assigned_at = NOW()
");
$stmt->bind_param("ii", $route_id, $vehicle_id);
if ($stmt->execute()) {
    echo json_encode(["success" => true, "message" => "Driver assigned to route."]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Assignment failed: " . $conn->error]);
}