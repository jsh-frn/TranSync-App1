<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../routes/geo_helpers.php";

$route_id    = isset($_GET['route_id']) && $_GET['route_id'] !== "" ? (int)$_GET['route_id'] : null;
$date        = trim($_GET['date'] ?? ""); // "YYYY-MM-DD" — a specific travel date
// Optional — scopes results to one operator's own fleet. Used by the
// rebooking "Select New Trip" flow (same-operator-only, never a
// cross-operator marketplace) — every other caller omits this and behaves
// exactly as before.
$operator_id = isset($_GET['operator_id']) && $_GET['operator_id'] !== "" ? (int)$_GET['operator_id'] : null;

// Fare precedence mirrors create_reservation.php's Bus branch exactly —
// a class-specific fare_matrix row (association-set) always wins when one
// exists, falling back to the trip's own fare_override, then the route's
// flat legacy fare. Without this LEFT JOIN, this listing (and everything
// downstream that reuses the same trip object — Trip Details, the
// passenger form) showed a fare that could differ from what
// create_reservation.php actually charges, since that endpoint alone did
// the extra fare_matrix lookup after fetching the trip.
$sql = "
    SELECT
        t.id, t.route_id, t.departure_time, t.capacity, t.seats_booked, t.status,
        r.name AS route_name, r.from_location, r.to_location, r.color, r.waypoints,
        COALESCE(fm.base_fare, t.fare_override, r.fare) AS fare,
        v.plate_number AS vehicle_plate,
        d.name AS driver_name,
        st.id AS service_type_id, st.name AS service_type_name, st.description AS service_type_description,
        ocd.details AS class_details
    FROM trips t
    JOIN routes   r ON r.id = t.route_id
    JOIN vehicles v ON v.id = t.vehicle_id
    JOIN drivers  d ON d.id = t.driver_id
    LEFT JOIN bus_schedules st_bs ON st_bs.id = t.schedule_id
    LEFT JOIN bus_service_types st ON st.id = v.service_type_id
    LEFT JOIN operator_class_details ocd ON ocd.service_type_id = st.id AND ocd.operator_id = t.operator_id
    LEFT JOIN fare_matrix fm ON fm.route_id = t.route_id AND fm.service_type_id = v.service_type_id
    WHERE t.status = 'scheduled' AND t.departure_time >= DATE_ADD(NOW(), INTERVAL 24 HOUR)
      AND t.vehicle_id IS NOT NULL AND t.driver_id IS NOT NULL
      AND (t.schedule_id IS NULL OR st_bs.status = 'active')
";

$params = [];
$types  = "";

if ($route_id) {
    $sql     .= " AND t.route_id = ?";
    $params[] = $route_id;
    $types   .= "i";
}
if ($date !== "" && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    $sql     .= " AND DATE(t.departure_time) = ?";
    $params[] = $date;
    $types   .= "s";
}
if ($operator_id) {
    $sql     .= " AND v.operator_id = ?";
    $params[] = $operator_id;
    $types   .= "i";
}

$sql .= " ORDER BY t.departure_time ASC";

$stmt = $conn->prepare($sql);
if ($types !== "") {
    $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$result = $stmt->get_result();

$trips = [];
while ($row = $result->fetch_assoc()) {
    $capacity     = (int)$row["capacity"];
    $seats_booked = (int)$row["seats_booked"];
    // Rough estimate only (Haversine along the route's own waypoints ÷ a
    // flat per-vehicle-type speed, same method+constants as
    // routes/route_planner.php, Core Flow 6) — not a live traffic/ETA
    // service, which this app has no access to. A route with no/invalid
    // waypoints yields 0 km, surfaced as null so the client can tell
    // "unknown" apart from "an actual zero-distance trip".
    $distanceKm = fullRouteKm($row["waypoints"] ?? null);
    $trips[] = [
        "id"             => (int)$row["id"],
        "route_id"       => (int)$row["route_id"],
        "route_name"     => $row["route_name"] ?: null,
        "from_location"  => $row["from_location"],
        "to_location"    => $row["to_location"],
        "color"          => $row["color"] ?: "#1a4a52",
        "fare"           => $row["fare"] !== null ? (float)$row["fare"] : 0,
        "departure_time" => $row["departure_time"],
        "capacity"       => $capacity,
        "seats_booked"   => $seats_booked,
        "seats_left"     => max(0, $capacity - $seats_booked),
        "vehicle_plate"  => $row["vehicle_plate"],
        "driver_name"    => $row["driver_name"],
        "status"         => $row["status"],
        "service_type_id"          => $row["service_type_id"] !== null ? (int)$row["service_type_id"] : null,
        "service_type_name"        => $row["service_type_name"],
        "service_type_description" => $row["service_type_description"],
        "class_details"            => $row["class_details"],
        "estimated_duration_minutes" => $distanceKm > 0 ? estMinutes($distanceKm, "Bus") : null,
    ];
}

echo json_encode(["success" => true, "trips" => $trips]);
