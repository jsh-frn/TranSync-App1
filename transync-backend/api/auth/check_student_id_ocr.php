<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

require_once "../../config/student_verification.php";
require_once "../../config/academic_validation.php";

// Read-only pre-check run automatically right after ID front/back capture
// (student-verification.tsx's "id_check" step) — decides whether the wizard
// needs to ask for an Enrollment Form/COE next, replacing the old manual
// "Does your ID show a printed validity date?" question with an actual OCR
// read of the two ID photos. Mirrors this codebase's existing
// preview-before-commit pattern (reservations/preview_ticket.php) — same
// idea, nothing is written to the database here. The FINAL submission
// endpoints re-run this exact same check as the authoritative server-side
// gate; this is purely a UX convenience so the wizard doesn't make the
// commuter fill out the whole rest of the flow before finding out an
// enrollment form was needed.
$idType       = $_POST['id_type']       ?? '';
$academicYear = trim($_POST['academic_year'] ?? '');

if (!in_array($idType, ['k12', 'college'], true) || !$academicYear) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "id_type and academic_year are required."]);
    exit;
}

function reqFile(string $field): ?string {
    if (!isset($_FILES[$field]) || $_FILES[$field]["error"] !== UPLOAD_ERR_OK) return null;
    return $_FILES[$field]["tmp_name"];
}
$idFrontTmp = reqFile('id_front');
$idBackTmp  = reqFile('id_back');
if (!$idFrontTmp || !$idBackTmp) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "id_front and id_back are required."]);
    exit;
}

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

// Tesseract unavailable — soft-skip, same philosophy as everywhere else in
// this pipeline: don't force an enrollment form just because we couldn't
// check, default to "sufficient" and let the facial-capture steps proceed.
if (!$ocrRan) {
    echo json_encode(["success" => true, "ocr_ran" => false, "sufficient" => true, "missing" => []]);
    exit;
}

$result = checkRequiredDetailsOnDocument($academicYear, $ocrText);
echo json_encode([
    "success"    => true,
    "ocr_ran"    => true,
    "sufficient" => $result["sufficient"],
    "missing"    => $result["missing"],
]);
