<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";

// ── GET: fetch balance + recent transactions ──────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $commuter_id = intval($_GET['commuter_id'] ?? 0);
    if (!$commuter_id) {
        http_response_code(400);
        echo json_encode(["message" => "Missing commuter_id"]);
        exit;
    }

    // Balance
    $stmt = $conn->prepare("SELECT balance FROM wallets WHERE commuter_id = ?");
    $stmt->bind_param("i", $commuter_id);
    $stmt->execute();
    $row     = $stmt->get_result()->fetch_assoc();
    $balance = $row ? (float)$row['balance'] : 0.00;

    // Recent transactions — defaults to the existing 20 (Wallet tab preview),
    // but the dedicated Wallet History screen passes a larger ?limit= for a
    // fuller history. No pagination exists anywhere else in this app yet
    // either, so a raised cap (not real pagination) matches that convention.
    $limit = intval($_GET['limit'] ?? 20);
    if ($limit <= 0 || $limit > 200) $limit = 20;

    $stmt = $conn->prepare("
        SELECT id, type, amount, reference_type, reference_id, note, balance_after, created_at
        FROM wallet_transactions
        WHERE owner_type = 'commuter' AND owner_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    ");
    $stmt->bind_param("ii", $commuter_id, $limit);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

    // wallet_transactions rows are only ever inserted once the underlying
    // money movement has already atomically completed (see config/db.php
    // transaction usage throughout this codebase) — there's no "pending"
    // state for this table (that only exists on withdrawal_requests), so
    // every row is accurately reported as Completed. "id" doubles as this
    // transaction's reference number; reference_id (when set) points at the
    // related booking/withdrawal/etc. row for anyone who needs it.
    $transactions = array_map(fn($r) => [
        "id"            => (int)$r['id'],
        "type"          => $r['type'],           // 'debit' | 'credit'
        "amount"        => (float)$r['amount'],
        "reference_type"=> $r['reference_type'], // 'jeepney_ride' | 'topup' | 'booking' | 'refund' | ...
        "reference_id"  => $r['reference_id'] !== null ? (int)$r['reference_id'] : null,
        "note"          => $r['note'],
        "balance_after" => (float)$r['balance_after'],
        "status"        => "completed",
        "created_at"    => $r['created_at'],
    ], $rows);

    echo json_encode([
        "success"      => true,
        "balance"      => $balance,
        "transactions" => $transactions,
    ]);
    exit;
}

// ── POST: top up wallet ───────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data        = json_decode(file_get_contents("php://input"), true);
    $commuter_id = intval($data['commuter_id'] ?? 0);
    $amount      = floatval($data['amount']     ?? 0);

    if (!$commuter_id || $amount <= 0) {
        http_response_code(400);
        echo json_encode(["message" => "Invalid commuter_id or amount"]);
        exit;
    }

    $conn->begin_transaction();
    try {
        // Update wallet balance
        $stmt = $conn->prepare("
            UPDATE wallets SET balance = balance + ? WHERE commuter_id = ?
        ");
        $stmt->bind_param("di", $amount, $commuter_id);
        $stmt->execute();

        // Get new balance
        $stmt = $conn->prepare("SELECT balance FROM wallets WHERE commuter_id = ?");
        $stmt->bind_param("i", $commuter_id);
        $stmt->execute();
        $new_balance = (float)$stmt->get_result()->fetch_assoc()['balance'];

        // Log transaction
        $note = "Top up ₱" . number_format($amount, 2);
        $stmt = $conn->prepare("
            INSERT INTO wallet_transactions
                (owner_type, owner_id, type, amount, reference_type, balance_after, note)
            VALUES ('commuter', ?, 'credit', ?, 'topup', ?, ?)
        ");
        $stmt->bind_param("idds", $commuter_id, $amount, $new_balance, $note);
        $stmt->execute();

        $conn->commit();

        echo json_encode([
            "success"     => true,
            "new_balance" => $new_balance,
            "message"     => "Top up successful",
        ]);
    } catch (Exception $e) {
        $conn->rollback();
        http_response_code(500);
        echo json_encode(["message" => "Top up failed: " . $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(["message" => "Method not allowed"]);