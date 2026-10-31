<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/academic_validation.php";

// Auto-fills the Student verification wizard's Academic Year field (now
// read-only, no manual typing — see currentAcademicYearSuggestion()) and
// defaults the College Semester picker. The single source of truth for
// "what is the current academic period" lives here so the client never
// computes it independently and risks drifting from what
// validateAcademicPeriod() itself would accept at submission time.
$idType = $_GET['id_type'] ?? '';
if (!in_array($idType, ['k12', 'college'], true)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "id_type must be k12 or college."]);
    exit;
}

$suggestion = currentAcademicYearSuggestion($idType);
echo json_encode([
    "success"       => true,
    "academic_year" => $suggestion["academic_year"],
    "semester"      => $suggestion["semester"],
]);
