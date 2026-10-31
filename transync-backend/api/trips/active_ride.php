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

$commuter_id = intval($_GET['commuter_id'] ?? 0);
$driver_id   = intval($_GET['driver_id']   ?? 0);

// ── Commuter: get their active ride ──────────────────────────────────────
if ($commuter_id) {
    $stmt = $conn->prepare("
        SELECT
            jr.id, jr.driver_id, jr.status,
            jr.board_lat, jr.board_lng, jr.board_time,
            jr.dropoff_lat, jr.dropoff_lng,
            jr.distance_km, jr.fare_amount, jr.discount_type,
            d.name      AS driver_name,
            d.latitude  AS driver_lat,
            d.longitude AS driver_lng
        FROM jeepney_rides jr
        JOIN drivers d ON d.id = jr.driver_id
        WHERE jr.commuter_id = ?
          AND jr.status IN ('active', 'dropoff_requested')
        ORDER BY jr.board_time DESC
        LIMIT 1
    ");
    $stmt->bind_param("i", $commuter_id);
    $stmt->execute();
    $ride = $stmt->get_result()->fetch_assoc();

    if (!$ride) {
        echo json_encode(["active" => false]);
        exit;
    }

    echo json_encode([
        "active"        => true,
        "ride_id"       => (int)$ride['id'],
        "driver_id"     => (int)$ride['driver_id'],
        "driver_name"   => $ride['driver_name'],
        "driver_lat"    => (float)$ride['driver_lat'],
        "driver_lng"    => (float)$ride['driver_lng'],
        "board_lat"     => (float)$ride['board_lat'],
        "board_lng"     => (float)$ride['board_lng'],
        "board_time"    => $ride['board_time'],
        "distance_km"   => (float)$ride['distance_km'],
        "fare_amount"   => (float)$ride['fare_amount'],
        "discount_type" => $ride['discount_type'],
        "dropoff_lat"   => (float)$ride['dropoff_lat'],
        "dropoff_lng"   => (float)$ride['dropoff_lng'],
        "status"        => $ride['status'],
    ]);
    exit;
}

// ── Driver: get active passengers + dropoff requests ─────────────────────
if ($driver_id) {
    // FIX: Added c.is_verified to the SELECT so the dropoff modal can
    // show the correct verified/unverified badge and discount info.
    $stmt = $conn->prepare("
        SELECT
            jr.id, jr.commuter_id, jr.status,
            jr.board_lat, jr.board_lng, jr.board_time,
            jr.dropoff_lat, jr.dropoff_lng,
            jr.distance_km, jr.fare_amount, jr.discount_type,
            c.name        AS commuter_name,
            c.category,
            c.is_verified,
            c.latitude    AS commuter_lat,
            c.longitude   AS commuter_lng
        FROM jeepney_rides jr
        JOIN commuters c ON c.id = jr.commuter_id
        WHERE jr.driver_id = ?
          AND jr.status IN ('active', 'dropoff_requested')
        ORDER BY jr.board_time ASC
    ");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

    $passengers       = [];
    $dropoff_requests = [];

    foreach ($rows as $r) {
        $entry = [
            "ride_id"       => (int)$r['id'],
            "commuter_id"   => (int)$r['commuter_id'],
            "commuter_name" => $r['commuter_name'],
            "category"      => $r['category'],
            "is_verified"   => (int)$r['is_verified'],
            "commuter_lat"  => (float)$r['commuter_lat'],
            "commuter_lng"  => (float)$r['commuter_lng'],
            "board_lat"     => (float)$r['board_lat'],
            "board_lng"     => (float)$r['board_lng'],
            "board_time"    => $r['board_time'],
            "distance_km"   => (float)$r['distance_km'],
            "fare_amount"   => (float)$r['fare_amount'],
            "discount_type" => $r['discount_type'],
            // FIX: dropoff coords are now always returned so end_ride.php
            // can use them as fallback if the driver doesn't provide fresh ones.
            "dropoff_lat"   => (float)$r['dropoff_lat'],
            "dropoff_lng"   => (float)$r['dropoff_lng'],
            "status"        => $r['status'],
        ];

        $passengers[] = $entry;

        // Only surface as a dropoff request if commuter tapped Para Po
        if ($r['status'] === 'dropoff_requested') {
            $dropoff_requests[] = $entry;
        }
    }

    echo json_encode([
        "active"           => count($passengers) > 0,
        "passengers"       => $passengers,
        "dropoff_requests" => $dropoff_requests,
    ]);
    exit;
}

echo json_encode(["active" => false, "message" => "Missing commuter_id or driver_id"]);
