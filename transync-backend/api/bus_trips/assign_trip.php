<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";

// Operator's half of the Bus Trip workflow redesign: the trip row already
// exists (auto-generated from an Active bus_schedules row by
// config/trip_generation.php, status='pending_assignment') — this endpoint
// just assigns a vehicle, its own driver, and an optional conductor to an
// already-generated trip, flipping it to 'scheduled' ("Ready/Open for
// Booking" — the existing status value, unchanged). Distinct from (and
// doesn't replace) bus_trips/create_trip.php, left in place unused for any
// historical/direct caller, per this codebase's deprecate-in-place convention.
// Validation mirrors create_trip.php's own checks almost exactly — the only
// real difference is the date is already fixed (this row's own
// departure_time), so there's no "next occurrence" computation to do.
$body = json_decode(file_get_contents("php://input"), true);

$required = ["operator_id", "trip_id", "vehicle_id", "driver_id"];
foreach ($required as $field) {
    if (empty($body[$field])) {
        echo json_encode(["success" => false, "message" => "Missing required field: $field"]);
        exit;
    }
}

$operator_id     = (int)$body["operator_id"];
$trip_id         = (int)$body["trip_id"];
$vehicle_id      = (int)$body["vehicle_id"];
$driver_id       = (int)$body["driver_id"];
$conductor_name  = isset($body["conductor_name"])  ? trim((string)$body["conductor_name"])  : null;
$conductor_phone = isset($body["conductor_phone"]) ? trim((string)$body["conductor_phone"]) : null;
if ($conductor_name === "")  $conductor_name  = null;
if ($conductor_phone === "") $conductor_phone = null;

$stmt = $conn->prepare("
    SELECT t.id, t.schedule_id, t.departure_time, t.status,
           bs.association_id, bs.service_type_id AS schedule_service_type_id
    FROM trips t
    LEFT JOIN bus_schedules bs ON bs.id = t.schedule_id
    WHERE t.id = ?
");
$stmt->bind_param("i", $trip_id);
$stmt->execute();
$trip = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$trip) {
    echo json_encode(["success" => false, "message" => "Trip not found."]);
    exit;
}
if ($trip["status"] !== "pending_assignment") {
    echo json_encode(["success" => false, "message" => "This trip has already been assigned (or is no longer pending)."]);
    exit;
}
if (!$trip["schedule_id"] || !$trip["association_id"]) {
    echo json_encode(["success" => false, "message" => "This trip has no valid schedule to assign against."]);
    exit;
}

// ── Operator must have an approved Bus membership at this trip's schedule's
// own association — same rule as create_trip.php (Core Flow 8).
$stmt = $conn->prepare("
    SELECT id FROM operator_association_applications
    WHERE operator_id = ? AND vehicle_type = 'Bus' AND association_id = ? AND status = 'approved'
");
$stmt->bind_param("ii", $operator_id, $trip["association_id"]);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "This trip doesn't belong to your association."]);
    exit;
}
$stmt->close();

// ── Vehicle: belongs to this operator, active Bus, matches the schedule's
// class AND association, has a built seat layout ──────────────────────────
$stmt = $conn->prepare("SELECT type, capacity, status, service_type_id, association_id FROM vehicles WHERE id = ? AND operator_id = ?");
$stmt->bind_param("ii", $vehicle_id, $operator_id);
$stmt->execute();
$vehicle = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$vehicle || $vehicle["status"] !== "active") {
    echo json_encode(["success" => false, "message" => "Vehicle not found or inactive."]);
    exit;
}
if ($vehicle["type"] !== "Bus") {
    echo json_encode(["success" => false, "message" => "Selected vehicle is not a Bus."]);
    exit;
}
if ((int)($vehicle["association_id"] ?? 0) !== (int)$trip["association_id"]) {
    echo json_encode(["success" => false, "message" => "Selected vehicle belongs to a different association than this trip's schedule."]);
    exit;
}
if ((int)($vehicle["service_type_id"] ?? 0) !== (int)$trip["schedule_service_type_id"]) {
    echo json_encode(["success" => false, "message" => "Selected vehicle's class doesn't match this schedule's class."]);
    exit;
}
if (empty($vehicle["capacity"])) {
    echo json_encode(["success" => false, "message" => "This vehicle has no seat layout yet — build one before assigning it to a trip."]);
    exit;
}

// ── Driver: belongs to this operator, active ───────────────────────────────
$stmt = $conn->prepare("SELECT id FROM drivers WHERE id = ? AND operator_id = ? AND status = 'active'");
$stmt->bind_param("ii", $driver_id, $operator_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "Driver not found or inactive."]);
    exit;
}
$stmt->close();

// No vehicle/driver scheduling-conflict check here (removed on request —
// see Do Not Break rule #41: the operator has full control over assigning a
// vehicle/driver even with overlapping schedules or back-to-back trips;
// the system never blocks an assignment for this reason).

$capacity = (int)$vehicle["capacity"];

// status='pending_assignment' guard doubles as the race-safety net — if two
// operators try to claim the same trip at once, only the first UPDATE
// matches; the second gets 0 affected_rows and a clear "already assigned"
// error instead of silently overwriting the first assignment.
$stmt = $conn->prepare("
    UPDATE trips
    SET operator_id = ?, vehicle_id = ?, driver_id = ?, conductor_name = ?, conductor_phone = ?,
        capacity = ?, status = 'scheduled'
    WHERE id = ? AND status = 'pending_assignment'
");
$stmt->bind_param("iiissii", $operator_id, $vehicle_id, $driver_id, $conductor_name, $conductor_phone, $capacity, $trip_id);
$stmt->execute();
$assigned = $stmt->affected_rows > 0;
$stmt->close();

if (!$assigned) {
    echo json_encode(["success" => false, "message" => "This trip was just assigned by someone else — please pick another."]);
    exit;
}

echo json_encode(["success" => true, "trip_id" => $trip_id, "status" => "scheduled"]);
