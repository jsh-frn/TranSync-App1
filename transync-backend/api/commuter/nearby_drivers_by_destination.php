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

$commuter_lat = floatval($_GET['lat']      ?? 0);
$commuter_lng = floatval($_GET['lng']      ?? 0);
$dest_lat     = floatval($_GET['dest_lat'] ?? 0);
$dest_lng     = floatval($_GET['dest_lng'] ?? 0);
$limit        = intval($_GET['limit']      ?? 10);

if (!$commuter_lat || !$commuter_lng) {
    http_response_code(400);
    echo json_encode(["message" => "lat and lng are required."]);
    exit;
}

// ── Haversine ─────────────────────────────────────────────────────────────────
function haversine(float $lat1, float $lng1, float $lat2, float $lng2): float {
    $R    = 6371;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a    = sin($dLat / 2) ** 2
          + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
    return $R * 2 * atan2(sqrt($a), sqrt(1 - $a));
}

// Point-to-segment distance using equirectangular approximation (returns km)
function ptSegDist(float $pLat, float $pLng, float $aLat, float $aLng, float $bLat, float $bLng): float {
    $cos = cos(deg2rad(($aLat + $bLat) / 2));
    $ax  = ($aLng - $pLng) * $cos; $ay = $aLat - $pLat;
    $bx  = ($bLng - $pLng) * $cos; $by = $bLat - $pLat;
    $dx  = $bx - $ax;              $dy = $by - $ay;
    $lenSq = $dx * $dx + $dy * $dy;
    if ($lenSq < 1e-12) return haversine($pLat, $pLng, $aLat, $aLng);
    $t = max(0.0, min(1.0, (-$ax * $dx - $ay * $dy) / $lenSq));
    return haversine($pLat, $pLng, $aLat + $t * ($bLat - $aLat), $aLng + $t * ($bLng - $aLng));
}

function format_driver(array $row): array {
    return [
        "id"                  => (int)$row["id"],
        "name"                => $row["name"],
        "operator_name"       => $row["operator_name"],
        "operator_type"       => $row["operator_type"],
        "route_id"            => isset($row["route_id"]) ? (int)$row["route_id"] : null,
        "latitude"            => (float)$row["latitude"],
        "longitude"           => (float)$row["longitude"],
        "heading"             => (float)($row["heading"] ?? 0),
        "is_full"             => (int)$row["is_full"],
        "is_online"           => (int)$row["is_online"],
        "distance_km"         => round((float)$row["distance_km"], 3),
        "location_updated_at" => $row["location_updated_at"] ?? "",
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// No destination — return nearest online drivers
// ─────────────────────────────────────────────────────────────────────────────
if (!$dest_lat || !$dest_lng) {
    echo json_encode([
        "matched"             => false,
        "matched_route_ids"   => [],
        "nearest_route_id"    => null,
        "nearest_waypoint"    => null,
        "drivers"             => fallback_nearby($conn, $commuter_lat, $commuter_lng, $limit),
    ]);
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// Destination provided — load all active routes with their waypoints
// ─────────────────────────────────────────────────────────────────────────────
$stmt = $conn->prepare("
    SELECT id, waypoints
    FROM routes
    WHERE status = 'active'
      AND waypoints IS NOT NULL
      AND waypoints != '[]'
      AND waypoints != ''
");
$stmt->execute();
$routes_raw = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// ── Score every route ─────────────────────────────────────────────────────────
// For each route we compute:
//   dest_min_dist   — closest any waypoint gets to the destination
//   user_min_dist   — closest any waypoint gets to the commuter
//   user_idx        — index of the closest waypoint to the commuter
//   dest_idx        — index of the closest waypoint to the destination
//   nearest_wp      — the actual waypoint on this route closest to the destination

$EXACT_THRESHOLD_KM = 1.5;   // dest within 1.5km of route = exact match
$SNAP_THRESHOLD_KM  = 3.0;   // show nearest route if nothing within 3km

$route_scores = [];

foreach ($routes_raw as $raw) {
    $rid      = (int)$raw['id'];
    $decoded  = json_decode($raw['waypoints'], true);
    if (!is_array($decoded) || count($decoded) < 2) continue;

    // Normalise key names: support {latitude,longitude} and {lat,lng}
    $wps = [];
    foreach ($decoded as $wp) {
        $lat = floatval($wp['latitude']  ?? $wp['lat'] ?? 0);
        $lng = floatval($wp['longitude'] ?? $wp['lng'] ?? 0);
        if ($lat !== 0.0 && $lng !== 0.0) $wps[] = [$lat, $lng];
    }
    if (count($wps) < 2) continue;

    $user_min_dist = PHP_INT_MAX;
    $dest_min_dist = PHP_INT_MAX;
    $user_idx      = 0;
    $dest_idx      = 0;
    $nearest_wp    = null;
    $n_wps         = count($wps);

    // Nearest waypoint index + segment-based minimum distance
    foreach ($wps as $i => [$wlat, $wlng]) {
        $d_user = haversine($commuter_lat, $commuter_lng, $wlat, $wlng);
        $d_dest = haversine($dest_lat,     $dest_lng,     $wlat, $wlng);

        if ($d_user < $user_min_dist) { $user_min_dist = $d_user; $user_idx = $i; }
        if ($d_dest < $dest_min_dist) {
            $dest_min_dist = $d_dest;
            $dest_idx      = $i;
            $nearest_wp    = ["latitude" => $wlat, "longitude" => $wlng];
        }
    }

    // Override distances with segment-based proximity (handles pins between sparse waypoints)
    for ($i = 0; $i < $n_wps - 1; $i++) {
        [$aLat, $aLng] = $wps[$i];
        [$bLat, $bLng] = $wps[$i + 1];
        $ds = ptSegDist($dest_lat,     $dest_lng,     $aLat, $aLng, $bLat, $bLng);
        $du = ptSegDist($commuter_lat, $commuter_lng, $aLat, $aLng, $bLat, $bLng);
        if ($ds < $dest_min_dist) $dest_min_dist = $ds;
        if ($du < $user_min_dist) $user_min_dist = $du;
    }

    $route_scores[$rid] = [
        "route_id"      => $rid,
        "dest_min_dist" => $dest_min_dist,
        "user_min_dist" => $user_min_dist,
        "user_idx"      => $user_idx,
        "dest_idx"      => $dest_idx,
        "nearest_wp"    => $nearest_wp,
        "waypoint_count"=> count($wps),
    ];
}

if (empty($route_scores)) {
    // No routes in DB at all
    echo json_encode([
        "matched"           => false,
        "matched_route_ids" => [],
        "nearest_route_id"  => null,
        "nearest_waypoint"  => null,
        "drivers"           => fallback_nearby($conn, $commuter_lat, $commuter_lng, $limit),
    ]);
    exit;
}

// ── Sort by distance to destination ──────────────────────────────────────────
uasort($route_scores, fn($a, $b) => $a['dest_min_dist'] <=> $b['dest_min_dist']);

// ── Find EXACT matches (dest within threshold AND user within threshold) ──────
$exact_matches = [];
foreach ($route_scores as $rid => $score) {
    $near_dest = $score['dest_min_dist'] <= $EXACT_THRESHOLD_KM;
    $near_user = $score['user_min_dist'] <= $EXACT_THRESHOLD_KM;
    // Direction check: user pickup waypoint index <= destination waypoint index (±2 tolerance)
    $correct_dir = $score['user_idx'] <= ($score['dest_idx'] + 5);

    if ($near_dest && $near_user && $correct_dir) {
        $exact_matches[] = $rid;
    }
}

// ── Nearest route (best candidate even if no exact match) ────────────────────
// Take the route whose waypoints get closest to the destination
$nearest_score     = reset($route_scores);   // already sorted by dest_min_dist
$nearest_route_id  = $nearest_score['route_id'];
$nearest_waypoint  = $nearest_score['nearest_wp'];
$nearest_dist      = $nearest_score['dest_min_dist'];

// ─────────────────────────────────────────────────────────────────────────────
// CASE A: Exact match found — show only drivers on those routes
// ─────────────────────────────────────────────────────────────────────────────
if (!empty($exact_matches)) {
    $drivers = fetch_drivers_for_routes($conn, $exact_matches, $commuter_lat, $commuter_lng, $limit);
    echo json_encode([
        "matched"           => true,
        "matched_route_ids" => $exact_matches,
        "nearest_route_id"  => $nearest_route_id,
        "nearest_waypoint"  => $nearest_waypoint,
        "drivers"           => $drivers,
    ]);
    exit;
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE B: No exact match — show nearest route + its drivers
// The nearest route passes closest to the pinned destination.
// We still only show drivers on that route (not random nearby).
// ─────────────────────────────────────────────────────────────────────────────
$drivers = fetch_drivers_for_routes($conn, [$nearest_route_id], $commuter_lat, $commuter_lng, $limit);

echo json_encode([
    "matched"               => false,
    "matched_route_ids"     => [$nearest_route_id],   // highlight the nearest route
    "nearest_route_id"      => $nearest_route_id,
    "nearest_waypoint"      => $nearest_waypoint,     // closest point on route to pin
    "nearest_dist_km"       => round($nearest_dist, 3),
    "drivers"               => $drivers,
    "message"               => "No route passes your pin. Showing nearest route " . round($nearest_dist * 1000) . "m away.",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fetch_drivers_for_routes($conn, array $route_ids, float $lat, float $lng, int $limit): array {
    if (empty($route_ids)) return [];

    $placeholders = implode(',', array_fill(0, count($route_ids), '?'));
    $types        = str_repeat('i', count($route_ids));

    $sql = "
        SELECT
            d.id, d.name, d.latitude, d.longitude, d.heading,
            d.is_full, d.is_online, d.location_updated_at,
            o.name       AS operator_name,
            v.type       AS operator_type,
            ra.route_id,
            (
                6371 * ACOS(
                    LEAST(1.0,
                        COS(RADIANS(?)) * COS(RADIANS(d.latitude))
                        * COS(RADIANS(d.longitude) - RADIANS(?))
                        + SIN(RADIANS(?)) * SIN(RADIANS(d.latitude))
                    )
                )
            ) AS distance_km
        FROM drivers d
        JOIN operators o          ON o.id = d.operator_id
        LEFT JOIN vehicles v      ON v.id = d.vehicle_id
        JOIN route_assignments ra ON ra.vehicle_id = d.vehicle_id
        WHERE
            d.is_online     = 1
            AND d.latitude  IS NOT NULL
            AND d.longitude IS NOT NULL
            AND d.location_updated_at >= NOW() - INTERVAL 2 MINUTE
            AND ra.route_id IN ($placeholders)
        GROUP BY d.id
        ORDER BY distance_km ASC
        LIMIT ?
    ";

    $bind_types = 'ddd' . $types . 'i';
    $bind_vals  = array_merge([$lat, $lng, $lat], $route_ids, [$limit]);

    $stmt = $conn->prepare($sql);
    $stmt->bind_param($bind_types, ...$bind_vals);
    $stmt->execute();
    $result  = $stmt->get_result();
    $drivers = [];
    while ($row = $result->fetch_assoc()) {
        $drivers[] = format_driver($row);
    }
    return $drivers;
}

function fallback_nearby($conn, float $lat, float $lng, int $limit): array {
    $stmt = $conn->prepare("
        SELECT
            d.id, d.name, d.latitude, d.longitude, d.heading,
            d.is_full, d.is_online, d.location_updated_at,
            o.name       AS operator_name,
            v.type       AS operator_type,
            NULL         AS route_id,
            (
                6371 * ACOS(
                    LEAST(1.0,
                        COS(RADIANS(?)) * COS(RADIANS(d.latitude))
                        * COS(RADIANS(d.longitude) - RADIANS(?))
                        + SIN(RADIANS(?)) * SIN(RADIANS(d.latitude))
                    )
                )
            ) AS distance_km
        FROM drivers d
        JOIN operators o ON o.id = d.operator_id
        JOIN vehicles  v ON v.id = d.vehicle_id
        WHERE
            d.is_online  = 1
            AND d.latitude  IS NOT NULL
            AND d.longitude IS NOT NULL
            AND d.location_updated_at >= NOW() - INTERVAL 2 MINUTE
            AND v.type = 'Jeepney'
        HAVING distance_km <= 5
        ORDER BY distance_km ASC
        LIMIT ?
    ");
    $stmt->bind_param("dddi", $lat, $lng, $lat, $limit);
    $stmt->execute();
    $result  = $stmt->get_result();
    $drivers = [];
    while ($row = $result->fetch_assoc()) {
        $drivers[] = format_driver($row);
    }
    return $drivers;
}
