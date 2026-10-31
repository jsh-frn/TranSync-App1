<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/phone_otp.php";

$data              = json_decode(file_get_contents("php://input"), true) ?? $_POST;
$commuter_id       = (int)($data["commuter_id"] ?? 0);
$current_password  = $data["current_password"] ?? "";
$new_password      = $data["new_password"] ?? "";
// Alternative to Current Password — the commuter forgot it and instead
// verified their own on-file phone via OTP (auth/send_phone_otp.php with
// purpose=password_reset + verify_phone_otp.php, same flow the login
// page's "Forgot Password" uses). The phone itself is never taken from the
// client — always read fresh from this commuter's own row below, so this
// flag can't be used to prove ownership of a phone that isn't actually on
// file for this exact account.
$via_otp           = (bool)($data["via_otp"] ?? false);

if (!$commuter_id || $new_password === "" || (!$via_otp && $current_password === "")) {
    echo json_encode(["success" => false, "message" => "Current password and new password are required."]);
    exit;
}

// Same minimum-length rule as every other password-setting path in this app
// (registration, drivers.php's update_details) — see CLAUDE.md.
if (strlen($new_password) < 6) {
    echo json_encode(["success" => false, "message" => "New password must be at least 6 characters."]);
    exit;
}

$stmt = $conn->prepare("SELECT password, phone FROM commuters WHERE id = ?");
$stmt->bind_param("i", $commuter_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    echo json_encode(["success" => false, "message" => "Commuter not found."]);
    exit;
}

if ($via_otp) {
    if (!isPhoneOtpVerified($conn, $row["phone"])) {
        echo json_encode(["success" => false, "message" => "Please verify your phone number first."]);
        exit;
    }
} elseif (!password_verify($current_password, $row["password"])) {
    echo json_encode(["success" => false, "message" => "Current password is incorrect."]);
    exit;
}

$hashed = password_hash($new_password, PASSWORD_BCRYPT);
$update = $conn->prepare("UPDATE commuters SET password = ? WHERE id = ?");
$update->bind_param("si", $hashed, $commuter_id);
$update->execute();

if ($via_otp) {
    consumePhoneOtpVerification($conn, $row["phone"]);
}

echo json_encode(["success" => true, "message" => "Password changed successfully."]);
