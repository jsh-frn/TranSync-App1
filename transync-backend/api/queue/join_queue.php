<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";
require_once "../../config/subscription.php";

$raw         = file_get_contents("php://input");
$data        = json_decode($raw, true);
$driver_id   = intval($data['driver_id']   ?? 0);
$operator_id = intval($data['operator_id'] ?? 0);
// Optional: UV Express drivers queue per-route (a UV operator may run several
// routes). Jeepney callers omit this, keeping route_id NULL and behavior
// exactly as before.
$route_id    = isset($data['route_id']) && $data['route_id'] !== "" ? intval($data['route_id']) : null;

if (!$driver_id || !$operator_id) {
    echo json_encode(["success" => false, "message" => "Missing fields"]);
    exit;
}

// Suspension for non-payment: a Jeepney driver whose platform subscription is
// overdue for the current calendar period can't join the queue (can't work)
// until they pay — but can still log in and use the wallet screen to pay,
// see drivers/pay_subscription.php. Bus/UV Express drivers are unaffected
// (their system contribution is the automatic per-ride remittance instead).
// Keyed off the driver's own assigned vehicle type, not the operator's
// (now-legacy, no-longer-fixed) operator_type — one operator can run
// multiple vehicle types, so this must be per-driver, not per-operator.
$stmt = $conn->prepare("SELECT v.type FROM drivers d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = ?");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$isJeepney = ($stmt->get_result()->fetch_assoc()["type"] ?? null) === "Jeepney";
$stmt->close();

if ($isJeepney) {
    $rate = $conn->query("SELECT frequency FROM subscription_rates ORDER BY id DESC LIMIT 1")->fetch_assoc();
    if ($rate) {
        $period = currentSubscriptionPeriod($conn, $rate["frequency"]);
        $stmt = $conn->prepare("SELECT id FROM subscription_payments WHERE driver_id = ? AND period_start = ?");
        $stmt->bind_param("is", $driver_id, $period["period_start"]);
        $stmt->execute();
        $paidThisPeriod = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$paidThisPeriod) {
            echo json_encode(["success" => false, "message" => "Your platform quota is overdue — pay it from your Wallet tab to rejoin the queue.", "subscription_overdue" => true]);
            exit;
        }
    }
}

// Safety: mark any leftover 'waiting' rows for this driver as completed
// before inserting the new one — prevents ghost rows in the queue
$stmt = $conn->prepare("
    UPDATE dispatch_queue
    SET    status   = 'completed',
           ended_at = NOW()
    WHERE  driver_id = ?
      AND  status    = 'waiting'
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();

// Count how many OTHER drivers are currently 'waiting' for this operator
// (and this route, when route-scoped). Only 'waiting' rows count —
// completed/dispatched rows are ignored
if ($route_id !== null) {
    $stmt = $conn->prepare("
        SELECT COUNT(*) AS cnt
        FROM dispatch_queue
        WHERE operator_id = ?
          AND route_id    = ?
          AND status      = 'waiting'
    ");
    $stmt->bind_param("ii", $operator_id, $route_id);
} else {
    $stmt = $conn->prepare("
        SELECT COUNT(*) AS cnt
        FROM dispatch_queue
        WHERE operator_id = ?
          AND status      = 'waiting'
    ");
    $stmt->bind_param("i", $operator_id);
}
$stmt->execute();
$cnt            = (int) $stmt->get_result()->fetch_assoc()['cnt'];
$queue_position = $cnt + 1;

// Insert a fresh new queue row every time
$stmt = $conn->prepare("
    INSERT INTO dispatch_queue (driver_id, operator_id, route_id, status, joined_at)
    VALUES (?, ?, ?, 'waiting', NOW())
");
$stmt->bind_param("iii", $driver_id, $operator_id, $route_id);
$stmt->execute();

$queue_id = (int) $conn->insert_id;

echo json_encode([
    "success"        => true,
    "queue_id"       => $queue_id,
    "queue_position" => $queue_position,
]);
