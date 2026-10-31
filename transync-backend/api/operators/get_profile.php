<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Lets Operator Profile/Settings/Verification re-sync live (Operator
// Settings) — mirrors commuter/get_profile.php and associations/
// get_profile.php. login_mobile.php's operator branch only ever reflects
// login-time state, so this is the only way an admin approving/rejecting
// the operator's account mid-session shows up without a re-login.
$operator_id = (int)($_GET["operator_id"] ?? 0);
if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, name, email, phone, operator_type, is_verified, status, rejected_at, avatar_url
    FROM operators WHERE id = ?
");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$op = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$op) {
    echo json_encode(["success" => false, "message" => "Operator not found."]);
    exit;
}

echo json_encode([
    "success" => true,
    "operator" => [
        "id"            => (int)$op["id"],
        "name"          => $op["name"],
        "email"         => $op["email"],
        "phone"         => $op["phone"],
        "operator_type" => $op["operator_type"],
        "is_verified"   => (int)$op["is_verified"],
        "status"        => $op["status"],
        "rejected_at"   => $op["rejected_at"],
        // Relative path — see commuter/get_profile.php's comment.
        "avatar_url"    => $op["avatar_url"],
    ],
]);
