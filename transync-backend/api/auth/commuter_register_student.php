<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

require_once "../../config/db.php";
require_once "../../config/rekognition.php";
require_once "../../config/student_verification.php";
require_once "../../config/academic_validation.php";
require_once "../../config/account_validation.php";
require_once "../../config/consent.php";
require_once "../../config/phone_otp.php";

// Dedicated registration + auto-verification endpoint for the Student
// discount category only — default/disabled/elderly keep using
// commuter_register.php's simple upload + admin-review path unchanged.
// Every stage below either passes or returns immediately with {stage,
// message}; nothing is written to the database until every stage has
// passed, so a failed attempt leaves nothing behind for the commuter to
// clean up — they just retry the step that failed.
function respondFail(int $status, string $stage, string $message): void {
    http_response_code($status);
    echo json_encode(["success" => false, "stage" => $stage, "message" => $message]);
    exit;
}

// ── 1. Base account fields ──────────────────────────────────────────────
// No free-text "name" field here — the wizard collects Last/First/Middle
// Name directly (see step 2 below), pre-filled from the registration
// screen's own draft but still editable here (a physical ID can format a
// name slightly differently); $name is derived from those once parsed.
// date_of_birth/terms_accepted are likewise carried through from the
// registration draft, collected once on that screen, not re-asked here.
$email          = trim($_POST["email"]    ?? "");
$phone          = trim($_POST["phone"]    ?? "");
$password       = $_POST["password"]      ?? "";
// No longer collected on the redesigned registration screen — optional,
// same as commuter_register.php.
$dateOfBirth    = trim($_POST["date_of_birth"] ?? "") ?: null;
$termsAccepted  = $_POST["terms_accepted"] ?? null;

if (!$email || !$phone || !$password) {
    respondFail(400, "account", "All account fields are required.");
}

if ($dateOfBirth !== null) {
    $dob = DateTime::createFromFormat("Y-m-d", $dateOfBirth);
    $dobErrors = DateTime::getLastErrors();
    if (!$dob || ($dobErrors && ($dobErrors["warning_count"] > 0 || $dobErrors["error_count"] > 0)) || $dob > new DateTime("today")) {
        respondFail(400, "account", "Please enter a valid date of birth.");
    }
}

if (!termsWereAccepted($termsAccepted)) {
    respondFail(400, "account", "You must agree to the Terms & Conditions and Privacy Policy to continue.");
}

// ── 2. Student-specific fields ──────────────────────────────────────────
$lastName        = trim($_POST["last_name"]         ?? "");
$firstName       = trim($_POST["first_name"]        ?? "");
$middleName      = trim($_POST["middle_name"]        ?? "") ?: null;
$suffix          = trim($_POST["suffix"]              ?? "") ?: null;
$schoolName      = trim($_POST["school_name"]        ?? "");
$academicYear    = trim($_POST["academic_year"]      ?? "");
$studentIdNumber = trim($_POST["student_id_number"]  ?? "");
$idType          = $_POST["id_type"]                  ?? "";

if (!$lastName || !$firstName || !$schoolName || !$academicYear || !$studentIdNumber) {
    respondFail(400, "details", "All student details are required.");
}
if (!in_array($idType, ["k12", "college"], true)) {
    respondFail(400, "details", "Please select whether this is a K-12 or College ID.");
}

$name = trim(implode(" ", array_filter([$firstName, $middleName, $lastName, $suffix])));

// Semester (College only) is never captured from the commuter or the
// document — it's derived purely from the server clock, same source
// current_academic_period.php already used to auto-fill the wizard's
// Academic Year field. See config/academic_validation.php.
$semester = $idType === "college" ? currentAcademicYearSuggestion("college")["semester"] : null;

// ── 3. Captured files ────────────────────────────────────────────────────
// Whether an Enrollment Form/COE is required is no longer asked up front
// (no more "does your ID show a validity date?" toggle) — the wizard
// decides automatically via check_student_id_ocr.php right after ID
// capture, and the OCR cross-check below (step 7) is the authoritative
// server-side re-check regardless of what the client already captured.
function requiredFileTmpPath(string $field): ?string {
    if (!isset($_FILES[$field]) || $_FILES[$field]["error"] !== UPLOAD_ERR_OK) return null;
    return $_FILES[$field]["tmp_name"];
}

$idFrontTmp  = requiredFileTmpPath("id_front");
$idBackTmp   = requiredFileTmpPath("id_back");
$selfieCTmp  = requiredFileTmpPath("selfie_center");
$selfieLTmp  = requiredFileTmpPath("selfie_left");
$selfieRTmp  = requiredFileTmpPath("selfie_right");
$enrollTmp   = requiredFileTmpPath("enrollment_form"); // optional — required only if the OCR check below can't confirm the academic period

if (!$idFrontTmp || !$idBackTmp) {
    respondFail(400, "id_capture", "Please capture both the front and back of your ID.");
}
if (!$selfieCTmp || !$selfieLTmp || !$selfieRTmp) {
    respondFail(400, "facial_capture", "Please complete all three facial capture photos.");
}

// ── 4. Duplicate email / phone (same checks as commuter_register.php) ───
if (!isValidEmailFormat($email)) {
    respondFail(400, "account", "Please enter a valid email address.");
}
if (emailAlreadyRegistered($conn, $email)) {
    respondFail(409, "account", "Email already registered.");
}

foreach ([
    "SELECT id FROM commuters    WHERE phone         = ?",
    "SELECT id FROM operators    WHERE phone         = ?",
    "SELECT id FROM drivers      WHERE phone         = ?",
    "SELECT id FROM associations WHERE contact_phone = ?",
] as $sql) {
    $s = $conn->prepare($sql);
    $s->bind_param("s", $phone);
    $s->execute();
    $s->store_result();
    if ($s->num_rows > 0) {
        respondFail(409, "account", "This phone number is already linked to an existing account.");
    }
}

// Phone must have been verified via OTP (auth/send_phone_otp.php +
// verify_phone_otp.php) before the account can be created — see migration 048.
if (!isPhoneOtpVerified($conn, $phone)) {
    respondFail(403, "account", "Please verify your phone number first.");
}

// ── 5. Duplicate Student ID number ───────────────────────────────────────
$stmt = $conn->prepare("SELECT id FROM commuter_id_verifications WHERE student_id_number = ?");
$stmt->bind_param("s", $studentIdNumber);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    respondFail(409, "details", "This Student ID number is already registered to another account.");
}

// ── 6-9. Automatic verification — anything short of a clean pass now falls
// through to the admin's manual-review queue instead of hard-blocking
// registration, so the account still gets created (is_verified=0,
// verification_status='pending_review') and the commuter isn't stuck
// retrying. Two exceptions stay immediate, no-account-created hard blocks:
// (a) liveness, since an unusable capture (no face at all) isn't something
// a human reviewer could resolve either, and (b) "academic year not
// confirmable and no Enrollment Form was captured yet" — that one still has
// a concrete, immediately-actionable fix (capture the form), so it's worth
// asking for before parking this as a slow admin case.
$needsReview   = false;
$reviewReasons = [];

// ── 6. Academic period validation (K-12 vs College rules, see config/academic_validation.php) ──
$periodCheck = validateAcademicPeriod($idType, $academicYear);
if (!$periodCheck["valid"]) {
    $needsReview     = true;
    $reviewReasons[] = "academic_period: " . $periodCheck["message"];
}

// ── 7. OCR cross-check (soft-skips if Tesseract isn't installed) ────────
$ocrText = "";
$ocrRan  = false;
foreach (array_filter([$idFrontTmp, $idBackTmp, $enrollTmp]) as $imgPath) {
    $ocr = runTesseractOcr($imgPath);
    if ($ocr["skipped"]) continue; // Tesseract not installed — soft-skip this stage entirely
    $ocrRan = true;
    if ($ocr["success"] && $ocr["text"]) {
        $ocrText .= "\n" . $ocr["text"];
    }
}

if ($ocrRan) {
    if (!fuzzyNameMatch($lastName, $firstName, $ocrText)) {
        $needsReview     = true;
        $reviewReasons[] = "name_mismatch";
    }
    if (!ocrContainsIdNumber($studentIdNumber, $ocrText)) {
        $needsReview     = true;
        $reviewReasons[] = "id_number_mismatch";
    }
    if (!fuzzySchoolMatch($schoolName, $ocrText)) {
        $needsReview     = true;
        $reviewReasons[] = "school_mismatch";
    }
    // The "Missing Information Rule" (K-12's "validity period" / College's
    // "Academic Year") — must be confirmable somewhere across every
    // captured document (ID front/back, plus the Enrollment Form/COE if
    // one was captured), not just typed by the commuter. This is the
    // authoritative server-side re-check of the same test
    // check_student_id_ocr.php already ran right after ID capture. If still
    // missing and no Enrollment Form was provided, that's still
    // immediately fixable right now — ask for one specifically, rather than
    // committing an account over something the commuter could fix in the
    // next 30 seconds. Only once an Enrollment Form was ALSO captured and
    // it's still unconfirmable does this become a review case.
    $detailsCheck = checkRequiredDetailsOnDocument($academicYear, $ocrText);
    if (!$detailsCheck["sufficient"]) {
        if (!$enrollTmp) {
            respondFail(422, "enrollment_form", "We couldn't find your academic year on your ID. Please also capture your Enrollment Form or Certificate of Enrollment.");
        }
        $needsReview     = true;
        $reviewReasons[] = "academic_year_unconfirmed";
    }
}

// ── 8. Pose-challenge liveness — stays a hard, immediate block ──────────
$faceCenter = rekognitionDetectFaces($selfieCTmp);
$faceLeft   = rekognitionDetectFaces($selfieLTmp);
$faceRight  = rekognitionDetectFaces($selfieRTmp);

$liveness = checkPoseChallenge($faceCenter, $faceLeft, $faceRight);
if (!$liveness["success"]) {
    respondFail(422, "liveness", $liveness["error"]);
}

// ── 9. Face match: selfie vs ID front ────────────────────────────────────
$faceMatch = rekognitionCompareFaces($selfieCTmp, $idFrontTmp);
if (!$faceMatch["success"]) {
    $similarity = $faceMatch["similarity"];
    if ($similarity !== null && $similarity < FACE_MATCH_HARD_REJECT_BELOW) {
        // Confidently a different person, not just "photo quality" — this
        // is someone else's ID plus the applicant's own face, the exact
        // impersonation this pipeline exists to catch. Never softened into
        // a pending-review account; no account is created at all.
        respondFail(422, "face_match", "Your selfie doesn't resemble your ID photo at all ({$similarity}% similarity). This looks like it may not be your own ID — please make sure you're using your own ID and your own face.");
    }
    $needsReview     = true;
    $reviewReasons[] = "face_match: " . ($faceMatch["error"] ?? "low similarity");
}

// ── Save files, create the account, record the audit row ────────────────
function saveStudentUpload(string $tmpPath, string $originalName, string $label): string {
    $ext        = pathinfo($originalName, PATHINFO_EXTENSION) ?: "jpg";
    $filename   = "student_{$label}_" . time() . "_" . uniqid() . "." . $ext;
    $upload_dir = str_replace("\\", "/", dirname(dirname(__DIR__)) . "/uploads/commuters/");
    if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);
    move_uploaded_file($tmpPath, $upload_dir . $filename);
    return "uploads/commuters/" . $filename;
}

$idFrontPath  = saveStudentUpload($idFrontTmp, $_FILES["id_front"]["name"], "front");
$idBackPath   = saveStudentUpload($idBackTmp, $_FILES["id_back"]["name"], "back");
$enrollPath   = $enrollTmp ? saveStudentUpload($enrollTmp, $_FILES["enrollment_form"]["name"], "enrollment") : null;
$selfieCPath  = saveStudentUpload($selfieCTmp, $_FILES["selfie_center"]["name"], "selfie_center");
$selfieLPath  = saveStudentUpload($selfieLTmp, $_FILES["selfie_left"]["name"], "selfie_left");
$selfieRPath  = saveStudentUpload($selfieRTmp, $_FILES["selfie_right"]["name"], "selfie_right");

$hashed  = password_hash($password, PASSWORD_BCRYPT);
$now     = new DateTime();
// A pending-review account has nothing confirmed yet, so it gets no expiry
// either — matches the same convention as commuter_switch_category.php's
// pending_review rows. Only a clean pass carries the real computed expiry
// ($periodCheck["expires_at"] is guaranteed non-null whenever $needsReview
// is false, since an invalid period is itself one of the review triggers).
$expires    = $needsReview ? null : $periodCheck["expires_at"];
$isVerified = $needsReview ? 0 : 1;
$verificationStatus = $needsReview ? "pending_review" : "verified";
// A pending-review account gets full "Regular" access immediately, not a
// half-claimed "Student (unverified)" state — category only flips to the
// real claimed one once an admin actually approves it (auth/verify.php's
// commuter approve branch reads the claim back from
// commuter_id_verifications, since this row no longer carries it). The
// claim itself is still recorded truthfully below on the verification row.
$accountCategory = $needsReview ? "default" : "student";

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("
        INSERT INTO commuters
            (name, first_name, middle_name, last_name, suffix, date_of_birth,
             email, phone, password, category, discount_id_url, status, is_verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    ");
    $stmt->bind_param(
        "sssssssssssi",
        $name, $firstName, $middleName, $lastName, $suffix, $dateOfBirth,
        $email, $phone, $hashed, $accountCategory, $idFrontPath, $isVerified
    );
    $stmt->execute();
    $commuterId = $conn->insert_id;

    $wallet = $conn->prepare("INSERT INTO wallets (commuter_id, balance) VALUES (?, 0.00)");
    $wallet->bind_param("i", $commuterId);
    $wallet->execute();

    recordConsent($conn, "commuter", $commuterId);
    consumePhoneOtpVerification($conn, $phone);

    $provider   = $faceMatch["provider"];
    $similarity = $faceMatch["similarity"];
    $ocrJson      = json_encode(["ocr_ran" => $ocrRan, "review_reasons" => $reviewReasons]);
    $livenessJson = json_encode(["provider" => $provider, "center_yaw" => $faceCenter["yaw"], "left_yaw" => $faceLeft["yaw"], "right_yaw" => $faceRight["yaw"]]);
    $verifiedAtStr = $now->format("Y-m-d H:i:s");
    $expiresAtStr  = $expires ? $expires->format("Y-m-d H:i:s") : null;

    $verifStmt = $conn->prepare("
        INSERT INTO commuter_id_verifications
            (commuter_id, category, last_name, first_name, middle_name, school_name, academic_year, semester,
             student_id_number, id_type, id_front_path, id_back_path, enrollment_form_path,
             selfie_center_path, selfie_left_path, selfie_right_path,
             ocr_raw_text, ocr_match_result, face_match_score, liveness_result,
             provider, verification_status, verified_at, expires_at)
        VALUES (?, 'student', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    // Built as parallel (type, value) pairs rather than a hand-counted type
    // string — a hand-counted placeholder literal is exactly the kind of
    // thing that silently drifts by one character when a column gets
    // added/reordered later, and mysqli won't catch a type/position
    // mismatch for you (this bit us once already when `semester` wasn't
    // here yet — see the type-string bug fixed earlier this session).
    $verifParams = [
        ["i", $commuterId], ["s", $lastName], ["s", $firstName], ["s", $middleName],
        ["s", $schoolName], ["s", $academicYear], ["s", $semester], ["s", $studentIdNumber], ["s", $idType],
        ["s", $idFrontPath], ["s", $idBackPath], ["s", $enrollPath],
        ["s", $selfieCPath], ["s", $selfieLPath], ["s", $selfieRPath],
        ["s", $ocrText], ["s", $ocrJson], ["d", $similarity], ["s", $livenessJson],
        ["s", $provider], ["s", $verificationStatus], ["s", $verifiedAtStr], ["s", $expiresAtStr],
    ];
    $verifTypes  = implode("", array_column($verifParams, 0));
    $verifValues = array_column($verifParams, 1);
    $verifStmt->bind_param($verifTypes, ...$verifValues);
    $verifStmt->execute();

    $conn->commit();
} catch (\Throwable $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["success" => false, "stage" => "save", "message" => "Registration failed while saving your account. Please try again."]);
    exit;
}

echo json_encode([
    "success" => true,
    "outcome" => $needsReview ? "pending_review" : "verified",
    "message" => $needsReview
        ? "We couldn't automatically confirm your Student ID — it's been sent to an admin for manual review. Please allow up to 24 hours. In the meantime, you can still get your student discount when boarding by showing your physical ID to the driver."
        : "Registration successful — your Student account is verified.",
]);
