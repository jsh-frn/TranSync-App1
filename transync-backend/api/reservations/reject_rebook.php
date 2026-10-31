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

// DEPRECATED — superseded by operator_review_rebook.php (action='reject'),
// which also handles the no-longer-no_show-only eligibility model and
// records reviewed_by_operator_id/rejection_reason. Left functional (not
// deleted) for any historical/direct caller, per this codebase's
// deprecate-in-place convention — no current mobile screen calls this.
//
// Operator-initiated counterpart to the old request_rebook.php flow —
// declines a pending rebook request without touching the underlying
// reservation at all. This app has no notification system, so like the
// request itself, the outcome only ever surfaces as a status read back by
// the commuter's own Booking Details screen (rebook_request_status).
$body           = json_decode(file_get_contents("php://input"), true);
$operator_id    = (int)($body["operator_id"] ?? 0);
$reservation_id = (int)($body["reservation_id"] ?? 0);

if (!$operator_id || !$reservation_id) {
    echo json_encode(["success" => false, "message" => "operator_id and reservation_id are required."]);
    exit;
}

$stmt = $conn->prepare("SELECT id, trip_id, uv_slot_id, boarding_status FROM reservations WHERE id = ?");
$stmt->bind_param("i", $reservation_id);
$stmt->execute();
$res = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$res) {
    echo json_encode(["success" => false, "message" => "Booking not found."]);
    exit;
}
if ($res["boarding_status"] !== "no_show") {
    echo json_encode(["success" => false, "message" => "Only a missed (no-show) booking's rebook request can be reviewed."]);
    exit;
}

// Verify the booking actually belongs to this operator's fleet — same check
// operator_rebook.php uses before it will act on a booking.
if ($res["trip_id"]) {
    $stmt = $conn->prepare("SELECT v.operator_id FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = ?");
    $stmt->bind_param("i", $res["trip_id"]);
} else {
    $stmt = $conn->prepare("SELECT operator_id FROM uv_slots WHERE id = ?");
    $stmt->bind_param("i", $res["uv_slot_id"]);
}
$stmt->execute();
$ownerRow = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$ownerRow || (int)$ownerRow["operator_id"] !== $operator_id) {
    echo json_encode(["success" => false, "message" => "This booking doesn't belong to your fleet."]);
    exit;
}

$stmt = $conn->prepare("
    UPDATE rebook_requests SET status = 'rejected', resolved_at = NOW()
    WHERE reservation_id = ? AND status = 'pending'
");
$stmt->bind_param("i", $reservation_id);
$stmt->execute();
$updated = $stmt->affected_rows > 0;
$stmt->close();

if (!$updated) {
    echo json_encode(["success" => false, "message" => "No pending rebook request found for this booking."]);
    exit;
}

echo json_encode(["success" => true]);
