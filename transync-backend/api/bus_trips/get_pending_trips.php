<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/trip_generation.php";

// Date-scoped Pending Assignment view — the "Pending Assignment" status
// filter in (operator)/trips.tsx no longer pulls from get_operator_trips.php
// (which could mean loading 60-90+ generated rows at once across a 30-day
// window and every schedule); it calls this instead, one calendar date at a
// time, so the screen never has to render more than a single day's worth of
// still-unassigned trips.

$operator_id = (int)($_GET['operator_id'] ?? 0);
if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

$date = trim($_GET['date'] ?? "");
if ($date === "" || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    $date = date("Y-m-d"); // default to today; exact-day granularity only, no clock math needed
}

// Same opportunistic sweep + top-up as every other Bus trip read endpoint
// (no cron in this app) — expiring stale pending trips here too means a
// commuter/operator hitting this exact date right at midnight still sees a
// clean list, not yesterday's leftovers for a split second.
expirePastPendingTrips($conn);
generateTripsForAllActiveSchedules($conn);

// Same operator-pooling rule as get_operator_trips.php used to apply inline:
// any operator with an approved Bus membership at the trip's own schedule's
// association can see (and assign) an unclaimed trip, not just whoever
// happens to already own it — nothing is ever operator-owned before assignment.
$stmt = $conn->prepare("
    SELECT
        t.id, t.route_id, t.schedule_id, t.departure_time, t.boarding_time,
        bs.association_id,
        r.name AS route_name, r.from_location, r.to_location, r.color,
        COALESCE(t.fare_override, r.fare) AS fare,
        bs.service_type_id,
        st.name AS service_type_name
    FROM trips t
    JOIN routes   r  ON r.id = t.route_id
    JOIN bus_schedules bs ON bs.id = t.schedule_id
    LEFT JOIN bus_service_types st ON st.id = bs.service_type_id
    WHERE t.status = 'pending_assignment'
      AND DATE(t.departure_time) = ?
      AND EXISTS (
          SELECT 1 FROM operator_association_applications oaa
          WHERE oaa.operator_id = ? AND oaa.vehicle_type = 'Bus'
            AND oaa.association_id = bs.association_id AND oaa.status = 'approved'
      )
    ORDER BY t.departure_time ASC
");
$stmt->bind_param("si", $date, $operator_id);
$stmt->execute();
$result = $stmt->get_result();

$trips = [];
while ($row = $result->fetch_assoc()) {
    $trips[] = [
        "id"                => (int)$row["id"],
        "route_id"          => (int)$row["route_id"],
        "schedule_id"       => (int)$row["schedule_id"],
        "association_id"    => $row["association_id"] !== null ? (int)$row["association_id"] : null,
        "route_name"        => $row["route_name"] ?: null,
        "from_location"     => $row["from_location"],
        "to_location"       => $row["to_location"],
        "color"             => $row["color"] ?: "#1a4a52",
        "fare"              => $row["fare"] !== null ? (float)$row["fare"] : 0,
        "departure_time"    => $row["departure_time"],
        "boarding_time"     => $row["boarding_time"],
        "capacity"          => null,
        "seats_booked"      => 0,
        "seats_left"        => null,
        "vehicle_plate"     => null,
        "driver_name"       => null,
        "conductor_name"    => null,
        "conductor_phone"   => null,
        "service_type_id"   => $row["service_type_id"] !== null ? (int)$row["service_type_id"] : null,
        "service_type_name" => $row["service_type_name"],
        "status"            => "pending_assignment",
    ];
}

echo json_encode(["success" => true, "date" => $date, "trips" => $trips]);
