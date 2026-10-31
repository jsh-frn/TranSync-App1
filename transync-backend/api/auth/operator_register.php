<?php
header("Content-Type: application/json");

require_once "../../config/db.php";
require_once "../../config/account_validation.php";
require_once "../../config/consent.php";
require_once "../../config/phone_otp.php";

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

// Registration is generic — no vehicle type, no association (that stays a
// separate step, operators/apply_to_association.php, reachable from an
// "Apply to an association now?" prompt after this succeeds), and no
// association-tied address either — an operator can apply to and manage
// vehicles under multiple different associations at once (Core Flow 8), so
// nothing here belongs to any one of them. A single registration document
// is still required so the admin has something concrete to verify the
// account against — separate from (and in addition to) the vehicle-type-
// specific LTO/LTFRB document checklist submitted later per association
// application.
//
// Structured personal-info fields (first/middle/last/suffix/DOB) replace a
// single free-text name — `name` still exists and is populated below by
// concatenating these, so it keeps meaning exactly what it always has (the
// account holder's own name, read by the dashboard greeting/avatar
// initials/etc.), not the business.
//
// entity_type (Individual Operator | Business/Company) is a distinct concept
// from the legacy, deprecated `operators.operator_type` column (Jeepney
// Op|UV Op|Bus Op — a VEHICLE type, unread by any current code path) — never
// confuse the two or write entity_type's value into that column.
$first_name    = trim($_POST["first_name"]    ?? "");
$middle_name   = trim($_POST["middle_name"]   ?? "") ?: null;
$last_name     = trim($_POST["last_name"]     ?? "");
$suffix        = trim($_POST["suffix"]        ?? "") ?: null;
// No longer collected on the redesigned (3-step) registration screen —
// kept fully optional, same convention as commuter_register.php.
$date_of_birth = trim($_POST["date_of_birth"] ?? "") ?: null;

$email    = trim($_POST["email"]    ?? "");
$phone    = trim($_POST["phone"]    ?? "");
$password = $_POST["password"]      ?? "";

$entity_type    = $_POST["entity_type"]           ?? "";
// Both optional on the redesigned registration screen — a separate
// "Business Phone" was real friction on top of the operator's own already
// OTP-verified phone (same simplification principle as dropping
// Association's separate official phone, see association_register.php),
// and Business Name is superseded by the DTI/SEC document collected at
// Step 3 (a business identity document, not a free-typed duplicate of it).
$business_name  = trim($_POST["business_name"]    ?? "") ?: null;
$business_phone = trim($_POST["business_phone"]   ?? "") ?: null;

$terms_accepted = $_POST["terms_accepted"] ?? null;

if (!$first_name || !$last_name || !$email || !$phone || !$password) {
    http_response_code(400);
    echo json_encode(["message" => "All required fields must be filled in."]);
    exit;
}

if (!in_array($entity_type, ["individual", "business"], true)) {
    http_response_code(400);
    echo json_encode(["message" => "Please select an Operator Type."]);
    exit;
}

if ($date_of_birth !== null) {
    $dob = DateTime::createFromFormat("Y-m-d", $date_of_birth);
    $dobErrors = DateTime::getLastErrors();
    if (!$dob || ($dobErrors && ($dobErrors["warning_count"] > 0 || $dobErrors["error_count"] > 0)) || $dob > new DateTime("today")) {
        http_response_code(400);
        echo json_encode(["message" => "Please enter a valid date of birth."]);
        exit;
    }
}

if (!termsWereAccepted($terms_accepted)) {
    http_response_code(400);
    echo json_encode(["message" => "You must agree to the Operator Terms & Conditions and Privacy Policy to continue."]);
    exit;
}

if (!isValidEmailFormat($email)) {
    http_response_code(400);
    echo json_encode(["message" => "Please enter a valid email address."]);
    exit;
}

// Check duplicate email across every login-eligible table, not just
// operators — see commuter_register.php's identical note.
if (emailAlreadyRegistered($conn, $email)) {
    http_response_code(409);
    echo json_encode(["message" => "Email already registered."]);
    exit;
}

// Check duplicate phone (across all user tables)
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
        http_response_code(409);
        echo json_encode(["message" => "This phone number is already linked to an existing account."]);
        exit;
    }
}

// Phone must have been verified via OTP (auth/send_phone_otp.php +
// verify_phone_otp.php) before the account can be created — see migration 048.
if (!isPhoneOtpVerified($conn, $phone)) {
    http_response_code(403);
    echo json_encode(["message" => "Please verify your phone number first."]);
    exit;
}

// The single generic "valid ID or business permit" document is superseded
// by three specific, purpose-relevant documents collected at registration
// Step 3 — a Driver's License, the vehicle's own OR/CR, and a business
// registration document (DTI for a sole proprietor, SEC for a corporation —
// one column either way, same convention as the commuter pipeline sharing
// one `id_number` column between PWD/Senior). All three required, same
// reasoning Do Not Break rule #38 already established for the old single
// doc: the admin needs something concrete to verify the account against;
// this is that requirement, just satisfied more specifically.
// `registration_document_url` itself stays in the schema, deprecated in
// place, unpopulated for new rows (see migration 054).
$upload_dir = dirname(dirname(__DIR__)) . "/uploads/operators/";
$upload_dir = str_replace("\\", "/", $upload_dir);
if (!is_dir($upload_dir)) {
    mkdir($upload_dir, 0777, true);
}

function requireOperatorDoc(string $field, string $label, string $prefix, string $uploadDir): string {
    if (!isset($_FILES[$field]) || $_FILES[$field]["error"] !== UPLOAD_ERR_OK) {
        $err = isset($_FILES[$field]) ? $_FILES[$field]["error"] : "not received";
        http_response_code(400);
        echo json_encode(["message" => "A {$label} is required. Error code: {$err}"]);
        exit;
    }
    $ext      = pathinfo($_FILES[$field]["name"], PATHINFO_EXTENSION) ?: "jpg";
    $filename = "{$prefix}_" . time() . "_" . uniqid() . "." . $ext;
    if (!move_uploaded_file($_FILES[$field]["tmp_name"], $uploadDir . $filename)) {
        http_response_code(500);
        echo json_encode(["message" => "Failed to save {$label}. Check folder permissions."]);
        exit;
    }
    return "uploads/operators/" . $filename;
}

$drivers_license_url       = requireOperatorDoc("drivers_license", "Driver's License photo", "license", $upload_dir);
$vehicle_or_cr_url          = requireOperatorDoc("vehicle_or_cr", "Vehicle OR/CR photo", "orcr", $upload_dir);
$business_registration_url  = requireOperatorDoc("business_registration", "Business Name Registration document (DTI/SEC)", "bizreg", $upload_dir);

$name   = trim(implode(" ", array_filter([$first_name, $middle_name, $last_name, $suffix])));
$hashed = password_hash($password, PASSWORD_BCRYPT);

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("
        INSERT INTO operators
            (name, first_name, middle_name, last_name, suffix, date_of_birth,
             entity_type, business_name, business_phone, email, phone, password,
             drivers_license_url, vehicle_or_cr_url, business_registration_url, status, is_verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)
    ");
    $stmt->bind_param(
        "sssssssssssssss",
        $name, $first_name, $middle_name, $last_name, $suffix, $date_of_birth,
        $entity_type, $business_name, $business_phone, $email, $phone, $hashed,
        $drivers_license_url, $vehicle_or_cr_url, $business_registration_url
    );
    $stmt->execute();
    $operator_id = $conn->insert_id;

    recordConsent($conn, "operator", $operator_id);
    consumePhoneOtpVerification($conn, $phone);

    $conn->commit();
} catch (\Throwable $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["message" => "Registration failed. Please try again."]);
    exit;
}

echo json_encode(["message" => "Registration successful.", "id" => $operator_id]);
