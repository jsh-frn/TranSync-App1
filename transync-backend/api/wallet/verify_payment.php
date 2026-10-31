<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed"]);
    exit;
}

require_once "../../config/db.php";
require_once "../../config/paymongo.php";
require_once "../../config/auth.php";

// Same owner convention as create_source.php — derived from the caller's
// own validated session, never a client-supplied id.
$auth        = requireAuth($conn, ['commuter', 'driver']);
$is_driver   = $auth['owner_type'] === 'driver';
$commuter_id = $is_driver ? 0 : $auth['owner_id'];
$driver_id   = $is_driver ? $auth['owner_id'] : 0;
$owner_id    = $auth['owner_id'];

$data        = json_decode(file_get_contents("php://input"), true);
$source_id   = trim($data['source_id'] ?? '');

if (!$source_id) {
    http_response_code(400);
    echo json_encode(["message" => "Provide source_id."]);
    exit;
}

// ── De-duplication: check if this source was already credited ────────────────
// Also the ownership gate, not just a dedup lookup — if this exact
// (source_id, owner) pair was never created via create_source.php (e.g. the
// caller passed someone else's source_id with their own id), there is no
// row here at all. Rejecting immediately, rather than falling through to
// query PayMongo directly, matters because a chargeable-but-unclaimed
// source would otherwise get credited to whichever owner_id the caller
// supplied — not necessarily who actually paid for it.
$ownerCol = $is_driver ? "driver_id" : "commuter_id";
$stmt = $conn->prepare("SELECT status, payment_id, amount, method FROM paymongo_sources WHERE source_id = ? AND {$ownerCol} = ?");
$stmt->bind_param("si", $source_id, $owner_id);
$stmt->execute();
$tracked = $stmt->get_result()->fetch_assoc();

if (!$tracked) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "No matching top-up found for this account."]);
    exit;
}

if ($tracked && $tracked['status'] === 'credited') {
    echo json_encode([
        "success" => true,
        "already_credited" => true,
        "message" => "This payment has already been credited to your wallet.",
    ]);
    exit;
}

// ── Fetch source from PayMongo ───────────────────────────────────────────────
$ch = curl_init("https://api.paymongo.com/v1/sources/{$source_id}");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
        "Authorization: Basic " . base64_encode(PAYMONGO_SECRET_KEY . ":"),
    ],
]);
$response  = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_err  = curl_error($ch);
curl_close($ch);

if ($curl_err || $http_code !== 200) {
    http_response_code(503);
    echo json_encode(["message" => "Could not reach PayMongo. Please try again."]);
    exit;
}

$source_data    = json_decode($response, true)['data'];
$source_status  = $source_data['attributes']['status'];
$amount_centavos= $source_data['attributes']['amount'];
$amount_pesos   = $amount_centavos / 100.0;
// NOT $source_data['attributes']['type'] — PayMongo's Sources API only
// actually accepts `gcash` as a source type (see create_source.php), so a
// "Maya (Demo)" top-up's source is really typed 'gcash' on PayMongo's side
// too. Our own paymongo_sources.method column is what actually remembers
// which demo button the user tapped — that's the one that must drive the
// label/note below, or every Maya (Demo) top-up would get mislabeled
// "GCash (Demo)" the moment it's verified.
$method         = $tracked['method'] ?? $source_data['attributes']['type'];

// ── Case: payment was created before but wallet credit failed (recovery) ─────
// tracked.payment_id set but status != 'credited' means we already charged PayMongo
// — skip straight to wallet credit
$payment_id = $tracked['payment_id'] ?? null;

if (!$payment_id) {
    if ($source_status !== 'chargeable') {
        http_response_code(402);
        echo json_encode([
            "success" => false,
            "message" => $source_status === 'pending'
                ? "Payment not yet completed. Please finish the payment in the GCash (Demo) or Maya (Demo) checkout."
                : "Payment was not completed (status: {$source_status}).",
            "status"  => $source_status,
        ]);
        exit;
    }

    // ── Create PayMongo payment from chargeable source ───────────────────────
    $pay_payload = json_encode([
        "data" => [
            "attributes" => [
                "amount"      => $amount_centavos,
                "currency"    => "PHP",
                "source"      => ["id" => $source_id, "type" => "source"],
                "description" => "TranSync Wallet Top Up",
            ],
        ],
    ]);

    $ch = curl_init("https://api.paymongo.com/v1/payments");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $pay_payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            "Content-Type: application/json",
            "Authorization: Basic " . base64_encode(PAYMONGO_SECRET_KEY . ":"),
        ],
    ]);
    $pay_response  = curl_exec($ch);
    $pay_http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($pay_http_code !== 200 && $pay_http_code !== 201) {
        $err = json_decode($pay_response, true);
        http_response_code(502);
        echo json_encode(["message" => "Payment charge failed", "details" => $err['errors'] ?? $err]);
        exit;
    }

    $payment_id = json_decode($pay_response, true)['data']['id'];

    // Persist payment_id so a retry can skip re-charging even if wallet credit fails below
    $stmt = $conn->prepare("
        UPDATE paymongo_sources SET payment_id = ? WHERE source_id = ?
    ");
    $stmt->bind_param("ss", $payment_id, $source_id);
    $stmt->execute();
}

// ── Credit wallet (atomic) — commuter wallet lives in `wallets`, driver
// wallet is a column directly on `drivers` (drivers/driver_wallet.php's own
// existing pattern) ───────────────────────────────────────────────────────
$conn->begin_transaction();
try {
    if ($is_driver) {
        $stmt = $conn->prepare("UPDATE drivers SET wallet_balance = wallet_balance + ? WHERE id = ?");
        $stmt->bind_param("di", $amount_pesos, $driver_id);
        $stmt->execute();
        if ($stmt->affected_rows === 0) throw new Exception("Driver not found.");

        $stmt = $conn->prepare("SELECT wallet_balance FROM drivers WHERE id = ?");
        $stmt->bind_param("i", $driver_id);
        $stmt->execute();
        $new_balance = (float)$stmt->get_result()->fetch_assoc()['wallet_balance'];
    } else {
        $stmt = $conn->prepare("UPDATE wallets SET balance = balance + ? WHERE commuter_id = ?");
        $stmt->bind_param("di", $amount_pesos, $commuter_id);
        $stmt->execute();

        $stmt = $conn->prepare("SELECT balance FROM wallets WHERE commuter_id = ?");
        $stmt->bind_param("i", $commuter_id);
        $stmt->execute();
        $new_balance = (float)$stmt->get_result()->fetch_assoc()['balance'];
    }

    $label = $method === 'paymaya' ? 'Maya (Demo)' : 'GCash (Demo)';
    $note  = "Top up via {$label} ₱" . number_format($amount_pesos, 2);

    $owner_type = $is_driver ? 'driver' : 'commuter';
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, type, amount, reference_type, balance_after, note)
        VALUES (?, ?, 'credit', ?, 'topup', ?, ?)
    ");
    $stmt->bind_param("sidds", $owner_type, $owner_id, $amount_pesos, $new_balance, $note);
    $stmt->execute();

    $stmt = $conn->prepare("UPDATE paymongo_sources SET status = 'credited' WHERE source_id = ?");
    $stmt->bind_param("s", $source_id);
    $stmt->execute();

    $conn->commit();

    echo json_encode([
        "success"     => true,
        "new_balance" => $new_balance,
        "amount"      => $amount_pesos,
        "method"      => $method,
        "message"     => "Top up successful",
    ]);
} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["message" => "Failed to credit wallet. Please try verifying again."]);
}
