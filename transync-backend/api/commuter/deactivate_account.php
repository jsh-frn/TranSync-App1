<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Reversible self-service deactivation (Commuter Settings page) — see
// migration 045. Deliberately does not touch commuters.status/rejected_at,
// which login_mobile.php already uses for the unrelated admin-reject gate.
// Logging back in with the correct password clears this flag automatically
// (see login_mobile.php's commuter branch) — no admin action either way.
$data        = json_decode(file_get_contents("php://input"), true) ?? $_POST;
$commuter_id = (int)($data["commuter_id"] ?? 0);
$password    = $data["password"] ?? "";

if (!$commuter_id || $password === "") {
    echo json_encode(["success" => false, "message" => "Password confirmation is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT password FROM commuters WHERE id = ?");
$stmt->bind_param("i", $commuter_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    echo json_encode(["success" => false, "message" => "Commuter not found."]);
    exit;
}
if (!password_verify($password, $row["password"])) {
    echo json_encode(["success" => false, "message" => "Password is incorrect."]);
    exit;
}

$update = $conn->prepare("UPDATE commuters SET deactivated_at = NOW() WHERE id = ?");
$update->bind_param("i", $commuter_id);
$update->execute();

echo json_encode(["success" => true, "message" => "Your account has been deactivated. Log back in anytime to reactivate it."]);
