<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// The system has no mutable wallet_balance column anywhere — its balance is
// simply the running sum of every 'system' ledger entry (credits from Bus/UV
// remittance + Jeepney subscriptions, no debits exist yet). Computed live so
// there's no separate balance to drift out of sync with the ledger.
$result = $conn->query("
    SELECT
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS balance
    FROM wallet_transactions
    WHERE owner_type = 'system'
");
$balance = (float)$result->fetch_assoc()["balance"];

$byReferenceResult = $conn->query("
    SELECT reference_type, COUNT(*) AS count, SUM(amount) AS total
    FROM wallet_transactions
    WHERE owner_type = 'system' AND type = 'credit'
    GROUP BY reference_type
");
$byReference = [];
while ($row = $byReferenceResult->fetch_assoc()) {
    $byReference[] = [
        "reference_type" => $row["reference_type"],
        "count"          => (int)$row["count"],
        "total"          => (float)$row["total"],
    ];
}

$txResult = $conn->query("
    SELECT amount, reference_type, reference_id, note, created_at
    FROM wallet_transactions
    WHERE owner_type = 'system'
    ORDER BY created_at DESC
    LIMIT 50
");
$transactions = [];
while ($row = $txResult->fetch_assoc()) {
    $transactions[] = [
        "amount"         => (float)$row["amount"],
        "reference_type" => $row["reference_type"],
        "reference_id"   => $row["reference_id"] !== null ? (int)$row["reference_id"] : null,
        "note"           => $row["note"],
        "created_at"     => $row["created_at"],
    ];
}

echo json_encode([
    "success"      => true,
    "balance"      => $balance,
    "by_reference" => $byReference,
    "transactions" => $transactions,
]);
