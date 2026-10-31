<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";

$data        = json_decode(file_get_contents("php://input"), true);
$operator_id = (int)($data["operator_id"] ?? 0);
$driver_id   = (int)($data["driver_id"]   ?? 0);

if (!$operator_id || !$driver_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id and driver_id are required."]);
    exit;
}

$stmt = $conn->prepare("SELECT id FROM drivers WHERE id = ? AND operator_id = ?");
$stmt->bind_param("ii", $driver_id, $operator_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    http_response_code(403);
    echo json_encode(["success" => false, "message" => "This driver does not belong to your account."]);
    exit;
}
$stmt->close();

$conn->begin_transaction();

try {
    // 1. Delete ALL membership records for this driver (active + any corrupted rows).
    $stmt = $conn->prepare("DELETE FROM association_memberships WHERE subject_type = 'driver' AND subject_id = ?");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $stmt->close();

    // 2. Clear the driver's association_id.
    $stmt = $conn->prepare("UPDATE drivers SET association_id = NULL WHERE id = ?");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $stmt->close();

    // 3. Remove any route assignments for this driver.
    $stmt = $conn->prepare("DELETE FROM route_assignments WHERE driver_id = ?");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
    echo json_encode(["success" => true, "message" => "Driver has left the association."]);

} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Transaction failed: " . $e->getMessage()]);
}
