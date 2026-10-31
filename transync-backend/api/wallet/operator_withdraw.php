<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/auth.php";

$auth        = requireAuth($conn, ['operator']);
$operator_id = $auth['owner_id'];

// association_id selects which wallet to withdraw from — a real id draws
// from that specific operator_association_wallets balance, omitted/null
// draws from the frozen Legacy bucket (operators.wallet_balance). An
// operator can hold several association wallets at once now, so a
// withdrawal can never again just debit "the" balance without saying which one.
$body           = json_decode(file_get_contents("php://input"), true);
$amount         = (float)($body["amount"]       ?? 0);
$association_id = isset($body["association_id"]) && $body["association_id"] !== "" && $body["association_id"] !== null
    ? (int)$body["association_id"] : null;

if ($amount <= 0) {
    echo json_encode(["success" => false, "message" => "A positive amount is required."]);
    exit;
}

if ($association_id) {
    $stmt = $conn->prepare("SELECT balance FROM operator_association_wallets WHERE operator_id = ? AND association_id = ?");
    $stmt->bind_param("ii", $operator_id, $association_id);
    $stmt->execute();
    $walletRow = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $balance = $walletRow ? (float)$walletRow["balance"] : 0.0;
} else {
    $stmt = $conn->prepare("SELECT wallet_balance FROM operators WHERE id = ?");
    $stmt->bind_param("i", $operator_id);
    $stmt->execute();
    $operator = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$operator) {
        echo json_encode(["success" => false, "message" => "Operator not found."]);
        exit;
    }
    $balance = (float)$operator["wallet_balance"];
}

if ($amount > $balance) {
    echo json_encode([
        "success" => false,
        "message" => "Insufficient wallet balance.",
        "balance" => $balance,
    ]);
    exit;
}

$conn->begin_transaction();
try {
    $new_balance = round($balance - $amount, 2);

    if ($association_id) {
        $stmt = $conn->prepare("UPDATE operator_association_wallets SET balance = ? WHERE operator_id = ? AND association_id = ?");
        $stmt->bind_param("dii", $new_balance, $operator_id, $association_id);
        $stmt->execute();
        $stmt->close();
    } else {
        $stmt = $conn->prepare("UPDATE operators SET wallet_balance = ? WHERE id = ?");
        $stmt->bind_param("di", $new_balance, $operator_id);
        $stmt->execute();
        $stmt->close();
    }

    // Completes immediately — no admin/association approval step. The
    // balance above is already debited synchronously in this same
    // transaction, so there's nothing left pending to approve; this row is
    // purely a completed record for the operator's own withdrawal history.
    $stmt = $conn->prepare("
        INSERT INTO withdrawal_requests (operator_id, association_id, amount, status, resolved_at)
        VALUES (?, ?, ?, 'paid', NOW())
    ");
    $stmt->bind_param("iid", $operator_id, $association_id, $amount);
    $stmt->execute();
    $withdrawal_id = $conn->insert_id;
    $stmt->close();

    $note = "Withdrawal #{$withdrawal_id}";
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, association_id, type, amount, reference_type, reference_id, balance_after, note)
        VALUES ('operator', ?, ?, 'debit', ?, 'withdrawal', ?, ?, ?)
    ");
    $stmt->bind_param("iidids", $operator_id, $association_id, $amount, $withdrawal_id, $new_balance, $note);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
    echo json_encode([
        "success"       => true,
        "withdrawal_id" => $withdrawal_id,
        "new_balance"   => $new_balance,
        "message"       => "Withdrawal completed — funds have been debited from your wallet.",
    ]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to submit withdrawal."]);
}
