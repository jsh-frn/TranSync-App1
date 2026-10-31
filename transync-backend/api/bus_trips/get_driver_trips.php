<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$driver_id = (int)($_GET['driver_id'] ?? 0);
if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "driver_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT
        t.id, t.route_id, t.departure_time, t.boarding_time, t.capacity, t.seats_booked, t.status,
        r.name AS route_name, r.from_location, r.to_location, r.color,
        COALESCE(t.fare_override, r.fare) AS fare,
        v.plate_number AS vehicle_plate
    FROM trips t
    JOIN routes   r ON r.id = t.route_id
    JOIN vehicles v ON v.id = t.vehicle_id
    WHERE t.driver_id = ? AND t.status IN ('scheduled', 'boarding', 'departed')
    ORDER BY t.departure_time ASC
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$result = $stmt->get_result();

$trips = [];
while ($row = $result->fetch_assoc()) {
    $capacity     = (int)$row["capacity"];
    $seats_booked = (int)$row["seats_booked"];
    $trips[] = [
        "id"             => (int)$row["id"],
        "route_id"       => (int)$row["route_id"],
        "route_name"     => $row["route_name"] ?: null,
        "from_location"  => $row["from_location"],
        "to_location"    => $row["to_location"],
        "color"          => $row["color"] ?: "#1a4a52",
        "fare"           => $row["fare"] !== null ? (float)$row["fare"] : 0,
        "departure_time" => $row["departure_time"],
        "boarding_time"  => $row["boarding_time"],
        "capacity"       => $capacity,
        "seats_booked"   => $seats_booked,
        "seats_left"     => max(0, $capacity - $seats_booked),
        "vehicle_plate"  => $row["vehicle_plate"],
        "status"         => $row["status"],
    ];
}

echo json_encode(["success" => true, "trips" => $trips]);
