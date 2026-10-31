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

// Driver Profile -> Earnings History: a per-day breakdown of the same
// booking-credit ledger driver_summary.php's "Today" figure already reads
// (creditRemittanceSplit(), reference_type='booking' — covers a real QR
// boarding scan, a post-cutoff late-cancellation forfeiture, and a no-show
// sweep alike, all three credit the driver identically). Bus/UV Express
// only in practice — Jeepney never writes this reference_type (cash fares,
// off-app), so a Jeepney driver simply gets an empty history back, same as
// "Today's Summary" already shows 0 for them by design.
// Capped at the last 30 days, newest first — this app has no pagination
// infra anywhere yet (matches get_commuter_reservations.php's own
// scope=all cap-at-100 convention, just day-scoped here since this is a
// daily aggregate, not a row list).
$stmt = $conn->prepare("
    SELECT DATE(created_at) AS day, COUNT(*) AS trip_count, SUM(amount) AS total_earnings
    FROM wallet_transactions
    WHERE owner_type = 'driver' AND owner_id = ? AND type = 'credit' AND reference_type = 'booking'
      AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    GROUP BY DATE(created_at)
    ORDER BY day DESC
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$result = $stmt->get_result();

$days = [];
$grand_total = 0.0;
$grand_trips = 0;
while ($row = $result->fetch_assoc()) {
    $earnings = (float)$row["total_earnings"];
    $trips    = (int)$row["trip_count"];
    $days[] = [
        "date"           => $row["day"],
        "trip_count"     => $trips,
        "total_earnings" => $earnings,
    ];
    $grand_total += $earnings;
    $grand_trips += $trips;
}
$stmt->close();

echo json_encode([
    "success"     => true,
    "days"        => $days,
    "grand_total" => round($grand_total, 2),
    "grand_trips" => $grand_trips,
]);
