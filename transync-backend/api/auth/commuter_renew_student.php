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

// Renewal counterpart to commuter_register_student.php — same verification
// pipeline (OCR cross-check, pose-challenge liveness, face-match), but
// against an EXISTING, already-logged-in commuter, not a brand new account.
// No name/email/phone/password here, and no 48h cooldown — expiry isn't a
// rejection, so the commuter can re-verify immediately.
//
// Also doubles as the FIRST-TIME application path for a Default commuter
// applying for the Student discount from Settings (see Core Flow 2b) — the
// only difference from a true renewal is the commuter's starting category;
// the verification pipeline and stored row are identical either way, so
// this is a category-gate relaxation, not a second pipeline.
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
// 'default' is a first-time applicant (never verified anything); 'student'
// is a true renewal. Anything else (disabled/elderly) isn't reachable from
// either the Settings "Apply" entry or the expired-Student renewal button.
$isFirstTimeApply = $commuter["category"] === "default";
if (!$isFirstTimeApply && $commuter["category"] !== "student") {
    respondFail(400, "account", "This flow is only for Default or existing Student accounts.");
}

// ── Student-specific fields (same shape as commuter_register_student.php) ──
$lastName        = trim($_POST["last_name"]         ?? "");
$firstName       = trim($_POST["first_name"]        ?? "");
$middleName      = trim($_POST["middle_name"]        ?? "") ?: null;
$schoolName      = trim($_POST["school_name"]        ?? "");
$academicYear    = trim($_POST["academic_year"]      ?? "");
$studentIdNumber = trim($_POST["student_id_number"]  ?? "");
$idType          = $_POST["id_type"]                  ?? "";
$birthdate       = trim($_POST["birthdate"]           ?? "");

if (!$lastName || !$firstName || !$schoolName || !$academicYear || !$studentIdNumber || !$birthdate) {
    respondFail(400, "details", "All student details are required.");
}
$dob = DateTime::createFromFormat('Y-m-d', $birthdate);
$dobErrors = DateTime::getLastErrors();
if (!$dob || ($dobErrors && ($dobErrors["warning_count"] > 0 || $dobErrors["error_count"] > 0)) || $dob > new DateTime("today")) {
    respondFail(400, "details", "Please enter a valid birthday.");
}
if (!in_array($idType, ["k12", "college"], true)) {
    respondFail(400, "details", "Please select whether this is a K-12 or College ID.");
}

// Semester (College only) is derived from the server clock, never from the
// commuter or the document — see config/academic_validation.php.
$semester = $idType === "college" ? currentAcademicYearSuggestion("college")["semester"] : null;

function requiredFileTmpPath(string $field): ?string {
    if (!isset($_FILES[$field]) || $_FILES[$field]["error"] !== UPLOAD_ERR_OK) return null;
    return $_FILES[$field]["tmp_name"];
}

$idFrontTmp = requiredFileTmpPath("id_front");
$idBackTmp  = requiredFileTmpPath("id_back");
$selfieCTmp = requiredFileTmpPath("selfie_center");
$selfieLTmp = requiredFileTmpPath("selfie_left");
$selfieRTmp = requiredFileTmpPath("selfie_right");
$enrollTmp  = requiredFileTmpPath("enrollment_form");

if (!$idFrontTmp || !$idBackTmp) {
    respondFail(400, "id_capture", "Please capture both the front and back of your ID.");
}
if (!$selfieCTmp || !$selfieLTmp || !$selfieRTmp) {
    respondFail(400, "facial_capture", "Please complete all three facial capture photos.");
}

// Duplicate Student ID number check excludes this commuter's own prior
// verification row(s) — re-submitting the same real ID they already own
// must not look like a collision with themselves.
$stmt = $conn->prepare("
    SELECT id FROM commuter_id_verifications
    WHERE student_id_number = ? AND commuter_id != ?
");
$stmt->bind_param("si", $studentIdNumber, $commuterId);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    respondFail(409, "details", "This Student ID number is already registered to another account.");
}

$periodCheck = validateAcademicPeriod($idType, $academicYear);
if (!$periodCheck["valid"]) {
    respondFail(422, "details", $periodCheck["message"]);
}

$ocrText = "";
$ocrRan  = false;
foreach (array_filter([$idFrontTmp, $idBackTmp, $enrollTmp]) as $imgPath) {
    $ocr = runTesseractOcr($imgPath);
    if ($ocr["skipped"]) continue;
    $ocrRan = true;
    if ($ocr["success"] && $ocr["text"]) {
        $ocrText .= "\n" . $ocr["text"];
    }
}

if ($ocrRan) {
    if (!fuzzyNameMatch($lastName, $firstName, $ocrText)) {
        respondFail(422, "ocr", "We couldn't find your name on the captured ID/enrollment form. Please retake the photos with better lighting and make sure the text is readable.");
    }
    if (!ocrContainsIdNumber($studentIdNumber, $ocrText)) {
        respondFail(422, "ocr", "We couldn't find your Student ID number on the captured photos. Please double check the number you typed and retake the ID photos.");
    }
    if (!fuzzySchoolMatch($schoolName, $ocrText)) {
        respondFail(422, "ocr", "We couldn't find your school name on the captured ID/enrollment form. Please double check what you typed and retake the photos with better lighting.");
    }
    $detailsCheck = checkRequiredDetailsOnDocument($academicYear, $ocrText);
    if (!$detailsCheck["sufficient"]) {
        // TEMPORARY DIAGNOSTIC — remove once the real-world OCR-miss report
        // is root-caused, see commuter_register_student.php's matching note.
        $debugSnippet = substr(preg_replace('/\s+/', ' ', trim($ocrText)), 0, 400);
        respondFail(422, $enrollTmp ? "ocr" : "enrollment_form", $enrollTmp
            ? "We couldn't confirm your academic year on the captured documents. Please retake with better lighting. [DEBUG OCR: {$debugSnippet}]"
            : "We couldn't find your academic year on your ID. Please also capture your Enrollment Form or Certificate of Enrollment.");
    }
}

$faceCenter = rekognitionDetectFaces($selfieCTmp);
$faceLeft   = rekognitionDetectFaces($selfieLTmp);
$faceRight  = rekognitionDetectFaces($selfieRTmp);

$liveness = checkPoseChallenge($faceCenter, $faceLeft, $faceRight);
if (!$liveness["success"]) {
    respondFail(422, "liveness", $liveness["error"]);
}

$faceMatch = rekognitionCompareFaces($selfieCTmp, $idFrontTmp);
if (!$faceMatch["success"]) {
    respondFail(422, "face_match", $faceMatch["error"] ?? "We couldn't verify that the selfie matches your ID photo.");
}

// ── Every stage passed — save files, record the renewal, restore verified status ──
function saveStudentUpload(string $tmpPath, string $originalName, string $label): string {
    $ext        = pathinfo($originalName, PATHINFO_EXTENSION) ?: "jpg";
    $filename   = "student_{$label}_" . time() . "_" . uniqid() . "." . $ext;
    $upload_dir = str_replace("\\", "/", dirname(dirname(__DIR__)) . "/uploads/commuters/");
    if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);
    move_uploaded_file($tmpPath, $upload_dir . $filename);
    return "uploads/commuters/" . $filename;
}

$idFrontPath = saveStudentUpload($idFrontTmp, $_FILES["id_front"]["name"], "front");
$idBackPath  = saveStudentUpload($idBackTmp, $_FILES["id_back"]["name"], "back");
$enrollPath  = $enrollTmp ? saveStudentUpload($enrollTmp, $_FILES["enrollment_form"]["name"], "enrollment") : null;
$selfieCPath = saveStudentUpload($selfieCTmp, $_FILES["selfie_center"]["name"], "selfie_center");
$selfieLPath = saveStudentUpload($selfieLTmp, $_FILES["selfie_left"]["name"], "selfie_left");
$selfieRPath = saveStudentUpload($selfieRTmp, $_FILES["selfie_right"]["name"], "selfie_right");

$now     = new DateTime();
$expires = $periodCheck["expires_at"];

$conn->begin_transaction();
try {
    // category='student' is a no-op UPDATE for a true renewal (already
    // student) and the actual first-time grant for a Default applicant.
    $update = $conn->prepare("UPDATE commuters SET is_verified = 1, category = 'student', discount_id_url = ?, date_of_birth = ? WHERE id = ?");
    $update->bind_param("ssi", $idFrontPath, $birthdate, $commuterId);
    $update->execute();

    $provider      = $faceMatch["provider"];
    $similarity    = $faceMatch["similarity"];
    $ocrJson       = json_encode(["ocr_ran" => $ocrRan, "name_matched" => $ocrRan ?: null, "id_number_matched" => $ocrRan ?: null]);
    $livenessJson  = json_encode(["provider" => $provider, "center_yaw" => $faceCenter["yaw"], "left_yaw" => $faceLeft["yaw"], "right_yaw" => $faceRight["yaw"]]);
    $verifiedAtStr = $now->format("Y-m-d H:i:s");
    $expiresAtStr  = $expires->format("Y-m-d H:i:s");

    $verifStmt = $conn->prepare("
        INSERT INTO commuter_id_verifications
            (commuter_id, category, last_name, first_name, middle_name, birthdate, school_name, academic_year, semester,
             student_id_number, id_type, id_front_path, id_back_path, enrollment_form_path,
             selfie_center_path, selfie_left_path, selfie_right_path,
             ocr_raw_text, ocr_match_result, face_match_score, liveness_result,
             provider, verification_status, verified_at, expires_at)
        VALUES (?, 'student', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)
    ");
    $verifParams = [
        ["i", $commuterId], ["s", $lastName], ["s", $firstName], ["s", $middleName], ["s", $birthdate],
        ["s", $schoolName], ["s", $academicYear], ["s", $semester], ["s", $studentIdNumber], ["s", $idType],
        ["s", $idFrontPath], ["s", $idBackPath], ["s", $enrollPath],
        ["s", $selfieCPath], ["s", $selfieLPath], ["s", $selfieRPath],
        ["s", $ocrText], ["s", $ocrJson], ["d", $similarity], ["s", $livenessJson],
        ["s", $provider], ["s", $verifiedAtStr], ["s", $expiresAtStr],
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

echo json_encode([
    "success" => true,
    "message" => $isFirstTimeApply
        ? "Your Student discount has been verified."
        : "Your Student verification has been renewed.",
]);
