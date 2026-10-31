<?php
// ── Always output JSON, even for fatal errors ─────────────────────────────────
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Catch PHP errors and return them as JSON so the frontend sees a real message
// instead of a blank response or an HTML error page.
set_error_handler(function($errno, $errstr) {
    http_response_code(500);
    echo json_encode(["error" => true, "message" => "PHP error: $errstr"]);
    exit;
});

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";
require_once "../../config/auth.php";

requireAuth($conn, ['admin']);

// Verify db connection
if (!$conn || $conn->connect_error) {
    http_response_code(500);
    echo json_encode(["error" => true, "message" => "Database connection failed: " . ($conn->connect_error ?? "unknown")]);
    exit;
}

$base_url = BACKEND_PUBLIC_URL;

// ── POST: approve or reject ───────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data   = json_decode(file_get_contents("php://input"), true);
    $id     = (int)($data['id']     ?? 0);
    $type   = trim($data['type']   ?? "");
    $action = trim($data['action'] ?? "");
    $reason = trim($data['reason'] ?? "");

    if (!$id || !$type || !$action) {
        http_response_code(400);
        echo json_encode(["message" => "Missing required fields."]);
        exit;
    }

    if (!in_array($action, ['approve', 'reject'])) {
        http_response_code(400);
        echo json_encode(["message" => "Invalid action. Must be 'approve' or 'reject'."]);
        exit;
    }

    // A rejection must always carry a real, admin-facing basis for the
    // decision (commuter/operator only — see the rejection_reason migration
    // note; associations aren't in scope for this).
    if ($action === 'reject' && in_array($type, ['commuter', 'operator']) && $reason === '') {
        http_response_code(400);
        echo json_encode(["message" => "A rejection reason is required."]);
        exit;
    }

    // ── Association ───────────────────────────────────────────────────────────
    if ($type === 'association') {
        if ($action === 'approve') {
            $stmt = $conn->prepare("UPDATE associations SET status = 'active' WHERE id = ?");
            $stmt->bind_param("i", $id);
            $stmt->execute();
            echo json_encode(["message" => "Association approved. They can now log in."]);
        } else {
            $stmt = $conn->prepare("UPDATE associations SET status = 'inactive' WHERE id = ?");
            $stmt->bind_param("i", $id);
            $stmt->execute();
            echo json_encode(["message" => "Association rejected."]);
        }
        exit;
    }

    // ── Commuter / Operator ───────────────────────────────────────────────────
    if (!in_array($type, ['commuter', 'operator'])) {
        http_response_code(400);
        echo json_encode(["message" => "Invalid type."]);
        exit;
    }

    $table = $type === 'commuter' ? 'commuters' : 'operators';

    if ($action === 'approve') {
        // Clears any prior rejection_reason too — a resubmitted, now-approved
        // applicant shouldn't carry a stale rejection basis on their record.
        if ($type === 'commuter') {
            // A pending Student/PWD/Senior submission keeps commuters.category
            // at 'default' the whole time it's under review (see
            // commuter_register_student.php et al. and commuter_switch_category.php
            // — "instant Regular access, upgrade once approved") — the real
            // claimed category lives on the most recent commuter_id_verifications
            // row instead. Promote it now, on approval.
            $claim = $conn->prepare("
                SELECT id, category FROM commuter_id_verifications
                WHERE commuter_id = ? AND verification_status = 'pending_review'
                ORDER BY id DESC LIMIT 1
            ");
            $claim->bind_param("i", $id);
            $claim->execute();
            $claimRow = $claim->get_result()->fetch_assoc();

            if ($claimRow) {
                $claimedCategory = $claimRow['category'];
                $stmt = $conn->prepare("UPDATE commuters SET category = ?, is_verified = 1, status = 'active', rejected_at = NULL, rejection_reason = NULL WHERE id = ?");
                $stmt->bind_param("si", $claimedCategory, $id);
                $stmt->execute();

                $promote = $conn->prepare("UPDATE commuter_id_verifications SET verification_status = 'verified', verified_at = NOW() WHERE id = ?");
                $promote->bind_param("i", $claimRow['id']);
                $promote->execute();
            } else {
                // No pending_review verification row — either a plain default
                // account, or a legacy/direct-upload row (predating this
                // pipeline) where commuters.category already holds the claimed
                // target from registration time. Nothing to promote from.
                $stmt = $conn->prepare("UPDATE commuters SET is_verified = 1, status = 'active', rejected_at = NULL, rejection_reason = NULL WHERE id = ?");
                $stmt->bind_param("i", $id);
                $stmt->execute();
            }
            echo json_encode(["message" => "Commuter approved successfully."]);
            exit;
        }

        $stmt = $conn->prepare("UPDATE `$table` SET is_verified = 1, status = 'active', rejected_at = NULL, rejection_reason = NULL WHERE id = ?");
        $stmt->bind_param("i", $id);
        $stmt->execute();
        echo json_encode(["message" => ucfirst($type) . " approved successfully."]);
    } else {
        $stmt = $conn->prepare("UPDATE `$table` SET is_verified = 0, status = 'inactive', rejected_at = NOW(), rejection_reason = ? WHERE id = ?");
        $stmt->bind_param("si", $reason, $id);
        $stmt->execute();
        echo json_encode(["message" => ucfirst($type) . " rejected."]);
    }
    exit;
}

// ── GET: fetch pending verifications ─────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

$type = trim($_GET['type'] ?? 'commuter');

// ── Association pending ───────────────────────────────────────────────────────
if ($type === 'association') {
    $result = $conn->query("
        SELECT
            id,
            name,
            contact_email  AS email,
            contact_phone  AS phone,
            address,
            document_url,
            rep_government_id_url,
            supporting_document_url,
            coverage_area,
            estimated_fleet_size,
            status,
            DATE_FORMAT(created_at, '%b %d, %Y') AS date_added
        FROM associations
        WHERE status = 'pending'
        ORDER BY created_at DESC
    ");

    if (!$result) {
        http_response_code(500);
        echo json_encode(["error" => true, "message" => "Query failed: " . $conn->error]);
        exit;
    }

    $list = [];
    while ($row = $result->fetch_assoc()) {
        // rep_government_id_url was previously collected at registration but
        // never actually surfaced to admin anywhere (write-only) — fixed
        // alongside adding supporting_document_url (Board Resolution) here,
        // since both are reviewed on the same admin screen.
        if ($row['document_url']) {
            $row['document_url'] = $base_url . $row['document_url'];
        }
        if ($row['rep_government_id_url']) {
            $row['rep_government_id_url'] = $base_url . $row['rep_government_id_url'];
        }
        if ($row['supporting_document_url']) {
            $row['supporting_document_url'] = $base_url . $row['supporting_document_url'];
        }
        $list[] = $row;
    }
    echo json_encode($list);
    exit;
}

// ── Commuter pending ──────────────────────────────────────────────────────────
// Only show commuters who:
//   1. Have not been verified yet (is_verified = 0)
//   2. Have not been rejected (rejected_at IS NULL)
//   3. Have a non-default category that requires a discount ID
//      OR have already uploaded a document (covers edge cases)
if ($type === 'commuter') {
    // LEFT JOINs the commuter's own most-recent commuter_id_verifications
    // row (Student/PWD/Senior auto-verification pipelines — see
    // commuter_register_student.php / commuter_switch_category.php) so the
    // admin can cross-examine every document the applicant actually
    // submitted (ID front/back, Enrollment Form) plus everything they typed
    // on the application form, not just the single generic discount_id_url
    // a manually-reviewed disabled/elderly registration still only ever
    // has. A commuter with no such row (that manual path, or a legacy
    // account) simply gets NULLs here and the existing single-document view
    // is unchanged for them — see VerifyUsers.jsx.
    //
    // Deliberately does NOT select selfie_center_path/selfie_left_path/
    // selfie_right_path — the admin reviews the applicant's identity
    // documents and typed form as the basis for approval, never their
    // facial-liveness photos (a privacy boundary, not an oversight).
    $result = $conn->query("
        SELECT
            c.id,
            c.name,
            c.email,
            c.category AS role,
            c.discount_id_url AS document_url,
            DATE_FORMAT(c.created_at, '%b %d, %Y') AS date_added,
            civ.last_name, civ.first_name, civ.middle_name,
            civ.school_name, civ.academic_year, civ.semester, civ.student_id_number, civ.id_type,
            civ.id_number, civ.birthdate, civ.issuing_lgu, civ.date_issued, civ.validity_date,
            civ.id_front_path, civ.id_back_path, civ.enrollment_form_path,
            civ.face_match_score, civ.verification_status AS verification_detail_status
        FROM commuters c
        LEFT JOIN commuter_id_verifications civ
            ON civ.commuter_id = c.id
            AND civ.id = (SELECT MAX(id) FROM commuter_id_verifications WHERE commuter_id = c.id)
        WHERE c.is_verified = 0
          AND c.rejected_at IS NULL
          AND (
            c.category != 'default'
            OR c.discount_id_url IS NOT NULL
          )
        ORDER BY c.created_at DESC
    ");

    if (!$result) {
        http_response_code(500);
        echo json_encode(["error" => true, "message" => "Query failed: " . $conn->error]);
        exit;
    }

    $list = [];
    while ($row = $result->fetch_assoc()) {
        if ($row['document_url']) {
            $row['document_url'] = $base_url . $row['document_url'];
        }
        foreach (['id_front_path', 'id_back_path', 'enrollment_form_path'] as $docField) {
            if ($row[$docField]) $row[$docField] = $base_url . $row[$docField];
        }
        // Computed once here rather than in the admin frontend — the
        // "which ID-number column" question (student_id_number vs the
        // generic id_number, see migration 040) is backend plumbing the UI
        // shouldn't need to know about.
        $row['claimed_name']      = $row['last_name'] ? trim("{$row['first_name']} {$row['last_name']}") : null;
        $row['claimed_id_number'] = $row['student_id_number'] ?: $row['id_number'];
        $list[] = $row;
    }
    echo json_encode($list);
    exit;
}

// ── Operator pending ──────────────────────────────────────────────────────────
// Show operators who are not yet verified and not rejected.
// status = 'active' is the default on registration — rejected ones get
// status = 'inactive', so we exclude those.
if ($type === 'operator') {
    // operator_type is deprecated — registration no longer collects a vehicle
    // type or documents at all (both moved to the per-vehicle-type association
    // application, reviewed separately by the association). This is now a
    // thin, non-document identity check, so "role" is just a static label.
    $result = $conn->query("
        SELECT
            id,
            name,
            email,
            'Operator'               AS role,
            route,
            registration_document_url,
            drivers_license_url,
            vehicle_or_cr_url,
            cpc_document_url,
            ltfrb_document_url,
            DATE_FORMAT(created_at, '%b %d, %Y') AS date_added
        FROM operators
        WHERE is_verified = 0
          AND rejected_at IS NULL
        ORDER BY created_at DESC
    ");

    if (!$result) {
        http_response_code(500);
        echo json_encode(["error" => true, "message" => "Query failed: " . $conn->error]);
        exit;
    }

    $list = [];
    while ($row = $result->fetch_assoc()) {
        // registration_document_url is deprecated in place (migration 054) —
        // still prefixed/returned for any legacy row that has one, but new
        // registrations populate drivers_license_url/vehicle_or_cr_url instead.
        if ($row['registration_document_url']) $row['registration_document_url'] = $base_url . $row['registration_document_url'];
        if ($row['drivers_license_url']) $row['drivers_license_url'] = $base_url . $row['drivers_license_url'];
        if ($row['vehicle_or_cr_url'])   $row['vehicle_or_cr_url']   = $base_url . $row['vehicle_or_cr_url'];
        if ($row['cpc_document_url'])   $row['cpc_document_url']   = $base_url . $row['cpc_document_url'];
        if ($row['ltfrb_document_url']) $row['ltfrb_document_url'] = $base_url . $row['ltfrb_document_url'];
        $list[] = $row;
    }
    echo json_encode($list);
    exit;
}

// Unknown type
http_response_code(400);
echo json_encode(["message" => "Unknown type '$type'. Must be commuter, operator, or association."]);