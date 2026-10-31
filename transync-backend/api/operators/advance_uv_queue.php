<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Operator-triggered version of the same dispatched->completed / waiting->dispatched
// transition a driver can already self-trigger via trips/start_trip.php and
// queue/leave_queue.php — writes to the same dispatch_queue rows, so it can
// never conflict destructively with driver self-service. Does not touch
// join_queue.php/leave_queue.php or any Jeepney (route_id IS NULL) behavior.
$data        = json_decode(file_get_contents("php://input"), true);
$operator_id = (int)($data["operator_id"] ?? 0);
$route_id    = (int)($data["route_id"] ?? 0);

if (!$operator_id || !$route_id) {
    echo json_encode(["success" => false, "message" => "operator_id and route_id are required."]);
    exit;
}

// Routes are association-owned now — resolve via the operator's approved
// UV Express membership, same pattern as uv_slots/create_slot.php.
$stmt = $conn->prepare("
    SELECT r.id FROM routes r
    JOIN operator_association_applications oaa
        ON oaa.association_id = r.association_id AND oaa.vehicle_type = 'UV Express' AND oaa.status = 'approved'
    WHERE r.id = ? AND oaa.operator_id = ? AND r.vehicle_type = 'UV Express'
");
$stmt->bind_param("ii", $route_id, $operator_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    echo json_encode(["success" => false, "message" => "Route not found for this operator."]);
    exit;
}

$conn->begin_transaction();
try {
    // Retire the currently dispatched driver for this route, if any
    $stmt = $conn->prepare("
        SELECT id FROM dispatch_queue
        WHERE operator_id = ? AND route_id = ? AND status = 'dispatched'
        LIMIT 1
    ");
    $stmt->bind_param("ii", $operator_id, $route_id);
    $stmt->execute();
    $current = $stmt->get_result()->fetch_assoc();

    if ($current) {
        $stmt = $conn->prepare("UPDATE dispatch_queue SET status = 'completed', ended_at = NOW() WHERE id = ?");
        $stmt->bind_param("i", $current["id"]);
        $stmt->execute();
    }

    // Advance the next waiting driver (front of line, same FIFO start_trip.php uses)
    $stmt = $conn->prepare("
        SELECT id, driver_id FROM dispatch_queue
        WHERE operator_id = ? AND route_id = ? AND status = 'waiting'
        ORDER BY id ASC LIMIT 1
    ");
    $stmt->bind_param("ii", $operator_id, $route_id);
    $stmt->execute();
    $next = $stmt->get_result()->fetch_assoc();

    if ($next) {
        $stmt = $conn->prepare("UPDATE dispatch_queue SET status = 'dispatched', started_at = NOW() WHERE id = ?");
        $stmt->bind_param("i", $next["id"]);
        $stmt->execute();

        $stmt = $conn->prepare("UPDATE drivers SET is_online = 1, is_full = 0 WHERE id = ?");
        $stmt->bind_param("i", $next["driver_id"]);
        $stmt->execute();
    }

    if (!$current && !$next) {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "No dispatched or waiting drivers on this route."]);
        exit;
    }

    $conn->commit();
    echo json_encode(["success" => true, "advanced_to_driver_id" => $next ? (int)$next["driver_id"] : null]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to advance queue."]);
}
