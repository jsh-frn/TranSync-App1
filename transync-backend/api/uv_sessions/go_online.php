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

$body      = json_decode(file_get_contents("php://input"), true);
$driver_id = (int)($body["driver_id"] ?? 0);
if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "driver_id is required."]);
    exit;
}

// ── Driver's own vehicle + assigned route are the session's vehicle/route ────
$stmt = $conn->prepare("SELECT operator_id, vehicle_id FROM drivers WHERE id = ?");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$driver = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$driver) {
    echo json_encode(["success" => false, "message" => "Driver not found."]);
    exit;
}
if (!$driver["vehicle_id"]) {
    echo json_encode(["success" => false, "message" => "No vehicle assigned — contact your operator."]);
    exit;
}

// route_assignments is vehicle-keyed (migration 056), not driver-keyed.
$stmt = $conn->prepare("SELECT route_id FROM route_assignments WHERE vehicle_id = ?");
$stmt->bind_param("i", $driver["vehicle_id"]);
$stmt->execute();
$assignment = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$assignment) {
    echo json_encode(["success" => false, "message" => "No route assigned — contact your operator."]);
    exit;
}

$stmt = $conn->prepare("SELECT type, capacity FROM vehicles WHERE id = ?");
$stmt->bind_param("i", $driver["vehicle_id"]);
$stmt->execute();
$vehicle = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$vehicle || $vehicle["type"] !== "UV Express") {
    echo json_encode(["success" => false, "message" => "Assigned vehicle is not a UV Express unit."]);
    exit;
}

$route_id = (int)$assignment["route_id"];

// ── If the association has set an operating-hours window for this route,
// a driver can only go online within it — checked against the DB clock's
// own current time-of-day, never PHP's date()/time() (clock-mismatch
// landmine: php.ini's Europe/Berlin vs this server's actual MySQL clock) ──
$stmt = $conn->prepare("SELECT start_time, end_time FROM uv_operating_hours WHERE route_id = ? AND status = 'active'");
$stmt->bind_param("i", $route_id);
$stmt->execute();
$hours = $stmt->get_result()->fetch_assoc();
$stmt->close();
if ($hours) {
    $now_hms = $conn->query("SELECT TIME(NOW()) AS now_hms")->fetch_assoc()["now_hms"];
    if ($now_hms < $hours["start_time"] || $now_hms > $hours["end_time"]) {
        echo json_encode([
            "success" => false,
            "message" => "This route only operates " . substr($hours["start_time"], 0, 5) . "–" . substr($hours["end_time"], 0, 5) . " — you can't go online outside that window.",
        ]);
        exit;
    }
}

$capacity   = (int)($vehicle["capacity"] ?? 10);
$vehicle_id = (int)$driver["vehicle_id"];
$operator_id = (int)$driver["operator_id"];

$conn->begin_transaction();
try {
    // Ghost-row cleanup — mirrors join_queue.php's pattern for dispatch_queue
    $stmt = $conn->prepare("
        UPDATE uv_sessions SET status = 'cancelled', ended_at = NOW()
        WHERE driver_id = ? AND status IN ('open', 'full')
    ");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $stmt->close();

    $stmt = $conn->prepare("
        INSERT INTO uv_sessions (driver_id, vehicle_id, route_id, operator_id, capacity, status, started_at)
        VALUES (?, ?, ?, ?, ?, 'open', NOW())
    ");
    $stmt->bind_param("iiiii", $driver_id, $vehicle_id, $route_id, $operator_id, $capacity);
    $stmt->execute();
    $uv_session_id = $conn->insert_id;
    $stmt->close();

    $stmt = $conn->prepare("UPDATE drivers SET is_online = 1 WHERE id = ?");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
    echo json_encode(["success" => true, "uv_session_id" => $uv_session_id, "capacity" => $capacity]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to go online."]);
}
