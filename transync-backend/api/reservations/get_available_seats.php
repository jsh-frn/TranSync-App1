<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Seat selection applies to Bus trips only — a Bus trip has a fixed vehicle_id
// at creation, but a UV slot deliberately doesn't (queue-based rollover: any
// currently-dispatched driver/vehicle can serve it, see project notes on UV
// slot rollover), so there's no fixed seat map to offer for UV bookings.
$trip_id = (int)($_GET["trip_id"] ?? 0);
if (!$trip_id) {
    echo json_encode(["success" => false, "message" => "trip_id is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT vehicle_id FROM trips WHERE id = ?");
$stmt->bind_param("i", $trip_id);
$stmt->execute();
$trip = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$trip) {
    echo json_encode(["success" => false, "message" => "Trip not found."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT seat_label, seat_row, seat_col, seat_type, is_blocked
    FROM seats WHERE vehicle_id = ?
    ORDER BY seat_row, seat_col
");
$stmt->bind_param("i", $trip["vehicle_id"]);
$stmt->execute();
$allSeats = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

if (!$allSeats) {
    echo json_encode(["success" => true, "seats" => [], "message" => "No seat map generated for this vehicle yet."]);
    exit;
}

// Seat availability is scoped per-trip (not globally per-vehicle) — the same
// physical bus runs many trips, each with its own passenger list.
$stmt = $conn->prepare("
    SELECT seat_labels FROM reservations
    WHERE trip_id = ? AND boarding_status != 'cancelled' AND seat_labels IS NOT NULL
");
$stmt->bind_param("i", $trip_id);
$stmt->execute();
$taken = array_column($stmt->get_result()->fetch_all(MYSQLI_ASSOC), "seat_labels");
$stmt->close();
$takenSet = array_flip($taken);

// `state` drives the commuter UI's 5-color scheme directly so it doesn't
// have to re-derive the same precedence logic client-side: driver/conductor
// seats are never bookable regardless of anything else, "blank" marks the
// aisle path itself (never bookable, never colored like a real seat), an
// operator-blocked seat ("Reserved/Saved", yellow) is never selectable even
// if unbooked, and only otherwise-plain seats can be booked/available.
$seats = array_map(function ($s) use ($takenSet) {
    $isBlocked = (bool)$s["is_blocked"];
    $isBooked  = isset($takenSet[$s["seat_label"]]);
    $state = in_array($s["seat_type"], ["driver", "conductor", "blank"], true) ? $s["seat_type"]
        : ($isBooked ? "booked" : ($isBlocked ? "blocked" : "available"));
    return [
        "seat_label" => $s["seat_label"],
        "seat_row"   => (int)$s["seat_row"],
        "seat_col"   => (int)$s["seat_col"],
        "seat_type"  => $s["seat_type"],
        "is_blocked" => $isBlocked,
        "state"      => $state,
        "available"  => $state === "available",
    ];
}, $allSeats);

echo json_encode(["success" => true, "seats" => $seats]);
