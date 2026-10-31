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

$body = json_decode(file_get_contents("php://input"), true);

$required = ["operator_id", "route_id", "departure_time", "capacity"];
foreach ($required as $field) {
    if (empty($body[$field]) && $body[$field] !== 0) {
        echo json_encode(["success" => false, "message" => "Missing required field: $field"]);
        exit;
    }
}

$operator_id    = (int)$body["operator_id"];
$route_id       = (int)$body["route_id"];
$departure_time = trim($body["departure_time"]);
$capacity       = (int)$body["capacity"];

if ($capacity <= 0) {
    echo json_encode(["success" => false, "message" => "Capacity must be greater than zero."]);
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

if ($departure_ts <= $db_now_ts) {
    echo json_encode(["success" => false, "message" => "Departure time must be in the future."]);
    exit;
}

// ── Validate the route belongs to an association this operator has an
// approved UV Express membership at (routes are association-owned now —
// there is no operator-owned route creation path anymore, see Core Flow 8) ──
$stmt = $conn->prepare("
    SELECT r.vehicle_type, r.status FROM routes r
    JOIN operator_association_applications oaa
        ON oaa.association_id = r.association_id AND oaa.vehicle_type = 'UV Express' AND oaa.status = 'approved'
    WHERE r.id = ? AND oaa.operator_id = ?
");
$stmt->bind_param("ii", $route_id, $operator_id);
$stmt->execute();
$route = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$route || $route["status"] !== "active") {
    echo json_encode(["success" => false, "message" => "Route not found, inactive, or not approved for your operator account."]);
    exit;
}
if ($route["vehicle_type"] !== "UV Express") {
    echo json_encode(["success" => false, "message" => "Only UV Express routes can have scheduled slots."]);
    exit;
}

// ── If the association has set an operating-hours window for this route,
// the slot's departure time-of-day must fall inside it (Core Flow: UV
// operating hours) — an 'inactive' or missing row means no restriction ──
$stmt = $conn->prepare("SELECT start_time, end_time FROM uv_operating_hours WHERE route_id = ? AND status = 'active'");
$stmt->bind_param("i", $route_id);
$stmt->execute();
$hours = $stmt->get_result()->fetch_assoc();
$stmt->close();
if ($hours) {
    // Extract the time-of-day via MySQL, not PHP's date() on $departure_ts —
    // date() would run through PHP's date.timezone (Europe/Berlin), which
    // doesn't match this server's actual clock (see clock-mismatch landmine).
    $stmt = $conn->prepare("SELECT TIME(?) AS dep_hms");
    $stmt->bind_param("s", $departure_time);
    $stmt->execute();
    $departure_hms = $stmt->get_result()->fetch_assoc()["dep_hms"];
    $stmt->close();
    if ($departure_hms < $hours["start_time"] || $departure_hms > $hours["end_time"]) {
        echo json_encode([
            "success" => false,
            "message" => "This route only operates " . substr($hours["start_time"], 0, 5) . "–" . substr($hours["end_time"], 0, 5) . " — pick a departure time inside that window.",
        ]);
        exit;
    }
}

$stmt = $conn->prepare("
    INSERT INTO uv_slots (route_id, operator_id, departure_time, capacity)
    VALUES (?, ?, ?, ?)
");
$stmt->bind_param("iisi", $route_id, $operator_id, $departure_time, $capacity);
$stmt->execute();
$slot_id = $conn->insert_id;
$stmt->close();

echo json_encode(["success" => true, "slot_id" => $slot_id]);
