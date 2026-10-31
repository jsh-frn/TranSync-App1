<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Snapshots a vehicle's current seat layout into a new named Seat Layout
// Library template. Purely additive — never touches the source vehicle.
$body       = json_decode(file_get_contents("php://input"), true);
$vehicle_id = (int)($body["vehicle_id"] ?? 0);
$name       = trim($body["name"] ?? "");

if (!$vehicle_id || $name === "") {
    echo json_encode(["success" => false, "message" => "vehicle_id and name are required."]);
    exit;
}

$stmt = $conn->prepare("SELECT operator_id, service_type_id, type FROM vehicles WHERE id = ?");
$stmt->bind_param("i", $vehicle_id);
$stmt->execute();
$vehicle = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$vehicle || $vehicle["type"] !== "Bus") {
    echo json_encode(["success" => false, "message" => "Vehicle not found or not a Bus."]);
    exit;
}
if (!$vehicle["service_type_id"]) {
    echo json_encode(["success" => false, "message" => "This vehicle has no class assigned yet."]);
    exit;
}

$stmt = $conn->prepare("SELECT seat_label, seat_row, seat_col, seat_type FROM seats WHERE vehicle_id = ? ORDER BY seat_row, seat_col");
$stmt->bind_param("i", $vehicle_id);
$stmt->execute();
$seats = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

if (empty($seats)) {
    echo json_encode(["success" => false, "message" => "This vehicle has no seat layout to save yet."]);
    exit;
}

$conn->begin_transaction();
try {
    $capacity    = count(array_filter($seats, fn($s) => !in_array($s["seat_type"], ["driver", "conductor", "blank"], true)));
    $layoutStyle = in_array("sleeper", array_column($seats, "seat_type"), true) ? "sleeper" : "seater";
    $operatorId  = (int)$vehicle["operator_id"];
    $serviceTypeId = (int)$vehicle["service_type_id"];

    $stmt = $conn->prepare("
        INSERT INTO bus_layout_templates (operator_id, service_type_id, name, capacity, layout_style)
        VALUES (?, ?, ?, ?, ?)
    ");
    $stmt->bind_param("iisis", $operatorId, $serviceTypeId, $name, $capacity, $layoutStyle);
    $stmt->execute();
    $template_id = $conn->insert_id;
    $stmt->close();

    $stmt = $conn->prepare("
        INSERT INTO bus_layout_template_seats (template_id, seat_label, seat_row, seat_col, seat_type)
        VALUES (?, ?, ?, ?, ?)
    ");
    foreach ($seats as $s) {
        $label = $s["seat_label"]; $row = (int)$s["seat_row"]; $col = (int)$s["seat_col"]; $type = $s["seat_type"];
        $stmt->bind_param("isiis", $template_id, $label, $row, $col, $type);
        $stmt->execute();
    }
    $stmt->close();

    $conn->commit();
    echo json_encode(["success" => true, "template_id" => $template_id]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to save template."]);
}
