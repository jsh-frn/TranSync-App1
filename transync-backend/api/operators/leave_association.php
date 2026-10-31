<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";

$data           = json_decode(file_get_contents("php://input"), true);
$operator_id    = (int)($data["operator_id"]    ?? 0);
$vehicle_type   = trim($data["vehicle_type"]    ?? "");
$association_id = (int)($data["association_id"] ?? 0);

if (!$operator_id || !$association_id || !in_array($vehicle_type, ["Jeepney", "UV Express", "Bus"], true)) {
    echo json_encode(["success" => false, "message" => "operator_id, association_id, and a valid vehicle_type are required."]);
    exit;
}

// association_id disambiguates which specific membership to leave — an
// operator can now hold the same vehicle_type approved at several
// associations at once, so vehicle_type alone no longer identifies a
// single row.
$stmt = $conn->prepare("
    SELECT id, association_id FROM operator_association_applications
    WHERE operator_id = ? AND vehicle_type = ? AND association_id = ? AND status = 'approved'
");
$stmt->bind_param("isi", $operator_id, $vehicle_type, $association_id);
$stmt->execute();
$app = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$app) {
    echo json_encode(["success" => false, "message" => "You are not an approved member of this association for {$vehicle_type}."]);
    exit;
}

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("UPDATE operator_association_applications SET status = 'removed' WHERE id = ?");
    $stmt->bind_param("i", $app["id"]);
    $stmt->execute();
    $stmt->close();

    // Unassign only this operator's vehicles OF THIS VEHICLE TYPE AT THIS
    // ASSOCIATION from any association-owned routes — leaving a UV Express
    // membership at DAU must not touch the operator's separate UV Express
    // vehicles/routes at Angeles City JODA, even though it's the same type.
    // Routes belong to vehicles now (migration 056), no driver hop needed.
    $stmt = $conn->prepare("
        DELETE ra FROM route_assignments ra
        JOIN vehicles v ON v.id = ra.vehicle_id
        WHERE v.operator_id = ? AND v.type = ? AND v.association_id = ?
    ");
    $stmt->bind_param("isi", $operator_id, $vehicle_type, $association_id);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
    echo json_encode(["success" => true]);
} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to leave association."]);
}
