<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$method = $_SERVER['REQUEST_METHOD'];

// ── GET: wallet balance + last 20 transactions ────────────────────────────────
if ($method === 'GET') {
    $driver_id = (int)($_GET['driver_id'] ?? 0);
    if (!$driver_id) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "driver_id is required."]);
        exit;
    }

    $stmt = $conn->prepare("SELECT wallet_balance FROM drivers WHERE id = ?");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    if (!$row) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "Driver not found."]);
        exit;
    }

    // Defaults to the existing 20 (Wallet tab preview); the Wallet History
    // screen passes a larger ?limit= for a fuller history — same pattern as
    // wallet/wallet.php.
    $txn_limit = intval($_GET['limit'] ?? 20);
    if ($txn_limit <= 0 || $txn_limit > 200) $txn_limit = 20;

    $stmt2 = $conn->prepare("
        SELECT id, type, amount, reference_type, reference_id, balance_after, note, created_at
        FROM wallet_transactions
        WHERE owner_type = 'driver' AND owner_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    ");
    $stmt2->bind_param("ii", $driver_id, $txn_limit);
    $stmt2->execute();
    $result = $stmt2->get_result();
    $txns = [];
    while ($t = $result->fetch_assoc()) {
        $t['id']            = (int)$t['id'];
        $t['amount']        = (float)$t['amount'];
        $t['reference_id']  = $t['reference_id'] !== null ? (int)$t['reference_id'] : null;
        $t['balance_after'] = (float)$t['balance_after'];
        // Every wallet_transactions row is a completed ledger entry (see
        // wallet/wallet.php's identical note) — status only exists on
        // withdrawal_requests below, which already has a real status.
        $t['status']        = "completed";
        $txns[] = $t;
    }

    $stmt3 = $conn->prepare("
        SELECT id, amount, status, requested_at, resolved_at, association_id
        FROM withdrawal_requests
        WHERE owner_type = 'driver' AND driver_id = ?
        ORDER BY requested_at DESC
        LIMIT 10
    ");
    $stmt3->bind_param("i", $driver_id);
    $stmt3->execute();
    $wResult = $stmt3->get_result();
    $withdrawals = [];
    while ($w = $wResult->fetch_assoc()) {
        $withdrawals[] = [
            "id"             => (int)$w["id"],
            "amount"         => (float)$w["amount"],
            "status"         => $w["status"],
            "requested_at"   => $w["requested_at"],
            "resolved_at"    => $w["resolved_at"],
            "association_id" => $w["association_id"] !== null ? (int)$w["association_id"] : null,
        ];
    }

    echo json_encode([
        "success"      => true,
        "balance"      => (float)$row['wallet_balance'],
        "transactions" => $txns,
        "withdrawals"  => $withdrawals,
    ]);
    exit;
}

// ── POST: top-up driver wallet ────────────────────────────────────────────────
if ($method === 'POST') {
    $data      = json_decode(file_get_contents("php://input"), true);
    $driver_id = (int)($data['driver_id'] ?? 0);
    $amount    = (float)($data['amount']    ?? 0);

    if (!$driver_id || $amount <= 0) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "driver_id and a positive amount are required."]);
        exit;
    }

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare("
            UPDATE drivers SET wallet_balance = wallet_balance + ? WHERE id = ?
        ");
        $stmt->bind_param("di", $amount, $driver_id);
        $stmt->execute();
        if ($stmt->affected_rows === 0) throw new Exception("Driver not found.");

        $stmt2 = $conn->prepare("SELECT wallet_balance FROM drivers WHERE id = ?");
        $stmt2->bind_param("i", $driver_id);
        $stmt2->execute();
        $new_balance = (float)$stmt2->get_result()->fetch_assoc()['wallet_balance'];

        $note = "Wallet top-up";
        $ref  = "topup";
        $stmt3 = $conn->prepare("
            INSERT INTO wallet_transactions
                (owner_type, owner_id, type, amount, reference_type, balance_after, note)
            VALUES ('driver', ?, 'credit', ?, ?, ?, ?)
        ");
        $stmt3->bind_param("idsds", $driver_id, $amount, $ref, $new_balance, $note);
        $stmt3->execute();

        $conn->commit();
        echo json_encode([
            "success"     => true,
            "message"     => "Wallet topped up.",
            "new_balance" => $new_balance,
        ]);
    } catch (Exception $e) {
        $conn->rollback();
        http_response_code(500);
        echo json_encode(["success" => false, "message" => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(["message" => "Method not allowed."]);
