<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// An operator can hold the same vehicle type approved at several
// associations at once now, so wallet_balance is split per association
// (operator_association_wallets) — association_id selects which one to
// return as "balance" here. operators.wallet_balance is frozen as a
// "Legacy" bucket (whatever the operator had before this split existed,
// migration 031) and is always returned separately as legacy_balance,
// regardless of which association is requested, so the client can show
// both.
$operator_id    = (int)($_GET["operator_id"]    ?? 0);
$association_id = (int)($_GET["association_id"] ?? 0);
if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT wallet_balance FROM operators WHERE id = ?");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    echo json_encode(["success" => false, "message" => "Operator not found."]);
    exit;
}
$legacy_balance = (float)$row["wallet_balance"];

$balance = 0.0;
if ($association_id) {
    $stmt = $conn->prepare("SELECT balance FROM operator_association_wallets WHERE operator_id = ? AND association_id = ?");
    $stmt->bind_param("ii", $operator_id, $association_id);
    $stmt->execute();
    $balRow = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $balance = $balRow ? (float)$balRow["balance"] : 0.0;
}

// Transaction list scoped to the requested association when given (falls
// back to every operator-owned transaction, legacy included, when omitted —
// e.g. for a caller that hasn't adopted association scoping yet). Defaults
// to the existing 20; a caller wanting a fuller history (e.g. a future
// operator "Wallet Transactions" view) can pass a larger ?limit=, same
// pattern as wallet/wallet.php and drivers/driver_wallet.php.
$txn_limit = intval($_GET['limit'] ?? 20);
if ($txn_limit <= 0 || $txn_limit > 200) $txn_limit = 20;

if ($association_id) {
    $stmt = $conn->prepare("
        SELECT id, type, amount, reference_type, reference_id, note, balance_after, created_at
        FROM wallet_transactions
        WHERE owner_type = 'operator' AND owner_id = ? AND association_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    ");
    $stmt->bind_param("iii", $operator_id, $association_id, $txn_limit);
} else {
    $stmt = $conn->prepare("
        SELECT id, type, amount, reference_type, reference_id, note, balance_after, created_at
        FROM wallet_transactions
        WHERE owner_type = 'operator' AND owner_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    ");
    $stmt->bind_param("ii", $operator_id, $txn_limit);
}
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Every wallet_transactions row is a completed ledger entry (see
// wallet/wallet.php's identical note) — no "pending" state exists on this
// table, unlike withdrawal_requests below which has a real status.
$transactions = array_map(fn($r) => [
    "id"             => (int)$r["id"],
    "type"           => $r["type"],
    "amount"         => (float)$r["amount"],
    "reference_type" => $r["reference_type"],
    "reference_id"   => $r["reference_id"] !== null ? (int)$r["reference_id"] : null,
    "note"           => $r["note"],
    "balance_after"  => (float)$r["balance_after"],
    "status"         => "completed",
    "created_at"     => $r["created_at"],
], $rows);

// Legacy withdrawal history (association_id IS NULL) is always included;
// the requested association's own withdrawal history is included too when
// association_id is given.
if ($association_id) {
    $stmt = $conn->prepare("
        SELECT id, amount, status, requested_at, resolved_at, association_id
        FROM withdrawal_requests
        WHERE operator_id = ? AND (association_id = ? OR association_id IS NULL)
        ORDER BY requested_at DESC
        LIMIT 10
    ");
    $stmt->bind_param("ii", $operator_id, $association_id);
} else {
    $stmt = $conn->prepare("
        SELECT id, amount, status, requested_at, resolved_at, association_id
        FROM withdrawal_requests
        WHERE operator_id = ?
        ORDER BY requested_at DESC
        LIMIT 10
    ");
    $stmt->bind_param("i", $operator_id);
}
$stmt->execute();
$wRows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$withdrawals = array_map(fn($r) => [
    "id"             => (int)$r["id"],
    "amount"         => (float)$r["amount"],
    "status"         => $r["status"],
    "requested_at"   => $r["requested_at"],
    "resolved_at"    => $r["resolved_at"],
    "association_id" => $r["association_id"] !== null ? (int)$r["association_id"] : null,
], $wRows);

echo json_encode([
    "success"        => true,
    "balance"        => $balance,
    "legacy_balance" => $legacy_balance,
    "transactions"   => $transactions,
    "withdrawals"    => $withdrawals,
]);
