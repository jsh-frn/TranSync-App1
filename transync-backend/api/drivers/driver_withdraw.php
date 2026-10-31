<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/auth.php";

$auth      = requireAuth($conn, ['driver']);
$driver_id = $auth['owner_id'];

// A driver's wallet_balance is a single flat column (unlike an operator's,
// which is split per-association — a driver only ever has one vehicle/
// operator/association at a time). association_id is captured here purely
// for record-keeping context, derived live from the driver's current
// vehicle, same pattern as Jeepney quota's association tagging (migration 031).
$body   = json_decode(file_get_contents("php://input"), true);
$amount = (float)($body["amount"] ?? 0);

if ($amount <= 0) {
    echo json_encode(["success" => false, "message" => "A positive amount is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT d.wallet_balance, v.association_id
    FROM drivers d
    LEFT JOIN vehicles v ON v.id = d.vehicle_id
    WHERE d.id = ?
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$driver = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$driver) {
    echo json_encode(["success" => false, "message" => "Driver not found."]);
    exit;
}

$balance        = (float)$driver["wallet_balance"];
$association_id = $driver["association_id"] !== null ? (int)$driver["association_id"] : null;

if ($amount > $balance) {
    echo json_encode([
        "success" => false,
        "message" => "Insufficient wallet balance.",
        "balance" => $balance,
    ]);
    exit;
}

$conn->begin_transaction();
try {
    $new_balance = round($balance - $amount, 2);

    $stmt = $conn->prepare("UPDATE drivers SET wallet_balance = ? WHERE id = ?");
    $stmt->bind_param("di", $new_balance, $driver_id);
    $stmt->execute();
    $stmt->close();

    $stmt = $conn->prepare("
        INSERT INTO withdrawal_requests (owner_type, driver_id, association_id, amount, status)
        VALUES ('driver', ?, ?, ?, 'pending')
    ");
    $stmt->bind_param("iid", $driver_id, $association_id, $amount);
    $stmt->execute();
    $withdrawal_id = $conn->insert_id;
    $stmt->close();

    $note = "Withdrawal request #{$withdrawal_id}";
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, association_id, type, amount, reference_type, reference_id, balance_after, note)
        VALUES ('driver', ?, ?, 'debit', ?, 'withdrawal', ?, ?, ?)
    ");
    $stmt->bind_param("iidids", $driver_id, $association_id, $amount, $withdrawal_id, $new_balance, $note);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
    echo json_encode([
        "success"       => true,
        "withdrawal_id" => $withdrawal_id,
        "new_balance"   => $new_balance,
        "message"       => "Withdrawal request submitted — funds are debited now and released by admin once processed.",
    ]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to submit withdrawal."]);
}
