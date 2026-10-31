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
require_once "../../config/account_lookup.php";
require_once "../../config/phone_otp.php";

// Final step of the login page's "Forgot Password" flow — requires a
// recent, unconsumed OTP verification for this exact phone number (from
// send_phone_otp.php{purpose:"password_reset"} + verify_phone_otp.php,
// exactly the same isPhoneOtpVerified() gate every self-registration
// endpoint already uses). Re-resolves the account by phone itself rather
// than trusting any client-supplied id — Commuter/Operator/Association
// only, same scope as lookup_account_by_phone.php (Driver excluded).
$data        = json_decode(file_get_contents("php://input"), true) ?? [];
$phone       = trim($data["phone"] ?? "");
$newPassword = $data["new_password"] ?? "";

if (!preg_match('/^09\d{9}$/', $phone)) {
    http_response_code(400);
    echo json_encode(["message" => "Invalid phone number."]);
    exit;
}
if (strlen($newPassword) < 6) {
    http_response_code(400);
    echo json_encode(["message" => "Password must be at least 6 characters."]);
    exit;
}

if (!isPhoneOtpVerified($conn, $phone)) {
    http_response_code(403);
    echo json_encode(["message" => "Please verify your phone number first."]);
    exit;
}

$account = findAccountByPhone($conn, $phone);
if (!$account) {
    http_response_code(404);
    echo json_encode(["message" => "This phone number is not registered."]);
    exit;
}

$tables = [
    'commuter'    => 'commuters',
    'operator'    => 'operators',
    'association' => 'associations',
];
$table = $tables[$account['account_type']];

$hashed = password_hash($newPassword, PASSWORD_BCRYPT);
$stmt = $conn->prepare("UPDATE {$table} SET password = ? WHERE id = ?");
$stmt->bind_param("si", $hashed, $account['id']);
$stmt->execute();

consumePhoneOtpVerification($conn, $phone);

echo json_encode(["success" => true, "message" => "Password reset successful. You can now log in with your new password."]);
