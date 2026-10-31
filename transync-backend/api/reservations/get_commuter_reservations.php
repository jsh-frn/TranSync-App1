<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/sweep.php";
require_once __DIR__ . "/../routes/geo_helpers.php";

$commuter_id = (int)($_GET['commuter_id'] ?? 0);
if (!$commuter_id) {
    echo json_encode(["success" => false, "message" => "commuter_id is required."]);
    exit;
}

// Opportunistic sweep (no cron in this app — see config/sweep.php's own
// header comment): a commuter opening Upcoming Bookings or Booking History
// is a chance to resolve any reservation that's already past its QR grace
// period but never got flipped by a status poll. Without this, a booking
// whose driver never got scanned could sit in "Upcoming" forever past its
// own departure time instead of moving to "Booking History" as expired/no_show.
sweepDepartedReservations($conn);

// scope=upcoming (default) is the original behavior, unchanged — active
// bookings only, soonest departure first. scope=all is the Booking History
// feed (also what Recent Activity derives from client-side): every booking
// regardless of status, newest-created first, capped at 100 (this app has
// no pagination anywhere yet — matches that existing convention rather than
// introducing a one-off exception).
$scope = ($_GET['scope'] ?? 'upcoming') === 'all' ? 'all' : 'upcoming';

if ($scope === 'all') {
    $where = "WHERE r.commuter_id = ? AND r.vehicle_category IN ('UV Express', 'Bus')";
    $order = "ORDER BY r.created_at DESC";
    $limit = "LIMIT 100";
} else {
    $where = "WHERE r.commuter_id = ?
      AND r.status = 'confirmed'
      AND r.vehicle_category IN ('UV Express', 'Bus')
      AND r.boarding_status = 'reserved'";
    // A scanned ('boarded') ticket has been used — it must leave Upcoming the
    // moment the driver scans it (it still appears in scope=all / History).
    $order = "ORDER BY r.departure_time ASC";
    $limit = "LIMIT 20";
}

// Bus vehicle/driver is fixed per trip, so it's knowable ahead of boarding —
// LEFT JOIN through trips. UV Express is pooled/queue-based (no fixed
// vehicle_id/driver_id, Core Flow 8b/12) — whichever driver ends up
// dispatched at boarding time scans it, so there is no vehicle to show for
// a UV booking ahead of time; the mobile client must render "Assigned at
// boarding", not fabricate a plate.
$stmt = $conn->prepare("
    SELECT
        r.id,
        r.trip_id,
        r.uv_session_id,
        r.uv_slot_id,
        r.route_id,
        r.origin_terminal,
        r.destination_terminal,
        r.departure_time,
        r.fare_amount,
        r.base_fare_amount,
        r.discount_type,
        r.passenger_name,
        r.passenger_phone,
        r.passenger_age,
        r.passengers_count,
        r.vehicle_category,
        r.status,
        r.boarding_status,
        r.payment_status,
        r.cancellation_type,
        r.refund_amount,
        r.refund_pct,
        r.seat_labels,
        r.queue_number,
        r.qr_code,
        r.created_at,
        r.resolved_at,
        r.boarded_at,
        r.rebooked_from_reservation_id,
        r.rebooked_to_reservation_id,
        r.rebooking_fee_amount,
        ro.name       AS route_name,
        ro.color      AS route_color,
        ro.waypoints,
        bv.plate_number AS vehicle_plate,
        bv.type          AS vehicle_type,
        bv.operator_id   AS trip_operator_id,
        bd.name          AS driver_name,
        rr.status        AS rebook_request_status,
        rr.rejection_reason AS rebook_rejection_reason,
        bt.status        AS trip_status,
        us.status        AS uv_slot_status,
        us.operator_id   AS uv_slot_operator_id
    FROM reservations r
    LEFT JOIN routes ro ON ro.id = r.route_id
    LEFT JOIN trips bt ON bt.id = r.trip_id
    LEFT JOIN vehicles bv ON bv.id = bt.vehicle_id
    LEFT JOIN drivers bd ON bd.id = bt.driver_id
    LEFT JOIN rebook_requests rr ON rr.id = (
        SELECT id FROM rebook_requests WHERE reservation_id = r.id ORDER BY requested_at DESC LIMIT 1
    )
    LEFT JOIN uv_slots us ON us.id = r.uv_slot_id
    $where
    $order
    $limit
");
$stmt->bind_param("i", $commuter_id);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

$bookings = array_map(function ($row) {
    // Rough estimate only — same Haversine-over-waypoints ÷ flat-speed
    // method as get_upcoming_trips.php/get_available_slots.php (Do Not
    // Break rule #71) — never a fabricated exact ETA.
    $distanceKm = fullRouteKm($row["waypoints"] ?? null);
    $durationMin = $distanceKm > 0 ? estMinutes($distanceKm, $row["vehicle_category"]) : null;

    return [
        "id"                   => (int)$row["id"],
        "trip_id"              => $row["trip_id"] !== null ? (int)$row["trip_id"] : null,
        "uv_session_id"        => $row["uv_session_id"] !== null ? (int)$row["uv_session_id"] : null,
        "uv_slot_id"           => $row["uv_slot_id"] !== null ? (int)$row["uv_slot_id"] : null,
        "route_id"             => $row["route_id"] ? (int)$row["route_id"] : null,
        "origin_terminal"      => $row["origin_terminal"],
        "destination_terminal" => $row["destination_terminal"],
        "departure_time"       => $row["departure_time"],
        "fare_amount"          => (float)$row["fare_amount"],
        "base_fare_amount"     => $row["base_fare_amount"] !== null ? (float)$row["base_fare_amount"] : null,
        "discount_type"        => $row["discount_type"],
        "passenger_name"       => $row["passenger_name"],
        "passenger_phone"      => $row["passenger_phone"],
        "passenger_age"        => $row["passenger_age"] !== null ? (int)$row["passenger_age"] : null,
        "passengers_count"     => (int)$row["passengers_count"],
        "vehicle_category"     => $row["vehicle_category"],
        "vehicle_plate"        => $row["vehicle_plate"],
        "vehicle_type"         => $row["vehicle_type"],
        "driver_name"          => $row["driver_name"],
        "status"               => $row["status"],
        "boarding_status"      => $row["boarding_status"],
        "payment_status"       => $row["payment_status"],
        "cancellation_type"    => $row["cancellation_type"],
        "refund_amount"        => $row["refund_amount"] !== null ? (float)$row["refund_amount"] : null,
        "refund_pct"           => $row["refund_pct"] !== null ? (float)$row["refund_pct"] : null,
        "seat_labels"          => $row["seat_labels"],
        "queue_number"         => $row["queue_number"] !== null ? (int)$row["queue_number"] : null,
        "seats_ahead"          => ($row["queue_number"] !== null && $row["boarding_status"] === "reserved")
                                   ? max(0, (int)$row["queue_number"] - 1) : null,
        "qr_code"              => $row["qr_code"],
        "created_at"           => $row["created_at"],
        "resolved_at"          => $row["resolved_at"],
        "route_name"           => $row["route_name"] ?? null,
        "route_color"          => $row["route_color"] ?? "#1a4a52",
        "estimated_duration_minutes" => $durationMin,
        "rebook_request_status" => $row["rebook_request_status"],
        "rebook_rejection_reason" => $row["rebook_rejection_reason"],
        "rebooked_from_reservation_id" => $row["rebooked_from_reservation_id"] !== null ? (int)$row["rebooked_from_reservation_id"] : null,
        "rebooked_to_reservation_id"   => $row["rebooked_to_reservation_id"] !== null ? (int)$row["rebooked_to_reservation_id"] : null,
        "rebooking_fee_amount" => $row["rebooking_fee_amount"] !== null ? (float)$row["rebooking_fee_amount"] : null,
        // The trip's/slot's own lifecycle status (scheduled|boarding|departed|
        // completed|cancelled) — lets the client show a "Boarding" state on a
        // still-`reserved` booking once the vehicle itself has started
        // boarding, without waiting for this passenger's own QR to be scanned.
        // A Jeepney booking never reaches this endpoint (vehicle_category
        // filter above), so exactly one of the two joins ever matches.
        "vehicle_status" => $row["trip_status"] ?? $row["uv_slot_status"] ?? null,
        // The operator that owns this booking's trip/slot — used by the
        // rebooking "Select New Trip" flow to scope its picker to the same
        // operator's own fleet (never a cross-operator marketplace). Null
        // only for a pooled route-level UV slot with no single operator.
        "rebooking_operator_id" => $row["trip_operator_id"] !== null
            ? (int)$row["trip_operator_id"]
            : ($row["uv_slot_operator_id"] !== null ? (int)$row["uv_slot_operator_id"] : null),
    ];
}, $rows);

echo json_encode(["success" => true, "bookings" => $bookings]);
