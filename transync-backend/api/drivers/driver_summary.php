<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";

$driver_id = intval($_GET['driver_id'] ?? 0);

if (!$driver_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "driver_id is required."]);
    exit;
}

// Driver home screen "Today's Summary" — previously always read
// jeepney_rides regardless of vehicle type, which was correct for Jeepney
// once but has been dead data for every driver since Jeepney's per-ride
// QR/fare flow went fully dormant (Core Flow 4 — fare reverted to cash,
// off-app; nothing writes to jeepney_rides anymore) and was never correct
// for Bus/UV Express (jeepney_rides never held their rows to begin with).
//
// "Trips" counts completed dispatch_queue cycles (Join Queue → Start Trip
// → End Trip) for EVERY vehicle type — that's the one Dispatch-tab flow
// shared identically by Jeepney/UV Express/Bus drivers alike (Core Flow 3,
// widened route-scoped for UV Express per the Critical Insights section),
// so it must count the same way for all three, not just Jeepney. An
// earlier version scoped Bus/UV Express's trip_count to actual QR-boarded
// passengers instead (wallet_transactions credits) — that undercounted,
// since a driver who ran the queue cycle with no passenger boarded still
// legitimately completed a dispatch trip and expects it reflected here.
$stmt = $conn->prepare("
    SELECT COUNT(*) AS trip_count
    FROM dispatch_queue
    WHERE driver_id = ? AND status = 'completed' AND DATE(ended_at) = CURDATE()
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$trip_count = (int)($row["trip_count"] ?? 0);

// "Earnings" stays Bus/UV Express only — Jeepney has no per-ride app
// earnings by design (cash/traditional, off-app). Every completed boarding
// credits the driver's wallet via creditRemittanceSplit()
// (config/remittance.php) with reference_type='booking' — the same ledger
// the driver's own Wallet tab already reads, so this agrees with that number.
$stmt = $conn->prepare("SELECT v.type FROM drivers d LEFT JOIN vehicles v ON d.vehicle_id = v.id WHERE d.id = ?");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$vehicleType = $stmt->get_result()->fetch_assoc()["type"] ?? null;
$stmt->close();

$total_earnings = 0.0;

if ($vehicleType !== "Jeepney") {
    $stmt = $conn->prepare("
        SELECT COALESCE(SUM(amount), 0) AS total_earnings
        FROM wallet_transactions
        WHERE owner_type = 'driver' AND owner_id = ? AND type = 'credit'
          AND reference_type = 'booking' AND DATE(created_at) = CURDATE()
    ");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $total_earnings = (float)($row["total_earnings"] ?? 0);
}

echo json_encode([
    "success"        => true,
    "trip_count"     => $trip_count,
    "total_earnings" => $total_earnings,
]);
