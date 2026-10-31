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
require_once __DIR__ . "/../../config/subscription.php";

// Driver pays the current calendar period's subscription fee like a bill —
// no scheduled auto-debit exists, this is a manual "Pay Now" action. Debits
// the driver's wallet and credits the system wallet (ledger-only, see
// system_wallet.php).
$body      = json_decode(file_get_contents("php://input"), true);
$driver_id = (int)($body["driver_id"] ?? 0);

if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "driver_id is required."]);
    exit;
}

$rate = $conn->query("SELECT frequency, amount FROM subscription_rates ORDER BY id DESC LIMIT 1")->fetch_assoc();
if (!$rate) {
    echo json_encode(["success" => false, "message" => "No quota rate has been set yet."]);
    exit;
}
$amount    = (float)$rate["amount"];
$frequency = $rate["frequency"];
$period    = currentSubscriptionPeriod($conn, $frequency);

$stmt = $conn->prepare("SELECT id FROM subscription_payments WHERE driver_id = ? AND period_start = ?");
$stmt->bind_param("is", $driver_id, $period["period_start"]);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "Already paid for the current period."]);
    exit;
}
$stmt->close();

$stmt = $conn->prepare("SELECT wallet_balance FROM drivers WHERE id = ?");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$driver = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$driver) {
    echo json_encode(["success" => false, "message" => "Driver not found."]);
    exit;
}
if ((float)$driver["wallet_balance"] < $amount) {
    echo json_encode([
        "success"  => false,
        "message"  => "Insufficient wallet balance for the quota fee.",
        "balance"  => (float)$driver["wallet_balance"],
        "required" => $amount,
    ]);
    exit;
}

$conn->begin_transaction();
try {
    $new_balance = round((float)$driver["wallet_balance"] - $amount, 2);
    $stmt = $conn->prepare("UPDATE drivers SET wallet_balance = ? WHERE id = ?");
    $stmt->bind_param("di", $new_balance, $driver_id);
    $stmt->execute();
    $stmt->close();

    $note = "Platform quota ({$frequency})";
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, type, amount, reference_type, balance_after, note)
        VALUES ('driver', ?, 'debit', ?, 'subscription', ?, ?)
    ");
    $stmt->bind_param("idds", $driver_id, $amount, $new_balance, $note);
    $stmt->execute();
    $stmt->close();

    $sysNote = "Jeepney quota — driver #{$driver_id}";
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, type, amount, reference_type, balance_after, note)
        VALUES ('system', 0, 'credit', ?, 'subscription', ?, ?)
    ");
    $stmt->bind_param("dds", $amount, $amount, $sysNote);
    $stmt->execute();
    $stmt->close();

    $stmt = $conn->prepare("
        INSERT INTO subscription_payments (driver_id, amount, frequency, period_start, period_end)
        VALUES (?, ?, ?, ?, ?)
    ");
    $stmt->bind_param("idsss", $driver_id, $amount, $frequency, $period["period_start"], $period["period_end"]);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
    echo json_encode([
        "success"     => true,
        "new_balance" => $new_balance,
        "next_due_at" => $period["period_end"],
    ]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to process quota payment."]);
}
