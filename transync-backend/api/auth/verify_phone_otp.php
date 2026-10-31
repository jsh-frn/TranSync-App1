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
require_once "../../config/sms.php";

// Checks a submitted code against IPROG's own /otp/verify_otp — this
// endpoint never compares against a locally-stored code (none is stored,
// see migration 048's note). On success, marks the phone as verified so
// isPhoneOtpVerified() (config/phone_otp.php) lets the actual registration
// endpoint proceed.
$data  = json_decode(file_get_contents("php://input"), true) ?? [];
$phone = trim($data["phone"] ?? "");
$otp   = trim($data["otp"]   ?? "");

if (!preg_match('/^09\d{9}$/', $phone) || !preg_match('/^\d{6}$/', $otp)) {
    http_response_code(400);
    echo json_encode(["message" => "Invalid phone number or code."]);
    exit;
}

$maxAttempts = (int) OTP_MAX_ATTEMPTS;
$stmt = $conn->prepare("
    SELECT id, attempts FROM phone_otp_verifications
    WHERE phone_number = ? AND verified = 0 AND expires_at >= NOW()
    ORDER BY id DESC LIMIT 1
");
$stmt->bind_param("s", $phone);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row) {
    http_response_code(400);
    echo json_encode(["message" => "No pending verification for this number, or it has expired. Request a new code."]);
    exit;
}
if ((int) $row["attempts"] >= $maxAttempts) {
    http_response_code(429);
    echo json_encode(["message" => "Too many incorrect attempts. Request a new code."]);
    exit;
}

$payload = json_encode([
    "api_token"    => IPROG_SMS_API_TOKEN,
    "phone_number" => $phone,
    "otp"          => $otp,
]);

$ch = curl_init(IPROG_SMS_BASE_URL . "/otp/verify_otp");
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

$result  = json_decode($response, true);
$success = $http_code === 200 && ($result["status"] ?? "") === "success";

if (!$success) {
    $upd = $conn->prepare("UPDATE phone_otp_verifications SET attempts = attempts + 1 WHERE id = ?");
    $upd->bind_param("i", $row["id"]);
    $upd->execute();

    $message = $result["message"] ?? "Incorrect or expired code.";
    http_response_code(400);
    echo json_encode(["success" => false, "message" => $message]);
    exit;
}

$upd = $conn->prepare("UPDATE phone_otp_verifications SET verified = 1, verified_at = NOW() WHERE id = ?");
$upd->bind_param("i", $row["id"]);
$upd->execute();

echo json_encode(["success" => true, "message" => "Phone number verified."]);
