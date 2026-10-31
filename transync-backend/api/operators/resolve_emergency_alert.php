<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";

// An operator marks an emergency raised by one of THEIR OWN drivers as
// resolved. Ownership is checked through drivers.operator_id — an operator can
// never resolve another operator's driver's alert.
$data        = json_decode(file_get_contents("php://input"), true) ?? [];
$operator_id = (int)($data["operator_id"] ?? 0);
$alert_id    = (int)($data["alert_id"] ?? 0);

if (!$operator_id || !$alert_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id and alert_id are required."]);
    exit;
}

$stmt = $conn->prepare("
    UPDATE emergency_alerts ea
    JOIN drivers d ON d.id = ea.driver_id
    SET ea.status = 'resolved'
    WHERE ea.id = ? AND d.operator_id = ? AND ea.status = 'active'
");
$stmt->bind_param("ii", $alert_id, $operator_id);
$stmt->execute();
$changed = $stmt->affected_rows > 0;
$stmt->close();

if (!$changed) {
    echo json_encode(["success" => false, "message" => "Alert not found, already resolved, or not one of your drivers'."]);
    exit;
}
echo json_encode(["success" => true]);
