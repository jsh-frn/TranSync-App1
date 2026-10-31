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

$data          = json_decode(file_get_contents("php://input"), true);
$submission_id = (int)($data['submission_id'] ?? 0);
$operator_id   = (int)($data['operator_id']   ?? 0);
$action        = $data['action'] ?? '';  // 'confirm' or 'reject'

if (!$submission_id || !$operator_id || !in_array($action, ['confirm', 'reject'])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "submission_id, operator_id, and action (confirm|reject) are required."]);
    exit;
}

// Fetch submission — must be pending and belong to this operator
$stmt = $conn->prepare("
    SELECT id, driver_id, amount, status, association_id
    FROM quota_submissions
    WHERE id = ? AND operator_id = ?
");
$stmt->bind_param("ii", $submission_id, $operator_id);
$stmt->execute();
$sub = $stmt->get_result()->fetch_assoc();

if (!$sub) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Submission not found."]);
    exit;
}

if ($sub['status'] !== 'pending') {
    http_response_code(422);
    echo json_encode(["success" => false, "message" => "This submission has already been reviewed."]);
    exit;
}

$new_status     = $action === 'confirm' ? 'confirmed' : 'rejected';
$driver_id      = (int)$sub['driver_id'];
$amount         = (float)$sub['amount'];
$association_id = $sub['association_id'] !== null ? (int)$sub['association_id'] : null;

$conn->begin_transaction();
try {
    // Update submission status
    $upd = $conn->prepare("
        UPDATE quota_submissions
        SET status = ?, reviewed_at = NOW()
        WHERE id = ?
    ");
    $upd->bind_param("si", $new_status, $submission_id);
    $upd->execute();

    // On rejection: refund driver wallet
    if ($action === 'reject') {
        $refund = $conn->prepare("
            UPDATE drivers SET wallet_balance = wallet_balance + ? WHERE id = ?
        ");
        $refund->bind_param("di", $amount, $driver_id);
        $refund->execute();

        $balStmt = $conn->prepare("SELECT wallet_balance FROM drivers WHERE id = ?");
        $balStmt->bind_param("i", $driver_id);
        $balStmt->execute();
        $new_balance = (float)$balStmt->get_result()->fetch_assoc()['wallet_balance'];

        $note = "Quota submission rejected — refund";
        $ref  = "quota_refund";
        $txn = $conn->prepare("
            INSERT INTO wallet_transactions
                (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
            VALUES ('driver', ?, 'credit', ?, ?, ?, ?, ?)
        ");
        $txn->bind_param("idsids", $driver_id, $amount, $ref, $submission_id, $new_balance, $note);
        $txn->execute();
    }

    // On confirmation: credit the operator's wallet immediately — confirming
    // receipt of a driver's quota IS the operator being paid, there's no
    // separate real-world "cash out" step to make the operator click through.
    if ($action === 'confirm') {
        $upd2 = $conn->prepare("
            UPDATE quota_submissions SET cashed_out_at = NOW() WHERE id = ?
        ");
        $upd2->bind_param("i", $submission_id);
        $upd2->execute();

        // Credit the specific association this submission was captured under
        // (set at submit_quota.php time from the driver's vehicle) — falls
        // back to the operator's frozen Legacy bucket if none was captured.
        if ($association_id) {
            $credit = $conn->prepare("
                INSERT INTO operator_association_wallets (operator_id, association_id, balance)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)
            ");
            $credit->bind_param("iid", $operator_id, $association_id, $amount);
            $credit->execute();

            $balStmt = $conn->prepare("SELECT balance FROM operator_association_wallets WHERE operator_id = ? AND association_id = ?");
            $balStmt->bind_param("ii", $operator_id, $association_id);
            $balStmt->execute();
            $new_balance = (float)($balStmt->get_result()->fetch_assoc()['balance'] ?? $amount);
        } else {
            $credit = $conn->prepare("
                UPDATE operators SET wallet_balance = wallet_balance + ? WHERE id = ?
            ");
            $credit->bind_param("di", $amount, $operator_id);
            $credit->execute();

            $balStmt = $conn->prepare("SELECT wallet_balance FROM operators WHERE id = ?");
            $balStmt->bind_param("i", $operator_id);
            $balStmt->execute();
            $new_balance = (float)$balStmt->get_result()->fetch_assoc()['wallet_balance'];
        }

        $note = "Quota confirmed — driver #{$driver_id}";
        $ref  = "quota_cashout";
        $txn = $conn->prepare("
            INSERT INTO wallet_transactions
                (owner_type, owner_id, association_id, type, amount, reference_type, reference_id, balance_after, note)
            VALUES ('operator', ?, ?, 'credit', ?, ?, ?, ?, ?)
        ");
        $txn->bind_param("iidsids", $operator_id, $association_id, $amount, $ref, $submission_id, $new_balance, $note);
        $txn->execute();
    }

    $conn->commit();
    echo json_encode([
        "success" => true,
        "message" => "Submission " . $new_status . ".",
        "status"  => $new_status,
    ]);
} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["success" => false, "message" => $e->getMessage()]);
}
