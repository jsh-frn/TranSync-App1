<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/rebook_eligibility.php";

// Operator's half of the new 2-step rebooking flow — this endpoint ONLY
// grants or denies permission. No reservation is created and no money moves
// here; the commuter picks their own new trip and pays the 10% fee
// afterward via complete_rebook.php, once approved. This replaces the old
// operator_rebook.php's "operator executes everything atomically" model.
$data             = json_decode(file_get_contents("php://input"), true);
$operator_id      = (int)($data["operator_id"]      ?? 0);
$reservation_id   = (int)($data["reservation_id"]   ?? 0);
$action           = trim($data["action"]            ?? "");
$rejection_reason = trim($data["rejection_reason"]  ?? "");

if (!$operator_id || !$reservation_id || !in_array($action, ["approve", "reject"])) {
    echo json_encode(["success" => false, "message" => "Invalid request."]);
    exit;
}
if ($action === "reject" && $rejection_reason === "") {
    echo json_encode(["success" => false, "message" => "Rejection reason is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT id, trip_id, uv_slot_id, boarding_status, departure_time, resolved_at FROM reservations WHERE id = ?");
$stmt->bind_param("i", $reservation_id);
$stmt->execute();
$res = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$res) {
    echo json_encode(["success" => false, "message" => "Booking not found."]);
    exit;
}

// Fleet ownership check — same trip->vehicle->operator / uv_slot->operator
// join used everywhere else this app authorizes an operator against a
// specific booking (e.g. the old operator_rebook.php).
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

expireStaleRebookRequests($conn);

$stmt = $conn->prepare("SELECT id FROM rebook_requests WHERE reservation_id = ? AND status = 'pending'");
$stmt->bind_param("i", $reservation_id);
$stmt->execute();
$request = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$request) {
    echo json_encode(["success" => false, "message" => "There's no pending rebook request for this booking."]);
    exit;
}

$conn->begin_transaction();
try {
    if ($action === "approve") {
        $stmt = $conn->prepare("
            UPDATE rebook_requests
            SET status = 'approved', reviewed_by_operator_id = ?, reviewed_at = NOW()
            WHERE reservation_id = ? AND status = 'pending'
        ");
        $stmt->bind_param("ii", $operator_id, $reservation_id);
    } else {
        $stmt = $conn->prepare("
            UPDATE rebook_requests
            SET status = 'rejected', reviewed_by_operator_id = ?, reviewed_at = NOW(), rejection_reason = ?
            WHERE reservation_id = ? AND status = 'pending'
        ");
        $stmt->bind_param("isi", $operator_id, $rejection_reason, $reservation_id);
    }
    $stmt->execute();
    $updated = $stmt->affected_rows > 0;
    $stmt->close();

    if (!$updated) {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "This request was already reviewed."]);
        exit;
    }

    $conn->commit();
    echo json_encode(["success" => true]);
} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to review rebook request."]);
}
