<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";

$body      = json_decode(file_get_contents("php://input"), true);
$driver_id = (int)($body["driver_id"] ?? 0);
if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "driver_id is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT id FROM uv_sessions WHERE driver_id = ? AND status IN ('open', 'full')");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$session = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$session) {
    echo json_encode(["success" => false, "message" => "No active session for this driver."]);
    exit;
}
$uv_session_id = (int)$session["id"];

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("UPDATE uv_sessions SET status = 'departed', ended_at = NOW() WHERE id = ?");
    $stmt->bind_param("i", $uv_session_id);
    $stmt->execute();
    $stmt->close();

    $stmt = $conn->prepare("
        UPDATE reservations SET boarding_status = 'no_show', status = 'expired'
        WHERE uv_session_id = ? AND boarding_status = 'reserved'
    ");
    $stmt->bind_param("i", $uv_session_id);
    $stmt->execute();
    $stmt->close();

    $stmt = $conn->prepare("UPDATE drivers SET is_online = 0 WHERE id = ?");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
    echo json_encode(["success" => true]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to go offline."]);
}
