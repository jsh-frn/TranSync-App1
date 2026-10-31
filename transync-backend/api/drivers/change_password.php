<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/phone_otp.php";

$data             = json_decode(file_get_contents("php://input"), true) ?? $_POST;
$driver_id        = (int)($data["driver_id"] ?? 0);
$current_password = $data["current_password"] ?? "";
$new_password     = $data["new_password"] ?? "";
// Alternative to Current Password — see commuter/change_password.php's
// identical note. Phone is always read fresh from this driver's own row
// below, never taken from the client. Driver is excluded from the login
// page's phone-lookup "Forgot Password" flow (see config/account_lookup.php),
// but this Settings-context OTP is sent via
// send_phone_otp.php{purpose:"self_verify"} — the phone here comes from
// this driver's own get_profile.php response, not a typed-in number, so
// the registration-lookup check that excludes Driver doesn't apply.
$via_otp          = (bool)($data["via_otp"] ?? false);

if (!$driver_id || $new_password === "" || (!$via_otp && $current_password === "")) {
    echo json_encode(["success" => false, "message" => "Current password and new password are required."]);
    exit;
}
if (strlen($new_password) < 6) {
    echo json_encode(["success" => false, "message" => "New password must be at least 6 characters."]);
    exit;
}

$stmt = $conn->prepare("SELECT password, phone FROM drivers WHERE id = ?");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    echo json_encode(["success" => false, "message" => "Driver not found."]);
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
$update = $conn->prepare("UPDATE drivers SET password = ? WHERE id = ?");
$update->bind_param("si", $hashed, $driver_id);
$update->execute();

if ($via_otp) {
    consumePhoneOtpVerification($conn, $row["phone"]);
}

echo json_encode(["success" => true, "message" => "Password changed successfully."]);
