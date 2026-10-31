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
$after_id  = intval($_GET['after_id']  ?? 0);
$is_init   = isset($_GET['init']) && $_GET['init'] === '1';

if (!$driver_id) {
    http_response_code(400);
    echo json_encode(["found" => false, "message" => "driver_id is required."]);
    exit;
}

// ── Init mode ─────────────────────────────────────────────────────────────
// Called once on app load with ?init=1
// Returns the current max ride_id so the app seeds its baseline
// without firing a notification for rides that already existed
if ($is_init) {
    $stmt = $conn->prepare("
        SELECT COALESCE(MAX(id), 0) AS max_id
        FROM jeepney_rides
        WHERE driver_id = ?
    ");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    echo json_encode([
        "found"   => false,
        "ride_id" => (int) ($row["max_id"] ?? 0),
    ]);
    exit;
}

// ── Normal poll ───────────────────────────────────────────────────────────
// Returns the newest active ride with id > after_id (the last ride the app saw)
$stmt = $conn->prepare("
    SELECT
        jr.id          AS ride_id,
        c.name         AS commuter_name,
        c.category,
        c.is_verified
    FROM jeepney_rides jr
    JOIN commuters c ON c.id = jr.commuter_id
    WHERE jr.driver_id = ?
      AND jr.id        > ?
      AND jr.status    = 'active'
    ORDER BY jr.id DESC
    LIMIT 1
");
$stmt->bind_param("ii", $driver_id, $after_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row) {
    echo json_encode(["found" => false]);
    exit;
}

echo json_encode([
    "found"         => true,
    "ride_id"       => (int) $row["ride_id"],
    "commuter_name" => $row["commuter_name"],
    "category"      => $row["category"],
    "is_verified"   => (int) $row["is_verified"],
]);
