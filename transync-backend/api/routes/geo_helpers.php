<?php
// Shared Haversine distance + speed-based ETA helpers. The same formula and
// per-vehicle-type speed constants route_planner.php already uses for its
// own board/alight distance scoring (Core Flow 6) — extracted here so the
// booking-list endpoints (get_upcoming_trips.php/get_available_slots.php)
// can estimate a whole-route travel time without a second, drifting copy of
// the math. route_planner.php's own local copies are left as-is (not
// refactored to require this file) — this only backs the new callers.

function haversineKm($lat1, $lng1, $lat2, $lng2) {
    $R    = 6371;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a    = sin($dLat / 2) ** 2 +
            cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
    return $R * 2 * atan2(sqrt($a), sqrt(1 - $a));
}
function wpLat($wp) { return (float)($wp['lat'] ?? $wp['latitude']  ?? 0); }
function wpLng($wp) { return (float)($wp['lng'] ?? $wp['longitude'] ?? 0); }

function polylineKmBetween($wps, $fromIdx, $toIdx) {
    $start = min($fromIdx, $toIdx);
    $end   = max($fromIdx, $toIdx);
    $total = 0.0;
    for ($i = $start; $i < $end; $i++) {
        $total += haversineKm(wpLat($wps[$i]), wpLng($wps[$i]),
                              wpLat($wps[$i + 1]), wpLng($wps[$i + 1]));
    }
    return $total;
}
function estMinutes($km, $vehicleType) {
    $speeds = ['Jeepney' => 20, 'UV Express' => 35, 'Bus' => 30];
    $spd    = $speeds[$vehicleType] ?? 25;
    return max(1, (int) round(($km / $spd) * 60));
}

// Whole-route distance (board at the first waypoint, alight at the last) —
// what a booking listing needs, unlike route_planner.php's mid-route
// board/alight matching against an arbitrary origin/destination.
function fullRouteKm($waypointsJson) {
    $wps = json_decode($waypointsJson ?? '[]', true);
    if (!is_array($wps) || count($wps) < 2) return 0.0;
    return polylineKmBetween($wps, 0, count($wps) - 1);
}
