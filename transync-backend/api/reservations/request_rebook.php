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
require_once __DIR__ . "/../../config/rebook_eligibility.php";

// Commuter-initiated — this app has no notification system, so a request
// can't be "delivered" anywhere except a visible flag on the operator's own
// trip/slot manifest (the same screen that already has the "Approve"/"Reject"
// actions, see operator_review_rebook.php) — the operator sees it the next
// time they naturally open that manifest. This never rebooks anything
// itself: an approval only grants permission, and only
// reservations/complete_rebook.php (commuter-triggered, after approval)
// actually creates the new reservation. This endpoint just raises a flag.
//
// Eligibility is no longer no_show-only (see config/rebook_eligibility.php):
// a commuter can request proactively while still 'reserved' (any time
// before departure, no cutoff), or reactively within
// NO_SHOW_REBOOK_REQUEST_GRACE_HOURS of becoming 'no_show'.
$body           = json_decode(file_get_contents("php://input"), true);
$commuter_id    = (int)($body["commuter_id"] ?? 0);
$reservation_id = (int)($body["reservation_id"] ?? 0);

if (!$commuter_id || !$reservation_id) {
    echo json_encode(["success" => false, "message" => "commuter_id and reservation_id are required."]);
    exit;
}

$stmt = $conn->prepare("SELECT id, commuter_id, boarding_status, departure_time, resolved_at FROM reservations WHERE id = ?");
$stmt->bind_param("i", $reservation_id);
$stmt->execute();
$res = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$res) {
    echo json_encode(["success" => false, "message" => "Booking not found."]);
    exit;
}
if ((int)$res["commuter_id"] !== $commuter_id) {
    echo json_encode(["success" => false, "message" => "This booking doesn't belong to you."]);
    exit;
}

expireStaleRebookRequests($conn);

if (!isRebookEligible($conn, $res)) {
    echo json_encode([
        "success" => false,
        "message" => $res["boarding_status"] === "no_show"
            ? "The window to request a rebook on this missed trip has passed."
            : "This booking isn't eligible for a rebook request.",
    ]);
    exit;
}

$stmt = $conn->prepare("SELECT id FROM rebook_requests WHERE reservation_id = ? AND status = 'pending'");
$stmt->bind_param("i", $reservation_id);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "A rebook request for this booking is already pending."]);
    exit;
}
$stmt->close();

$stmt = $conn->prepare("INSERT INTO rebook_requests (reservation_id, commuter_id, status) VALUES (?, ?, 'pending')");
$stmt->bind_param("ii", $reservation_id, $commuter_id);
$stmt->execute();
$request_id = $conn->insert_id;
$stmt->close();

echo json_encode(["success" => true, "request_id" => $request_id]);
