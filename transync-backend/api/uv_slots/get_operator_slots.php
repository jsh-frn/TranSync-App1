<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$operator_id = (int)($_GET['operator_id'] ?? 0);
if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

// Legacy operator-created slots keep their exact operator_id match. New
// route-level pooled slots (operator_id NULL — see Core Flow 8b) show up for
// every operator currently active on that route's schedule, since none of
// them "own" the slot individually anymore.
$stmt = $conn->prepare("
    SELECT
        s.id, s.route_id, s.departure_time, s.capacity, s.seats_booked, s.status,
        r.name AS route_name, r.from_location, r.to_location, r.color, r.fare
    FROM uv_slots s
    JOIN routes r ON r.id = s.route_id
    WHERE s.operator_id = ? OR EXISTS (
        SELECT 1 FROM uv_schedule_activations a
        JOIN uv_operating_hours h ON h.id = a.uv_operating_hours_id
        WHERE h.route_id = s.route_id AND a.operator_id = ? AND a.status = 'active'
    )
    ORDER BY FIELD(s.status, 'scheduled', 'boarding', 'departed', 'completed', 'cancelled'), s.departure_time ASC
");
$stmt->bind_param("ii", $operator_id, $operator_id);
$stmt->execute();
$result = $stmt->get_result();

$slots = [];
while ($row = $result->fetch_assoc()) {
    // NULL capacity (route-level pooled slot — Core Flow 8b) means uncapped;
    // keep it as null rather than coercing to 0, so the client can tell
    // "unlimited" apart from a real (legacy operator-created) zero-seat slot.
    $capacity     = $row["capacity"] !== null ? (int)$row["capacity"] : null;
    $seats_booked = (int)$row["seats_booked"];
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
    ];
}

echo json_encode(["success" => true, "slots" => $slots]);
