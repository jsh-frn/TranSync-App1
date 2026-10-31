<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$trip_id = (int)($_GET['trip_id'] ?? 0);
if (!$trip_id) {
    echo json_encode(["success" => false, "message" => "trip_id is required."]);
    exit;
}

// Commuters can flag a missed booking as wanting a rebook (see Core Flow
// 9.4/9a) — this app has no notification system, so that request only ever
// surfaces here, on the manifest the operator already opens to handle
// no-shows. rebook_requested is true only while a request is still pending
// (never yet acted on) — it self-clears once operator_rebook.php actually
// rebooks it or an admin dismisses it.
$stmt = $conn->prepare("
    SELECT r.id, r.passenger_name, r.passenger_phone, r.passenger_age, r.fare_amount,
           r.discount_type, r.boarding_status, r.boarded_at, r.qr_code, r.created_at,
           (rr.id IS NOT NULL) AS rebook_requested
    FROM reservations r
    LEFT JOIN rebook_requests rr ON rr.reservation_id = r.id AND rr.status = 'pending'
    WHERE r.trip_id = ? AND r.status != 'cancelled'
    ORDER BY r.id ASC
");
$stmt->bind_param("i", $trip_id);
$stmt->execute();
$result = $stmt->get_result();

$bookings = [];
while ($row = $result->fetch_assoc()) {
    $bookings[] = [
        "id"               => (int)$row["id"],
        "passenger_name"   => $row["passenger_name"],
        "passenger_phone"  => $row["passenger_phone"],
        "passenger_age"    => $row["passenger_age"] !== null ? (int)$row["passenger_age"] : null,
        "fare_amount"      => (float)$row["fare_amount"],
        "discount_type"    => $row["discount_type"],
        "boarding_status"  => $row["boarding_status"],
        "boarded_at"       => $row["boarded_at"],
        "created_at"       => $row["created_at"],
        "rebook_requested" => (bool)$row["rebook_requested"],
    ];
}

echo json_encode(["success" => true, "bookings" => $bookings]);
