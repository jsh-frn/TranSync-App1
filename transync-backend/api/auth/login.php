<?php
header("Content-Type: application/json");

require_once "../../config/db.php";
require_once "../../config/auth.php";

$data     = json_decode(file_get_contents("php://input"), true);
$email    = $data["email"]    ?? "";
$password = $data["password"] ?? "";

$stmt = $conn->prepare("SELECT * FROM admins WHERE email = ?");
$stmt->bind_param("s", $email);
$stmt->execute();
$admin = $stmt->get_result()->fetch_assoc();

if (!$admin || !password_verify($password, $admin["password"])) {
    http_response_code(401);
    echo json_encode(["message" => "Invalid credentials"]);
    exit;
}

$token = createSession($conn, 'admin', (int)$admin["id"], 1); // 1-day admin sessions

echo json_encode([
    "message"       => "Login successful",
    "session_token" => $token,
    "admin"         => [
        "id"    => $admin["id"],
        "name"  => $admin["name"],
        "email" => $admin["email"],
    ]
]);
