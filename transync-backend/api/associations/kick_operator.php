<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";

$data           = json_decode(file_get_contents("php://input"), true);
$association_id = (int)($data['association_id'] ?? 0);
$operator_id    = (int)($data['operator_id']     ?? 0);
$vehicle_type   = trim($data['vehicle_type']     ?? "");

if (!$association_id || !$operator_id || !in_array($vehicle_type, ["Jeepney", "UV Express", "Bus"], true)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "association_id, operator_id, and a valid vehicle_type are required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id FROM operator_association_applications
    WHERE operator_id = ? AND association_id = ? AND vehicle_type = ? AND status = 'approved'
");
$stmt->bind_param("iis", $operator_id, $association_id, $vehicle_type);
$stmt->execute();
$app = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$app) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Operator is not an approved {$vehicle_type} member of this association."]);
    exit;
}

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("UPDATE operator_association_applications SET status = 'removed' WHERE id = ?");
    $stmt->bind_param("i", $app["id"]);
    $stmt->execute();
    $stmt->close();

    // Unassign only this operator's vehicles OF THIS VEHICLE TYPE from any
    // association-owned routes they held via this membership (routes belong
    // to vehicles now, migration 056 — no driver hop needed).
    $stmt = $conn->prepare("
        DELETE ra FROM route_assignments ra
        JOIN vehicles v ON v.id = ra.vehicle_id
        WHERE v.operator_id = ? AND v.type = ?
    ");
    $stmt->bind_param("is", $operator_id, $vehicle_type);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
    echo json_encode(["success" => true, "message" => "Operator has been removed from the association for {$vehicle_type}."]);
} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to remove operator."]);
}
