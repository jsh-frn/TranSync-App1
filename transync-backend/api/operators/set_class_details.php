<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Operator-owned overlay on an association-owned class (bus_service_types) —
// the operator can only add/edit descriptive details for a class they're
// approved to use, never the class itself (name/description stay
// association-only, see associations/service_types.php).
$data            = json_decode(file_get_contents("php://input"), true);
$operator_id     = (int)($data["operator_id"] ?? 0);
$service_type_id = (int)($data["service_type_id"] ?? 0);
$details         = trim($data["details"] ?? "");

if (!$operator_id || !$service_type_id) {
    echo json_encode(["success" => false, "message" => "operator_id and service_type_id are required."]);
    exit;
}

// Confirm the operator is actually approved to use this class's association
// (same scoping get_association_service_types.php already enforces).
$stmt = $conn->prepare("
    SELECT st.id
    FROM operator_association_applications oaa
    JOIN bus_service_types st ON st.association_id = oaa.association_id
    WHERE oaa.operator_id = ? AND oaa.vehicle_type = 'Bus' AND oaa.status = 'approved' AND st.id = ?
    LIMIT 1
");
$stmt->bind_param("ii", $operator_id, $service_type_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    echo json_encode(["success" => false, "message" => "You are not approved for this class."]);
    exit;
}

$stmt = $conn->prepare("
    INSERT INTO operator_class_details (operator_id, service_type_id, details)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE details = VALUES(details)
");
$stmt->bind_param("iis", $operator_id, $service_type_id, $details);

if ($stmt->execute()) {
    echo json_encode(["success" => true, "message" => "Class details saved."]);
} else {
    echo json_encode(["success" => false, "message" => "Failed to save details."]);
}
