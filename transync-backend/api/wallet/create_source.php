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

// This top-up flow is shared by every top-up entry point in the app —
// GCash (Demo) and Maya (Demo) both call this same endpoint, distinguished
// only by `method`; there is deliberately no separate implementation per
// payment method. Owner is either a commuter (mobile wallet.tsx) or a
// driver (driver dashboard's Wallet tab) — derived from the caller's own
// validated session, never a client-supplied id (mirrors how
// paymongo_sources itself tracks exactly one of commuter_id/driver_id, see
// migration 037).
$auth        = requireAuth($conn, ['commuter', 'driver']);
$is_driver   = $auth['owner_type'] === 'driver';
$commuter_id = $is_driver ? 0 : $auth['owner_id'];
$driver_id   = $is_driver ? $auth['owner_id'] : 0;

$data        = json_decode(file_get_contents("php://input"), true);
$amount      = floatval($data['amount']      ?? 0);
$method      = $data['method']               ?? '';

if ($amount <= 0 || !in_array($method, ['gcash', 'paymaya'])) {
    http_response_code(400);
    echo json_encode(["message" => "Invalid parameters. Amount must be greater than 0 and method must be gcash or paymaya."]);
    exit;
}

if ($commuter_id) {
    $stmt = $conn->prepare("SELECT id FROM commuters WHERE id = ?");
    $stmt->bind_param("i", $commuter_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        http_response_code(404);
        echo json_encode(["message" => "Commuter not found"]);
        exit;
    }
} else {
    $stmt = $conn->prepare("SELECT id FROM drivers WHERE id = ?");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        http_response_code(404);
        echo json_encode(["message" => "Driver not found"]);
        exit;
    }
}

$amount_centavos = intval(round($amount * 100));

// PayMongo's live Sources API only actually accepts `gcash` and `grab_pay`
// as a source `type` — `paymaya` is rejected outright ("source_type passed
// paymaya is invalid", confirmed against the real API and PayMongo's
// current docs). Maya's real integration is a completely different,
// separate API (Payment Intents + Payment Methods), which the "reuse the
// existing flow, don't build a separate implementation for Maya" ask
// explicitly rules out. So: "Maya (Demo)" places the exact same PayMongo
// call as GCash — the only genuinely working source type — while our own
// `method`/labels/transaction notes still correctly say Maya (Demo)
// throughout. Only this one line differs between the two demo methods.
$paymongo_source_type = $method === 'paymaya' ? 'gcash' : $method;

// Build the HTTP redirect URL using the host the mobile app reached us on.
// payment_return.php renders an HTML page that deep-links back to transyncmobile://.
// PayMongo only accepts http/https redirect URLs — custom schemes are rejected.
$scheme      = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host        = $_SERVER['HTTP_HOST'];
$return_base = "{$scheme}://{$host}/TranSync-App/transync-backend/api/wallet/payment_return.php";

$payload = json_encode([
    "data" => [
        "attributes" => [
            "amount"   => $amount_centavos,
            "currency" => "PHP",
            "type"     => $paymongo_source_type,
            "redirect" => [
                "success" => "{$return_base}?status=success",
                "failed"  => "{$return_base}?status=failed",
            ],
        ],
    ],
]);

$ch = curl_init("https://api.paymongo.com/v1/sources");
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
        "Content-Type: application/json",
        "Authorization: Basic " . base64_encode(PAYMONGO_SECRET_KEY . ":"),
    ],
]);

$response  = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_err  = curl_error($ch);
curl_close($ch);

if ($curl_err) {
    http_response_code(503);
    echo json_encode(["message" => "Network error reaching PayMongo"]);
    exit;
}

if ($http_code !== 200 && $http_code !== 201) {
    $err    = json_decode($response, true);
    $detail = $err['errors'][0]['detail'] ?? ($err['errors'][0]['code'] ?? 'Unknown error');
    http_response_code(502);
    echo json_encode(["message" => "PayMongo: {$detail}", "details" => $err]);
    exit;
}

$source    = json_decode($response, true)['data'];
$source_id = $source['id'];
$checkout  = $source['attributes']['redirect']['checkout_url'];

// Record source in DB to enable de-duplication and recovery in verify_payment.php
// commuter_id/driver_id: exactly one is a real id, the other is 0 here — cast
// to NULL so the unused FK column stays genuinely empty, not a bogus "0" row.
$commuter_id_or_null = $commuter_id ?: null;
$driver_id_or_null   = $driver_id   ?: null;
$stmt = $conn->prepare("
    INSERT INTO paymongo_sources (source_id, commuter_id, driver_id, amount, method, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
    ON DUPLICATE KEY UPDATE created_at = created_at
");
$stmt->bind_param("siids", $source_id, $commuter_id_or_null, $driver_id_or_null, $amount, $method);
$stmt->execute();

echo json_encode([
    "success"      => true,
    "source_id"    => $source_id,
    "checkout_url" => $checkout,
    "amount"       => $amount,
    "method"       => $method,
]);
