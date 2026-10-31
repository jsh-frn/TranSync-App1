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

$data         = json_decode(file_get_contents("php://input"), true);
$ride_id      = intval($data['ride_id']      ?? 0);
$dropoff_lat  = floatval($data['dropoff_lat'] ?? 0);
$dropoff_lng  = floatval($data['dropoff_lng'] ?? 0);
$triggered_by = $data['triggered_by'] ?? 'driver'; // 'driver' | 'commuter' | 'auto'

if (!$ride_id) {
    echo json_encode(["success" => false, "message" => "Missing ride_id"]);
    exit;
}

// ── Fetch ride ────────────────────────────────────────────────────────────
// FIX 1: Accept BOTH 'active' and 'dropoff_requested' statuses.
// Previously only 'active' was accepted, but when the commuter taps
// "Para Po" the status becomes 'dropoff_requested' — so the driver's
// Confirm Drop Off was always hitting "ride not found or already ended".
$stmt = $conn->prepare("
    SELECT
        jr.*,
        c.is_verified,
        c.category,
        w.balance AS wallet_balance,
        w.id      AS wallet_id
    FROM jeepney_rides jr
    JOIN commuters c ON c.id = jr.commuter_id
    JOIN wallets   w ON w.commuter_id = jr.commuter_id
    WHERE jr.id = ?
      AND jr.status IN ('active', 'dropoff_requested')
    LIMIT 1
");
$stmt->bind_param("i", $ride_id);
$stmt->execute();
$ride = $stmt->get_result()->fetch_assoc();

if (!$ride) {
    echo json_encode(["success" => false, "message" => "Ride not found or already ended"]);
    exit;
}

$commuter_id = (int)$ride['commuter_id'];
$driver_id   = (int)$ride['driver_id'];

// ── Haversine distance ────────────────────────────────────────────────────
function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float {
    $R    = 6371;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a    = sin($dLat / 2) ** 2
          + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
    return $R * 2 * atan2(sqrt($a), sqrt(1 - $a));
}

$board_lat = (float)$ride['board_lat'];
$board_lng = (float)$ride['board_lng'];

// Use provided dropoff coords; if not given fall back to stored dropoff,
// then fall back to board point (minimum ₱13 base fare).
$drop_lat = $dropoff_lat ?: ((float)$ride['dropoff_lat'] ?: $board_lat);
$drop_lng = $dropoff_lng ?: ((float)$ride['dropoff_lng'] ?: $board_lng);

$distance_km = haversine($board_lat, $board_lng, $drop_lat, $drop_lng);

// ── Fare calculation ──────────────────────────────────────────────────────
$base_fare   = 13.00;
$base_km     = 4.0;
$per_km_rate = 1.80;

$fare = $base_fare;
if ($distance_km > $base_km) {
    $fare += ($distance_km - $base_km) * $per_km_rate;
}

// FIX 2: Use discount_type from the ride record (set at boarding time).
// Previously relied on $ride['category'] + $ride['is_verified'] which
// could be null when the driver triggers end_ride. discount_type is
// stored reliably at board time in verify_qr_board.php.
$discount_type = $ride['discount_type'] ?? 'default';
$is_discounted = in_array($discount_type, ['student', 'disabled', 'elderly']);
if ($is_discounted) $fare *= 0.80;

// Round to nearest ₱0.25
$fare = round($fare * 4) / 4;

// ── Wallet check ──────────────────────────────────────────────────────────
$wallet_balance = (float)$ride['wallet_balance'];
if ($wallet_balance < $fare) {
    // Never block — ride already happened. Charge whatever is available.
    $fare = round($wallet_balance * 4) / 4;
}

// ── Atomic transaction ────────────────────────────────────────────────────
$conn->begin_transaction();
try {
    // 1. Complete the ride
    $stmt = $conn->prepare("
        UPDATE jeepney_rides SET
            status       = 'completed',
            dropoff_lat  = ?,
            dropoff_lng  = ?,
            dropoff_time = NOW(),
            distance_km  = ?,
            fare_amount  = ?
        WHERE id = ?
    ");
    $stmt->bind_param("ddddi", $drop_lat, $drop_lng, $distance_km, $fare, $ride_id);
    $stmt->execute();

    // 2. Deduct from commuter wallet
    $new_commuter_balance = $wallet_balance - $fare;
    $stmt = $conn->prepare("UPDATE wallets SET balance = ? WHERE commuter_id = ?");
    $stmt->bind_param("di", $new_commuter_balance, $commuter_id);
    $stmt->execute();

    // 3. Log commuter wallet debit
    $note = sprintf("Jeepney fare — %.2f km", $distance_km);
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
        VALUES ('commuter', ?, 'debit', ?, 'jeepney_ride', ?, ?, ?)
    ");
    $stmt->bind_param("idids", $commuter_id, $fare, $ride_id, $new_commuter_balance, $note);
    $stmt->execute();

    // 4. Credit driver wallet
    $drv_stmt = $conn->prepare("SELECT wallet_balance FROM drivers WHERE id = ?");
    $drv_stmt->bind_param("i", $driver_id);
    $drv_stmt->execute();
    $drv_row            = $drv_stmt->get_result()->fetch_assoc();
    $new_driver_balance = (float)$drv_row['wallet_balance'] + $fare;

    $stmt = $conn->prepare("UPDATE drivers SET wallet_balance = ? WHERE id = ?");
    $stmt->bind_param("di", $new_driver_balance, $driver_id);
    $stmt->execute();

    // 5. Log driver wallet credit
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
        VALUES ('driver', ?, 'credit', ?, 'jeepney_ride', ?, ?, ?)
    ");
    $stmt->bind_param("idids", $driver_id, $fare, $ride_id, $new_driver_balance, $note);
    $stmt->execute();

    $conn->commit();

    echo json_encode([
        "success"         => true,
        "ride_id"         => $ride_id,
        "distance_km"     => round($distance_km, 3),
        "fare_charged"    => $fare,
        "wallet_balance"  => $new_commuter_balance,
        "driver_credited" => $fare,
        "triggered_by"    => $triggered_by,
        "discount_applied"=> $is_discounted,
    ]);

} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Transaction failed: " . $e->getMessage()]);
}
