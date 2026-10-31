<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/trip_generation.php";

$operator_id = (int)($_GET['operator_id'] ?? 0);
if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

// Opportunistic sweep + top-up (no cron in this app — see
// config/trip_generation.php's own header comment): every operator's Bus
// Trips page load is a chance to expire stale pending trips and backfill any
// schedule's rolling window that's fallen short. System-wide, not just this
// operator's own schedules — the pending pool is shared until someone claims
// a trip (see bus_trips/get_pending_trips.php for the date-scoped view of it).
expirePastPendingTrips($conn);
generateTripsForAllActiveSchedules($conn);

// Only this operator's OWN already-assigned trips — unclaimed
// pending_assignment trips have their own dedicated, date-scoped endpoint
// now (get_pending_trips.php) rather than being loaded here in bulk (a
// schedule's rolling 30-day window across every schedule could mean 60-90+
// rows, which used to load in full on every single page visit).
$stmt = $conn->prepare("
    SELECT
        t.id, t.route_id, t.schedule_id, t.departure_time, t.boarding_time,
        t.capacity, t.seats_booked, t.status, t.conductor_name, t.conductor_phone,
        bs.association_id,
        r.name AS route_name, r.from_location, r.to_location, r.color,
        COALESCE(t.fare_override, r.fare) AS fare,
        v.plate_number AS vehicle_plate,
        d.name AS driver_name,
        COALESCE(v.service_type_id, bs.service_type_id) AS service_type_id,
        st.name AS service_type_name
    FROM trips t
    JOIN routes   r ON r.id = t.route_id
    LEFT JOIN vehicles v ON v.id = t.vehicle_id
    LEFT JOIN drivers  d ON d.id = t.driver_id
    LEFT JOIN bus_schedules bs ON bs.id = t.schedule_id
    LEFT JOIN bus_service_types st ON st.id = COALESCE(v.service_type_id, bs.service_type_id)
    WHERE t.operator_id = ? AND t.status != 'pending_assignment'
    ORDER BY FIELD(t.status, 'scheduled', 'boarding', 'departed', 'completed', 'cancelled'), t.departure_time ASC
");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$result = $stmt->get_result();

$trips = [];
while ($row = $result->fetch_assoc()) {
    $capacity     = $row["capacity"] !== null ? (int)$row["capacity"] : null;
    $seats_booked = (int)$row["seats_booked"];
    $trips[] = [
        "id"             => (int)$row["id"],
        "route_id"       => (int)$row["route_id"],
        "schedule_id"    => $row["schedule_id"] !== null ? (int)$row["schedule_id"] : null,
        "association_id" => $row["association_id"] !== null ? (int)$row["association_id"] : null,
        "route_name"     => $row["route_name"] ?: null,
        "from_location"  => $row["from_location"],
        "to_location"    => $row["to_location"],
        "color"          => $row["color"] ?: "#1a4a52",
        "fare"           => $row["fare"] !== null ? (float)$row["fare"] : 0,
        "departure_time" => $row["departure_time"],
        "boarding_time"  => $row["boarding_time"],
        "capacity"       => $capacity,
        "seats_booked"   => $seats_booked,
        "seats_left"     => $capacity !== null ? max(0, $capacity - $seats_booked) : null,
        "vehicle_plate"  => $row["vehicle_plate"],
        "driver_name"    => $row["driver_name"],
        "conductor_name"  => $row["conductor_name"],
        "conductor_phone" => $row["conductor_phone"],
        "service_type_id"   => $row["service_type_id"] !== null ? (int)$row["service_type_id"] : null,
        "service_type_name" => $row["service_type_name"],
        "status"         => $row["status"],
    ];
}

echo json_encode(["success" => true, "trips" => $trips]);
