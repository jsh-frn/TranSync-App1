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

$data             = json_decode(file_get_contents("php://input"), true);
$application_id   = (int)($data["application_id"]   ?? 0);
$association_id   = (int)($data["association_id"]   ?? 0);
$action           = trim($data["action"]            ?? "");   // "approve" | "reject"
$rejection_reason = trim($data["rejection_reason"]  ?? "");

// ── VALIDATION ───────────────────────────────────────────────────────────────
if (!$application_id || !$association_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "application_id and association_id are required."]);
    exit;
}

if (!in_array($action, ["approve", "reject"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "action must be 'approve' or 'reject'."]);
    exit;
}

if ($action === "reject" && !$rejection_reason) {
    http_response_code(422);
    echo json_encode(["success" => false, "message" => "A rejection reason is required."]);
    exit;
}

// ── FETCH APPLICATION ────────────────────────────────────────────────────────
// Verify it belongs to this association and is still pending.
$stmt = $conn->prepare("
    SELECT * FROM association_applications
    WHERE id = ? AND association_id = ?
");
$stmt->bind_param("ii", $application_id, $association_id);
$stmt->execute();
$app = $stmt->get_result()->fetch_assoc();

if (!$app) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Application not found."]);
    exit;
}

if ($app["status"] !== "pending") {
    http_response_code(409);
    echo json_encode([
        "success" => false,
        "message" => "This application has already been " . $app["status"] . ".",
    ]);
    exit;
}

$subject_type = $app["subject_type"];   // 'driver' | 'vehicle'
$subject_id   = (int)$app["subject_id"];
$operator_id  = (int)$app["operator_id"];
$now          = date("Y-m-d H:i:s");

// ── BEGIN TRANSACTION ────────────────────────────────────────────────────────
$conn->begin_transaction();

try {

    if ($action === "approve") {

        // 1. Check the subject isn't already an active member of another association.
        $stmt = $conn->prepare("
            SELECT id FROM association_memberships
            WHERE subject_type = ? AND subject_id = ? AND status = 'active'
        ");
        $stmt->bind_param("si", $subject_type, $subject_id);
        $stmt->execute();
        if ($stmt->get_result()->fetch_assoc()) {
            $conn->rollback();
            http_response_code(409);
            echo json_encode([
                "success" => false,
                "message" => "This " . $subject_type . " already belongs to another association.",
            ]);
            exit;
        }

        // 2. Update application status → approved.
        $stmt = $conn->prepare("
            UPDATE association_applications
            SET status = 'approved', reviewed_by = ?, reviewed_at = ?
            WHERE id = ?
        ");
        $stmt->bind_param("isi", $association_id, $now, $application_id);
        $stmt->execute();

        // 3. Insert membership record.
        $stmt = $conn->prepare("
            INSERT INTO association_memberships
                (application_id, operator_id, association_id, subject_type, subject_id, approved_at, status)
            VALUES (?, ?, ?, ?, ?, ?, 'active')
        ");
        $stmt->bind_param("iiisss", $application_id, $operator_id, $association_id, $subject_type, $subject_id, $now);
        $stmt->execute();

        // 4. Denormalize: write association_id onto the driver or vehicle row
        //    so other queries don't need a JOIN to know membership.
        if ($subject_type === "driver") {
            $stmt = $conn->prepare("UPDATE drivers  SET association_id = ? WHERE id = ?");
        } else {
            $stmt = $conn->prepare("UPDATE vehicles SET association_id = ? WHERE id = ?");
        }
        $stmt->bind_param("ii", $association_id, $subject_id);
        $stmt->execute();

        // 5. Auto-reject any other PENDING applications for the same subject
        //    to a different association (a subject can only be in one).
        $stmt = $conn->prepare("
            UPDATE association_applications
            SET
                status           = 'rejected',
                rejection_reason = 'Automatically rejected: already approved by another association.',
                reviewed_at      = ?
            WHERE subject_type    = ?
              AND subject_id      = ?
              AND status          = 'pending'
              AND association_id != ?
        ");
        $stmt->bind_param("ssii", $now, $subject_type, $subject_id, $association_id);
        $stmt->execute();

        // 6. If a preferred route was requested and subject is a driver, auto-assign now.
        if ($subject_type === "driver" && !empty($app["preferred_route_id"])) {
            $pref_route = (int)$app["preferred_route_id"];
            $stmt = $conn->prepare("DELETE FROM route_assignments WHERE driver_id = ?");
            $stmt->bind_param("i", $subject_id);
            $stmt->execute();
            $stmt = $conn->prepare("INSERT INTO route_assignments (route_id, driver_id) VALUES (?, ?)");
            $stmt->bind_param("ii", $pref_route, $subject_id);
            $stmt->execute();
        }

        $conn->commit();
        echo json_encode([
            "success" => true,
            "message" => ucfirst($subject_type) . " approved and added to your association.",
        ]);

    } else {
        // ── REJECT ──────────────────────────────────────────────────────────

        $stmt = $conn->prepare("
            UPDATE association_applications
            SET
                status           = 'rejected',
                rejection_reason = ?,
                reviewed_by      = ?,
                reviewed_at      = ?
            WHERE id = ?
        ");
        $stmt->bind_param("siis", $rejection_reason, $association_id, $now, $application_id);
        $stmt->execute();

        $conn->commit();
        echo json_encode([
            "success" => true,
            "message" => "Application rejected.",
        ]);
    }

} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "message" => "Something went wrong. Please try again.",
        "error"   => $e->getMessage(),
    ]);
}