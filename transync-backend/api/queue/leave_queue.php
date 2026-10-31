<?php
header("Content-Type: application/json");
require_once "../../config/db.php";

$data      = json_decode(file_get_contents("php://input"), true);
$driver_id = intval($data['driver_id'] ?? 0);

if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "Missing driver_id"]);
    exit;
}

$conn->query("UPDATE dispatch_queue SET status='completed', ended_at=NOW() WHERE driver_id=$driver_id AND status='waiting'");

echo json_encode([
    "success"       => true,
    "rows_affected" => $conn->affected_rows,
    "driver_id"     => $driver_id,
]);
