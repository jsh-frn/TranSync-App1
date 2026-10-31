<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Lets the mobile client re-sync a commuter's own verification/category
// status mid-session (admin approval/rejection, resubmission) without a
// logout/login — the AsyncStorage "user" blob otherwise only ever reflects
// whatever was true at login time. See src/context/UserContext.tsx.
$commuter_id = (int)($_GET['commuter_id'] ?? 0);
if (!$commuter_id) {
    echo json_encode(["success" => false, "message" => "commuter_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, name, first_name, middle_name, last_name, suffix, date_of_birth, email, phone, category, is_verified, status, rejected_at, rejection_reason, created_at, avatar_url
    FROM commuters WHERE id = ?
");
$stmt->bind_param("i", $commuter_id);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$user) {
    echo json_encode(["success" => false, "message" => "Commuter not found."]);
    exit;
}

// Same rejected-but-resubmittable override as login_mobile.php's commuter
// branch (Core Flow 1/2) — a rejected commuter reads as category='default',
// is_verified=0 until they resubmit, so a background refresh here never
// contradicts what a fresh login would show.
$category    = $user["category"];
$is_verified = (int)$user["is_verified"];
if ($user["rejected_at"]) {
    $category    = "default";
    $is_verified = 0;
}

// Same live expiry check as login_mobile.php's commuter branch — a lapsed
// Student verification (10mo K-12 / 5mo college) isn't an admin rejection,
// so it's its own flag rather than piggybacking on rejected_at.
$student_verification_expired = false;
if ($category === "student") {
    $expStmt = $conn->prepare("
        SELECT (expires_at < NOW()) AS is_expired FROM commuter_id_verifications
        WHERE commuter_id = ? AND verification_status = 'verified' AND expires_at IS NOT NULL
        ORDER BY verified_at DESC LIMIT 1
    ");
    $expStmt->bind_param("i", $commuter_id);
    $expStmt->execute();
    $expRow = $expStmt->get_result()->fetch_assoc();
    $student_verification_expired = $expRow ? (bool)$expRow["is_expired"] : false;
    // Same downgrade as the rejected_at branch above — an expired Student
    // verification must stop the discount from applying, not just flag it.
    if ($student_verification_expired) {
        $category    = "default";
        $is_verified = 0;
    }
}

// PWD's own lapsed-verification check — same shape as the Student block
// above, kept separate (rather than folded into student_verification_expired)
// since that field name/flag is specifically read by home.tsx's
// Student-only expired banner.
$pwd_verification_expired = false;
if ($category === "disabled") {
    $pwdExpStmt = $conn->prepare("
        SELECT (expires_at < NOW()) AS is_expired FROM commuter_id_verifications
        WHERE commuter_id = ? AND category = 'disabled' AND verification_status = 'verified' AND expires_at IS NOT NULL
        ORDER BY verified_at DESC LIMIT 1
    ");
    $pwdExpStmt->bind_param("i", $commuter_id);
    $pwdExpStmt->execute();
    $pwdExpRow = $pwdExpStmt->get_result()->fetch_assoc();
    $pwd_verification_expired = $pwdExpRow ? (bool)$pwdExpRow["is_expired"] : false;
    if ($pwd_verification_expired) {
        $category    = "default";
        $is_verified = 0;
    }
}

// Additive fields for the Profile screen's "Change Discount Type" feature
// (commuter_switch_category.php) — deliberately separate from the
// downgraded $category/$is_verified above, which every other screen's fare-
// discount logic depends on unchanged (Do Not Break rule #70). raw_category
// is the commuter's actual stored category, undowngraded, so Profile can
// still show "Student (Expired)" instead of "Standard" once lapsed.
// discount_expires_at/can_switch_category are read generically off whatever
// category the commuter currently holds — never hardcoded to 'student' —
// so they naturally stay null/false for disabled/elderly, which never write
// an expires_at at all.
// Whether a Student/PWD/Senior verification is genuinely awaiting admin
// review right now — independent of `category`/`raw_category`, both of
// which stay 'default' for the whole time a submission is pending (see
// commuter_register_student.php et al. and commuter_switch_category.php —
// "instant Regular access, upgrade once approved"). Without this separate
// signal, a genuinely pending commuter and a plain Regular commuter are
// indistinguishable from category alone; home.tsx/profile.tsx's "Pending"
// badge must key off this instead.
$pendingStmt = $conn->prepare("
    SELECT id FROM commuter_id_verifications
    WHERE commuter_id = ? AND verification_status = 'pending_review'
    ORDER BY id DESC LIMIT 1
");
$pendingStmt->bind_param("i", $commuter_id);
$pendingStmt->execute();
$has_pending_discount_verification = $pendingStmt->get_result()->fetch_assoc() !== null;

$raw_category = $user["category"];
$discount_expires_at = null;
$can_switch_category = false;
$discountExpStmt = $conn->prepare("
    SELECT expires_at, (expires_at < NOW()) AS is_expired FROM commuter_id_verifications
    WHERE commuter_id = ? AND category = ? AND verification_status = 'verified' AND expires_at IS NOT NULL
    ORDER BY verified_at DESC LIMIT 1
");
$discountExpStmt->bind_param("is", $commuter_id, $raw_category);
$discountExpStmt->execute();
$discountExpRow = $discountExpStmt->get_result()->fetch_assoc();
if ($discountExpRow) {
    $discount_expires_at = $discountExpRow["expires_at"];
    $can_switch_category = (bool)$discountExpRow["is_expired"];
}

// Settings' "Discount Eligibility" section (Core Flow 2b) — distinct from
// can_switch_category above, which specifically means "current verified
// category has expired." A first-time applicant has nothing to switch FROM
// (raw_category is still 'default', no commuter_id_verifications row exists
// at all), so that flag stays false for them by simple absence of a match,
// not an explicit check — this is a separate flag, not a broadened reuse of
// it, so Profile's expired-discount card copy/branching is unaffected.
$can_apply_category = $raw_category === "default" && !$has_pending_discount_verification;

echo json_encode([
    "success" => true,
    "user" => [
        "id"          => (int)$user["id"],
        "name"        => $user["name"],
        // Structured name fields — needed by Settings' Edit Personal Info
        // form (first/middle/last as separate inputs), which was previously
        // always seeing them as blank/undefined since this endpoint never
        // sent them at all, only the concatenated `name`.
        "first_name"  => $user["first_name"],
        "middle_name" => $user["middle_name"],
        "last_name"   => $user["last_name"],
        // Used to pre-fill the discount application wizards (Student/PWD/
        // Senior) so a logged-in commuter doesn't retype what the account
        // already knows.
        "suffix"        => $user["suffix"],
        "date_of_birth" => $user["date_of_birth"],
        "email"       => $user["email"],
        "phone"       => $user["phone"],
        "category"    => $category,
        "is_verified" => $is_verified,
        "status"      => $user["status"],
        "rejected_at" => $user["rejected_at"],
        "rejection_reason" => $user["rejection_reason"],
        "created_at"  => $user["created_at"],
        // Relative path — the mobile client prefixes with FILE_BASE (see
        // src/config/api.ts), never a hardcoded host, which would only
        // resolve on Expo web and not a real device/emulator.
        "avatar_url"  => $user["avatar_url"],
        "student_verification_expired" => $student_verification_expired,
        "pwd_verification_expired" => $pwd_verification_expired,
        "raw_category" => $raw_category,
        "discount_expires_at" => $discount_expires_at,
        "can_switch_category" => $can_switch_category,
        "can_apply_category" => $can_apply_category,
        "has_pending_discount_verification" => $has_pending_discount_verification,
    ],
]);
