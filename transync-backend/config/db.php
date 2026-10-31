<?php
require_once __DIR__ . '/env.php';

$host = getenv('DB_HOST') ?: "localhost";
$db   = getenv('DB_NAME') ?: "transync";
$user = getenv('DB_USER') ?: "root";
$pass = getenv('DB_PASS') ?: "";

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    die(json_encode(["message" => "Connection failed: " . $conn->connect_error]));
}