<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Applying a template creates an INDEPENDENT COPY — fresh rows in `seats`,
// no FK back to bus_layout_template_seats. Editing this vehicle's layout
// afterward never touches the template or any other vehicle that applied it.
$body        = json_decode(file_get_contents("php://input"), true);
$vehicle_id  = (int)($body["vehicle_id"] ?? 0);
$template_id = (int)($body["template_id"] ?? 0);

if (!$vehicle_id || !$template_id) {
    echo json_encode(["success" => false, "message" => "vehicle_id and template_id are required."]);
    exit;
}

$stmt = $conn->prepare("SELECT type FROM vehicles WHERE id = ?");
$stmt->bind_param("i", $vehicle_id);
$stmt->execute();
$vehicle = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$vehicle || $vehicle["type"] !== "Bus") {
    echo json_encode(["success" => false, "message" => "Vehicle not found or not a Bus."]);
    exit;
}

$stmt = $conn->prepare("SELECT id FROM bus_layout_templates WHERE id = ?");
$stmt->bind_param("i", $template_id);
$stmt->execute();
$template = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$template) {
    echo json_encode(["success" => false, "message" => "Template not found."]);
    exit;
}

$stmt = $conn->prepare("SELECT seat_label, seat_row, seat_col, seat_type FROM bus_layout_template_seats WHERE template_id = ?");
$stmt->bind_param("i", $template_id);
$stmt->execute();
$templateSeats = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

if (empty($templateSeats)) {
    echo json_encode(["success" => false, "message" => "This template has no seats."]);
    exit;
}
$templateLabels = array_flip(array_column($templateSeats, "seat_label"));

// Same "can't destroy a booked seat" guard as save_seat_layout.php — only
// relevant when re-templating a vehicle that already has active bookings.
$stmt = $conn->prepare("
    SELECT s.seat_label
    FROM seats s
    WHERE s.vehicle_id = ? AND EXISTS(
        SELECT 1 FROM reservations r
        JOIN trips t ON t.id = r.trip_id
        WHERE t.vehicle_id = s.vehicle_id AND r.seat_labels = s.seat_label
          AND r.boarding_status IN ('reserved','boarded')
    )
");
$stmt->bind_param("i", $vehicle_id);
$stmt->execute();
$bookedLabels = array_column($stmt->get_result()->fetch_all(MYSQLI_ASSOC), "seat_label");
$stmt->close();

$lockedRemovals = array_values(array_filter($bookedLabels, fn($l) => !isset($templateLabels[$l])));
if (!empty($lockedRemovals)) {
    echo json_encode([
        "success"      => false,
        "message"      => "These seats have active bookings and would be removed by this template: " . implode(", ", $lockedRemovals),
        "locked_seats" => $lockedRemovals,
    ]);
    exit;
}

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("DELETE FROM seats WHERE vehicle_id = ?");
    $stmt->bind_param("i", $vehicle_id);
    $stmt->execute();
    $stmt->close();

    $stmt = $conn->prepare("
        INSERT INTO seats (vehicle_id, seat_label, seat_row, seat_col, seat_type)
        VALUES (?, ?, ?, ?, ?)
    ");
    foreach ($templateSeats as $s) {
        $label = $s["seat_label"]; $row = (int)$s["seat_row"]; $col = (int)$s["seat_col"]; $type = $s["seat_type"];
        $stmt->bind_param("isiis", $vehicle_id, $label, $row, $col, $type);
        $stmt->execute();
    }
    $stmt->close();

    $capacity = count(array_filter($templateSeats, fn($s) => !in_array($s["seat_type"], ["driver", "conductor", "blank"], true)));
    $stmt = $conn->prepare("UPDATE vehicles SET capacity = ? WHERE id = ?");
    $stmt->bind_param("ii", $capacity, $vehicle_id);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
    echo json_encode(["success" => true, "seat_count" => count($templateSeats)]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to apply template."]);
}
