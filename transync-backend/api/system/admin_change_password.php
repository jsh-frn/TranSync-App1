<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$data             = json_decode(file_get_contents("php://input"), true) ?? $_POST;
$admin_id         = (int)($data["admin_id"] ?? 0);
$current_password = $data["current_password"] ?? "";
$new_password     = $data["new_password"] ?? "";

if (!$admin_id || $current_password === "" || $new_password === "") {
    echo json_encode(["success" => false, "message" => "Current password and new password are required."]);
    exit;
}

// Same minimum-length rule as every other password-setting path in this app.
if (strlen($new_password) < 6) {
    echo json_encode(["success" => false, "message" => "New password must be at least 6 characters."]);
    exit;
}

$stmt = $conn->prepare("SELECT password FROM admins WHERE id = ?");
$stmt->bind_param("i", $admin_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    echo json_encode(["success" => false, "message" => "Admin not found."]);
    exit;
}

if (!password_verify($current_password, $row["password"])) {
    echo json_encode(["success" => false, "message" => "Current password is incorrect."]);
    exit;
}

$hashed = password_hash($new_password, PASSWORD_BCRYPT);
$update = $conn->prepare("UPDATE admins SET password = ? WHERE id = ?");
$update->bind_param("si", $hashed, $admin_id);
$update->execute();

echo json_encode(["success" => true, "message" => "Password changed successfully."]);
