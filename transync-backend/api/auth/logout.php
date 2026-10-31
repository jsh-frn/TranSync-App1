<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";
require_once "../../config/auth.php";

$header = getAuthorizationHeader();
if (preg_match('/^Bearer\s+(\S+)$/', $header, $m)) {
    destroySession($conn, $m[1]);
}

echo json_encode(["message" => "Logged out."]);
