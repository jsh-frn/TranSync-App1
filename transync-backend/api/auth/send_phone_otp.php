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
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

require_once "../../config/db.php";
require_once "../../config/account_validation.php";
require_once "../../config/account_lookup.php";
require_once "../../config/sms.php";

// Sends a fresh OTP via IPROG SMS. Shared by three pre-checks, selected by
// `purpose`:
//   - "registration" (default, backward-compatible with the three existing
//     registration screens which don't send this field at all) — the phone
//     must NOT already belong to an account (see migration 048).
//   - "password_reset" — the phone MUST already belong to a Commuter/
//     Operator/Association account (Driver excluded, see
//     config/account_lookup.php's note); used by the login page's own
//     "Forgot Password" flow, where the caller supplies an arbitrary phone
//     number that hasn't been tied to a specific account yet.
//   - "self_verify" — no registration check at all. Used by the Settings
//     "verify via OTP instead of Current Password" flow (all four roles,
//     including Driver): the phone is always read server-side from that
//     exact already-identified account's own on-file row (never typed by
//     the user), so it's already known to be a real, currently-registered
//     number — re-running the password_reset 3-table lookup would
//     incorrectly reject a Driver's own phone (Driver is intentionally
//     outside that lookup's scope, see config/account_lookup.php). Safe to
//     skip: the actual security boundary here is receipt of the SMS itself
//     (verify_phone_otp.php), not this pre-check, which only exists to
//     avoid spending SMS credits on numbers nobody could ever prove
//     ownership of.
// Either way, the actual OTP mechanics (cooldown, IPROG call, storage) are
// identical — only which accounts are eligible differs. The plaintext code
// IPROG returns in its own response is intentionally never echoed back
// here — /otp/verify_otp is the only place a submitted code is ever checked.
$data    = json_decode(file_get_contents("php://input"), true) ?? [];
$phone   = trim($data["phone"] ?? "");
$purpose = $data["purpose"] ?? "registration";
if (!in_array($purpose, ["registration", "password_reset", "self_verify"], true)) {
    $purpose = "registration";
}

if (!preg_match('/^09\d{9}$/', $phone)) {
    http_response_code(400);
    echo json_encode(["message" => "Enter a valid 11-digit Philippine mobile number (09XXXXXXXXX)."]);
    exit;
}

if ($purpose === "registration") {
    // Don't spend an SMS credit verifying a number that's already claimed by
    // an existing account — every self-registration endpoint would reject it
    // later anyway (same 4-table check commuter_register.php etc. already run).
    if (phoneAlreadyRegistered($conn, $phone)) {
        http_response_code(409);
        echo json_encode(["message" => "This phone number is already linked to an existing account."]);
        exit;
    }
} elseif ($purpose === "password_reset") {
    // The inverse of "registration": refuse to send unless the phone is
    // actually on file for a resettable (Commuter/Operator/Association)
    // account.
    if (!findAccountByPhone($conn, $phone)) {
        http_response_code(404);
        echo json_encode(["message" => "This phone number is not registered."]);
        exit;
    }
}
// purpose === "self_verify" — no pre-check, see the note above.

// Resend cooldown — IPROG's docs don't specify a rate limit, so this is
// enforced on our side. Compared entirely in MySQL (NOW() - INTERVAL ...),
// never PHP's time()/date(), per this codebase's documented PHP/MySQL clock
// mismatch landmine.
$cooldown = (int) OTP_RESEND_COOLDOWN_SECONDS;
$stmt = $conn->prepare("
    SELECT id FROM phone_otp_verifications
    WHERE phone_number = ? AND otp_requested_at >= (NOW() - INTERVAL {$cooldown} SECOND)
    ORDER BY id DESC LIMIT 1
");
$stmt->bind_param("s", $phone);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    http_response_code(429);
    echo json_encode(["message" => "Please wait before requesting another code."]);
    exit;
}

// "message" is deliberately omitted, not sent as "" — IPROG only falls back
// to its own default template ("Your OTP code is :otp. It is valid for 5
// minutes...") when the key is absent entirely; an empty string is taken as
// a literal (blank) custom message and produces an SMS with no OTP in it.
$payload = json_encode([
    "api_token"          => IPROG_SMS_API_TOKEN,
    "phone_number"       => $phone,
    "expires_in_minutes" => (int) OTP_EXPIRY_MINUTES,
]);

$ch = curl_init(IPROG_SMS_BASE_URL . "/otp/send_otp");
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => ["Content-Type: application/json"],
]);
$response  = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_err  = curl_error($ch);
curl_close($ch);

if ($curl_err) {
    http_response_code(503);
    echo json_encode(["message" => "Network error reaching the SMS provider. Please try again."]);
    exit;
}

$result = json_decode($response, true);
if ($http_code !== 200 || ($result["status"] ?? "") !== "success") {
    $detail = $result["message"] ?? "Failed to send verification code. Please try again.";
    http_response_code(502);
    echo json_encode(["message" => $detail]);
    exit;
}

$expiresMinutes = (int) OTP_EXPIRY_MINUTES;
$stmt = $conn->prepare("
    INSERT INTO phone_otp_verifications (phone_number, otp_requested_at, expires_at, verified, attempts)
    VALUES (?, NOW(), NOW() + INTERVAL {$expiresMinutes} MINUTE, 0, 0)
");
$stmt->bind_param("s", $phone);
$stmt->execute();

echo json_encode(["success" => true, "message" => "Verification code sent."]);
