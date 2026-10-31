<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

// Vehicle Type -> Route -> Driver -> Daily Quota (driver_route_quotas,
// migration 057) — a separate concept from the peso-based driver_quotas
// settlement target (see quota/get_driver_quota.php). Returns every driver
// currently assigned (via their vehicle, migration 056) to the given route,
// with whatever daily_quota the operator has set (null if unset) and a live
// count of today's valid bookings against it.

$operator_id = (int)($_GET['operator_id'] ?? 0);
$route_id    = (int)($_GET['route_id']    ?? 0);

if (!$operator_id || !$route_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id and route_id are required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT r.vehicle_type
    FROM routes r
    WHERE r.id = ?
");
$stmt->bind_param("i", $route_id);
$stmt->execute();
$route = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$route) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Route not found."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT d.id, d.name, d.email, v.id AS vehicle_id, v.plate_number,
           drq.daily_quota
    FROM route_assignments ra
    JOIN vehicles v ON v.id = ra.vehicle_id
    JOIN drivers d  ON d.vehicle_id = v.id
    LEFT JOIN driver_route_quotas drq ON drq.route_id = ra.route_id AND drq.driver_id = d.id
    WHERE ra.route_id = ? AND v.operator_id = ?
    ORDER BY d.name ASC
");
$stmt->bind_param("ii", $route_id, $operator_id);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

$drivers = [];
foreach ($rows as $row) {
    $daily_quota = $row["daily_quota"] !== null ? (int)$row["daily_quota"] : null;
    $used_today  = null;

    if ($daily_quota !== null) {
        // Bus (trip-based) usage — counts every valid reservation on this
        // driver's own trips for this route, scoped to today. UV Express
        // usage is tracked separately at boarding time (see
        // board_reservation.php / preview_ticket.php) since a UV slot has no
        // fixed driver at booking time — this count only reflects Bus.
        $uStmt = $conn->prepare("
            SELECT COUNT(*) AS cnt
            FROM reservations res
            JOIN trips t ON t.id = res.trip_id
            WHERE t.driver_id = ? AND t.route_id = ? AND DATE(t.departure_time) = CURDATE()
              AND res.boarding_status IN ('reserved', 'boarded', 'completed')
        ");
        $uStmt->bind_param("ii", $row["id"], $route_id);
        $uStmt->execute();
        $used_today = (int)$uStmt->get_result()->fetch_assoc()["cnt"];
        $uStmt->close();
    }

    $drivers[] = [
        "driver_id"      => (int)$row["id"],
        "driver_name"    => $row["name"],
        "driver_email"   => $row["email"],
        "vehicle_id"     => (int)$row["vehicle_id"],
        "plate_number"   => $row["plate_number"],
        "daily_quota"    => $daily_quota,
        "used_today"     => $used_today,
    ];
}

echo json_encode([
    "success"      => true,
    "vehicle_type" => $route["vehicle_type"],
    "drivers"      => $drivers,
]);
