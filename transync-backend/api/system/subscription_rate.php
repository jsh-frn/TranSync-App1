<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Single global admin-tunable rate for the Jeepney driver platform subscription
// (system revenue, separate from the operator's quota cut — see
// driver/pay_subscription.php). Only one row is ever kept; POST overwrites it.
if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $row = $conn->query("SELECT id, frequency, amount, updated_at FROM subscription_rates ORDER BY id DESC LIMIT 1")->fetch_assoc();
    echo json_encode([
        "success" => true,
        "rate" => $row ? [
            "frequency"  => $row["frequency"],
            "amount"     => (float)$row["amount"],
            "updated_at" => $row["updated_at"],
        ] : null,
    ]);
    exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

$body      = json_decode(file_get_contents("php://input"), true);
$frequency = trim($body["frequency"] ?? "");
$amount    = isset($body["amount"]) ? (float)$body["amount"] : null;

if (!in_array($frequency, ["daily", "weekly", "monthly"], true) || $amount === null || $amount <= 0) {
    echo json_encode(["success" => false, "message" => "frequency (daily|weekly|monthly) and a positive amount are required."]);
    exit;
}

$existing = $conn->query("SELECT id FROM subscription_rates ORDER BY id DESC LIMIT 1")->fetch_assoc();
if ($existing) {
    $stmt = $conn->prepare("UPDATE subscription_rates SET frequency = ?, amount = ? WHERE id = ?");
    $stmt->bind_param("sdi", $frequency, $amount, $existing["id"]);
} else {
    $stmt = $conn->prepare("INSERT INTO subscription_rates (frequency, amount) VALUES (?, ?)");
    $stmt->bind_param("sd", $frequency, $amount);
}
$stmt->execute();
$stmt->close();

echo json_encode(["success" => true]);
