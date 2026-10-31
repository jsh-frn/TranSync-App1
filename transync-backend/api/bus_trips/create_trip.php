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
require_once __DIR__ . "/../../config/policy.php";

// The route/class/boarding-time/departure-time/date are no longer typed in
// fresh per trip — they come entirely from an association-published
// bus_schedules template (see associations/bus_schedules.php) plus a
// server-computed "next occurrence" (see below). The operator just commits
// one of their own vehicles + drivers; capacity always comes from the
// vehicle's own seat layout, never a manual override.
$body = json_decode(file_get_contents("php://input"), true);

$required = ["operator_id", "schedule_id", "vehicle_id", "driver_id"];
foreach ($required as $field) {
    if (empty($body[$field])) {
        echo json_encode(["success" => false, "message" => "Missing required field: $field"]);
        exit;
    }
}

$operator_id = (int)$body["operator_id"];
$schedule_id = (int)$body["schedule_id"];
$vehicle_id  = (int)$body["vehicle_id"];
$driver_id   = (int)$body["driver_id"];
$fare_override = isset($body["fare_override"]) && $body["fare_override"] !== "" ? round((float)$body["fare_override"], 2) : null;
$isPreview   = !empty($body["preview"]);

$stmt = $conn->prepare("
    SELECT route_id, service_type_id, boarding_time, departure_time, recurrence_type, weekdays, association_id, status
    FROM bus_schedules WHERE id = ?
");
$stmt->bind_param("i", $schedule_id);
$stmt->execute();
$schedule = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$schedule || $schedule["status"] !== "active") {
    echo json_encode(["success" => false, "message" => "Schedule not found or inactive."]);
    exit;
}

// ── Operator must have an approved Bus membership at THIS SCHEDULE'S OWN
// association — an operator can hold Bus approved at several associations
// simultaneously now, so this checks membership at the specific association
// the schedule belongs to, never a single independently-derived "the
// operator's Bus association" (which would be ambiguous / pick an arbitrary
// one of several).
$stmt = $conn->prepare("
    SELECT id FROM operator_association_applications
    WHERE operator_id = ? AND vehicle_type = 'Bus' AND association_id = ? AND status = 'approved'
");
$stmt->bind_param("ii", $operator_id, $schedule["association_id"]);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "This schedule doesn't belong to your association."]);
    exit;
}
$stmt->close();

// ── Validate vehicle belongs to this operator, is an active Bus, matches the
// schedule's class AND association, and already has a built seat layout
// (capacity comes from it, never a manual override) ──────────────────────
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
if ((int)($vehicle["association_id"] ?? 0) !== (int)$schedule["association_id"]) {
    echo json_encode(["success" => false, "message" => "Selected vehicle belongs to a different association than this schedule."]);
    exit;
}
if ((int)($vehicle["service_type_id"] ?? 0) !== (int)$schedule["service_type_id"]) {
    echo json_encode(["success" => false, "message" => "Selected vehicle's class doesn't match this schedule's class."]);
    exit;
}
if (empty($vehicle["capacity"])) {
    echo json_encode(["success" => false, "message" => "This vehicle has no seat layout yet — build one before assigning it to a trip."]);
    exit;
}

// ── Validate driver belongs to this operator ──────────────────────────────────
$stmt = $conn->prepare("SELECT id FROM drivers WHERE id = ? AND operator_id = ? AND status = 'active'");
$stmt->bind_param("ii", $driver_id, $operator_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "Driver not found or inactive."]);
    exit;
}
$stmt->close();

// ── Compute the next valid occurrence date ────────────────────────────────
// Never mix PHP's own time()/date() with a MySQL DATETIME string — fetch the
// DB's clock first and run every comparison through strtotime() on
// DB-sourced values so the Europe/Berlin-vs-SYSTEM timezone offset cancels
// out (see CLAUDE.md's PHP/MySQL clock mismatch note).
$stmt = $conn->query("SELECT NOW() AS now_ts");
$now_ts = $stmt->fetch_assoc()["now_ts"];
$minDepartureTs = strtotime($now_ts) + (ADVANCE_BOOKING_HOURS["Bus"] * 3600);

$lookaheadDays = 60;
$stmt = $conn->prepare("
    SELECT DATE(departure_time) AS d FROM trips
    WHERE (vehicle_id = ? OR driver_id = ?)
      AND status IN ('scheduled','boarding','departed')
      AND departure_time >= ?
");
$stmt->bind_param("iis", $vehicle_id, $driver_id, $now_ts);
$stmt->execute();
$conflictDates = array_flip(array_column($stmt->get_result()->fetch_all(MYSQLI_ASSOC), "d"));
$stmt->close();

$weekdaysAllowed = $schedule["recurrence_type"] === "weekly"
    ? array_map("intval", explode(",", (string)$schedule["weekdays"]))
    : null;

$resolvedDate = null;
$startTs = strtotime(date("Y-m-d", strtotime($now_ts)));
for ($i = 0; $i <= $lookaheadDays; $i++) {
    $candidateDate = date("Y-m-d", $startTs + $i * 86400);
    if ($weekdaysAllowed !== null) {
        $weekday = (int)date("w", strtotime($candidateDate)); // 0=Sun..6=Sat
        if (!in_array($weekday, $weekdaysAllowed, true)) continue;
    }
    $candidateDeparture = "{$candidateDate} {$schedule['departure_time']}";
    if (strtotime($candidateDeparture) < $minDepartureTs) continue;
    if (isset($conflictDates[$candidateDate])) continue;
    $resolvedDate = $candidateDate;
    break;
}

if (!$resolvedDate) {
    echo json_encode(["success" => false, "message" => "No available date found in the next $lookaheadDays days for this schedule."]);
    exit;
}

$boarding_time_dt  = "{$resolvedDate} {$schedule["boarding_time"]}";
$departure_time_dt = "{$resolvedDate} {$schedule["departure_time"]}";

if ($isPreview) {
    echo json_encode([
        "success" => true, "preview" => true,
        "date" => $resolvedDate, "departure_time" => $departure_time_dt,
    ]);
    exit;
}

// ── Final race-condition safety net right before insert — the lookahead
// query above and this INSERT aren't in the same transaction, so re-check
// the resolved date specifically before committing to it ───────────────────
$stmt = $conn->prepare("
    SELECT id FROM trips
    WHERE (vehicle_id = ? OR driver_id = ?)
      AND status IN ('scheduled','boarding','departed')
      AND DATE(departure_time) = ?
    LIMIT 1
");
$stmt->bind_param("iis", $vehicle_id, $driver_id, $resolvedDate);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "This vehicle or driver was just committed to another trip on this date — please try again."]);
    exit;
}
$stmt->close();

$capacity = (int)$vehicle["capacity"];

$stmt = $conn->prepare("
    INSERT INTO trips (route_id, schedule_id, boarding_time, operator_id, vehicle_id, driver_id, departure_time, fare_override, capacity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
");
$stmt->bind_param(
    "iisiiisdi",
    $schedule["route_id"], $schedule_id, $boarding_time_dt, $operator_id, $vehicle_id, $driver_id, $departure_time_dt, $fare_override, $capacity
);
$stmt->execute();
$trip_id = $conn->insert_id;
$stmt->close();

echo json_encode(["success" => true, "trip_id" => $trip_id, "date" => $resolvedDate, "departure_time" => $departure_time_dt]);
