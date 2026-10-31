<?php
header("Content-Type: application/json");
require_once "../../config/db.php";

$data      = json_decode(file_get_contents("php://input"), true);
$driver_id = $data['driver_id'] ?? null;

if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "Missing driver_id"]);
    exit;
}

// Find this driver's current waiting row
$stmt = $conn->prepare("
    SELECT id, operator_id, route_id FROM dispatch_queue
    WHERE driver_id = ? AND status = 'waiting'
    ORDER BY joined_at ASC LIMIT 1
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$queue_row = $stmt->get_result()->fetch_assoc();

if (!$queue_row) {
    echo json_encode(["success" => false, "message" => "No active queue entry found"]);
    exit;
}

$queue_id     = (int) $queue_row["id"];
$queue_op_id  = (int) $queue_row["operator_id"];
$queue_route  = $queue_row["route_id"] !== null ? (int) $queue_row["route_id"] : null;

// Route-scoped queues (UV Express) model a single physical line: only one
// driver may be dispatched at a time, and only the driver at the front of
// the waiting line may start — because "dispatched" now grants authority to
// scan and get paid for that route's scheduled-slot bookings (see
// board_reservation.php). Jeepney's unscoped queue (route_id NULL) keeps its
// existing looser behavior unchanged — many jeepneys can be dispatched at once.
if ($queue_route !== null) {
    $stmt = $conn->prepare("
        SELECT id FROM dispatch_queue
        WHERE operator_id = ? AND route_id = ? AND status = 'dispatched'
        LIMIT 1
    ");
    $stmt->bind_param("ii", $queue_op_id, $queue_route);
    $stmt->execute();
    if ($stmt->get_result()->fetch_assoc()) {
        echo json_encode(["success" => false, "message" => "Another driver is currently dispatched for this route."]);
        exit;
    }

    $stmt = $conn->prepare("
        SELECT MIN(id) AS front_id FROM dispatch_queue
        WHERE operator_id = ? AND route_id = ? AND status = 'waiting'
    ");
    $stmt->bind_param("ii", $queue_op_id, $queue_route);
    $stmt->execute();
    $front_id = (int) $stmt->get_result()->fetch_assoc()["front_id"];
    if ($front_id !== $queue_id) {
        echo json_encode(["success" => false, "message" => "You are not first in line yet."]);
        exit;
    }
}

// Change this driver from 'waiting' → 'dispatched'
// The instant this happens, every driver behind them is now 1 position higher
// because queue_position.php only counts 'waiting' rows
$stmt = $conn->prepare("
    UPDATE dispatch_queue
    SET    status     = 'dispatched',
           started_at = NOW()
    WHERE  id          = ?
      AND  status      = 'waiting'
");
$stmt->bind_param("i", $queue_id);
$stmt->execute();

if ($stmt->affected_rows === 0) {
    echo json_encode(["success" => false, "message" => "No active queue entry found"]);
    exit;
}

// Mark driver as online
$stmt = $conn->prepare("
    UPDATE drivers
    SET is_online = 1, is_full = 0
    WHERE id = ?
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();

echo json_encode(["success" => true]);
