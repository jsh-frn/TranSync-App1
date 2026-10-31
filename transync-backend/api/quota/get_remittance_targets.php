<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

// Vehicle Type -> Route -> Driver -> Remittance Target — the peso-based
// driver_quotas/quota_submissions settlement target (see set_quota.php,
// submit_quota.php, review_submission.php), just browsed through the same
// Vehicle Type -> Route hierarchy the separate booking-capacity feature
// (driver_route_quotas, get_route_quotas.php) already uses. This is NOT a
// booking cap of any kind — a driver's ability to accept bookings is never
// affected by this data.
//
// Two modes:
//   route_id given   -> drivers currently assigned (via their vehicle) to
//                        that route, same resolution as get_route_quotas.php.
//   route_id omitted -> "Unassigned Drivers" bucket: drivers of the given
//                        vehicle_type whose vehicle has no route assignment
//                        yet, so they still have a place to get a target set
//                        (mirrors the old flat Remittance -> Targets list,
//                        which showed every driver regardless of route).

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

$operator_id    = (int)($_GET['operator_id'] ?? 0);
$route_id       = (isset($_GET['route_id']) && $_GET['route_id'] !== '') ? (int)$_GET['route_id'] : 0;
$vehicle_type   = $_GET['vehicle_type'] ?? '';
$association_id = (isset($_GET['association_id']) && $_GET['association_id'] !== '') ? (int)$_GET['association_id'] : null;

if (!$operator_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

$route_name = null;

if ($route_id) {
    $stmt = $conn->prepare("SELECT name, vehicle_type FROM routes WHERE id = ?");
    $stmt->bind_param("i", $route_id);
    $stmt->execute();
    $route = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$route) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "Route not found."]);
        exit;
    }
    $vehicle_type = $route["vehicle_type"];
    $route_name   = $route["name"];

    $stmt = $conn->prepare("
        SELECT d.id, d.name, v.id AS vehicle_id, v.plate_number
        FROM route_assignments ra
        JOIN vehicles v ON v.id = ra.vehicle_id
        JOIN drivers d  ON d.vehicle_id = v.id
        WHERE ra.route_id = ? AND v.operator_id = ?
        ORDER BY d.name ASC
    ");
    $stmt->bind_param("ii", $route_id, $operator_id);
} else {
    if ($vehicle_type === '') {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "vehicle_type is required when route_id is omitted."]);
        exit;
    }
    $route_name = "Unassigned Drivers";

    $sql = "
        SELECT d.id, d.name, v.id AS vehicle_id, v.plate_number
        FROM drivers d
        JOIN vehicles v ON v.id = d.vehicle_id
        LEFT JOIN route_assignments ra ON ra.vehicle_id = v.id
        WHERE d.operator_id = ? AND v.type = ? AND ra.id IS NULL
    ";
    $types  = "is";
    $params = [$operator_id, $vehicle_type];
    if ($association_id) {
        $sql     .= " AND v.association_id = ?";
        $types   .= "i";
        $params[] = $association_id;
    }
    $sql .= " ORDER BY d.name ASC";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param($types, ...$params);
}

$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

$drivers = [];
foreach ($rows as $row) {
    $driver_id = (int)$row["id"];

    $qStmt = $conn->prepare("SELECT id, amount, frequency FROM driver_quotas WHERE driver_id = ?");
    $qStmt->bind_param("i", $driver_id);
    $qStmt->execute();
    $quota = $qStmt->get_result()->fetch_assoc();
    $qStmt->close();

    $quota_id         = null;
    $quota_amount     = null;
    $quota_frequency  = null;
    $period_label     = null;
    $period_total     = null;
    $period_remaining = null;
    $period_met       = null;

    if ($quota) {
        $quota_id        = (int)$quota["id"];
        $quota_amount    = (float)$quota["amount"];
        $quota_frequency = $quota["frequency"];

        // Current period boundaries computed by MySQL's own clock (daily =
        // today, weekly = Mon-Sun containing today) — same logic as
        // get_driver_quota.php, kept in sync deliberately (see that file's
        // own comment on why this must go through the DB clock, not PHP's).
        if ($quota_frequency === 'weekly') {
            $period_label = 'This week';
            $sumStmt = $conn->prepare("
                SELECT COALESCE(SUM(amount), 0) AS total
                FROM quota_submissions
                WHERE driver_id = ? AND status IN ('pending', 'confirmed')
                  AND submitted_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(NOW()) DAY)
                  AND submitted_at <  DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(NOW()) DAY), INTERVAL 7 DAY)
            ");
        } else {
            $period_label = 'Today';
            $sumStmt = $conn->prepare("
                SELECT COALESCE(SUM(amount), 0) AS total
                FROM quota_submissions
                WHERE driver_id = ? AND status IN ('pending', 'confirmed')
                  AND submitted_at >= CURDATE() AND submitted_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
            ");
        }
        $sumStmt->bind_param("i", $driver_id);
        $sumStmt->execute();
        $period_total = (float)$sumStmt->get_result()->fetch_assoc()['total'];
        $sumStmt->close();

        $period_remaining = max($quota_amount - $period_total, 0);
        $period_met       = $period_total >= $quota_amount;
    }

    $drivers[] = [
        "driver_id"         => $driver_id,
        "driver_name"       => $row["name"],
        "vehicle_id"        => $row["vehicle_id"] !== null ? (int)$row["vehicle_id"] : null,
        "plate_number"      => $row["plate_number"],
        "quota_id"          => $quota_id,
        "quota_amount"      => $quota_amount,
        "quota_frequency"   => $quota_frequency,
        "period_label"      => $period_label,
        "period_total"      => $period_total,
        "period_remaining"  => $period_remaining,
        "period_met"        => $period_met,
    ];
}

echo json_encode([
    "success"      => true,
    "vehicle_type" => $vehicle_type,
    "route_name"   => $route_name,
    "drivers"      => $drivers,
]);
