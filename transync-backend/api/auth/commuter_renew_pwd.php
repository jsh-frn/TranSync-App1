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

// Renewal counterpart to commuter_register_pwd.php, reached for an
// EXISTING, already-logged-in commuter — not a brand new account. No
// name/email/phone/password here, and no 48h cooldown (expiry isn't a
// rejection, so the commuter can re-verify immediately, same as
// commuter_renew_student.php).
//
// Also doubles as the FIRST-TIME application path for a Default commuter
// applying for the PWD discount from Settings (see Core Flow 2b) — same
// reasoning as commuter_renew_student.php's own first-time-apply note.
//
// Unlike commuter_renew_student.php's hard binary pass/fail, this reuses
// the same 4-outcome classifier (classifySwitchVerification()) that PWD
// registration and category-switch already use — PWD registration itself
// is 4-outcome, not binary, so a renewal of that same account should be
// judged by the same rules, not a stricter ad hoc one.
function respondFail(int $status, string $stage, string $message): void {
    http_response_code($status);
    echo json_encode(["success" => false, "stage" => $stage, "message" => $message]);
    exit;
}

$commuterId = (int)($_POST["commuter_id"] ?? 0);
if (!$commuterId) {
    respondFail(400, "account", "commuter_id is required.");
}

$stmt = $conn->prepare("SELECT id, category FROM commuters WHERE id = ?");
$stmt->bind_param("i", $commuterId);
$stmt->execute();
$commuter = $stmt->get_result()->fetch_assoc();
if (!$commuter) {
    respondFail(404, "account", "Commuter not found.");
}
// 'default' is a first-time applicant (never verified anything); 'disabled'
// is a true renewal. Anything else isn't reachable from either entry point.
$isFirstTimeApply = $commuter["category"] === "default";
if (!$isFirstTimeApply && $commuter["category"] !== "disabled") {
    respondFail(400, "account", "This flow is only for Default or existing PWD accounts.");
}

// ── PWD ID fields (same shape as commuter_register_pwd.php) ─────────────
$lastName     = trim($_POST["last_name"]     ?? "");
$firstName    = trim($_POST["first_name"]    ?? "");
$middleName   = trim($_POST["middle_name"]   ?? "") ?: null;
$idNumber     = trim($_POST["id_number"]     ?? "");
$issuingLgu   = trim($_POST["issuing_lgu"]   ?? "");
$validityDate = trim($_POST["validity_date"] ?? "");
$birthdate    = trim($_POST["birthdate"]     ?? "");

if (!$lastName || !$firstName || !$idNumber || !$issuingLgu || !$validityDate || !$birthdate) {
    respondFail(400, "details", "All PWD ID details are required.");
}
if (!DateTime::createFromFormat('Y-m-d', $validityDate)) {
    respondFail(400, "details", "Please provide a valid Validity Date.");
}
$dob = DateTime::createFromFormat('Y-m-d', $birthdate);
$dobErrors = DateTime::getLastErrors();
if (!$dob || ($dobErrors && ($dobErrors["warning_count"] > 0 || $dobErrors["error_count"] > 0)) || $dob > new DateTime("today")) {
    respondFail(400, "details", "Please enter a valid birthday.");
}

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

// Duplicate ID number check excludes this commuter's own prior rows (same
// exclusion shape as commuter_renew_student.php / commuter_switch_category.php).
$stmt = $conn->prepare("SELECT id FROM commuter_id_verifications WHERE id_number = ? AND commuter_id != ?");
$stmt->bind_param("si", $idNumber, $commuterId);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    respondFail(409, "details", "This ID number is already registered to another account.");
}

// ── OCR (soft-skips if Tesseract isn't installed — see classifySwitchVerification() for how that's handled here) ──
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

// ── Pose-challenge liveness — always a hard, immediate retake on failure, never "uncertain" ──
$faceCenter = rekognitionDetectFaces($selfieCTmp);
$faceLeft   = rekognitionDetectFaces($selfieLTmp);
$faceRight  = rekognitionDetectFaces($selfieRTmp);

$liveness = checkPoseChallenge($faceCenter, $faceLeft, $faceRight);
if (!$liveness["success"]) {
    respondFail(422, "liveness", $liveness["error"]);
}

// ── Face match — read directly into the classifier below rather than gating on it here, since a mid-band similarity should fall to "uncertain," not an immediate reject ──
$faceMatch = rekognitionCompareFaces($selfieCTmp, $idFrontTmp);

$fields = ["lastName" => $lastName, "firstName" => $firstName, "idNumber" => $idNumber, "validityDate" => $validityDate];
$classification = classifySwitchVerification("disabled", $fields, $ocrText, $ocrRan, $faceMatch);

// 'blocked' (confident impersonation, or a confirmed-expired Validity Date)
// is an immediate hard reject — nothing written, same as registration.
// 'uncertain'/'rejected' both fall through to the admin's existing
// VerifyUsers queue instead (a fresh commuter_id_verifications row is still
// inserted, pending_review) — sending it to a human isn't the same as
// auto-approving it.
if ($classification["outcome"] === "blocked") {
    respondFail(422, $classification["stage"] ?? "details", $classification["message"]);
}

// ── Save files, update the account, record the audit row ──
function savePwdRenewUpload(string $tmpPath, string $originalName, string $label): string {
    $ext        = pathinfo($originalName, PATHINFO_EXTENSION) ?: "jpg";
    $filename   = "pwd_renew_{$label}_" . time() . "_" . uniqid() . "." . $ext;
    $upload_dir = str_replace("\\", "/", dirname(dirname(__DIR__)) . "/uploads/commuters/");
    if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);
    move_uploaded_file($tmpPath, $upload_dir . $filename);
    return "uploads/commuters/" . $filename;
}

$idFrontPath = savePwdRenewUpload($idFrontTmp, $_FILES["id_front"]["name"], "front");
$idBackPath  = savePwdRenewUpload($idBackTmp, $_FILES["id_back"]["name"], "back");
$selfieCPath = savePwdRenewUpload($selfieCTmp, $_FILES["selfie_center"]["name"], "selfie_center");
$selfieLPath = savePwdRenewUpload($selfieLTmp, $_FILES["selfie_left"]["name"], "selfie_left");
$selfieRPath = savePwdRenewUpload($selfieRTmp, $_FILES["selfie_right"]["name"], "selfie_right");

$isVerified         = $classification["outcome"] === "verified" ? 1 : 0;
$verificationStatus = $classification["outcome"] === "verified" ? "verified" : "pending_review";
$now          = new DateTime();
$expiresAtStr = "{$validityDate} 23:59:59";

$conn->begin_transaction();
try {
    // category='disabled' is a no-op for a true renewal (already disabled)
    // and the actual grant/application for a Default first-time applicant —
    // set regardless of outcome so a pending_review row still shows up
    // correctly in the admin queue and already carries the right category
    // by the time it's approved (see verify.php, Core Flow 2).
    $update = $conn->prepare("UPDATE commuters SET is_verified = ?, category = 'disabled', discount_id_url = ?, date_of_birth = ?, rejected_at = NULL WHERE id = ?");
    $update->bind_param("issi", $isVerified, $idFrontPath, $birthdate, $commuterId);
    $update->execute();

    $provider   = $faceMatch["provider"] ?? ($faceCenter["provider"] ?? "demo");
    $similarity = $faceMatch["similarity"];
    $ocrJson      = json_encode(["ocr_ran" => $ocrRan, "outcome" => $classification["outcome"]]);
    $livenessJson = json_encode(["provider" => $provider, "center_yaw" => $faceCenter["yaw"], "left_yaw" => $faceLeft["yaw"], "right_yaw" => $faceRight["yaw"]]);
    $verifiedAtStr = $now->format("Y-m-d H:i:s");

    $verifStmt = $conn->prepare("
        INSERT INTO commuter_id_verifications
            (commuter_id, category, last_name, first_name, middle_name, id_number,
             issuing_lgu, validity_date, birthdate,
             id_front_path, id_back_path, selfie_center_path, selfie_left_path, selfie_right_path,
             ocr_raw_text, ocr_match_result, face_match_score, liveness_result,
             provider, verification_status, verified_at, expires_at)
        VALUES (?, 'disabled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $verifParams = [
        ["i", $commuterId], ["s", $lastName], ["s", $firstName], ["s", $middleName],
        ["s", $idNumber], ["s", $issuingLgu], ["s", $validityDate], ["s", $birthdate],
        ["s", $idFrontPath], ["s", $idBackPath],
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
    echo json_encode(["success" => false, "stage" => "save", "message" => "Renewal failed while saving. Please try again."]);
    exit;
}

$outcomeForClient = $classification["outcome"] === "verified" ? "verified" : "pending_review";
echo json_encode([
    "success" => true,
    "outcome" => $outcomeForClient,
    "message" => $outcomeForClient === "verified"
        ? ($isFirstTimeApply ? "Your PWD discount has been verified." : "Your PWD verification has been renewed.")
        : "We couldn't automatically confirm this — it's been sent to an admin for manual review. Please allow up to 24 hours. In the meantime, you can still get your discount when boarding by showing your physical ID to the driver.",
]);
