<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

// ── GET: return uncashed confirmed total for operator ─────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $operator_id = (int)($_GET['operator_id'] ?? 0);
    if (!$operator_id) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "operator_id is required."]);
        exit;
    }

    $stmt = $conn->prepare("
        SELECT COALESCE(SUM(amount), 0) AS uncashed_total
        FROM quota_submissions
        WHERE operator_id = ? AND status = 'confirmed' AND cashed_out_at IS NULL
    ");
    $stmt->bind_param("i", $operator_id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();

    $balStmt = $conn->prepare("SELECT wallet_balance FROM operators WHERE id = ?");
    $balStmt->bind_param("i", $operator_id);
    $balStmt->execute();
    $balRow = $balStmt->get_result()->fetch_assoc();

    echo json_encode([
        "success"         => true,
        "uncashed_total"  => (float)$row['uncashed_total'],
        "operator_balance"=> $balRow ? (float)$balRow['wallet_balance'] : 0,
    ]);
    exit;
}

// ── POST: cash out — mark all confirmed uncashed submissions ──────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data        = json_decode(file_get_contents("php://input"), true);
    $operator_id = (int)($data['operator_id'] ?? 0);
    if (!$operator_id) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "operator_id is required."]);
        exit;
    }

    // Sum what we're cashing out
    $sum = $conn->prepare("
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM quota_submissions
        WHERE operator_id = ? AND status = 'confirmed' AND cashed_out_at IS NULL
    ");
    $sum->bind_param("i", $operator_id);
    $sum->execute();
    $total = (float)$sum->get_result()->fetch_assoc()['total'];

    if ($total <= 0) {
        echo json_encode(["success" => false, "message" => "No confirmed submissions to cash out."]);
        exit;
    }

    // Group what's being cashed out by association — a bulk cash-out can
    // span submissions captured under several different associations (or
    // none, pre-split legacy rows), so each group must credit its own
    // wallet rather than one combined total.
    $groupStmt = $conn->prepare("
        SELECT association_id, COALESCE(SUM(amount), 0) AS subtotal
        FROM quota_submissions
        WHERE operator_id = ? AND status = 'confirmed' AND cashed_out_at IS NULL
        GROUP BY association_id
    ");
    $groupStmt->bind_param("i", $operator_id);
    $groupStmt->execute();
    $groups = $groupStmt->get_result()->fetch_all(MYSQLI_ASSOC);

    $conn->begin_transaction();
    try {
        $upd = $conn->prepare("
            UPDATE quota_submissions
            SET cashed_out_at = NOW()
            WHERE operator_id = ? AND status = 'confirmed' AND cashed_out_at IS NULL
        ");
        $upd->bind_param("i", $operator_id);
        $upd->execute();

        foreach ($groups as $g) {
            $association_id = $g["association_id"] !== null ? (int)$g["association_id"] : null;
            $subtotal        = (float)$g["subtotal"];
            if ($subtotal <= 0) continue;

            if ($association_id) {
                $credit = $conn->prepare("
                    INSERT INTO operator_association_wallets (operator_id, association_id, balance)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)
                ");
                $credit->bind_param("iid", $operator_id, $association_id, $subtotal);
                $credit->execute();

                $balStmt = $conn->prepare("SELECT balance FROM operator_association_wallets WHERE operator_id = ? AND association_id = ?");
                $balStmt->bind_param("ii", $operator_id, $association_id);
                $balStmt->execute();
                $group_balance = (float)($balStmt->get_result()->fetch_assoc()['balance'] ?? $subtotal);
            } else {
                $credit = $conn->prepare("UPDATE operators SET wallet_balance = wallet_balance + ? WHERE id = ?");
                $credit->bind_param("di", $subtotal, $operator_id);
                $credit->execute();

                $balStmt = $conn->prepare("SELECT wallet_balance FROM operators WHERE id = ?");
                $balStmt->bind_param("i", $operator_id);
                $balStmt->execute();
                $group_balance = (float)$balStmt->get_result()->fetch_assoc()['wallet_balance'];
            }

            $txn = $conn->prepare("
                INSERT INTO wallet_transactions
                    (owner_type, owner_id, association_id, type, amount, reference_type, balance_after, note)
                VALUES ('operator', ?, ?, 'credit', ?, 'quota_cashout', ?, 'Quota cash out')
            ");
            $txn->bind_param("iidd", $operator_id, $association_id, $subtotal, $group_balance);
            $txn->execute();
        }

        $conn->commit();
        echo json_encode([
            "success"       => true,
            "message"       => "Cash out recorded.",
            "amount_cashed" => $total,
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
