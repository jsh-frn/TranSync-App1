<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/subscription.php";

// Jeepney driver platform subscription — separate system revenue from the
// operator's quota cut (see config/remittance.php for the Bus/UV equivalent).
// Periods are calendar-aligned (see config/subscription.php): daily resets at
// midnight, weekly is Monday-Sunday (matches the existing quota period logic
// in quota/get_driver_quota.php), monthly is the 1st-to-end-of-month.
$driver_id = (int)($_GET["driver_id"] ?? 0);
if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "driver_id is required."]);
    exit;
}

$rate = $conn->query("SELECT frequency, amount FROM subscription_rates ORDER BY id DESC LIMIT 1")->fetch_assoc();
if (!$rate) {
    echo json_encode(["success" => true, "rate" => null, "next_due_at" => null, "is_overdue" => false, "last_paid_at" => null]);
    exit;
}

$period = currentSubscriptionPeriod($conn, $rate["frequency"]);

$stmt = $conn->prepare("
    SELECT paid_at FROM subscription_payments
    WHERE driver_id = ? AND period_start = ?
    LIMIT 1
");
$stmt->bind_param("is", $driver_id, $period["period_start"]);
$stmt->execute();
$paidThisPeriod = $stmt->get_result()->fetch_assoc();
$stmt->close();

$stmt = $conn->prepare("SELECT paid_at FROM subscription_payments WHERE driver_id = ? ORDER BY paid_at DESC LIMIT 1");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$lastPaid = $stmt->get_result()->fetch_assoc();
$stmt->close();

echo json_encode([
    "success"      => true,
    "rate"         => ["frequency" => $rate["frequency"], "amount" => (float)$rate["amount"]],
    "last_paid_at" => $lastPaid["paid_at"] ?? null,
    "next_due_at"  => $period["period_end"],
    "is_overdue"   => !$paidThisPeriod,
]);
