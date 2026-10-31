<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

// Sets/updates a driver's Vehicle Type -> Route -> Driver -> Daily Quota
// (driver_route_quotas, migration 057) — the booking-capacity cap, not the
// peso-based driver_quotas settlement target (quota/set_quota.php).

$data        = json_decode(file_get_contents("php://input"), true);
$operator_id = (int)($data['operator_id']  ?? 0);
$route_id    = (int)($data['route_id']     ?? 0);
$driver_id   = (int)($data['driver_id']    ?? 0);
$daily_quota = isset($data['daily_quota']) ? (int)$data['daily_quota'] : 0;

if (!$operator_id || !$route_id || !$driver_id || $daily_quota <= 0) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id, route_id, driver_id, and a positive daily_quota are required."]);
    exit;
}

// The driver must belong to this operator and their currently-assigned
// vehicle must actually be assigned to this route (migration 056) — an
// operator can only set a quota for a driver genuinely on that route today.
$stmt = $conn->prepare("
    SELECT d.id
    FROM drivers d
    JOIN route_assignments ra ON ra.vehicle_id = d.vehicle_id
    WHERE d.id = ? AND d.operator_id = ? AND ra.route_id = ?
");
$stmt->bind_param("iii", $driver_id, $operator_id, $route_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    http_response_code(403);
    echo json_encode(["success" => false, "message" => "This driver isn't currently assigned to this route."]);
    exit;
}
$stmt->close();

$stmt = $conn->prepare("
    INSERT INTO driver_route_quotas (operator_id, route_id, driver_id, daily_quota)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE daily_quota = VALUES(daily_quota)
");
$stmt->bind_param("iiii", $operator_id, $route_id, $driver_id, $daily_quota);

if ($stmt->execute()) {
    echo json_encode([
        "success"     => true,
        "message"     => "Quota saved.",
        "route_id"    => $route_id,
        "driver_id"   => $driver_id,
        "daily_quota" => $daily_quota,
    ]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to save quota."]);
}
