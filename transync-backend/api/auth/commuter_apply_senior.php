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

// First-time Senior Citizen discount application for an ALREADY-LOGGED-IN,
// already-registered Default commuter — reached from Settings ("Apply for
// Senior Citizen Discount"), see Core Flow 2b. Not a renewal: Senior
// verification never expires (Core Flow 2a), so unlike Student/PWD there is
// no commuter_renew_senior.php to relax — this is the first and only place a
// logged-in commuter can gain the 'elderly' category. Reuses the exact same
// classifySwitchVerification() pipeline as commuter_register_senior.php
// (which this file otherwise mirrors closely), just UPDATEing the existing
// commuter row instead of INSERTing a new account — no
// name/email/phone/password/consent/wallet/OTP handling here, all of that
// already happened at the original registration.
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
if ($commuter["category"] !== "default") {
    respondFail(400, "account", "This flow is only for Default accounts applying for the first time.");
}

// ── Senior Citizen ID fields (same shape as commuter_register_senior.php) ──
$lastName   = trim($_POST["last_name"]   ?? "");
$firstName  = trim($_POST["first_name"]  ?? "");
$middleName = trim($_POST["middle_name"] ?? "") ?: null;
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

// Duplicate ID number check excludes this commuter's own prior rows, same
// exclusion shape as commuter_renew_pwd.php/commuter_switch_category.php —
// shares the id_number uniqueness namespace with PWD (Core Flow 2a).
$stmt = $conn->prepare("SELECT id FROM commuter_id_verifications WHERE id_number = ? AND commuter_id != ?");
$stmt->bind_param("si", $idNumber, $commuterId);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    respondFail(409, "details", "This ID number is already registered to another account.");
}

// ── OCR cross-check (soft-skips if Tesseract isn't installed) ──
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

// ── Pose-challenge liveness — always a hard, immediate retake on failure ──
$faceCenter = rekognitionDetectFaces($selfieCTmp);
$faceLeft   = rekognitionDetectFaces($selfieLTmp);
$faceRight  = rekognitionDetectFaces($selfieRTmp);

$liveness = checkPoseChallenge($faceCenter, $faceLeft, $faceRight);
if (!$liveness["success"]) {
    respondFail(422, "liveness", $liveness["error"]);
}

// ── Face match — read directly into the classifier below ──
$faceMatch = rekognitionCompareFaces($selfieCTmp, $idFrontTmp);

$fields = ["lastName" => $lastName, "firstName" => $firstName, "idNumber" => $idNumber, "birthdate" => $birthdate];
$classification = classifySwitchVerification("elderly", $fields, $ocrText, $ocrRan, $faceMatch);

// 'blocked' (confident impersonation, or a confirmed under-60 age) is an
// immediate hard reject — nothing written, same as registration.
if ($classification["outcome"] === "blocked") {
    respondFail(422, $classification["stage"] ?? "details", $classification["message"]);
}

// ── Save files, update the account, record the audit row ──
function saveSeniorApplyUpload(string $tmpPath, string $originalName, string $label): string {
    $ext        = pathinfo($originalName, PATHINFO_EXTENSION) ?: "jpg";
    $filename   = "senior_apply_{$label}_" . time() . "_" . uniqid() . "." . $ext;
    $upload_dir = str_replace("\\", "/", dirname(dirname(__DIR__)) . "/uploads/commuters/");
    if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);
    move_uploaded_file($tmpPath, $upload_dir . $filename);
    return "uploads/commuters/" . $filename;
}

$idFrontPath = saveSeniorApplyUpload($idFrontTmp, $_FILES["id_front"]["name"], "front");
$idBackPath  = saveSeniorApplyUpload($idBackTmp, $_FILES["id_back"]["name"], "back");
$selfieCPath = saveSeniorApplyUpload($selfieCTmp, $_FILES["selfie_center"]["name"], "selfie_center");
$selfieLPath = saveSeniorApplyUpload($selfieLTmp, $_FILES["selfie_left"]["name"], "selfie_left");
$selfieRPath = saveSeniorApplyUpload($selfieRTmp, $_FILES["selfie_right"]["name"], "selfie_right");

$now = new DateTime();

$isVerified          = $classification["outcome"] === "verified" ? 1 : 0;
$verificationStatus  = $classification["outcome"] === "verified" ? "verified" : "pending_review";
// A pending-review applicant keeps full "Regular" access, not a half-claimed
// state — category only flips to 'elderly' once verified here or approved
// by an admin later (auth/verify.php), same convention as registration.
$accountCategory = $classification["outcome"] === "verified" ? "elderly" : "default";

$conn->begin_transaction();
try {
    $update = $conn->prepare("UPDATE commuters SET is_verified = ?, category = ?, discount_id_url = ?, rejected_at = NULL WHERE id = ?");
    $update->bind_param("issi", $isVerified, $accountCategory, $idFrontPath, $commuterId);
    $update->execute();

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
    echo json_encode(["success" => false, "stage" => "save", "message" => "Application failed while saving. Please try again."]);
    exit;
}

echo json_encode([
    "success" => true,
    "outcome" => $classification["outcome"] === "verified" ? "verified" : "pending_review",
    "message" => $classification["outcome"] === "verified"
        ? "Your Senior Citizen discount has been verified."
        : "We couldn't automatically confirm your Senior Citizen ID — it's been sent to an admin for manual review. Please allow up to 24 hours. In the meantime, you can still get your discount when boarding by showing your physical ID to the driver.",
]);
