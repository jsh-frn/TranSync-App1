<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

// ── Parameters ────────────────────────────────────────────────────────────────
$destination = trim($_GET['destination'] ?? "");
$origin      = trim($_GET['origin']      ?? "");
$destLatIn   = isset($_GET['dest_lat']) ? (float)$_GET['dest_lat'] : null;
$destLngIn   = isset($_GET['dest_lng']) ? (float)$_GET['dest_lng'] : null;
$origLatIn   = isset($_GET['orig_lat']) ? (float)$_GET['orig_lat'] : null;
$origLngIn   = isset($_GET['orig_lng']) ? (float)$_GET['orig_lng'] : null;

if ($destLatIn === null && strlen($destination) < 2) {
    echo json_encode(["success" => true, "options" => [], "dest_display" => null]);
    exit;
}

// ── Math helpers ──────────────────────────────────────────────────────────────
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

// Perpendicular distance from point P to segment AB (equirectangular approx, returns km)
function ptSegDistKm($pLat, $pLng, $aLat, $aLng, $bLat, $bLng) {
    $cos = cos(deg2rad(($aLat + $bLat) / 2));
    $ax  = ($aLng - $pLng) * $cos; $ay = $aLat - $pLat;
    $bx  = ($bLng - $pLng) * $cos; $by = $bLat - $pLat;
    $dx  = $bx - $ax;              $dy = $by - $ay;
    $lenSq = $dx * $dx + $dy * $dy;
    if ($lenSq < 1e-12) return haversineKm($pLat, $pLng, $aLat, $aLng);
    $t = max(0.0, min(1.0, (-$ax * $dx - $ay * $dy) / $lenSq));
    return haversineKm($pLat, $pLng, $aLat + $t * ($bLat - $aLat), $aLng + $t * ($bLng - $aLng));
}

// Returns [nearestWaypointIndex, minDistanceMeters].
// Distance uses segment-based proximity so a point between two sparse waypoints
// that lies directly on the route returns near-zero distance.
function closestWaypoint($wps, $lat, $lng) {
    $minWpDist  = PHP_INT_MAX;
    $minWpIdx   = 0;
    $minSegDist = PHP_INT_MAX;
    $n          = count($wps);

    for ($i = 0; $i < $n; $i++) {
        $d = haversineKm(wpLat($wps[$i]), wpLng($wps[$i]), $lat, $lng) * 1000;
        if ($d < $minWpDist) { $minWpDist = $d; $minWpIdx = $i; }
    }
    for ($i = 0; $i < $n - 1; $i++) {
        $d = ptSegDistKm($lat, $lng, wpLat($wps[$i]), wpLng($wps[$i]), wpLat($wps[$i+1]), wpLng($wps[$i+1])) * 1000;
        if ($d < $minSegDist) $minSegDist = $d;
    }
    // Return nearest waypoint index (for boarding/alighting) but the smaller of
    // waypoint-distance and segment-distance (for threshold checks)
    return [$minWpIdx, (float)min($minWpDist, $minSegDist)];
}

// Finds the best index to board a route at, given a target "get off here" index
// (destWpIdx). Routes are frequently loops (out one way, back another, or a single
// road walked out-and-back to the same terminal) — a loop can pass within threshold
// of the same origin point TWICE, once on each leg, and only one of those passes may
// actually be upstream of the destination in the route's drawn (physical travel)
// order. Picking the single globally-closest waypoint (as closestWaypoint() does)
// can land on the wrong pass and wrongly reject a route that genuinely serves this
// trip via its other leg — so this scans every waypoint within threshold and keeps
// only the closest one that's actually forward-valid (or, for a 'vice_versa' route,
// any nearby point at all, since direction doesn't constrain it).
// Returns [boardIdx, distMeters] or [null, null] if nothing qualifies.
function findBestBoardIdx($wps, $lat, $lng, $destWpIdx, $thresholdM, $isViceVersa) {
    $n = count($wps);
    $bestIdx  = null;
    $bestDist = PHP_INT_MAX;
    for ($i = 0; $i < $n; $i++) {
        // Strictly upstream (no tolerance): a boarding index even slightly past
        // destWpIdx isn't reachable by forward travel, and letting it through here
        // previously fed an inverted (board > alight) pair into polylineKmBetween(),
        // whose min/max silently computed the short backward gap between them
        // instead of the real forward distance — producing a deceptively tiny
        // "already there" ride for what should have been rejected outright.
        if (!$isViceVersa && $i > $destWpIdx) continue;
        $d = haversineKm(wpLat($wps[$i]), wpLng($wps[$i]), $lat, $lng) * 1000;
        if ($d < $thresholdM && $d < $bestDist) {
            $bestDist = $d;
            $bestIdx  = $i;
        }
    }
    if ($bestIdx === null) return [null, null];
    return [$bestIdx, $bestDist];
}

// ── Geocode via Nominatim (OSM) ───────────────────────────────────────────────
// Biased to a bounding box covering Pampanga province plus Angeles City / Clark
// (independently chartered cities enclaved within Pampanga's geography). Appending
// ", Pampanga" as literal text made Nominatim mismatch places like "Angeles City"
// (not administratively part of Pampanga province) to unrelated results — a viewbox
// bias scopes results geographically instead, without requiring textual containment.
function geocode($placeName) {
    $viewbox = "120.30,15.45,120.90,14.65"; // left,top,right,bottom (lon,lat,lon,lat)

    $tryGeocode = function ($query, $bounded) use ($viewbox) {
        $url = "https://nominatim.openstreetmap.org/search?" . http_build_query([
            'q'            => $query,
            'format'       => 'json',
            'limit'        => 1,
            'countrycodes' => 'ph',
            'viewbox'      => $viewbox,
            'bounded'      => $bounded ? 1 : 0,
        ]);
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 8,
            CURLOPT_USERAGENT      => 'TranSync-App/1.0',
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
        ]);
        $raw = curl_exec($ch);
        curl_close($ch);
        if (!$raw) return null;
        $data = json_decode($raw, true);
        if (empty($data)) return null;
        return ['lat' => (float)$data[0]['lat'], 'lng' => (float)$data[0]['lon'], 'display' => $data[0]['display_name']];
    };

    // Nominatim's structured-query parser can return zero results for an otherwise
    // valid place when a literal ", Philippines" suffix is combined with certain
    // multi-part inputs (observed failure: "Atlu-Bola, Mabalacat City, Philippines"
    // returns nothing, while the same text without the country suffix resolves
    // correctly — countrycodes=ph already scopes the search regionally, so the
    // suffix is redundant). Try progressively looser variants rather than giving up
    // after one shape, since a silent geocode failure means the planner has no
    // location to score routes against at all.
    $withSuffix = $placeName . ", Philippines";
    return $tryGeocode($withSuffix, true)
        ?? $tryGeocode($withSuffix, false)
        ?? $tryGeocode($placeName, true)
        ?? $tryGeocode($placeName, false);
}

// ── Resolve coords ────────────────────────────────────────────────────────────
if ($destLatIn !== null && $destLngIn !== null) {
    $destCoords = ['lat' => $destLatIn, 'lng' => $destLngIn, 'display' => $destination ?: 'Destination'];
} else {
    $destCoords = geocode($destination);
}

$origCoords = null;
if ($origLatIn !== null && $origLngIn !== null) {
    $origCoords = ['lat' => $origLatIn, 'lng' => $origLngIn, 'display' => $origin ?: 'Your location'];
} elseif ($origin !== '') {
    $origCoords = geocode($origin);
}

// ── Thresholds ────────────────────────────────────────────────────────────────
// DEST_THRESHOLD lowered from 1500m to 200m (2026-08-09, on request) — now
// that the multi-hop search above can actually chain further transfers to
// close a gap, a route only counts as "reaching the destination" if it gets
// within a genuine last-mile walk of it; past 200m the planner should keep
// looking for another jeepney instead of settling for "close enough, just
// walk the rest of the way." Before the multi-hop rewrite this was 1500m
// because there was no way to ask for anything better than "walk the last
// 1.5km" — that's no longer true.
$DEST_THRESHOLD     = 200;  // m — route must pass within 200m of destination
$ORIG_THRESHOLD     = 2500; // m — commuter must be within 2.5 km of route
$TRANSFER_THRESHOLD = 800;  // m — transfer connection distance

// A flat time cost standing in for the real wait/hassle of actually catching
// the next jeepney at a transfer (2026-08-08) — used by the multi-hop search
// below so a hop only ever gets chosen when it's a genuine net time win over
// staying on the current route, not just a marginally shorter ride. Matches
// the +5 min this file already added for a single transfer before this
// change; now applied per-hop for however many transfers a path actually has.
const TRANSFER_PENALTY_MINUTES = 5;

// Real commuters weigh a long walk as more costly than the same number of
// minutes spent riding — a 0.6km/~7-8 min walk to reach a route's own
// boarding point reads as "too far" even when it's technically not the
// slowest option on the clock (2026-08-09, on request). This multiplier
// inflates ONLY the walking component of a graph edge's weight for the
// PATHFINDING decision itself, so the search actively prefers a route that
// picks the commuter up closer by, even at the cost of a few extra minutes
// of total ride+transfer time. It never touches the numbers actually shown
// to the commuter (total_mins/walk_mins/effective_mins) — those are always
// recomputed honestly from the real distances after a path is chosen, see
// legsToOption() below.
const WALK_PENALTY_MULTIPLIER = 2.5;

// Best-effort "which side of the road should I stand on" boarding hint range.
// Too close to the route's line (already basically standing on/beside it) or
// too far (a genuinely separate walk, not a same-street crossing) both skip
// the hint rather than guess — see boardSideHint() below for the caveat this
// is built on (routes are one shared line per corridor, not separate
// geometry per direction, so this is a heading + right-hand-traffic
// approximation, not a guaranteed-precise lane detection).
const SIDE_HINT_MIN_M = 8;
const SIDE_HINT_MAX_M = 45;

// ── Load all active routes with inferred vehicle_type ─────────────────────────
// vehicle_type falls back to operator_type when the route field is NULL
$res = $conn->query("
    SELECT
        r.id,
        r.name,
        r.from_location,
        r.to_location,
        r.fare,
        COALESCE(
            r.vehicle_type,
            CASE COALESCE(o.operator_type, 'Jeepney Op')
                WHEN 'Jeepney Op'  THEN 'Jeepney'
                WHEN 'UV Express'  THEN 'UV Express'
                WHEN 'Bus'         THEN 'Bus'
                ELSE 'Jeepney'
            END
        ) AS vehicle_type,
        r.color,
        r.direction_type,
        r.waypoints,
        t.id        AS terminal_id,
        t.terminal_name,
        t.latitude  AS terminal_lat,
        t.longitude AS terminal_lng
    FROM routes r
    LEFT JOIN operators o  ON o.id = r.operator_id
    LEFT JOIN terminals t  ON t.id = r.terminal_id
    WHERE r.status = 'active'
      AND (r.operator_id IS NOT NULL OR r.association_id IS NOT NULL)
    ORDER BY r.id
");

$all = [];
while ($row = $res->fetch_assoc()) {
    $wps = [];
    if ($row['waypoints']) {
        $decoded = json_decode($row['waypoints'], true);
        if (is_array($decoded)) $wps = $decoded;
    }
    $row['_wps'] = $wps;
    $all[(int)$row['id']] = $row;
}

// ── Drop geometrically-duplicate route rows ────────────────────────────────────
// Two rows with the same start/end points are the same physical route saved twice
// (a route-builder mistake), not two options — left in, they waste result slots on
// literal duplicates. Keep whichever row has from_location/to_location populated;
// otherwise keep the lower id.
$seenSig = [];
foreach ($all as $id => $route) {
    $wps = $route['_wps'];
    if (count($wps) < 2) continue;
    $first = $wps[0];
    $last  = $wps[count($wps) - 1];
    $sig = round(wpLat($first), 4) . ',' . round(wpLng($first), 4) . '|' .
           round(wpLat($last), 4)  . ',' . round(wpLng($last), 4);
    if (isset($seenSig[$sig])) {
        $keepId       = $seenSig[$sig];
        $keepHasNames = !empty($all[$keepId]['from_location']) || !empty($all[$keepId]['to_location']);
        $thisHasNames = !empty($route['from_location'])        || !empty($route['to_location']);
        if ($thisHasNames && !$keepHasNames) {
            unset($all[$keepId]);
            $seenSig[$sig] = $id;
        } else {
            unset($all[$id]);
        }
        continue;
    }
    $seenSig[$sig] = $id;
}

// ── Score every route against destination (and origin if known) ───────────────
foreach ($all as $id => &$route) {
    $wps = $route['_wps'];
    if (count($wps) < 2) {
        $route['_destDist'] = PHP_INT_MAX;
        continue;
    }
    if ($destCoords) {
        [$dIdx, $dDist] = closestWaypoint($wps, $destCoords['lat'], $destCoords['lng']);
        $route['_destWpIdx'] = $dIdx;
        $route['_destDist']  = $dDist;
    } else {
        $route['_destDist'] = PHP_INT_MAX;
    }
    // Origin proximity is no longer pre-scored here — a route can be a loop that
    // passes the origin twice, so which pass is actually usable depends on
    // destWpIdx (computed just above) and is resolved per-option via
    // findBestBoardIdx() instead of a single cached closest point.
}
unset($route);

// ── Routes passing near destination ──────────────────────────────────────────
$nearDest = [];
foreach ($all as $id => $route) {
    if (($route['_destDist'] ?? PHP_INT_MAX) < $DEST_THRESHOLD) {
        $nearDest[$id] = $route;
    }
}

// A route that's actually usable as a "gets you near the destination" match,
// even when it isn't within the tight DEST_THRESHOLD used by the real
// multi-hop search — but a route many kilometers away is not a plausible
// match by any reasonable measure, text-named or "nearest available" alike.
// Shared by both fallbacks below (2026-09-24, fixing a reported bad-route bug
// — see the two comments at their use sites for exactly what each one fixes).
$PLAUSIBLE_MATCH_MAX_M = 5000; // m

// Text fallback: match name / from_location / to_location. This used to
// unconditionally force _destDist to 0 (and _destWpIdx to the route's very
// last waypoint) the instant any text matched, regardless of how far the
// route's REAL geometry actually was from the destination — a route named
// e.g. "Dau -> Angeles" whose waypoints stop 11km short of actual Angeles
// City would be treated as if it arrived exactly there. Two problems: (1) it
// fed a fabricated "already there" distance into the response for a route
// that doesn't really serve the area, and (2) simply adding the route to
// $nearDest (regardless of real distance) made the emptiness check below
// think a plausible match existed, silently skipping the nearest-route
// fallback even when a DIFFERENT, actually-closer route existed elsewhere.
// Now: keep the route's own already-computed real _destWpIdx/_destDist
// (set in the scoring loop above) and only treat the text match as
// confirmation once that real distance is at least plausible.
$destLower = strtolower($destination);
if ($destLower) {
    foreach ($all as $id => $route) {
        if (isset($nearDest[$id])) continue;
        $toLower   = strtolower($route['to_location']  ?? '');
        $nameLower = strtolower($route['name']          ?? '');
        $fromLower = strtolower($route['from_location'] ?? '');
        if (stripos($toLower, $destLower)   !== false ||
            stripos($nameLower, $destLower) !== false ||
            stripos($fromLower, $destLower) !== false) {
            if (($route['_destDist'] ?? PHP_INT_MAX) < $PLAUSIBLE_MATCH_MAX_M) {
                $nearDest[$id] = $route;
            }
        }
    }
}

// Nearest-route fallback: destination is not served by any registered route.
// Find the 1-2 closest routes so the commuter still gets useful suggestions
// (e.g. "ride this route and walk X m from the nearest stop") — but ONLY if
// even the closest route is still within a plausible distance. This
// previously had no cap at all: if nothing genuinely reaches the searched
// area, it would still return whichever route happened to be numerically
// least-far-away, however many kilometers off — which could surface a route
// that bypasses the searched area entirely (e.g. searching near Angeles City
// silently returning a Mabalacat<->San Fernando corridor route with no real
// connection to Angeles) instead of honestly reporting "nothing found here."
$nearestRouteFallback = false;
if (empty($nearDest)) {
    $candidates = [];
    foreach ($all as $id => $route) {
        if (count($route['_wps']) < 2) continue;
        $d = $route['_destDist'] ?? PHP_INT_MAX;
        if ($d < $PLAUSIBLE_MATCH_MAX_M) $candidates[$id] = $d;
    }
    asort($candidates);
    // Take up to 2 closest routes
    foreach (array_slice(array_keys($candidates), 0, 2, true) as $id) {
        $nearDest[$id] = $all[$id];
    }
    $nearestRouteFallback = !empty($nearDest);
}

// ── Segment builder ───────────────────────────────────────────────────────────
function buildSegment($route, $boardIdx, $alightIdx, $destName, $destDist) {
    $wps     = $route['_wps'];
    $hasWps  = count($wps) >= 2;
    $km      = $hasWps ? polylineKmBetween($wps, $boardIdx, $alightIdx) : null;
    $mins    = ($km !== null && $route['vehicle_type']) ? estMinutes($km, $route['vehicle_type']) : null;
    $lastIdx = count($wps) - 1;

    // Routes are one-way in the direction they were drawn (waypoint order = the
    // physical travel direction) — a road that carries jeeps both ways gets two
    // separately-drawn route rows, one per direction. board/alight normally follow
    // that forward order, but this labeling stays direction-agnostic defensively.
    $boardName  = ($boardIdx <= 2)
        ? ($route['from_location'] ?: 'Start of route')
        : (($boardIdx >= $lastIdx - 2) ? ($route['to_location'] ?: 'End of route') : 'Nearby stop');
    $alightName = ($alightIdx >= $lastIdx - 2)
        ? ($route['to_location'] ?: $destName)
        : (($alightIdx <= 2) ? ($route['from_location'] ?: $destName) : $destName);

    // Waypoint slice for mobile map rendering
    $wpSlice = [];
    if ($hasWps) {
        $start = min($boardIdx, $alightIdx);
        $end   = max($boardIdx, $alightIdx);
        for ($i = $start; $i <= $end; $i++) {
            $wp = $wps[$i];
            $lat = wpLat($wp);
            $lng = wpLng($wp);
            if ($lat !== 0.0 && $lng !== 0.0) {
                $wpSlice[] = ['latitude' => $lat, 'longitude' => $lng];
            }
        }
    }

    return [
        'route_id'     => (int)$route['id'],
        'route_name'   => $route['name']          ?? '',
        'from'         => $route['from_location']  ?? '',
        'to'           => $route['to_location']    ?? '',
        'board_at'     => $boardName,
        'alight_at'    => $alightName,
        'dist_to_dest' => (int)round($destDist),
        'fare'         => $route['fare'] !== null ? (float)$route['fare'] : null,
        'vehicle_type' => $route['vehicle_type']   ?? 'Jeepney',
        'color'        => $route['color']          ?? '#1a4a52',
        // Lets the map draw direction arrows both ways for a route that's
        // ridden both directions (a literal back-and-forth shuttle) instead
        // of only ever pointing board->alight.
        'direction_type' => $route['direction_type'] ?? 'one_way',
        'est_mins'     => $mins,
        'km'           => $km !== null ? round($km, 1) : null,
        'waypoints'    => $wpSlice,
        // Explicit board/alight coordinates (2026-08-10) — 'waypoints' above is
        // always stored low-index-to-high-index for map-drawing convenience,
        // regardless of which way this leg is actually ridden (a 'vice_versa'
        // route can be boarded at the higher index and alighted at the lower
        // one), so waypoints[0]/waypoints[last] is NOT a reliable way to find
        // "where does the commuter get off here" — these two fields are.
        'board_lat'  => $hasWps ? wpLat($wps[$boardIdx])  : null,
        'board_lng'  => $hasWps ? wpLng($wps[$boardIdx])  : null,
        'alight_lat' => $hasWps ? wpLat($wps[$alightIdx]) : null,
        'alight_lng' => $hasWps ? wpLng($wps[$alightIdx]) : null,
        // The route's origin terminal — lets the map highlight the exact pin this
        // segment departs from, rather than guessing from a text label. NOT the
        // same thing as this leg's actual alight point — see board_lat/alight_lat
        // above for that; terminal_lat/lng is only ever this route's own fixed
        // home terminal.
        'terminal_id'   => $route['terminal_id']   !== null ? (int)$route['terminal_id'] : null,
        'terminal_name' => $route['terminal_name']  ?? null,
        'terminal_lat'  => $route['terminal_lat']   !== null ? (float)$route['terminal_lat'] : null,
        'terminal_lng'  => $route['terminal_lng']   !== null ? (float)$route['terminal_lng'] : null,
    ];
}

// ── Multi-hop shortest-path search (2026-08-08) ────────────────────────────────
// Models every route's boarding/transfer/alighting points as nodes in a small
// weighted graph and finds the fastest ORIGIN->DESTINATION path via Dijkstra —
// any number of transfers, not capped at one. This is what lets the planner
// suggest getting off a route early to switch to a second (or third...) one
// when that's genuinely faster than riding the first route all the way to
// where it happens to pass near the destination, instead of only ever
// comparing "ride one route the whole way" against "one single transfer."
// TRANSFER_PENALTY_MINUTES keeps this from chaining a hop that only shaves off
// a trivial amount of ride time — a transfer only gets chosen when it's a
// real net win once the wait/hassle of catching the next jeepney is counted.

// Rough bounding box for a route's waypoints, padded by $paddingKm — lets the
// transfer-crossing scan below cheaply skip any pair of routes that can't
// possibly pass near each other, so this stays fast as the route count grows
// across Mabalacat/Angeles/San Fernando instead of just this dev seed data.
function routeBBox($wps, $paddingKm) {
    if (count($wps) === 0) return null;
    $minLat = $maxLat = wpLat($wps[0]);
    $minLng = $maxLng = wpLng($wps[0]);
    foreach ($wps as $wp) {
        $lat = wpLat($wp); $lng = wpLng($wp);
        if ($lat < $minLat) $minLat = $lat;
        if ($lat > $maxLat) $maxLat = $lat;
        if ($lng < $minLng) $minLng = $lng;
        if ($lng > $maxLng) $maxLng = $lng;
    }
    $padLat = $paddingKm / 111.0;
    $padLng = $paddingKm / (111.0 * max(0.1, cos(deg2rad(($minLat + $maxLat) / 2))));
    return [$minLat - $padLat, $maxLat + $padLat, $minLng - $padLng, $maxLng + $padLng];
}
function bboxOverlap($a, $b) {
    return $a[0] <= $b[1] && $b[0] <= $a[1] && $a[2] <= $b[3] && $b[2] <= $a[3];
}

// Best-effort "which side of the road should I stand on" hint for boarding a
// route at waypoint $idx, travelling in $forward direction (true = toward
// higher waypoint indices, false = toward lower — a 'vice_versa' route can be
// ridden either way, so this is resolved per-leg, not fixed per route). Uses
// the heading between the two waypoints either side of $idx plus the
// Philippines' right-hand-traffic convention (vehicles keep to the right of
// their own direction of travel).
//
// This is deliberately NOT a guaranteed-precise lane-level detection — this
// app's routes are stored as one shared waypoint line per corridor, not
// separate geometry per direction (confirmed against the live data: even the
// user-cited Xevera<->Astro corridor is a single 'vice_versa' row), so there's
// no per-lane geometry to compare against. Returns null (no confident hint)
// when the reference point is either basically on the line already or far
// enough away that this is a genuinely separate walk rather than a
// same-street crossing — see SIDE_HINT_MIN_M/SIDE_HINT_MAX_M above.
function boardSideHint($wps, $idx, $forward, $refLat, $refLng) {
    $n = count($wps);
    if ($n < 2 || $refLat === null || $refLng === null) return null;

    // The pair of consecutive waypoints actually ridden through $idx in the
    // direction of travel for this leg.
    if ($forward) {
        $aIdx = max(0, min($idx, $n - 2));
        $bIdx = $aIdx + 1;
    } else {
        $bIdx = max(1, min($idx, $n - 1));
        $aIdx = $bIdx - 1;
    }
    $aLat = wpLat($wps[$aIdx]); $aLng = wpLng($wps[$aIdx]);
    $bLat = wpLat($wps[$bIdx]); $bLng = wpLng($wps[$bIdx]);
    if (!$forward) { // travelled B->A even though the array stores A->B
        [$aLat, $bLat] = [$bLat, $aLat];
        [$aLng, $bLng] = [$bLng, $aLng];
    }

    $distM = ptSegDistKm($refLat, $refLng, $aLat, $aLng, $bLat, $bLng) * 1000;
    if ($distM < SIDE_HINT_MIN_M || $distM > SIDE_HINT_MAX_M) return null;

    // Local flat-earth projection (fine at street scale): longitude scaled by
    // cos(latitude) so both axes are comparable in the same "meters" unit —
    // same technique ptSegDistKm() itself already uses.
    $cosLat = cos(deg2rad(($aLat + $bLat) / 2));
    $hx = ($bLng - $aLng) * $cosLat; $hy = $bLat - $aLat;     // heading vector
    $vx = ($refLng - $aLng) * $cosLat; $vy = $refLat - $aLat; // ref-point vector
    $cross = $hx * $vy - $hy * $vx;
    if (abs($cross) < 1e-9) return null; // effectively on the line — no confident side

    // cross < 0 => ref point is to the RIGHT of the direction of travel — the
    // correct side under right-hand traffic (jeepneys keep right). cross > 0
    // => LEFT of travel direction — wrong side, needs to cross.
    return $cross < 0 ? 'correct' : 'cross';
}

// Every route this leg's boarding-to-alighting ride actually touches, keyed
// so a same-route continuation (see reconstructLegs()) never double-counts.
function pathRouteIds($path) {
    $ids = [];
    foreach ($path as $step) {
        if (isset($step['edge']['meta']['routeId'])) $ids[] = $step['edge']['meta']['routeId'];
    }
    return array_values(array_unique($ids));
}

// Walks a resolved O->D graph path (see runDijkstra() below) and collapses it
// into an ordered list of ride "legs" — one per distinct route actually
// boarded, each with its board/alight waypoint index and the walk distance
// immediately before/after it. Two consecutive ride edges on the SAME route
// (possible when Dijkstra passes through an intermediate point-of-interest
// node without transferring off) are merged into one leg rather than reported
// as a needless same-jeepney "transfer."
function reconstructLegs($path) {
    $legs = [];
    $pendingWalkM = 0.0;
    foreach ($path as $step) {
        $meta = $step['edge']['meta'];
        if (isset($meta['routeId'])) {
            [$rid, $fromIdx] = explode(':', $step['from']);
            [, $toIdx]       = explode(':', $step['to']);
            $rid = (int)$rid; $fromIdx = (int)$fromIdx; $toIdx = (int)$toIdx;
            $last = count($legs) - 1;
            if ($last >= 0 && $legs[$last]['routeId'] === $rid && $legs[$last]['alightIdx'] === $fromIdx) {
                $legs[$last]['alightIdx'] = $toIdx;
            } else {
                $legs[] = [
                    'routeId' => $rid, 'boardIdx' => $fromIdx, 'alightIdx' => $toIdx,
                    'walkBeforeM' => $pendingWalkM, 'walkAfterM' => 0.0,
                ];
            }
            $pendingWalkM = 0.0;
        } elseif ($step['to'] === 'D') {
            if (!empty($legs)) $legs[count($legs) - 1]['walkAfterM'] = $meta['walkM'] ?? 0.0;
        } elseif (isset($meta['transferWalkM'])) {
            if (!empty($legs)) $legs[count($legs) - 1]['walkAfterM'] = $meta['transferWalkM'];
        } elseif (isset($meta['walkM'])) {
            $pendingWalkM = $meta['walkM'];
        }
    }
    return $legs;
}

// Turns a reconstructed leg list into the same option shape the old
// direct/single-transfer code used to build directly, generalized to however
// many legs the path actually has.
function legsToOption($legs, $all, $destination, $origCoords) {
    if (empty($legs)) return null;
    $n = count($legs);
    $segments = [];
    $totalFare = 0.0; $anyFareNull = false;
    $totalKm   = 0.0; $anyKmNull   = false;
    $totalMins = 0;   $anyMinsNull = false;

    for ($i = 0; $i < $n; $i++) {
        $leg   = $legs[$i];
        $route = $all[$leg['routeId']];
        $isLast = ($i === $n - 1);
        $destName = $isLast
            ? $destination
            : (($all[$legs[$i + 1]['routeId']]['terminal_name'] ?? null)
                ?: ($all[$legs[$i + 1]['routeId']]['from_location'] ?? null)
                ?: 'Transfer point');

        $seg = buildSegment($route, $leg['boardIdx'], $leg['alightIdx'], $destName, $leg['walkAfterM']);

        // Side-of-road boarding hint — reference position is the commuter's
        // actual origin for the first leg, or wherever they just got off for
        // every later leg (the previous leg's own alight waypoint).
        if ($i === 0) {
            $refLat = $origCoords['lat'] ?? null;
            $refLng = $origCoords['lng'] ?? null;
        } else {
            $prevLeg   = $legs[$i - 1];
            $prevRoute = $all[$prevLeg['routeId']];
            $refLat = wpLat($prevRoute['_wps'][$prevLeg['alightIdx']]);
            $refLng = wpLng($prevRoute['_wps'][$prevLeg['alightIdx']]);
        }
        $forward = $leg['alightIdx'] >= $leg['boardIdx'];
        $hint = boardSideHint($route['_wps'], $leg['boardIdx'], $forward, $refLat, $refLng);
        $seg['board_side_hint'] = $hint;
        $seg['board_side_note'] = $hint === 'cross'
            ? 'You may need to cross to the other side of the road to board this jeepney here.'
            : null;

        $segments[] = $seg;

        if ($seg['fare']     === null) $anyFareNull = true; else $totalFare += $seg['fare'];
        if ($seg['km']       === null) $anyKmNull   = true; else $totalKm   += $seg['km'];
        if ($seg['est_mins'] === null) $anyMinsNull = true; else $totalMins += $seg['est_mins'];
    }

    $transferCount = $n - 1;
    if (!$anyMinsNull) $totalMins += $transferCount * TRANSFER_PENALTY_MINUTES;

    return [
        'type'                => $transferCount === 0 ? 'direct' : 'transfer',
        'transfers'           => $transferCount,
        'total_fare'          => $anyFareNull ? null : round($totalFare, 2),
        'total_mins'          => $anyMinsNull ? null : $totalMins,
        'total_km'            => $anyKmNull   ? null : round($totalKm, 1),
        // Kept for older clients — the first transfer's own location. Every
        // per-transfer divider should prefer each segment's own alight_at
        // instead (see the mobile client), since a 2+-transfer journey has
        // more than one transfer point and this field can only ever hold one.
        'transfer_point'      => $n > 1 ? ($segments[0]['alight_at'] ?? null) : null,
        'walk_to_dest_m'      => (int)round($legs[$n - 1]['walkAfterM']),
        'walk_from_origin_m'  => $legs[0]['walkBeforeM'] !== null ? (int)round($legs[0]['walkBeforeM']) : null,
        'segments'            => $segments,
    ];
}

// Single-source shortest path (Dijkstra, non-negative weights) from the
// virtual 'O' node to the virtual 'D' node. $excludeRouteIds lets the caller
// search again with a route removed, to surface a genuinely different
// alternative rather than a near-duplicate of the best path.
function runDijkstra($graph, $excludeRouteIds = []) {
    $dist = ['O' => 0.0];
    $prev = [];
    $visited = [];
    $pq = new SplPriorityQueue();
    $pq->insert('O', 0);
    while (!$pq->isEmpty()) {
        $u = $pq->extract();
        if (isset($visited[$u])) continue;
        $visited[$u] = true;
        if ($u === 'D') break;
        foreach (($graph[$u] ?? []) as $edge) {
            if (isset($edge['meta']['routeId']) && in_array($edge['meta']['routeId'], $excludeRouteIds, true)) continue;
            $alt = $dist[$u] + $edge['w'];
            if (!isset($dist[$edge['to']]) || $alt < $dist[$edge['to']] - 1e-9) {
                $dist[$edge['to']] = $alt;
                $prev[$edge['to']] = ['from' => $u, 'edge' => $edge];
                $pq->insert($edge['to'], -$alt); // max-heap, so negate for min-heap behavior
            }
        }
    }
    if (!isset($dist['D'])) return null;

    $path = [];
    $cur = 'D';
    while ($cur !== 'O') {
        $p = $prev[$cur];
        $path[] = ['from' => $p['from'], 'to' => $cur, 'edge' => $p['edge']];
        $cur = $p['from'];
    }
    return array_reverse($path);
}

function findMultiHopOptions($all, $origCoords, $destination, $ORIG_THRESHOLD, $DEST_THRESHOLD, $TRANSFER_THRESHOLD) {
    $routeIds = array_keys($all);

    // ── Points of interest per route: every waypoint index worth being a
    // graph node — this route's own destination-alight point (if any), and
    // every place it comes within transfer range of another route. ─────────
    $poi = [];
    $destPoi = [];
    foreach ($routeIds as $id) {
        $poi[$id] = [];
        $route = $all[$id];
        if (($route['_destDist'] ?? PHP_INT_MAX) < $DEST_THRESHOLD) {
            $destPoi[$id] = $route['_destWpIdx'];
            $poi[$id][$route['_destWpIdx']] = true;
        } else {
            $destPoi[$id] = null;
        }
    }

    $bboxes = [];
    foreach ($routeIds as $id) {
        $bboxes[$id] = routeBBox($all[$id]['_wps'], $TRANSFER_THRESHOLD / 1000.0);
    }

    // Full per-waypoint scan between any two routes, skipped entirely when
    // their (padded) bounding boxes can't possibly overlap.
    $crossings = [];
    for ($i = 0; $i < count($routeIds); $i++) {
        for ($j = $i + 1; $j < count($routeIds); $j++) {
            $idA = $routeIds[$i]; $idB = $routeIds[$j];
            $bboxA = $bboxes[$idA]; $bboxB = $bboxes[$idB];
            if (!$bboxA || !$bboxB || !bboxOverlap($bboxA, $bboxB)) continue;

            $wpsA = $all[$idA]['_wps']; $wpsB = $all[$idB]['_wps'];
            if (count($wpsA) < 2 || count($wpsB) < 2) continue;

            foreach ($wpsA as $ai => $wpA) {
                $aLat = wpLat($wpA); $aLng = wpLng($wpA);
                foreach ($wpsB as $bi => $wpB) {
                    $d = haversineKm($aLat, $aLng, wpLat($wpB), wpLng($wpB)) * 1000;
                    if ($d < $TRANSFER_THRESHOLD) {
                        $crossings[] = ['idA' => $idA, 'aIdx' => $ai, 'idB' => $idB, 'bIdx' => $bi, 'distM' => $d];
                    }
                }
            }
        }
    }
    // Thin out redundant near-duplicate crossings along a long shared
    // stretch — keep only the closest pair within each small index bucket
    // per route-pair, so two routes running side by side for a while don't
    // register dozens of nearly-identical transfer nodes.
    $bestByBucket = [];
    foreach ($crossings as $c) {
        $key = $c['idA'] . ':' . intdiv($c['aIdx'], 3) . ':' . $c['idB'] . ':' . intdiv($c['bIdx'], 3);
        if (!isset($bestByBucket[$key]) || $c['distM'] < $bestByBucket[$key]['distM']) {
            $bestByBucket[$key] = $c;
        }
    }
    $crossings = array_values($bestByBucket);
    foreach ($crossings as $c) {
        $poi[$c['idA']][$c['aIdx']] = true;
        $poi[$c['idB']][$c['bIdx']] = true;
    }

    // ── Build the graph ──────────────────────────────────────────────────────
    $graph = [];
    $addEdge = function ($from, $to, $w, $meta = []) use (&$graph) {
        $graph[$from][] = ['to' => $to, 'w' => $w, 'meta' => $meta];
    };
    $nodeKey = function ($routeId, $idx) { return $routeId . ':' . $idx; };

    // Origin -> board point, computed per (route, point-of-interest) pair —
    // a one-way route's valid boarding point depends on which point it's
    // ultimately headed toward (findBestBoardIdx()'s own loop-aware logic),
    // so this can't be precomputed once per route in isolation.
    foreach ($routeIds as $id) {
        $route = $all[$id];
        $wps = $route['_wps'];
        if (count($wps) < 2 || empty($poi[$id])) continue;
        if ($origCoords) {
            $isVV = ($route['direction_type'] ?? 'one_way') === 'vice_versa';
            foreach (array_keys($poi[$id]) as $targetIdx) {
                [$bIdx, $bDist] = findBestBoardIdx($wps, $origCoords['lat'], $origCoords['lng'], $targetIdx, $ORIG_THRESHOLD, $isVV);
                if ($bIdx === null) continue;
                $poi[$id][$bIdx] = true;
                $addEdge('O', $nodeKey($id, $bIdx), walkMinutesEstimate($bDist) * WALK_PENALTY_MULTIPLIER, ['walkM' => $bDist]);
            }
        } else {
            // No known origin at all (a destination-only lookup) — same
            // graceful fallback the old single-hop code used: board from
            // this route's own start, no walk distance to report.
            $poi[$id][0] = true;
            $addEdge('O', $nodeKey($id, 0), 0, ['walkM' => null]);
        }
    }

    // dest-alight -> Destination
    foreach ($routeIds as $id) {
        if ($destPoi[$id] === null) continue;
        $idx = $destPoi[$id];
        $route = $all[$id];
        $addEdge($nodeKey($id, $idx), 'D', walkMinutesEstimate($route['_destDist']) * WALK_PENALTY_MULTIPLIER, ['walkM' => $route['_destDist']]);
    }

    // Within-route ride edges between every pair of this route's own points
    // of interest, respecting direction — one_way only forward (waypoint
    // order = physical travel direction, this file's existing convention),
    // vice_versa either way since it's ridden both directions.
    foreach ($routeIds as $id) {
        $route = $all[$id];
        $wps = $route['_wps'];
        $idxs = array_keys($poi[$id]);
        if (count($idxs) < 2) continue;
        $isVV = ($route['direction_type'] ?? 'one_way') === 'vice_versa';
        sort($idxs);
        foreach ($idxs as $from) {
            foreach ($idxs as $to) {
                if ($from === $to) continue;
                if (!$isVV && $from > $to) continue;
                $km = polylineKmBetween($wps, $from, $to);
                $mins = estMinutes($km, $route['vehicle_type'] ?? 'Jeepney');
                $addEdge($nodeKey($id, $from), $nodeKey($id, $to), $mins, ['routeId' => $id, 'km' => $km]);
            }
        }
    }

    // Transfer edges at every detected crossing, both directions.
    foreach ($crossings as $c) {
        $w = TRANSFER_PENALTY_MINUTES + walkMinutesEstimate($c['distM']) * WALK_PENALTY_MULTIPLIER;
        $addEdge($nodeKey($c['idA'], $c['aIdx']), $nodeKey($c['idB'], $c['bIdx']), $w, ['transferWalkM' => $c['distM']]);
        $addEdge($nodeKey($c['idB'], $c['bIdx']), $nodeKey($c['idA'], $c['aIdx']), $w, ['transferWalkM' => $c['distM']]);
    }

    // ── Fastest path, plus a few alternates for variety ─────────────────────
    // A simplified stand-in for full k-shortest-paths: re-run Dijkstra once
    // per route actually used in the best path, each time with that one route
    // excluded, keeping whatever distinct alternative results. Good enough to
    // give the commuter a couple of real choices — not claimed to be
    // exhaustive.
    $found = [];
    $best = runDijkstra($graph);
    if ($best !== null) {
        $found[implode('-', pathRouteIds($best))] = $best;
        foreach (pathRouteIds($best) as $rid) {
            if (count($found) >= 4) break;
            $alt = runDijkstra($graph, [$rid]);
            if ($alt === null) continue;
            $sig = implode('-', pathRouteIds($alt));
            if (!isset($found[$sig])) $found[$sig] = $alt;
        }
    }

    $options = [];
    foreach ($found as $path) {
        $legs = reconstructLegs($path);
        $opt  = legsToOption($legs, $all, $destination, $origCoords);
        if ($opt !== null) $options[] = $opt;
    }
    return $options;
}

// ── Build journey options ─────────────────────────────────────────────────────
$options = [];

if ($nearestRouteFallback) {
    // Destination isn't served by any route at all — same simple fallback as
    // before: get as close as possible and note the walk. No transfer search
    // makes sense here since nothing actually reaches the destination.
    foreach ($nearDest as $id => $routeB) {
        $wpsB      = $routeB['_wps'];
        $destWpIdx = $routeB['_destWpIdx'] ?? (count($wpsB) - 1);
        $destDist  = $routeB['_destDist']  ?? 0;

        $isViceVersaB = ($routeB['direction_type'] ?? 'one_way') === 'vice_versa';
        [$origBoardIdx, $origBoardDist] = $origCoords
            ? findBestBoardIdx($wpsB, $origCoords['lat'], $origCoords['lng'], $destWpIdx, $ORIG_THRESHOLD, $isViceVersaB)
            : [null, null];
        $canBoardAtOrigin = $origBoardIdx !== null;
        $boardIdx  = $canBoardAtOrigin ? $origBoardIdx : 0;

        $walkFromOriginM = null;
        if ($canBoardAtOrigin) {
            $walkFromOriginM = $origBoardDist;
        } elseif ($origCoords && count($wpsB) > 0) {
            $walkFromOriginM = haversineKm(
                $origCoords['lat'], $origCoords['lng'],
                wpLat($wpsB[0]),    wpLng($wpsB[0])
            ) * 1000;
        }

        $seg = buildSegment($routeB, $boardIdx, $destWpIdx, $destination, $destDist);
        $options[] = [
            'type'               => 'nearest',
            'transfers'          => 0,
            'total_fare'         => $seg['fare'],
            'total_mins'         => $seg['est_mins'],
            'total_km'           => $seg['km'],
            'transfer_point'     => null,
            'walk_to_dest_m'     => (int)round($destDist),
            'walk_from_origin_m' => $walkFromOriginM !== null ? (int)round($walkFromOriginM) : null,
            'segments'           => [$seg],
        ];
    }
} else {
    // ── Multi-hop shortest-path search — see findMultiHopOptions() above ────
    $options = findMultiHopOptions(
        $all, $origCoords, $destination, $ORIG_THRESHOLD, $DEST_THRESHOLD, $TRANSFER_THRESHOLD
    );
}

// ── Deduplicate ───────────────────────────────────────────────────────────────
$seen   = [];
$unique = [];
foreach ($options as $opt) {
    $key = implode('-', array_column($opt['segments'], 'route_id'));
    if (!isset($seen[$key])) {
        $seen[$key] = true;
        $unique[]   = $opt;
    }
}
$options = $unique;

// ── Sort: fastest door-to-door first, short total walk as a close-call tiebreak,
// nearest-fallback last ──────────────────────────────────────────────────────
// A "direct" route can still land up to DEST_THRESHOLD (1.5km) from the destination,
// and the boarding point itself can be up to ORIG_THRESHOLD away — a route whose
// terminal happens to sit near both the origin AND the destination can otherwise
// produce a deceptive near-0km "ride" that's really just two walks bookending a
// pointless hop. Both walks (to board, and from alight to the destination) are
// combined into one total, folded into effective_mins, and used as a tiebreak.
//
// Total time is the primary ranking factor (2026-08-08, on request) — a single
// "direct" jeepney that loops far out of the way before reaching the destination
// used to be able to outrank a genuinely faster transfer purely because it
// required less transfer-walking, even when the transfer saved 15-20+ minutes.
// The existing ORIG/DEST/TRANSFER_THRESHOLD checks upstream already cap how much
// walking any surfaced option can involve at all, so demoting walk distance to a
// tiebreak (rather than a hard pre-filter) doesn't risk surfacing an option with
// an unreasonable amount of walking — it only stops a large walk-tier difference
// from overriding a large time difference.
const LONG_WALK_THRESHOLD_M = 500;
// Two options within this many minutes of each other are treated as "same
// speed" for ranking purposes, and the tiebreak (less walking, then cheaper
// fare) decides between them instead of the small time difference.
const EFFECTIVE_MINS_TIE_WINDOW = 5;

function walkMinutesEstimate($meters) {
    if ($meters === null || $meters <= 0) return 0;
    return (int) ceil(($meters / 1000) / 5 * 60); // ~5 km/h walking pace
}
function walkTier($meters) {
    return ($meters !== null && $meters > LONG_WALK_THRESHOLD_M) ? 1 : 0;
}
foreach ($options as &$opt) {
    $totalWalkM = (int)($opt['walk_to_dest_m'] ?? 0) + (int)($opt['walk_from_origin_m'] ?? 0);
    $opt['total_walk_m']   = $totalWalkM;
    $opt['walk_mins']      = walkMinutesEstimate($totalWalkM);
    $opt['effective_mins'] = ($opt['total_mins'] ?? 0) + $opt['walk_mins'];
    // Ranking-only, never shown to the commuter (stripped before the response
    // below) — the same walk-aversion weighting the multi-hop graph search
    // itself already applies (WALK_PENALTY_MULTIPLIER), so a path the search
    // preferred specifically for minimizing walking can't get silently
    // out-ranked here by a different option that's a hair faster on raw
    // minutes but involves noticeably more walking.
    $opt['walk_penalized_mins'] = ($opt['total_mins'] ?? 0) + $opt['walk_mins'] * WALK_PENALTY_MULTIPLIER;
}
unset($opt);

usort($options, function ($a, $b) {
    // 'nearest' is an explicit "nothing actually reaches the destination" fallback —
    // always rank it behind any real direct/transfer match regardless of time.
    $aNearest = $a['type'] === 'nearest' ? 1 : 0;
    $bNearest = $b['type'] === 'nearest' ? 1 : 0;
    if ($aNearest !== $bNearest) return $aNearest - $bNearest;

    $emA = $a['walk_penalized_mins'] ?? PHP_INT_MAX;
    $emB = $b['walk_penalized_mins'] ?? PHP_INT_MAX;

    // Only treat two options as a "tie" (walk distance, then fare, decides)
    // once they're within EFFECTIVE_MINS_TIE_WINDOW of each other. Outside
    // that window the option that's better once walking is weighted always
    // wins outright — this is what stops a looping "direct" ride from
    // beating a genuinely faster transfer, AND stops a marginally-faster
    // option that involves a long walk from beating one that picks the
    // commuter up closer by.
    if (abs($emA - $emB) > EFFECTIVE_MINS_TIE_WINDOW) return $emA - $emB;

    $wA = walkTier($a['total_walk_m'] ?? null);
    $wB = walkTier($b['total_walk_m'] ?? null);
    if ($wA !== $wB) return $wA - $wB;

    if ($emA !== $emB) return $emA - $emB;
    return ($a['total_fare'] ?? PHP_INT_MAX) <=> ($b['total_fare'] ?? PHP_INT_MAX);
});

// Ranking-only field, never meant to reach the client (it's an artificially
// inflated number, not a real time estimate) — strip it now that sorting is done.
foreach ($options as &$opt) { unset($opt['walk_penalized_mins']); }
unset($opt);

// Limit results, but leave enough real candidates that a client which filters/
// sorts this same list into categories (e.g. the mobile app's Fastest/Cheapest/
// Direct Only/All Options tabs) has honest material to work with — this was
// previously capped at just 3, which meant every category tab could only ever
// reorder or subset that same tiny, walk-penalized-ranked list; a genuinely
// faster/cheaper/more-direct option that didn't make that top-3 cut was
// silently discarded before the client ever received it, so e.g. "Cheapest"
// could show the same 3 options as "All", just resorted, never a cheaper one
// that actually existed further down the full list (2026-09-24, on request).
$RESULT_LIMIT = 8;
$top = array_slice($options, 0, $RESULT_LIMIT);
$topHasTransfer = false;
foreach ($top as $o) { if ($o['type'] === 'transfer') { $topHasTransfer = true; break; } }
if (!$topHasTransfer) {
    // Append, never evict — with only 3 slots this used to overwrite the
    // weakest of them to guarantee a transfer option was present, which could
    // throw away a genuinely good direct/cheapest/nearest option just to make
    // room. With more slots there's no need to sacrifice one for the other.
    foreach ($options as $o) {
        if ($o['type'] === 'transfer') {
            $top[] = $o;
            break;
        }
    }
}
$options = array_values($top);

// ── Annotate driver availability per option ───────────────────────────────────
$usedRouteIds = [];
foreach ($options as $opt) {
    foreach ($opt['segments'] as $seg) {
        $usedRouteIds[] = (int)$seg['route_id'];
    }
}
$usedRouteIds = array_values(array_unique($usedRouteIds));

$activeRouteIds = [];
if (!empty($usedRouteIds)) {
    $ph    = implode(',', array_fill(0, count($usedRouteIds), '?'));
    $types = str_repeat('i', count($usedRouteIds));
    $stmt  = $conn->prepare("
        SELECT DISTINCT ra.route_id
        FROM route_assignments ra
        JOIN vehicles v ON v.id = ra.vehicle_id
        JOIN drivers d  ON d.vehicle_id = v.id
        WHERE d.is_online = 1
          AND d.latitude IS NOT NULL
          AND d.longitude IS NOT NULL
          AND d.location_updated_at >= NOW() - INTERVAL 2 MINUTE
          AND ra.route_id IN ($ph)
    ");
    $stmt->bind_param($types, ...$usedRouteIds);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $activeRouteIds[] = (int)$row['route_id'];
    }
}

foreach ($options as &$opt) {
    $opt['has_active_drivers'] = false;
    foreach ($opt['segments'] as $seg) {
        if (in_array((int)$seg['route_id'], $activeRouteIds)) {
            $opt['has_active_drivers'] = true;
            break;
        }
    }
}
unset($opt);

echo json_encode([
    'success'               => true,
    'options'               => $options,
    'nearest_route_fallback'=> $nearestRouteFallback,
    'dest_display'          => $destCoords ? $destCoords['display'] : null,
    'orig_display'          => $origCoords ? $origCoords['display'] : null,
    'geocoded'              => $destCoords !== null,
]);
