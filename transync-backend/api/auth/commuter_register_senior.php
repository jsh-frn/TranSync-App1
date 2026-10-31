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
require_once "../../config/discount_switch_validation.php";
require_once "../../config/account_validation.php";
require_once "../../config/consent.php";
require_once "../../config/phone_otp.php";

// Dedicated registration + auto-verification endpoint for the Senior
// Citizen discount category only — default/student/disabled keep using
// their own existing registration paths unchanged. Reuses
// classifySwitchVerification() verbatim (same classifier the "Change
// Discount Type" flow already uses for an existing commuter switching INTO
// 'elderly', see commuter_switch_category.php) rather than hand-rolling a
// second copy of the same OCR/age/face-match decision logic — the only
// genuine difference at registration time is that there's no existing
// account to gate behind an "expired category" check, and the account gets
// CREATED here instead of UPDATEd.
function respondFail(int $status, string $stage, string $message): void {
    http_response_code($status);
    echo json_encode(["success" => false, "stage" => $stage, "message" => $message]);
    exit;
}

// ── 1. Base account fields ──────────────────────────────────────────────
// No free-text "name" field here — the wizard collects Last/First/Middle
// Name directly (same convention as commuter_register_student.php),
// pre-filled from the registration draft but still editable; $name is
// derived from those once parsed. date_of_birth/terms_accepted are also
// carried through from that same draft, collected once there. Note:
// date_of_birth (this account's basic DOB) is a separate field/purpose from
// $birthdate below (the OCR-cross-checked age-eligibility proof stored on
// commuter_id_verifications) — they'll usually hold the same real value
// (the mobile wizard pre-fills $birthdate's input from this draft value)
// but are never merged into one column.
$email         = trim($_POST["email"]    ?? "");
$phone         = trim($_POST["phone"]    ?? "");
$password      = $_POST["password"]      ?? "";
// No longer collected on the redesigned registration screen — optional.
$dateOfBirth   = trim($_POST["date_of_birth"] ?? "") ?: null;
$termsAccepted = $_POST["terms_accepted"] ?? null;

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

// ── 2. Senior Citizen ID fields ─────────────────────────────────────────
$lastName   = trim($_POST["last_name"]   ?? "");
$firstName  = trim($_POST["first_name"]  ?? "");
$middleName = trim($_POST["middle_name"] ?? "") ?: null;
$suffix     = trim($_POST["suffix"]      ?? "") ?: null;
$idNumber   = trim($_POST["id_number"]   ?? "");
$issuingLgu = trim($_POST["issuing_lgu"] ?? "");
$dateIssued = trim($_POST["date_issued"] ?? "");
$birthdate  = trim($_POST["birthdate"]   ?? "");

if (!$lastName || !$firstName || !$idNumber || !$issuingLgu || !$dateIssued || !$birthdate) {
    respondFail(400, "details", "All Senior Citizen ID details are required.");
}
if (!DateTime::createFromFormat('Y-m-d', $birthdate)) {
    respondFail(400, "details", "Please provide a valid birthdate.");
}
if (!DateTime::createFromFormat('Y-m-d', $dateIssued)) {
    respondFail(400, "details", "Please provide a valid date issued.");
}

$name = trim(implode(" ", array_filter([$firstName, $middleName, $lastName, $suffix])));

// ── 3. Captured files ────────────────────────────────────────────────────
function requiredFileTmpPath(string $field): ?string {
    if (!isset($_FILES[$field]) || $_FILES[$field]["error"] !== UPLOAD_ERR_OK) return null;
    return $_FILES[$field]["tmp_name"];
}

$idFrontTmp = requiredFileTmpPath("id_front");
$idBackTmp  = requiredFileTmpPath("id_back");
$selfieCTmp = requiredFileTmpPath("selfie_center");
$selfieLTmp = requiredFileTmpPath("selfie_left");
$selfieRTmp = requiredFileTmpPath("selfie_right");

if (!$idFrontTmp || !$idBackTmp) {
    respondFail(400, "id_capture", "Please capture both the front and back of your ID.");
}
if (!$selfieCTmp || !$selfieLTmp || !$selfieRTmp) {
    respondFail(400, "facial_capture", "Please complete all three facial capture photos.");
}

// ── 4. Duplicate email / phone (same checks as commuter_register.php / commuter_register_student.php) ──
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

// ── 5. Duplicate Senior Citizen ID number ────────────────────────────────
// Shares the generic `id_number` column (and its uniqueness namespace) with
// PWD switch rows — deliberately, matches the existing shared-namespace
// behavior in commuter_switch_category.php rather than scoping this check
// to category='elderly' only.
$stmt = $conn->prepare("SELECT id FROM commuter_id_verifications WHERE id_number = ?");
$stmt->bind_param("s", $idNumber);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    respondFail(409, "details", "This ID number is already registered to another account.");
}

// ── 6. OCR cross-check (soft-skips if Tesseract isn't installed — see classifySwitchVerification() for how that's handled) ──
$ocrText = "";
$ocrRan  = false;
foreach ([$idFrontTmp, $idBackTmp] as $imgPath) {
    $ocr = runTesseractOcr($imgPath);
    if ($ocr["skipped"]) continue;
    $ocrRan = true;
    if ($ocr["success"] && $ocr["text"]) {
        $ocrText .= "\n" . $ocr["text"];
    }
}

// ── 7. Pose-challenge liveness — always a hard, immediate retake on failure, never "uncertain" ──
$faceCenter = rekognitionDetectFaces($selfieCTmp);
$faceLeft   = rekognitionDetectFaces($selfieLTmp);
$faceRight  = rekognitionDetectFaces($selfieRTmp);

$liveness = checkPoseChallenge($faceCenter, $faceLeft, $faceRight);
if (!$liveness["success"]) {
    respondFail(422, "liveness", $liveness["error"]);
}

// ── 8. Face match — read directly into the classifier below rather than gating on it here ──
$faceMatch = rekognitionCompareFaces($selfieCTmp, $idFrontTmp);

// ── 9. Classify: verified (auto-approve) / uncertain / rejected (both fall
// through to the admin's manual-review queue, account still created) /
// blocked (confident impersonation, or a confirmed under-60 age — no
// account created, immediate hard reject) ──
$fields = ["lastName" => $lastName, "firstName" => $firstName, "idNumber" => $idNumber, "birthdate" => $birthdate];
$classification = classifySwitchVerification("elderly", $fields, $ocrText, $ocrRan, $faceMatch);

if ($classification["outcome"] === "blocked") {
    respondFail(422, $classification["stage"] ?? "details", $classification["message"]);
}

// ── Save files, create the account, record the audit row ────────────────
function saveSeniorUpload(string $tmpPath, string $originalName, string $label): string {
    $ext        = pathinfo($originalName, PATHINFO_EXTENSION) ?: "jpg";
    $filename   = "senior_{$label}_" . time() . "_" . uniqid() . "." . $ext;
    $upload_dir = str_replace("\\", "/", dirname(dirname(__DIR__)) . "/uploads/commuters/");
    if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);
    move_uploaded_file($tmpPath, $upload_dir . $filename);
    return "uploads/commuters/" . $filename;
}

$idFrontPath = saveSeniorUpload($idFrontTmp, $_FILES["id_front"]["name"], "front");
$idBackPath  = saveSeniorUpload($idBackTmp, $_FILES["id_back"]["name"], "back");
$selfieCPath = saveSeniorUpload($selfieCTmp, $_FILES["selfie_center"]["name"], "selfie_center");
$selfieLPath = saveSeniorUpload($selfieLTmp, $_FILES["selfie_left"]["name"], "selfie_left");
$selfieRPath = saveSeniorUpload($selfieRTmp, $_FILES["selfie_right"]["name"], "selfie_right");

$hashed = password_hash($password, PASSWORD_BCRYPT);
$now    = new DateTime();

// 'verified' auto-approves immediately; 'uncertain'/'rejected' both create
// the account pending_review (same two-tier "outcome short of clean pass
// still creates the account" convention as commuter_register_student.php
// and commuter_switch_category.php) rather than hard-blocking registration.
$isVerified          = $classification["outcome"] === "verified" ? 1 : 0;
$verificationStatus  = $classification["outcome"] === "verified" ? "verified" : "pending_review";
// A pending-review account gets full "Regular" access immediately, not a
// half-claimed "Senior (unverified)" state — category only flips to the
// real claimed one once an admin approves it (auth/verify.php's commuter
// approve branch reads the claim back from commuter_id_verifications). The
// claim itself is still recorded truthfully below on the verification row.
$accountCategory = $classification["outcome"] === "verified" ? "elderly" : "default";

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

    $provider   = $faceMatch["provider"] ?? ($faceCenter["provider"] ?? "demo");
    $similarity = $faceMatch["similarity"];
    $ocrJson      = json_encode(["ocr_ran" => $ocrRan, "outcome" => $classification["outcome"]]);
    $livenessJson = json_encode(["provider" => $provider, "center_yaw" => $faceCenter["yaw"], "left_yaw" => $faceLeft["yaw"], "right_yaw" => $faceRight["yaw"]]);
    $verifiedAtStr = $now->format("Y-m-d H:i:s");

    $verifStmt = $conn->prepare("
        INSERT INTO commuter_id_verifications
            (commuter_id, category, last_name, first_name, middle_name, id_number, birthdate,
             issuing_lgu, date_issued,
             id_front_path, id_back_path, selfie_center_path, selfie_left_path, selfie_right_path,
             ocr_raw_text, ocr_match_result, face_match_score, liveness_result,
             provider, verification_status, verified_at, expires_at)
        VALUES (?, 'elderly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ");
    // Built as parallel (type, value) pairs, not a hand-counted placeholder
    // string — see commuter_register_student.php's identical note on why.
    $verifParams = [
        ["i", $commuterId], ["s", $lastName], ["s", $firstName], ["s", $middleName],
        ["s", $idNumber], ["s", $birthdate], ["s", $issuingLgu], ["s", $dateIssued],
        ["s", $idFrontPath], ["s", $idBackPath],
        ["s", $selfieCPath], ["s", $selfieLPath], ["s", $selfieRPath],
        ["s", $ocrText], ["s", $ocrJson], ["d", $similarity], ["s", $livenessJson],
        ["s", $provider], ["s", $verificationStatus], ["s", $verifiedAtStr],
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
    "outcome" => $classification["outcome"] === "verified" ? "verified" : "pending_review",
    "message" => $classification["outcome"] === "verified"
        ? "Registration successful — your Senior Citizen account is verified."
        : "We couldn't automatically confirm your Senior Citizen ID — it's been sent to an admin for manual review. Please allow up to 24 hours. In the meantime, you can still get your discount when boarding by showing your physical ID to the driver.",
]);
