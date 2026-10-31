<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$route_id = isset($_GET['route_id']) && $_GET['route_id'] !== "" ? (int)$_GET['route_id'] : null;

$sql = "
    SELECT
        s.id, s.driver_id, s.route_id, s.capacity, s.seats_booked, s.status, s.started_at,
        d.name AS driver_name,
        r.name AS route_name, r.from_location, r.to_location, r.color, r.fare,
        v.plate_number AS vehicle_plate
    FROM uv_sessions s
    JOIN drivers  d ON d.id = s.driver_id
    JOIN routes   r ON r.id = s.route_id
    JOIN vehicles v ON v.id = s.vehicle_id
    WHERE s.status IN ('open', 'full')
";
$params = [];
$types  = "";
if ($route_id) {
    $sql     .= " AND s.route_id = ?";
    $params[] = $route_id;
    $types   .= "i";
}
$sql .= " ORDER BY s.started_at ASC";

$stmt = $conn->prepare($sql);
if ($types !== "") {
    $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$result = $stmt->get_result();

// ── Estimated departure: rough heuristic, not a real schedule ────────────────
// Fewer empty seats left = sooner departure. Nearly-full vehicles are "about
// to leave"; a freshly-online vehicle with many empty seats has a longer wait.
// Based on the DB's own clock (not PHP's) so it can't drift from timestamps
// like `started_at` that MySQL already stamped with NOW().
$db_now = $conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"];

function estimateDeparture(string $dbNow, int $seatsLeft, string $status): string {
    $minutes = $status === 'full' ? 2 : max(5, min(30, $seatsLeft * 3));
    return (new DateTime($dbNow))->modify("+{$minutes} minutes")->format("Y-m-d H:i:s");
}

$sessions = [];
while ($row = $result->fetch_assoc()) {
    $capacity     = (int)$row["capacity"];
    $seats_booked = (int)$row["seats_booked"];
    $seats_left   = max(0, $capacity - $seats_booked);
    $sessions[] = [
        "id"                  => (int)$row["id"],
        "driver_id"           => (int)$row["driver_id"],
        "driver_name"         => $row["driver_name"],
        "route_id"            => (int)$row["route_id"],
        "route_name"          => $row["route_name"] ?: null,
        "from_location"       => $row["from_location"],
        "to_location"         => $row["to_location"],
        "color"               => $row["color"] ?: "#1a4a52",
        "fare"                => $row["fare"] !== null ? (float)$row["fare"] : 0,
        "vehicle_plate"       => $row["vehicle_plate"],
        "capacity"            => $capacity,
        "seats_booked"        => $seats_booked,
        "seats_left"          => $seats_left,
        "status"              => $row["status"],
        "started_at"          => $row["started_at"],
        "estimated_departure" => estimateDeparture($db_now, $seats_left, $row["status"]),
    ];
}

echo json_encode(["success" => true, "sessions" => $sessions]);
