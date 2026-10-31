<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";

$body        = json_decode(file_get_contents("php://input"), true);
$vehicle_id  = (int)($body["vehicle_id"] ?? 0);
$capacity    = isset($body["capacity"]) && $body["capacity"] !== "" ? (int)$body["capacity"] : null;
$layout_style = trim($body["layout_style"] ?? "");

if (!$vehicle_id) {
    echo json_encode(["success" => false, "message" => "vehicle_id is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT type, operator_id, service_type_id FROM vehicles WHERE id = ?");
$stmt->bind_param("i", $vehicle_id);
$stmt->execute();
$vehicle = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$vehicle) {
    echo json_encode(["success" => false, "message" => "Vehicle not found."]);
    exit;
}
if ($vehicle["type"] !== "Bus") {
    echo json_encode(["success" => false, "message" => "Seat maps are only generated for Bus vehicles."]);
    exit;
}
if (!$vehicle["service_type_id"]) {
    echo json_encode(["success" => false, "message" => "This vehicle has no class/service type assigned yet."]);
    exit;
}
if (!$capacity || $capacity < 1) {
    echo json_encode(["success" => false, "message" => "capacity is required."]);
    exit;
}

$operator_id     = (int)$vehicle["operator_id"];
$service_type_id = (int)$vehicle["service_type_id"];

// A layout (seater vs sleeper) only needs to be chosen once per operator +
// class + seat count — reuse it silently for every later vehicle that
// matches the same (operator, class, capacity) combination.
$stmt = $conn->prepare("
    SELECT layout_style FROM bus_layout_templates
    WHERE operator_id = ? AND service_type_id = ? AND capacity = ?
");
$stmt->bind_param("iii", $operator_id, $service_type_id, $capacity);
$stmt->execute();
$template = $stmt->get_result()->fetch_assoc();
$stmt->close();

$reused_template = false;
if ($template) {
    $layout_style    = $template["layout_style"];
    $reused_template = true;
} else {
    if (!in_array($layout_style, ["seater", "sleeper"], true)) {
        echo json_encode([
            "success"          => false,
            "message"          => "No layout exists yet for this class at this seat count — choose Seater or Sleeper.",
            "needs_layout_style" => true,
        ]);
        exit;
    }
}

$conn->begin_transaction();
try {
    if (!$reused_template) {
        $stmt = $conn->prepare("
            INSERT INTO bus_layout_templates (operator_id, service_type_id, capacity, layout_style)
            VALUES (?, ?, ?, ?)
        ");
        $stmt->bind_param("iiis", $operator_id, $service_type_id, $capacity, $layout_style);
        $stmt->execute();
        $stmt->close();
    }

    // Keep vehicles.capacity in sync — this is the one place Bus capacity gets set.
    $stmt = $conn->prepare("UPDATE vehicles SET capacity = ? WHERE id = ?");
    $stmt->bind_param("ii", $capacity, $vehicle_id);
    $stmt->execute();
    $stmt->close();

    // Re-seeding replaces the map (e.g. after a capacity/layout change) — safe
    // since seat availability is derived live from active reservations, not a
    // stored flag on this table.
    $stmt = $conn->prepare("DELETE FROM seats WHERE vehicle_id = ?");
    $stmt->bind_param("i", $vehicle_id);
    $stmt->execute();
    $stmt->close();

    $stmt = $conn->prepare("
        INSERT INTO seats (vehicle_id, seat_label, seat_row, seat_col, seat_type)
        VALUES (?, ?, ?, ?, ?)
    ");
    $letters = range("A", "Z");

    // Seater: standard 2+2 (4 per row), window/aisle. Sleeper: 2 per row
    // (single berths either side of the aisle), both always "sleeper" type.
    $seats_per_row = $layout_style === "sleeper" ? 2 : 4;

    $seated = 0;
    $row    = 1;
    while ($seated < $capacity) {
        for ($col = 1; $col <= $seats_per_row && $seated < $capacity; $col++, $seated++) {
            $label = $row . $letters[$col - 1];
            $type  = $layout_style === "sleeper" ? "sleeper" : (($col === 1 || $col === $seats_per_row) ? "window" : "aisle");
            $stmt->bind_param("isiis", $vehicle_id, $label, $row, $col, $type);
            $stmt->execute();
        }
        $row++;
    }
    $stmt->close();

    $conn->commit();
    echo json_encode([
        "success"          => true,
        "seats_created"    => $capacity,
        "layout_style"     => $layout_style,
        "reused_template"  => $reused_template,
    ]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to generate seat map."]);
}
