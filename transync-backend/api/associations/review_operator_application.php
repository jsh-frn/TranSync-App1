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

$data             = json_decode(file_get_contents("php://input"), true);
$application_id   = (int)($data["application_id"]   ?? 0);
$association_id   = (int)($data["association_id"]   ?? 0);
$action           = trim($data["action"]             ?? "");
$rejection_reason = trim($data["rejection_reason"]   ?? "");

if (!$application_id || !$association_id || !in_array($action, ["approve", "reject"])) {
    echo json_encode(["success" => false, "message" => "Invalid request."]);
    exit;
}
if ($action === "reject" && $rejection_reason === "") {
    echo json_encode(["success" => false, "message" => "Rejection reason is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, operator_id, association_id, vehicle_type, status
    FROM operator_association_applications
    WHERE id = ? AND association_id = ?
");
$stmt->bind_param("ii", $application_id, $association_id);
$stmt->execute();
$app = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$app) {
    echo json_encode(["success" => false, "message" => "Application not found."]);
    exit;
}
if ($app["status"] !== "pending") {
    echo json_encode(["success" => false, "message" => "This application has already been reviewed."]);
    exit;
}

$conn->begin_transaction();
try {
    if ($action === "approve") {
        // Membership is per-vehicle-type now — an operator can simultaneously
        // hold other approved (or pending) vehicle-type memberships elsewhere,
        // so there's no "already belongs to an association" 1:1 block anymore.
        // Admin verification of the operator's ACCOUNT still gates approval,
        // regardless of which vehicle type is being applied for.
        $stmt = $conn->prepare("SELECT is_verified FROM operators WHERE id = ?");
        $stmt->bind_param("i", $app["operator_id"]);
        $stmt->execute();
        $operator = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if ((int)($operator["is_verified"] ?? 0) !== 1) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This operator hasn't been verified by the admin yet — approval isn't available until then."]);
            exit;
        }

        // No auto-reject of other pending applications for the same vehicle
        // type: an operator can hold the same vehicle type approved at
        // several associations simultaneously now, so a pending UV Express
        // application at Association B is untouched by approving UV Express
        // at Association A — they're fully independent memberships. (The
        // apply-time dedup check in apply_to_association.php already
        // prevents two pending/approved rows for the exact same
        // (vehicle_type, association_id) pair, so there's nothing left to
        // reconcile here.)
        $stmt = $conn->prepare("UPDATE operator_association_applications SET status = 'approved', reviewed_at = NOW() WHERE id = ?");
        $stmt->bind_param("i", $application_id);
        $stmt->execute();
        $stmt->close();
    } else {
        $stmt = $conn->prepare("
            UPDATE operator_association_applications
            SET status = 'rejected', rejection_reason = ?, reviewed_at = NOW()
            WHERE id = ?
        ");
        $stmt->bind_param("si", $rejection_reason, $application_id);
        $stmt->execute();
        $stmt->close();
    }

    $conn->commit();
    echo json_encode(["success" => true]);
} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to review application."]);
}
