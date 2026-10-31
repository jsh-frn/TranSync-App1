<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Cross-trip view of every pending rebook_requests row for this operator's
// own fleet — powers the Operator Dashboard -> Trips "Rebooking Requests"
// section, so the operator doesn't have to open each trip's manifest one at
// a time to notice a request. get_trip_bookings.php/get_slot_bookings.php's
// own inline per-row badge is unaffected/unchanged — this is an additional,
// aggregated read of the same rebook_requests table.
//
// Ownership resolution mirrors operator_rebook.php's own check exactly: a
// Bus reservation's trip -> vehicle -> operator_id, or a UV reservation's
// slot -> operator_id directly. A pooled UV slot (operator_id IS NULL, see
// Core Flow 8b) has no single owning operator and so can never match here —
// the same pre-existing limitation operator_rebook.php itself already has;
// not something new introduced by this endpoint.
$operator_id = (int)($_GET['operator_id'] ?? 0);
if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT rr.reservation_id, rr.requested_at,
           r.passenger_name, r.passenger_phone, r.fare_amount, r.departure_time,
           r.trip_id, r.uv_slot_id, r.vehicle_category,
           ro.id AS route_id, ro.name AS route_name, ro.from_location, ro.to_location
    FROM rebook_requests rr
    JOIN reservations r ON r.id = rr.reservation_id
    LEFT JOIN trips t   ON t.id = r.trip_id
    LEFT JOIN vehicles v ON v.id = t.vehicle_id
    LEFT JOIN uv_slots us ON us.id = r.uv_slot_id
    LEFT JOIN routes ro ON ro.id = r.route_id
    WHERE rr.status = 'pending'
      AND (
        (r.trip_id IS NOT NULL AND v.operator_id = ?)
        OR (r.uv_slot_id IS NOT NULL AND us.operator_id = ?)
      )
    ORDER BY rr.requested_at ASC
");
$stmt->bind_param("ii", $operator_id, $operator_id);
$stmt->execute();
$result = $stmt->get_result();

$requests = [];
while ($row = $result->fetch_assoc()) {
    $requests[] = [
        "reservation_id"  => (int)$row["reservation_id"],
        "requested_at"    => $row["requested_at"],
        "passenger_name"  => $row["passenger_name"],
        "passenger_phone" => $row["passenger_phone"],
        "fare_amount"     => (float)$row["fare_amount"],
        "departure_time"  => $row["departure_time"],
        "trip_id"         => $row["trip_id"] !== null ? (int)$row["trip_id"] : null,
        "uv_slot_id"      => $row["uv_slot_id"] !== null ? (int)$row["uv_slot_id"] : null,
        "vehicle_category"=> $row["vehicle_category"],
        "route_id"        => $row["route_id"] !== null ? (int)$row["route_id"] : null,
        "route_name"      => $row["route_name"],
        "from_location"   => $row["from_location"],
        "to_location"     => $row["to_location"],
    ];
}

echo json_encode(["success" => true, "requests" => $requests]);
