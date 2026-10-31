<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";

$data               = json_decode(file_get_contents("php://input"), true);
$operator_id        = (int)($data["operator_id"]        ?? 0);
$association_id     = (int)($data["association_id"]     ?? 0);
$subject_type       = trim($data["subject_type"]        ?? ""); // 'driver' | 'vehicle'
$subject_id         = (int)($data["subject_id"]         ?? 0);
$preferred_route_id = (int)($data["preferred_route_id"] ?? 0);

// ── VALIDATION ────────────────────────────────────────────────────────────────
if (!$operator_id || !$association_id || !$subject_type || !$subject_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "All fields are required."]);
    exit;
}

if (!in_array($subject_type, ["driver", "vehicle"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "subject_type must be 'driver' or 'vehicle'."]);
    exit;
}

// ── CHECK: subject belongs to this operator ───────────────────────────────────
$table = $subject_type === "driver" ? "drivers" : "vehicles";
$stmt  = $conn->prepare("SELECT id FROM `$table` WHERE id = ? AND operator_id = ?");
$stmt->bind_param("ii", $subject_id, $operator_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    http_response_code(403);
    echo json_encode(["success" => false, "message" => "This " . $subject_type . " does not belong to your account."]);
    exit;
}

// ── CHECK: association exists, is active, and type matches operator ───────────
$stmt = $conn->prepare("SELECT id, association_type FROM associations WHERE id = ? AND status = 'active'");
$stmt->bind_param("i", $association_id);
$stmt->execute();
$assoc = $stmt->get_result()->fetch_assoc();
if (!$assoc) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Association not found or not active."]);
    exit;
}

$stmt = $conn->prepare("SELECT operator_type FROM operators WHERE id = ?");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$operator = $stmt->get_result()->fetch_assoc();
if (!$operator) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Operator not found."]);
    exit;
}

if ($assoc["association_type"] !== $operator["operator_type"]) {
    http_response_code(422);
    echo json_encode([
        "success" => false,
        "message" => "This association only accepts " . $assoc["association_type"] . " operators.",
    ]);
    exit;
}

// ── CHECK: preferred route belongs to this association (if provided) ──────────
if ($preferred_route_id) {
    $stmt = $conn->prepare("SELECT id FROM routes WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $preferred_route_id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Selected route does not belong to this association."]);
        exit;
    }
}

// ── CHECK: already an active membership somewhere ─────────────────────────────
$stmt = $conn->prepare("
    SELECT id FROM association_memberships
    WHERE subject_type = ? AND subject_id = ? AND status = 'active'
");
$stmt->bind_param("si", $subject_type, $subject_id);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    http_response_code(409);
    echo json_encode([
        "success" => false,
        "message" => ucfirst($subject_type) . " already belongs to an association. Revoke the current membership first.",
    ]);
    exit;
}

// ── CHECK: pending application to THIS association already exists ─────────────
// Only block on 'pending'. An 'approved' record is historical (driver may have
// left the association), so re-application must be allowed.
$stmt = $conn->prepare("
    SELECT id FROM association_applications
    WHERE subject_type   = ?
      AND subject_id     = ?
      AND association_id = ?
      AND status         = 'pending'
");
$stmt->bind_param("sii", $subject_type, $subject_id, $association_id);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    http_response_code(409);
    echo json_encode([
        "success" => false,
        "message" => "A pending application to this association already exists.",
    ]);
    exit;
}

// ── INSERT APPLICATION ────────────────────────────────────────────────────────
$stmt = $conn->prepare("
    INSERT INTO association_applications
        (operator_id, association_id, subject_type, subject_id, preferred_route_id, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
");
$route_id_param = $preferred_route_id ?: null;
$stmt->bind_param("iisii", $operator_id, $association_id, $subject_type, $subject_id, $route_id_param);

if ($stmt->execute()) {
    echo json_encode([
        "success" => true,
        "message" => "Application submitted. Waiting for association approval.",
        "application_id" => $conn->insert_id,
    ]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to submit application: " . $conn->error]);
}