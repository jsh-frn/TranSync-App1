<?php
header("Content-Type: application/json");
require_once "../../config/db.php";

$data        = json_decode(file_get_contents("php://input"), true);
$commuter_id = intval($data['commuter_id'] ?? 0);
$qr_data     = $data['qr_data']            ?? null;
$board_lat   = floatval($data['board_lat'] ?? 0);
$board_lng   = floatval($data['board_lng'] ?? 0);

if (!$commuter_id || !$qr_data) {
    echo json_encode(["success" => false, "message" => "Invalid request"]);
    exit;
}

// ── Parse driver_id from QR ───────────────────────────────────────────────
if (!str_starts_with($qr_data, "DRIVER_")) {
    echo json_encode(["success" => false, "message" => "Invalid QR code"]);
    exit;
}
$driver_id = (int) substr($qr_data, strlen("DRIVER_"));
if ($driver_id <= 0) {
    echo json_encode(["success" => false, "message" => "Invalid driver QR"]);
    exit;
}

// ── Fetch driver ──────────────────────────────────────────────────────────
$stmt = $conn->prepare("SELECT id, name FROM drivers WHERE id = ? LIMIT 1");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$driver = $stmt->get_result()->fetch_assoc();
if (!$driver) {
    echo json_encode(["success" => false, "message" => "Driver not found"]);
    exit;
}

// ── Fetch commuter ────────────────────────────────────────────────────────
$stmt = $conn->prepare("
    SELECT c.id, c.name, c.category, c.is_verified, w.balance
    FROM commuters c
    JOIN wallets w ON w.commuter_id = c.id
    WHERE c.id = ? LIMIT 1
");
$stmt->bind_param("i", $commuter_id);
$stmt->execute();
$commuter = $stmt->get_result()->fetch_assoc();
if (!$commuter) {
    echo json_encode(["success" => false, "message" => "Commuter not found"]);
    exit;
}

// ── Check minimum wallet balance (base fare = ₱13) ───────────────────────
$min_balance = 13.00;
if ((float)$commuter['balance'] < $min_balance) {
    echo json_encode([
        "success"         => false,
        "insufficient"    => true,
        "message"         => "Insufficient wallet balance. Please top up at least ₱13.00 to ride.",
        "current_balance" => (float)$commuter['balance'],
        "minimum_required"=> $min_balance,
    ]);
    exit;
}

// ── Prevent duplicate boarding ────────────────────────────────────────────
$stmt = $conn->prepare("
    SELECT id FROM jeepney_rides
    WHERE driver_id = ? AND commuter_id = ? AND status = 'active'
    LIMIT 1
");
$stmt->bind_param("ii", $driver_id, $commuter_id);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    echo json_encode(["success" => false, "message" => "You are already on board this jeepney."]);
    exit;
}

// ── Record boarding in jeepney_rides ─────────────────────────────────────
$stmt = $conn->prepare("
    INSERT INTO jeepney_rides
        (commuter_id, driver_id, status, board_lat, board_lng, board_time,
         distance_km, fare_amount, discount_type)
    VALUES (?, ?, 'active', ?, ?, NOW(), 0, 0, ?)
");
$discount_type = in_array($commuter['category'], ['student','disabled','elderly'])
    ? $commuter['category'] : 'default';
$stmt->bind_param(
    "iidds",
    $commuter_id, $driver_id,
    $board_lat, $board_lng,
    $discount_type
);
$stmt->execute();
$ride_id = (int)$conn->insert_id;

if ($ride_id <= 0) {
    echo json_encode(["success" => false, "message" => "Failed to record boarding."]);
    exit;
}

echo json_encode([
    "success"       => true,
    "ride_id"       => $ride_id,
    "driver_name"   => $driver['name'],
    "commuter_name" => $commuter['name'],
    "category"      => $commuter['category'],
    "is_verified"   => (int)$commuter['is_verified'],
    "wallet_balance"=> (float)$commuter['balance'],
]);