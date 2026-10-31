<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$vehicle_id = (int)($_GET["vehicle_id"] ?? 0);
if (!$vehicle_id) {
    echo json_encode(["success" => false, "message" => "vehicle_id is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT type, capacity FROM vehicles WHERE id = ?");
$stmt->bind_param("i", $vehicle_id);
$stmt->execute();
$vehicle = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$vehicle) {
    echo json_encode(["success" => false, "message" => "Vehicle not found."]);
    exit;
}

// A seat "has an active booking" if any reservation across ANY of this
// vehicle's trips (the layout is a property of the vehicle itself, not any
// one trip) still claims that label with boarding_status reserved/boarded —
// the builder uses this to lock a seat against deletion/rename.
$stmt = $conn->prepare("
    SELECT s.seat_label, s.seat_row, s.seat_col, s.seat_type, s.is_blocked,
           EXISTS(
               SELECT 1 FROM reservations r
               JOIN trips t ON t.id = r.trip_id
               WHERE t.vehicle_id = s.vehicle_id
                 AND r.seat_labels = s.seat_label
                 AND r.boarding_status IN ('reserved','boarded')
           ) AS has_active_booking
    FROM seats s
    WHERE s.vehicle_id = ?
    ORDER BY s.seat_row, s.seat_col
");
$stmt->bind_param("i", $vehicle_id);
$stmt->execute();
$result = $stmt->get_result();
$seats = [];
while ($row = $result->fetch_assoc()) {
    $seats[] = [
        "seat_label"         => $row["seat_label"],
        "seat_row"           => (int)$row["seat_row"],
        "seat_col"           => (int)$row["seat_col"],
        "seat_type"          => $row["seat_type"],
        "is_blocked"         => (bool)$row["is_blocked"],
        "has_active_booking" => (bool)$row["has_active_booking"],
    ];
}

echo json_encode([
    "success"      => true,
    "vehicle_type" => $vehicle["type"],
    "capacity"     => $vehicle["capacity"] ? (int)$vehicle["capacity"] : null,
    "seats"        => $seats,
]);
