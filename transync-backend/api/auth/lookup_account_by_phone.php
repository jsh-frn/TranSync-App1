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

// Step 1 of the login page's "Forgot Password" flow — given a phone number,
// find which account (Commuter/Operator/Association only, see
// config/account_lookup.php's note on Driver exclusion) it belongs to, and
// return just enough to power an "Is this you?" confirmation (masked name,
// account type, and the account's own profile photo if one is set — helps
// the real owner visually recognize their own account) before any OTP is
// sent. Never returns the account id — every later step in this flow
// re-resolves the account by phone number itself, server-side.
$data  = json_decode(file_get_contents("php://input"), true) ?? [];
$phone = trim($data["phone"] ?? "");

if (!preg_match('/^09\d{9}$/', $phone)) {
    http_response_code(400);
    echo json_encode(["message" => "Enter a valid 11-digit Philippine mobile number (09XXXXXXXXX)."]);
    exit;
}

$account = findAccountByPhone($conn, $phone);
if (!$account) {
    http_response_code(404);
    echo json_encode(["found" => false, "message" => "This phone number is not registered."]);
    exit;
}

echo json_encode([
    "found"        => true,
    "account_type" => $account["account_type"],
    "masked_name"  => maskFullName($account["first_name"], $account["last_name"]),
    "avatar_url"   => $account["avatar_url"],
]);
