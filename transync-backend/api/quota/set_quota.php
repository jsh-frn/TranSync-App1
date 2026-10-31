<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

$data        = json_decode(file_get_contents("php://input"), true);
$operator_id = (int)($data['operator_id'] ?? 0);
$driver_id   = (int)($data['driver_id']   ?? 0);
$amount      = (float)($data['amount']    ?? 0);
$frequency   = $data['frequency'] ?? 'daily';

if (!$operator_id || !$driver_id || $amount <= 0) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id, driver_id, and a positive amount are required."]);
    exit;
}

if (!in_array($frequency, ['daily', 'weekly'])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "frequency must be 'daily' or 'weekly'."]);
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

// Captured for reference/display alongside the quota target — the actual
// payment's own association (captured fresh at submit_quota.php time from
// the driver's vehicle then) is what determines which wallet gets credited,
// not this snapshot.
$assocStmt = $conn->prepare("
    SELECT v.association_id FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = ?
");
$assocStmt->bind_param("i", $driver_id);
$assocStmt->execute();
$assocRow = $assocStmt->get_result()->fetch_assoc();
$assocStmt->close();
$quota_association_id = ($assocRow && $assocRow["association_id"] !== null) ? (int)$assocRow["association_id"] : null;

// Upsert: insert or update if quota already exists for this driver
$stmt = $conn->prepare("
    INSERT INTO driver_quotas (operator_id, driver_id, association_id, amount, frequency)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
        operator_id    = VALUES(operator_id),
        association_id = VALUES(association_id),
        amount         = VALUES(amount),
        frequency      = VALUES(frequency)
");
$stmt->bind_param("iiids", $operator_id, $driver_id, $quota_association_id, $amount, $frequency);

if ($stmt->execute()) {
    echo json_encode([
        "success"   => true,
        "message"   => "Quota set successfully.",
        "driver_id" => $driver_id,
        "amount"    => $amount,
        "frequency" => $frequency,
    ]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to set quota."]);
}
