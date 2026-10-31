<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";

// A driver's emergency (SOS) alert — stored in emergency_alerts and shown to
// the driver's own operator (operators/get_emergency_alerts.php) and to the
// admin (system/emergency_alerts.php). Deliberately never blocked by a missing
// GPS fix, an inactive account, or a missing vehicle: in a real emergency the
// alert must always be recorded. Location falls back to the driver's last
// known position when the phone couldn't get a fresh fix.
$data      = json_decode(file_get_contents("php://input"), true) ?? [];
$driver_id = (int)($data["driver_id"] ?? 0);
$latitude  = (isset($data["latitude"])  && is_numeric($data["latitude"]))  ? (float)$data["latitude"]  : null;
$longitude = (isset($data["longitude"]) && is_numeric($data["longitude"])) ? (float)$data["longitude"] : null;
$message   = mb_substr(trim((string)($data["message"] ?? "")), 0, 500);

if (!$driver_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "driver_id is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT id, vehicle_id, latitude, longitude FROM drivers WHERE id = ?");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$driver = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$driver) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Driver not found."]);
    exit;
}

// A real GPS position is in range and not the (0,0) "no fix" placeholder —
// drivers.latitude/longitude are 0, not NULL, for a driver who never shared a
// location, and storing that would pin the alert in the ocean off Africa.
$validCoord = function ($lat, $lng) {
    return $lat !== null && $lng !== null
        && abs($lat) <= 90 && abs($lng) <= 180
        && (abs($lat) > 0.0001 || abs($lng) > 0.0001);
};
if (!$validCoord($latitude, $longitude)) { $latitude = null; $longitude = null; }

$usedLastKnown = false;
if ($latitude === null) {
    $lastLat = $driver["latitude"]  !== null ? (float)$driver["latitude"]  : null;
    $lastLng = $driver["longitude"] !== null ? (float)$driver["longitude"] : null;
    if ($validCoord($lastLat, $lastLng)) {
        $latitude      = $lastLat;
        $longitude     = $lastLng;
        $usedLastKnown = true;
    }
}
$vehicle_id = $driver["vehicle_id"] !== null ? (int)$driver["vehicle_id"] : null;

// A driver double-tapping (or re-sending in panic) must not create a pile of
// duplicate alerts — an alert still active from the last 2 minutes is reused.
// Compared entirely in MySQL (created_at is stamped by MySQL's own clock).
$stmt = $conn->prepare("
    SELECT id FROM emergency_alerts
    WHERE driver_id = ? AND status = 'active'
      AND created_at >= (NOW() - INTERVAL 2 MINUTE)
    ORDER BY id DESC LIMIT 1
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$recent = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($recent) {
    echo json_encode([
        "success"      => true,
        "alert_id"     => (int)$recent["id"],
        "already_sent" => true,
        "has_location" => $latitude !== null,
    ]);
    exit;
}

$stmt = $conn->prepare("
    INSERT INTO emergency_alerts (driver_id, vehicle_id, message, latitude, longitude)
    VALUES (?, ?, ?, ?, ?)
");
$stmt->bind_param("iisdd", $driver_id, $vehicle_id, $message, $latitude, $longitude);
if (!$stmt->execute()) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to record the alert. Please try again or call your operator directly."]);
    exit;
}
$alert_id = $stmt->insert_id;
$stmt->close();

$response = json_encode([
    "success"        => true,
    "alert_id"       => $alert_id,
    "already_sent"   => false,
    "has_location"   => $latitude !== null,
    "used_last_known"=> $usedLastKnown,
]);

// Answer the driver immediately — the alert is saved, which is all they need to
// know — THEN attempt the operator SMS, so a slow SMS provider never leaves a
// driver in an emergency staring at a spinner. (Content-Length + close lets
// the client finish while this script keeps running.)
ignore_user_abort(true);
header("Content-Length: " . strlen($response));
header("Connection: close");
echo $response;
if (function_exists("fastcgi_finish_request")) {
    fastcgi_finish_request();
} else {
    @ob_flush();
    flush();
}

// Opt-in, best effort, never affects the response above (see config/emergency_sms.php).
require_once __DIR__ . "/../../config/emergency_sms.php";
if (emergencySmsEnabled()) {
    try {
        $stmt = $conn->prepare("
            SELECT d.name AS driver_name, d.phone AS driver_phone,
                   v.plate_number, o.phone AS operator_phone
            FROM drivers d
            LEFT JOIN vehicles  v ON v.id = d.vehicle_id
            LEFT JOIN operators o ON o.id = d.operator_id
            WHERE d.id = ?
        ");
        $stmt->bind_param("i", $driver_id);
        $stmt->execute();
        $info = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if ($info && !empty($info["operator_phone"])) {
            sendPlainSms(
                $info["operator_phone"],
                buildEmergencySmsText($info["driver_name"], $info["plate_number"], $info["driver_phone"], $latitude, $longitude)
            );
        }
    } catch (Throwable $e) {
        error_log("emergency SMS failed: " . $e->getMessage());
    }
}
