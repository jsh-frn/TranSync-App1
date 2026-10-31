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

// Lets an operator swap the vehicle/driver/conductor already assigned to a
// trip that's already 'scheduled' (e.g. a vehicle breaks down, a driver
// calls in sick) without creating a duplicate pending assignment. Scoped to
// 'scheduled' only — once boarding has started the assigned vehicle is
// already the one passengers are lining up for, so reassignment stops being
// meaningful past that point (same spirit as the strict per-status action
// gating on the Trips tab, see (operator)/trips.tsx's TripCard). The trip's
// own departure_time is never touched here — that stays owned by the
// System/schedule (Do Not Break rule #58).
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
    SELECT t.id, t.schedule_id, t.departure_time, t.status, t.vehicle_id AS current_vehicle_id,
           bs.association_id, bs.service_type_id AS schedule_service_type_id
    FROM trips t
    LEFT JOIN bus_schedules bs ON bs.id = t.schedule_id
    WHERE t.id = ? AND t.operator_id = ?
");
$stmt->bind_param("ii", $trip_id, $operator_id);
$stmt->execute();
$trip = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$trip) {
    echo json_encode(["success" => false, "message" => "Trip not found."]);
    exit;
}
if ($trip["status"] !== "scheduled") {
    echo json_encode(["success" => false, "message" => "Only a Ready/Open trip can be reassigned — this one is {$trip["status"]}."]);
    exit;
}

// ── Vehicle: belongs to this operator, active Bus, matches the schedule's
// class AND association, has a built seat layout — same rules as assign_trip.php
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
if ($trip["association_id"] !== null && (int)($vehicle["association_id"] ?? 0) !== (int)$trip["association_id"]) {
    echo json_encode(["success" => false, "message" => "Selected vehicle belongs to a different association than this trip's schedule."]);
    exit;
}
if ($trip["schedule_service_type_id"] !== null && (int)($vehicle["service_type_id"] ?? 0) !== (int)$trip["schedule_service_type_id"]) {
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

// ── A vehicle swap on a trip that already has real bookings would orphan
// those commuters' seat_labels against a different vehicle's seat map (Do
// Not Break rule #40's spirit) — block only the vehicle change in that case;
// the driver/conductor can still be swapped freely since neither has any
// seat-map dependency. ──────────────────────────────────────────────────────
$vehicleChanging = $vehicle_id !== (int)$trip["current_vehicle_id"];
if ($vehicleChanging) {
    $stmt = $conn->prepare("SELECT COUNT(*) AS cnt FROM reservations WHERE trip_id = ? AND boarding_status IN ('reserved','boarded')");
    $stmt->bind_param("i", $trip_id);
    $stmt->execute();
    $bookingCount = (int)$stmt->get_result()->fetch_assoc()["cnt"];
    $stmt->close();
    if ($bookingCount > 0) {
        echo json_encode([
            "success" => false,
            "message" => "This trip already has {$bookingCount} booking(s) — the vehicle can't be changed since seat assignments would become invalid. Reassign the driver only, or resolve the affected bookings first.",
        ]);
        exit;
    }
}

// No vehicle/driver scheduling-conflict check here (removed on request —
// see Do Not Break rule #41: the operator has full control over reassigning
// a vehicle/driver even with overlapping schedules or back-to-back trips).
// The booking-integrity check above (blocking a vehicle swap once real
// seats are booked) is unrelated and stays — it protects existing
// commuters' data, not scheduling.

$capacity = (int)$vehicle["capacity"];

// Re-check status fresh (not affected_rows — an UPDATE that resubmits
// identical values legitimately reports 0 affected_rows in mysqli, which
// would otherwise look indistinguishable from "trip moved on" here).
$stmt = $conn->prepare("
    UPDATE trips
    SET vehicle_id = ?, driver_id = ?, conductor_name = ?, conductor_phone = ?, capacity = ?
    WHERE id = ? AND operator_id = ? AND status = 'scheduled'
");
$stmt->bind_param("iissiii", $vehicle_id, $driver_id, $conductor_name, $conductor_phone, $capacity, $trip_id, $operator_id);
$stmt->execute();
$queryFailed = $stmt->error !== "";
$stmt->close();

if ($queryFailed) {
    echo json_encode(["success" => false, "message" => "Could not reassign this trip."]);
    exit;
}

$check = $conn->prepare("SELECT status FROM trips WHERE id = ?");
$check->bind_param("i", $trip_id);
$check->execute();
$after = $check->get_result()->fetch_assoc();
$check->close();
if (!$after || $after["status"] !== "scheduled") {
    echo json_encode(["success" => false, "message" => "This trip changed status while reassigning — please refresh and try again."]);
    exit;
}

echo json_encode(["success" => true, "trip_id" => $trip_id, "status" => "scheduled"]);
