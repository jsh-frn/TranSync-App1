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

$data      = json_decode(file_get_contents("php://input"), true);
$driver_id = (int)($data['driver_id'] ?? 0);
$amount    = (float)($data['amount']   ?? 0);
$note      = trim($data['note']        ?? '');

if (!$driver_id || $amount <= 0) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "driver_id and a positive amount are required."]);
    exit;
}

// Fetch quota assignment (to get operator_id and frequency)
$stmt = $conn->prepare("
    SELECT operator_id, frequency FROM driver_quotas WHERE driver_id = ?
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$quota = $stmt->get_result()->fetch_assoc();

if (!$quota) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "No quota has been assigned to this driver yet."]);
    exit;
}

$operator_id = (int)$quota['operator_id'];
$period_type = $quota['frequency'];

// Capture which association this payment belongs to, from the driver's
// CURRENT vehicle at the moment of submission (Jeepney quota has no
// route/vehicle reference of its own otherwise) — null if the driver has no
// vehicle assigned right now, or their vehicle predates the association
// split; settles through the operator's Legacy wallet in that case.
$assocStmt = $conn->prepare("
    SELECT v.association_id FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = ?
");
$assocStmt->bind_param("i", $driver_id);
$assocStmt->execute();
$assocRow = $assocStmt->get_result()->fetch_assoc();
$assocStmt->close();
$submission_association_id = ($assocRow && $assocRow["association_id"] !== null) ? (int)$assocRow["association_id"] : null;

// Check wallet balance
$wStmt = $conn->prepare("SELECT wallet_balance FROM drivers WHERE id = ?");
$wStmt->bind_param("i", $driver_id);
$wStmt->execute();
$driver = $wStmt->get_result()->fetch_assoc();

if (!$driver) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Driver not found."]);
    exit;
}

$balance = (float)$driver['wallet_balance'];
if ($balance < $amount) {
    http_response_code(422);
    echo json_encode([
        "success" => false,
        "message" => "Insufficient wallet balance. Current balance: ₱" . number_format($balance, 2),
    ]);
    exit;
}

$conn->begin_transaction();
try {
    // Deduct from driver wallet
    $upd = $conn->prepare("
        UPDATE drivers SET wallet_balance = wallet_balance - ? WHERE id = ?
    ");
    $upd->bind_param("di", $amount, $driver_id);
    $upd->execute();

    $new_balance = $balance - $amount;

    // Create submission record
    $noteVal = $note !== '' ? $note : null;
    $ins = $conn->prepare("
        INSERT INTO quota_submissions (driver_id, association_id, operator_id, amount, period_type, note)
        VALUES (?, ?, ?, ?, ?, ?)
    ");
    $ins->bind_param("iiidss", $driver_id, $submission_association_id, $operator_id, $amount, $period_type, $noteVal);
    $ins->execute();
    $submission_id = (int)$conn->insert_id;

    // Log wallet debit transaction
    $txnNote = "Quota remittance";
    $ref     = "quota_submission";
    $txn = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
        VALUES ('driver', ?, 'debit', ?, ?, ?, ?, ?)
    ");
    $txn->bind_param("idsids", $driver_id, $amount, $ref, $submission_id, $new_balance, $txnNote);
    $txn->execute();

    $conn->commit();
    echo json_encode([
        "success"       => true,
        "message"       => "Quota submitted successfully. Awaiting operator confirmation.",
        "submission_id" => $submission_id,
        "new_balance"   => $new_balance,
    ]);
} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["success" => false, "message" => $e->getMessage()]);
}
