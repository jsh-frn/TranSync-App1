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

$lat   = floatval($_GET['lat']   ?? 0);
$lng   = floatval($_GET['lng']   ?? 0);
$limit = intval($_GET['limit']   ?? 5);

if (!$lat || !$lng) {
    http_response_code(400);
    echo json_encode(["message" => "lat and lng are required."]);
    exit;
}

// Haversine formula inside SQL to get nearest drivers
// Only returns Jeepney drivers who are online — keyed off the driver's own
// assigned vehicle type, not the operator's (now-legacy, no-longer-fixed)
// operator_type, since one operator can run multiple vehicle types.
//
// location_updated_at staleness filter (2 minutes) added so a driver whose
// app was killed/lost network — and therefore never got a chance to send
// the graceful is_online=0 cleanup ping — doesn't linger on every commuter's
// map forever at a frozen last-known position. Mirrors the same
// "NOW() - INTERVAL 2 MINUTE" pattern nearby_drivers_by_destination.php
// already uses.
//
// dispatch_status is the driver's own most recent dispatch_queue row
// (waiting/dispatched/completed/cancelled) — lets the client show whether
// this vehicle is actually en route vs. just idle-online, without exposing
// any additional driver/passenger personal information.
$stmt = $conn->prepare("
    SELECT
        d.id,
        d.name,
        d.latitude,
        d.longitude,
        d.heading,
        d.is_full,
        d.is_online,
        d.location_updated_at,
        o.name AS operator_name,
        v.type AS operator_type,
        v.plate_number,
        v.vehicle_number,
        v.bus_number,
        v.capacity,
        r.id   AS route_id,
        r.name AS route_name,
        (
            SELECT dq.status
            FROM dispatch_queue dq
            WHERE dq.driver_id = d.id
            ORDER BY dq.id DESC
            LIMIT 1
        ) AS dispatch_status,
        (
            6371 * ACOS(
                LEAST(1.0, COS(RADIANS(?)) * COS(RADIANS(d.latitude))
                * COS(RADIANS(d.longitude) - RADIANS(?))
                + SIN(RADIANS(?)) * SIN(RADIANS(d.latitude)))
            )
        ) AS distance_km
    FROM drivers d
    JOIN operators o ON d.operator_id = o.id
    JOIN vehicles  v ON v.id = d.vehicle_id
    LEFT JOIN route_assignments ra ON ra.vehicle_id = d.vehicle_id
    LEFT JOIN routes r ON r.id = ra.route_id
    WHERE
        d.is_online   = 1
        AND d.latitude  IS NOT NULL
        AND d.longitude IS NOT NULL
        AND v.type = 'Jeepney'
        AND d.location_updated_at >= NOW() - INTERVAL 2 MINUTE
    HAVING distance_km <= 5
    ORDER BY distance_km ASC
    LIMIT ?
");

$stmt->bind_param("dddi", $lat, $lng, $lat, $limit);
$stmt->execute();
$result  = $stmt->get_result();
$drivers = [];

while ($row = $result->fetch_assoc()) {
    $drivers[] = [
        "id"                  => (int)$row["id"],
        "name"                => $row["name"],
        "operator_name"       => $row["operator_name"],
        "operator_type"       => $row["operator_type"],
        "plate_number"        => $row["plate_number"],
        "vehicle_number"      => $row["vehicle_number"] ?? $row["bus_number"],
        "capacity"            => $row["capacity"] !== null ? (int)$row["capacity"] : null,
        "dispatch_status"     => $row["dispatch_status"],
        "route_id"            => $row["route_id"] !== null ? (int)$row["route_id"] : null,
        "route_name"          => $row["route_name"],
        "latitude"            => (float)$row["latitude"],
        "longitude"           => (float)$row["longitude"],
        "heading"             => (float)$row["heading"],
        "is_full"             => (int)$row["is_full"],
        "is_online"           => (int)$row["is_online"],
        "distance_km"         => round((float)$row["distance_km"], 3),
        "location_updated_at" => $row["location_updated_at"],
    ];
}

echo json_encode($drivers);