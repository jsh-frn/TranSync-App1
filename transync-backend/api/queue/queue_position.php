<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";

$driver_id   = intval($_GET['driver_id']   ?? 0);
$operator_id = intval($_GET['operator_id'] ?? 0);

if (!$driver_id || !$operator_id) {
    echo json_encode(["success" => false, "message" => "Missing fields"]);
    exit;
}

// Find this driver's current waiting row
$stmt = $conn->prepare("
    SELECT id, route_id FROM dispatch_queue
    WHERE driver_id   = ?
      AND operator_id = ?
      AND status      = 'waiting'
    ORDER BY joined_at ASC
    LIMIT 1
");
$stmt->bind_param("ii", $driver_id, $operator_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row) {
    echo json_encode(["success" => false, "in_queue" => false]);
    exit;
}

$my_id       = (int) $row['id'];
$my_route_id = $row['route_id'] !== null ? (int) $row['route_id'] : null;

// Count ONLY 'waiting' drivers ahead (joined before = smaller id), scoped to
// the same route when route-scoped (UV); route_id <=> NULL-safe match keeps
// unscoped Jeepney queues (route_id always NULL) working unchanged.
$stmt = $conn->prepare("
    SELECT COUNT(*) AS ahead
    FROM dispatch_queue
    WHERE operator_id = ?
      AND status      = 'waiting'
      AND id          < ?
      AND route_id    <=> ?
");
$stmt->bind_param("iii", $operator_id, $my_id, $my_route_id);
$stmt->execute();
$ahead    = (int) $stmt->get_result()->fetch_assoc()['ahead'];
$position = $ahead + 1;

echo json_encode([
    "success"        => true,
    "in_queue"       => true,
    "queue_position" => $position,
]);
