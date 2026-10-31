<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Commuter/driver-facing: a Jeepney route's association-set operating hours,
// purely for display (no booking window to enforce, unlike
// get_uv_schedule.php's is_bookable). Used by (main)/map.tsx (tapping a
// jeepney driver marker) and (driver)/dashboard.tsx's Dispatch tab. A route
// with no row, or an inactive one, has nothing published yet.

$route_id = (int)($_GET["route_id"] ?? 0);
if (!$route_id) {
    echo json_encode(["success" => false, "message" => "route_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT start_time, end_time, status
    FROM jeepney_operating_hours
    WHERE route_id = ?
");
$stmt->bind_param("i", $route_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row || $row["status"] !== "active") {
    echo json_encode(["success" => true, "hours" => null]);
    exit;
}

echo json_encode([
    "success" => true,
    "hours"   => [
        "start_time" => substr($row["start_time"], 0, 5),
        "end_time"   => substr($row["end_time"], 0, 5),
    ],
]);
