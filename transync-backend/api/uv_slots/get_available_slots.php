<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../routes/geo_helpers.php";

$route_id    = isset($_GET['route_id']) && $_GET['route_id'] !== "" ? (int)$_GET['route_id'] : null;
// Optional — scopes results to one operator's own fleet, used by the
// rebooking "Select New Trip" flow. Naturally excludes pooled route-level
// slots (operator_id IS NULL) when active, which is exactly right — a
// pooled slot has no single operator to rebook "within". Every other
// caller omits this and behaves exactly as before.
$operator_id = isset($_GET['operator_id']) && $_GET['operator_id'] !== "" ? (int)$_GET['operator_id'] : null;

// A route-level pooled slot (s.operator_id NULL — Core Flow 8b) must keep
// tracking its schedule's current activation state live: if the association
// deactivates the uv_operating_hours row (h.status != 'active', LEFT JOIN
// misses, h.id is NULL) or every operator has deactivated it
// (no matching uv_schedule_activations row), the slot stops being listed
// here even though the row itself still exists — no duplicate schedule or
// manual cleanup needed, it just stops being visible/bookable the instant
// activation flips off, and comes back the instant it flips back on. A
// legacy operator-owned slot (s.operator_id NOT NULL, predates the
// activation model) is exempt — it was never gated by activation to begin
// with, so deactivating an unrelated pooled schedule must never hide it.
$sql = "
    SELECT
        s.id, s.route_id, s.departure_time, s.capacity, s.seats_booked, s.status,
        r.name AS route_name, r.from_location, r.to_location, r.color, r.fare, r.waypoints,
        h.start_time AS oh_start, h.end_time AS oh_end
    FROM uv_slots s
    JOIN routes r ON r.id = s.route_id
    LEFT JOIN uv_operating_hours h ON h.route_id = r.id AND h.status = 'active'
    WHERE s.status = 'scheduled' AND s.departure_time >= DATE_ADD(NOW(), INTERVAL 24 HOUR)
      AND (s.capacity IS NULL OR s.seats_booked < s.capacity)
      AND (
        s.operator_id IS NOT NULL
        OR EXISTS (
            SELECT 1 FROM uv_schedule_activations a
            WHERE a.uv_operating_hours_id = h.id AND a.status = 'active'
        )
      )
";
$params = [];
$types  = "";
if ($route_id) {
    $sql     .= " AND s.route_id = ?";
    $params[] = $route_id;
    $types   .= "i";
}
if ($operator_id) {
    $sql     .= " AND s.operator_id = ?";
    $params[] = $operator_id;
    $types   .= "i";
}
$sql .= " ORDER BY s.departure_time ASC";

$stmt = $conn->prepare($sql);
if ($types !== "") {
    $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$result = $stmt->get_result();

$slots = [];
while ($row = $result->fetch_assoc()) {
    // NULL capacity (route-level pooled slot — Core Flow 8b) means uncapped.
    $capacity     = $row["capacity"] !== null ? (int)$row["capacity"] : null;
    $seats_booked = (int)$row["seats_booked"];
    // Same rough Haversine+speed estimate as get_upcoming_trips.php — see
    // that file's own note and routes/geo_helpers.php.
    $distanceKm = fullRouteKm($row["waypoints"] ?? null);
    $slots[] = [
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
        "seats_left"     => $capacity !== null ? max(0, $capacity - $seats_booked) : null,
        "status"         => $row["status"],
        "operating_hours" => $row["oh_start"] !== null
            ? ["start_time" => substr($row["oh_start"], 0, 5), "end_time" => substr($row["oh_end"], 0, 5)]
            : null,
        "estimated_duration_minutes" => $distanceKm > 0 ? estMinutes($distanceKm, "UV Express") : null,
    ];
}

echo json_encode(["success" => true, "slots" => $slots]);
