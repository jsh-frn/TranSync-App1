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

// Commuter-triggered: resolves (finding or creating) the pooled uv_slots row
// for a route + chosen departure time, replacing the old operator-manual
// "Schedule UV Slot" flow (see Core Flow 8b's UV scheduling rewrite). The
// slot this creates is route-level, not owned by one operator (operator_id
// NULL) and uncapped (capacity NULL) — any operator active on the route can
// have a driver board it, whichever one is actually dispatched when the
// commuter's chosen time arrives.

$body           = json_decode(file_get_contents("php://input"), true);
$route_id       = (int)($body["route_id"] ?? 0);
$departure_time = trim($body["departure_time"] ?? "");

if (!$route_id || $departure_time === "") {
    echo json_encode(["success" => false, "message" => "route_id and departure_time are required."]);
    exit;
}

$departure_ts = strtotime($departure_time);
if ($departure_ts === false) {
    echo json_encode(["success" => false, "message" => "Invalid departure_time."]);
    exit;
}

// DB clock, not PHP's — see board_reservation.php for why mixing time()/date()
// with strtotime() on a DB-sourced datetime string is unsafe on this server.
$db_now    = $conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"];
$db_now_ts = strtotime($db_now);

$min_lead_hours = ADVANCE_BOOKING_HOURS["UV Express"];
if ($departure_ts - $db_now_ts < $min_lead_hours * 3600) {
    echo json_encode(["success" => false, "message" => "UV Express bookings must be made at least {$min_lead_hours} hours before departure."]);
    exit;
}

$stmt = $conn->prepare("SELECT vehicle_type, status FROM routes WHERE id = ?");
$stmt->bind_param("i", $route_id);
$stmt->execute();
$route = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$route || $route["status"] !== "active" || $route["vehicle_type"] !== "UV Express") {
    echo json_encode(["success" => false, "message" => "Route not found, inactive, or not UV Express."]);
    exit;
}

// ── The association's schedule is the sole source of valid book-ahead times
// now — no schedule (or an inactive one) means this route has no book-ahead
// option at all (live "go online" walk-up is unaffected/separate). ─────────
$stmt = $conn->prepare("
    SELECT id, start_time, end_time, recurrence_type, weekdays
    FROM uv_operating_hours WHERE route_id = ? AND status = 'active'
");
$stmt->bind_param("i", $route_id);
$stmt->execute();
$schedule = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$schedule) {
    echo json_encode(["success" => false, "message" => "This route has no active schedule set."]);
    exit;
}

// Recurrence check — 0=Sun..6=Sat, matching PHP's date("w") / bus_schedules'
// own convention. DAYOFWEEK() on the commuter's own literal date string is
// timezone-independent (no "now" comparison involved), so this is safe
// without the DB-clock dance the advance-window check above needs.
if ($schedule["recurrence_type"] === "weekly") {
    $stmt = $conn->prepare("SELECT DAYOFWEEK(?) - 1 AS wd");
    $stmt->bind_param("s", $departure_time);
    $stmt->execute();
    $wd = (int)$stmt->get_result()->fetch_assoc()["wd"];
    $stmt->close();
    $allowed = $schedule["weekdays"] !== null ? array_map("intval", explode(",", $schedule["weekdays"])) : [];
    if (!in_array($wd, $allowed, true)) {
        echo json_encode(["success" => false, "message" => "This route doesn't operate on that day — check the schedule's recurrence."]);
        exit;
    }
}

// Time-of-day within the operating window — via MySQL, not PHP's date() (see
// clock-mismatch landmine, Critical Insights).
$stmt = $conn->prepare("SELECT TIME(?) AS dep_hms");
$stmt->bind_param("s", $departure_time);
$stmt->execute();
$dep_hms = $stmt->get_result()->fetch_assoc()["dep_hms"];
$stmt->close();
// UV Express runs 24 hours, so a schedule's window can wrap past midnight
// (e.g. start 23:00, end 02:00 the next day) — when start <= end it's a
// normal same-day window, but when start > end the valid range is
// [start, 24:00) UNION [00:00, end] instead of a single contiguous range.
$inWindow = $schedule["start_time"] <= $schedule["end_time"]
    ? ($dep_hms >= $schedule["start_time"] && $dep_hms <= $schedule["end_time"])
    : ($dep_hms >= $schedule["start_time"] || $dep_hms <= $schedule["end_time"]);
if (!$inWindow) {
    echo json_encode([
        "success" => false,
        "message" => "This route only operates " . substr($schedule["start_time"], 0, 5) . "–" . substr($schedule["end_time"], 0, 5) . " — pick a time inside that window.",
    ]);
    exit;
}

// At least one operator must actually be running this schedule.
$stmt = $conn->prepare("SELECT COUNT(*) AS cnt FROM uv_schedule_activations WHERE uv_operating_hours_id = ? AND status = 'active'");
$stmt->bind_param("i", $schedule["id"]);
$stmt->execute();
$activeOps = (int)$stmt->get_result()->fetch_assoc()["cnt"];
$stmt->close();
if ($activeOps === 0) {
    echo json_encode(["success" => false, "message" => "No operator is currently running this route's schedule."]);
    exit;
}

// ── Find-or-create the pooled slot for this exact route + time ─────────────
$stmt = $conn->prepare("SELECT id FROM uv_slots WHERE route_id = ? AND departure_time = ? AND status = 'scheduled'");
$stmt->bind_param("is", $route_id, $departure_time);
$stmt->execute();
$existing = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($existing) {
    echo json_encode(["success" => true, "slot_id" => (int)$existing["id"]]);
    exit;
}

$stmt = $conn->prepare("
    INSERT INTO uv_slots (route_id, operator_id, departure_time, capacity)
    VALUES (?, NULL, ?, NULL)
");
$stmt->bind_param("is", $route_id, $departure_time);
$stmt->execute();
$slot_id = $conn->insert_id;
$stmt->close();

echo json_encode(["success" => true, "slot_id" => $slot_id]);
