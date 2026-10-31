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

// Lets an already-logged-in commuter switch discount category once their
// CURRENT category's verification has expired (e.g. a Student whose ID
// lapsed, who has since become eligible for PWD). Three possible outcomes
// for a disabled/elderly target, unlike the Student pipeline's binary pass/
// fail — see config/discount_switch_validation.php's classifySwitchVerification():
// verified (auto-approved immediately), uncertain (lands in the admin's
// existing VerifyUsers pending queue), or rejected (a confident fraud/
// ineligibility finding — nothing written, commuter retries immediately).
// Switching to 'default' never runs this pipeline at all — dropping a
// discount needs no verification.
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
$currentCategory = $commuter["category"];

$targetCategory = $_POST["target_category"] ?? "";
if (!in_array($targetCategory, ["default", "disabled", "elderly"], true)) {
    respondFail(400, "account", "Please choose a valid discount type to switch to.");
}
if ($targetCategory === $currentCategory) {
    respondFail(400, "account", "You're already registered under that discount type.");
}

// Authoritative server-side gate — never trust the client that the button
// should even be visible. Deliberately generic (checks whichever category
// the commuter currently holds, not hardcoded to 'student') so it naturally
// never passes for disabled/elderly, which never write an expires_at at all.
$gateStmt = $conn->prepare("
    SELECT id FROM commuter_id_verifications
    WHERE commuter_id = ? AND category = ? AND verification_status = 'verified'
      AND expires_at IS NOT NULL AND expires_at < NOW()
    ORDER BY verified_at DESC LIMIT 1
");
$gateStmt->bind_param("is", $commuterId, $currentCategory);
$gateStmt->execute();
if (!$gateStmt->get_result()->fetch_assoc()) {
    respondFail(400, "account", "You can only switch discount types after your current one has expired.");
}

// ── Branch A: switch to Standard — instant, no verification needed ─────────
if ($targetCategory === "default") {
    // Setting is_verified=1 and clearing discount_id_url (not just changing
    // category) matters, not just cosmetic — verify.php's admin pending
    // queue is `WHERE is_verified=0 AND rejected_at IS NULL AND (category !=
    // 'default' OR discount_id_url IS NOT NULL)`. Leaving the old ID photo
    // path non-NULL with is_verified still 0 would make this commuter
    // silently reappear as a phantom pending row.
    $stmt = $conn->prepare("UPDATE commuters SET category = 'default', is_verified = 1, discount_id_url = NULL, rejected_at = NULL WHERE id = ?");
    $stmt->bind_param("i", $commuterId);
    $stmt->execute();

    echo json_encode(["success" => true, "outcome" => "verified", "message" => "You've switched to Standard — no more discount, but no more re-verification either."]);
    exit;
}

// ── Branch B: switch to PWD or Senior Citizen — automated pipeline ─────────
$lastName     = trim($_POST["last_name"]     ?? "");
$firstName    = trim($_POST["first_name"]    ?? "");
$middleName   = trim($_POST["middle_name"]   ?? "") ?: null;
$idNumber     = trim($_POST["id_number"]     ?? "");
$birthdate    = trim($_POST["birthdate"]     ?? "") ?: null; // Senior Citizen only
$issuingLgu   = trim($_POST["issuing_lgu"]   ?? "") ?: null; // Senior Citizen + PWD
$dateIssued   = trim($_POST["date_issued"]   ?? "") ?: null; // Senior Citizen only
$validityDate = trim($_POST["validity_date"] ?? "") ?: null; // PWD only

if (!$lastName || !$firstName || !$idNumber) {
    respondFail(400, "details", "All details are required.");
}
if ($targetCategory === "elderly" && (!$birthdate || !$issuingLgu || !$dateIssued)) {
    respondFail(400, "details", "Please provide your birthdate, issuing LGU, and date issued.");
}
if ($targetCategory === "disabled" && (!$issuingLgu || !$validityDate)) {
    respondFail(400, "details", "Please provide your issuing LGU and ID validity date.");
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

// Duplicate ID number check — excludes this commuter's own prior rows (same
// exclusion shape as the Student pipeline's renewal path).
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

$fields = ["lastName" => $lastName, "firstName" => $firstName, "idNumber" => $idNumber, "birthdate" => $birthdate, "validityDate" => $validityDate];
$classification = classifySwitchVerification($targetCategory, $fields, $ocrText, $ocrRan, $faceMatch);

// Most outcomes short of a clean "verified" fall through to the admin's
// manual-review queue rather than hard-blocking — including what the
// classifier internally calls "rejected" (e.g. an ID-number mismatch or an
// under-60 age for Senior). Sending it to a human isn't the same as
// auto-approving it: the admin still makes the actual call, this just
// stops treating an inconclusive automatic check as the final word.
//
// "blocked" is the exception: either a face-match score confidently below
// FACE_MATCH_HARD_REJECT_BELOW (the selfie and the ID photo are confidently
// two different people — someone else's ID plus the applicant's own face),
// or, Senior Citizen only, an OCR-confirmed birthdate showing age < 60, or,
// PWD only, an OCR-confirmed Validity Date already in the past. None of
// these are ambiguous cases for an admin to weigh — the first is the exact
// impersonation this pipeline exists to catch, the other two are discount
// eligibility requirements, not judgment calls — so all three stay an
// immediate hard reject, same as liveness (checked earlier, above).
if ($classification["outcome"] === "blocked") {
    respondFail(422, $classification["stage"] ?? "face_match", $classification["message"]);
}

// ── Save files, update the account, record the audit row ──
function saveSwitchUpload(string $tmpPath, string $originalName, string $label): string {
    $ext        = pathinfo($originalName, PATHINFO_EXTENSION) ?: "jpg";
    $filename   = "switch_{$label}_" . time() . "_" . uniqid() . "." . $ext;
    $upload_dir = str_replace("\\", "/", dirname(dirname(__DIR__)) . "/uploads/commuters/");
    if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);
    move_uploaded_file($tmpPath, $upload_dir . $filename);
    return "uploads/commuters/" . $filename;
}

$idFrontPath = saveSwitchUpload($idFrontTmp, $_FILES["id_front"]["name"], "front");
$idBackPath  = saveSwitchUpload($idBackTmp, $_FILES["id_back"]["name"], "back");
$selfieCPath = saveSwitchUpload($selfieCTmp, $_FILES["selfie_center"]["name"], "selfie_center");
$selfieLPath = saveSwitchUpload($selfieLTmp, $_FILES["selfie_left"]["name"], "selfie_left");
$selfieRPath = saveSwitchUpload($selfieRTmp, $_FILES["selfie_right"]["name"], "selfie_right");

// 'verified' auto-approves immediately; 'uncertain' writes the exact same
// commuters row shape today's manual disabled/elderly registration already
// produces (category set, is_verified=0, discount_id_url set,
// rejected_at=NULL) — which is what makes this commuter automatically
// appear in verify.php's existing pending queue, with zero admin-panel
// changes needed.
$isVerified = $classification["outcome"] === "verified" ? 1 : 0;
$verificationStatus = $classification["outcome"] === "verified" ? "verified" : "pending_review";
$now = new DateTime();
// A pending-review outcome keeps the commuter at 'default' (full Regular
// access) — category only flips to the real claimed one once an admin
// approves it (auth/verify.php's commuter approve branch reads the claim
// back from commuter_id_verifications). The claim itself is still recorded
// truthfully below on the verification row, unaffected.
$accountCategory = $classification["outcome"] === "verified" ? $targetCategory : "default";

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("UPDATE commuters SET category = ?, is_verified = ?, discount_id_url = ?, rejected_at = NULL WHERE id = ?");
    $stmt->bind_param("sisi", $accountCategory, $isVerified, $idFrontPath, $commuterId);
    $stmt->execute();

    $provider   = $faceMatch["provider"] ?? ($faceCenter["provider"] ?? "demo");
    $similarity = $faceMatch["similarity"];
    $ocrJson      = json_encode(["ocr_ran" => $ocrRan, "outcome" => $classification["outcome"]]);
    $livenessJson = json_encode(["provider" => $provider, "center_yaw" => $faceCenter["yaw"], "left_yaw" => $faceLeft["yaw"], "right_yaw" => $faceRight["yaw"]]);
    $verifiedAtStr = $now->format("Y-m-d H:i:s");
    // PWD is renewable (expires_at = Validity Date at end-of-day, matching
    // commuter_register_pwd.php's convention); Senior Citizen still never
    // expires — expires_at stays NULL for that target, unchanged.
    $expiresAtStr = $targetCategory === "disabled" ? "{$validityDate} 23:59:59" : null;

    $verifStmt = $conn->prepare("
        INSERT INTO commuter_id_verifications
            (commuter_id, category, last_name, first_name, middle_name, id_number, birthdate,
             issuing_lgu, date_issued, validity_date,
             id_front_path, id_back_path, selfie_center_path, selfie_left_path, selfie_right_path,
             ocr_raw_text, ocr_match_result, face_match_score, liveness_result,
             provider, verification_status, verified_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    // Built as parallel (type, value) pairs, not a hand-counted placeholder
    // string — see commuter_register_student.php's identical note on why.
    $verifParams = [
        ["i", $commuterId], ["s", $targetCategory], ["s", $lastName], ["s", $firstName], ["s", $middleName],
        ["s", $idNumber], ["s", $birthdate], ["s", $issuingLgu], ["s", $dateIssued], ["s", $validityDate],
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
    echo json_encode(["success" => false, "stage" => "save", "message" => "Something went wrong while saving your submission. Please try again."]);
    exit;
}

$outcomeForClient = $classification["outcome"] === "verified" ? "verified" : "pending_review";
echo json_encode([
    "success" => true,
    "outcome" => $outcomeForClient,
    "message" => $outcomeForClient === "verified"
        ? $classification["message"]
        : "We couldn't automatically confirm this — it's been sent to an admin for manual review. Please allow up to 24 hours. In the meantime, you can still get your discount when boarding by showing your physical ID to the driver.",
]);
