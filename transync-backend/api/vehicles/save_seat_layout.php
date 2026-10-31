<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Full-layout save from the Seat Layout Builder — the client sends the
// complete intended seat list; this diffs it against what's stored today.
// Editing a layout must never affect existing bookings (a seat keeps its
// identity by label, not position), and a seat with an active booking can
// never be removed — see Do Not Break notes on the Seat Layout Builder.
$body       = json_decode(file_get_contents("php://input"), true);
$vehicle_id = (int)($body["vehicle_id"] ?? 0);
$seats      = $body["seats"] ?? null;

if (!$vehicle_id || !is_array($seats)) {
    echo json_encode(["success" => false, "message" => "vehicle_id and seats[] are required."]);
    exit;
}

$stmt = $conn->prepare("SELECT type FROM vehicles WHERE id = ?");
$stmt->bind_param("i", $vehicle_id);
$stmt->execute();
$vehicle = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$vehicle) {
    echo json_encode(["success" => false, "message" => "Vehicle not found."]);
    exit;
}
if ($vehicle["type"] !== "Bus") {
    echo json_encode(["success" => false, "message" => "Seat layouts only apply to Bus vehicles."]);
    exit;
}

$validTypes = ["window", "aisle", "sleeper", "driver", "conductor", "blank"];
$submittedLabels = [];
foreach ($seats as $s) {
    $label = trim($s["seat_label"] ?? "");
    if ($label === "" || !isset($s["seat_row"], $s["seat_col"]) || !in_array($s["seat_type"] ?? "", $validTypes, true)) {
        echo json_encode(["success" => false, "message" => "Each seat needs a label, row, col, and a valid type."]);
        exit;
    }
    $submittedLabels[$label] = true;
}

// Seats with an active booking anywhere on this vehicle can never be removed.
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

$lockedRemovals = array_values(array_filter($bookedLabels, fn($l) => !isset($submittedLabels[$l])));
if (!empty($lockedRemovals)) {
    echo json_encode([
        "success"      => false,
        "message"      => "These seats have active bookings and can't be removed: " . implode(", ", $lockedRemovals),
        "locked_seats" => $lockedRemovals,
    ]);
    exit;
}

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("SELECT seat_label FROM seats WHERE vehicle_id = ?");
    $stmt->bind_param("i", $vehicle_id);
    $stmt->execute();
    $existingLabels = array_column($stmt->get_result()->fetch_all(MYSQLI_ASSOC), "seat_label");
    $stmt->close();

    $toRemove = array_values(array_diff($existingLabels, array_keys($submittedLabels)));
    if (!empty($toRemove)) {
        $placeholders = implode(",", array_fill(0, count($toRemove), "?"));
        $types = str_repeat("s", count($toRemove));
        $stmt = $conn->prepare("DELETE FROM seats WHERE vehicle_id = ? AND seat_label IN ($placeholders)");
        $stmt->bind_param("i" . $types, $vehicle_id, ...$toRemove);
        $stmt->execute();
        $stmt->close();
    }

    $stmt = $conn->prepare("
        INSERT INTO seats (vehicle_id, seat_label, seat_row, seat_col, seat_type, is_blocked)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE seat_row = VALUES(seat_row), seat_col = VALUES(seat_col),
            seat_type = VALUES(seat_type), is_blocked = VALUES(is_blocked)
    ");
    foreach ($seats as $s) {
        $label      = trim($s["seat_label"]);
        $row        = (int)$s["seat_row"];
        $col        = (int)$s["seat_col"];
        $type       = $s["seat_type"];
        $is_blocked = !empty($s["is_blocked"]) ? 1 : 0;
        $stmt->bind_param("isiisi", $vehicle_id, $label, $row, $col, $type, $is_blocked);
        $stmt->execute();
    }
    $stmt->close();

    // An empty layout (operator explicitly clearing it, e.g. to unblock a
    // class change) resets to "not yet configured" (NULL), not 0 — matches
    // the same not-yet-built state a freshly registered vehicle starts in.
    $stmt = $conn->prepare("
        UPDATE vehicles SET capacity = NULLIF((
            SELECT COUNT(*) FROM seats WHERE vehicle_id = ? AND seat_type NOT IN ('driver','conductor','blank')
        ), 0) WHERE id = ?
    ");
    $stmt->bind_param("ii", $vehicle_id, $vehicle_id);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
    echo json_encode(["success" => true, "seat_count" => count($seats)]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to save seat layout."]);
}
