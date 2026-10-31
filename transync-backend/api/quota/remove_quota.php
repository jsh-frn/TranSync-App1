<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

// Removes a driver's remittance target (driver_quotas row) without touching
// their quota_submissions history — those rows carry their own amount/
// period_type/status directly and have no FK back to driver_quotas, so
// deleting the target here never loses a past remittance record (get_submissions.php's
// LEFT JOIN to driver_quotas just returns quota_target: null for older rows
// after this, same as it already does for a driver who never had a target).

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

$data        = json_decode(file_get_contents("php://input"), true);
$operator_id = (int)($data['operator_id'] ?? 0);
$driver_id   = (int)($data['driver_id']   ?? 0);

if (!$operator_id || !$driver_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id and driver_id are required."]);
    exit;
}

// Verify the driver belongs to this operator
$chk = $conn->prepare("SELECT id FROM drivers WHERE id = ? AND operator_id = ?");
$chk->bind_param("ii", $driver_id, $operator_id);
$chk->execute();
if (!$chk->get_result()->fetch_assoc()) {
    http_response_code(403);
    echo json_encode(["success" => false, "message" => "Driver does not belong to this operator."]);
    exit;
}

$stmt = $conn->prepare("DELETE FROM driver_quotas WHERE driver_id = ? AND operator_id = ?");
$stmt->bind_param("ii", $driver_id, $operator_id);

if ($stmt->execute()) {
    echo json_encode([
        "success" => true,
        "message" => $stmt->affected_rows > 0 ? "Remittance target removed." : "No target was set for this driver.",
    ]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to remove target."]);
}
