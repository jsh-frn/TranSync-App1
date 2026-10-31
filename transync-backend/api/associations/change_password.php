<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/phone_otp.php";

$data            = json_decode(file_get_contents("php://input"), true) ?? $_POST;
$association_id  = (int)($data["association_id"] ?? 0);
$current_password = $data["current_password"] ?? "";
$new_password    = $data["new_password"] ?? "";
// Alternative to Current Password — see commuter/change_password.php's
// identical note. Phone (the rep's own contact_phone, the login-adjacent
// number) is always read fresh from this association's own row below,
// never taken from the client.
$via_otp         = (bool)($data["via_otp"] ?? false);

if (!$association_id || $new_password === "" || (!$via_otp && $current_password === "")) {
    echo json_encode(["success" => false, "message" => "Current password and new password are required."]);
    exit;
}
if (strlen($new_password) < 6) {
    echo json_encode(["success" => false, "message" => "New password must be at least 6 characters."]);
    exit;
}

$stmt = $conn->prepare("SELECT password, contact_phone FROM associations WHERE id = ?");
$stmt->bind_param("i", $association_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    echo json_encode(["success" => false, "message" => "Association not found."]);
    exit;
}
if ($via_otp) {
    if (!isPhoneOtpVerified($conn, $row["contact_phone"])) {
        echo json_encode(["success" => false, "message" => "Please verify your phone number first."]);
        exit;
    }
} elseif (!password_verify($current_password, $row["password"])) {
    echo json_encode(["success" => false, "message" => "Current password is incorrect."]);
    exit;
}

$hashed = password_hash($new_password, PASSWORD_BCRYPT);
$update = $conn->prepare("UPDATE associations SET password = ? WHERE id = ?");
$update->bind_param("si", $hashed, $association_id);
$update->execute();

if ($via_otp) {
    consumePhoneOtpVerification($conn, $row["contact_phone"]);
}

echo json_encode(["success" => true, "message" => "Password changed successfully."]);
