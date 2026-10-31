<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Surfaces the same route-scoped dispatch_queue FIFO that trips/start_trip.php
// already enforces for UV Express — the "dispatched" row for (operator_id,
// route_id) IS the active vehicle for new bookings (see board_reservation.php's
// slot-rollover authorization). Read-only; nothing here mutates the queue.
$operator_id = (int)($_GET["operator_id"] ?? 0);
$route_id    = (int)($_GET["route_id"] ?? 0);

if (!$operator_id || !$route_id) {
    echo json_encode(["success" => false, "message" => "operator_id and route_id are required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT dq.driver_id, d.name AS driver_name, v.plate_number
    FROM dispatch_queue dq
    JOIN drivers d ON d.id = dq.driver_id
    LEFT JOIN vehicles v ON v.id = d.vehicle_id
    WHERE dq.operator_id = ? AND dq.route_id = ? AND dq.status = 'dispatched'
    LIMIT 1
");
$stmt->bind_param("ii", $operator_id, $route_id);
$stmt->execute();
$dispatchedRow = $stmt->get_result()->fetch_assoc();
$dispatched = $dispatchedRow ? [
    "driver_id"    => (int)$dispatchedRow["driver_id"],
    "driver_name"  => $dispatchedRow["driver_name"],
    "plate_number" => $dispatchedRow["plate_number"],
] : null;

$stmt = $conn->prepare("
    SELECT dq.driver_id, d.name AS driver_name, v.plate_number
    FROM dispatch_queue dq
    JOIN drivers d ON d.id = dq.driver_id
    LEFT JOIN vehicles v ON v.id = d.vehicle_id
    WHERE dq.operator_id = ? AND dq.route_id = ? AND dq.status = 'waiting'
    ORDER BY dq.id ASC
");
$stmt->bind_param("ii", $operator_id, $route_id);
$stmt->execute();
$result = $stmt->get_result();
$waiting = [];
while ($row = $result->fetch_assoc()) {
    $waiting[] = [
        "driver_id"    => (int)$row["driver_id"],
        "driver_name"  => $row["driver_name"],
        "plate_number" => $row["plate_number"],
    ];
}

echo json_encode(["success" => true, "dispatched" => $dispatched, "waiting" => $waiting]);
