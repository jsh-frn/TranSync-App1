<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";
require_once "../../config/account_validation.php";
require_once "../../config/consent.php";
require_once "../../config/phone_otp.php";

// Reads from $_POST (multipart/form-data) since we're uploading files.
//
// Authorized Representative — a real person record that didn't exist on
// this table at all before (only contact_email/contact_phone, no name).
// contact_email/contact_phone stay the representative's own login
// credentials, unchanged in meaning.
$rep_first_name  = trim($_POST["rep_first_name"]  ?? "");
$rep_middle_name = trim($_POST["rep_middle_name"] ?? "") ?: null;
$rep_last_name   = trim($_POST["rep_last_name"]   ?? "");
$rep_suffix      = trim($_POST["rep_suffix"]      ?? "") ?: null;
$rep_position    = trim($_POST["rep_position"]    ?? "");
$contact_email   = trim($_POST["contact_email"]   ?? "");
$contact_phone   = trim($_POST["contact_phone"]   ?? "");

// Association Information — the org's own identity, distinct from the
// representative's own contact_email/contact_phone above.
$name             = trim($_POST["name"]             ?? "");
$acronym          = trim($_POST["acronym"]          ?? "") ?: null;
$address          = trim($_POST["address"]          ?? "");
$official_email   = trim($_POST["official_email"]   ?? "");
// No longer collected on the redesigned registration screen — the
// representative's own contact_phone (already OTP-verified above) is
// enough; a separate org-level phone was real friction with no distinct
// purpose. Column stays, deprecated in place, unpopulated for new rows.
$official_phone   = trim($_POST["official_phone"]   ?? "") ?: null;

// New on the redesigned registration screen's profile step — for admin's
// own reference only, never read by any routing/matching/booking logic
// (see migration 054).
$coverage_area         = trim($_POST["coverage_area"] ?? "") ?: null;
$estimated_fleet_size  = isset($_POST["estimated_fleet_size"]) && $_POST["estimated_fleet_size"] !== ""
    ? (int)$_POST["estimated_fleet_size"] : null;

$password       = trim($_POST["password"]         ?? "");
$confirm        = trim($_POST["confirm_password"] ?? "");
$terms_accepted = $_POST["terms_accepted"] ?? null;

// Associations are deliberately type-agnostic now (association_type is
// deprecated — an association can have operator members of every vehicle
// type at once, see Core Flow 8) — this form no longer collects or writes
// it at all; the column is simply left unpopulated for new rows, same as
// every other current registration path already leaves it.

// ── VALIDATION ────────────────────────────────────────────────────────────────
$errors = [];

if (!$rep_first_name) $errors[] = "Authorized representative's first name is required.";
if (!$rep_last_name)  $errors[] = "Authorized representative's last name is required.";
if (!$rep_position)   $errors[] = "Authorized representative's position/role is required.";
if (!$contact_email)  $errors[] = "Official email address is required.";
if ($contact_email && !filter_var($contact_email, FILTER_VALIDATE_EMAIL)) $errors[] = "Invalid official email format.";
if (!$contact_phone)  $errors[] = "Mobile/phone number is required.";

if (!$name)    $errors[] = "Official association name is required.";
if (!$address) $errors[] = "Association address is required.";
if (!$official_email) $errors[] = "Association email is required.";
if ($official_email && !filter_var($official_email, FILTER_VALIDATE_EMAIL)) $errors[] = "Invalid association email format.";

if (!$password) $errors[] = "Password is required.";
// Matches this app's existing password-length convention everywhere else
// (driver edit, verification renewal, etc.) — was previously an
// inconsistent 8-char minimum on this endpoint only.
if (strlen($password) < 6) $errors[] = "Password must be at least 6 characters.";
if ($password !== $confirm) $errors[] = "Passwords do not match.";

// Association Registration/Accreditation Document (proves the organization
// itself is legitimate) and the Authorized Representative's own
// government-issued ID (proves who the person is) are both required —
// distinct documents for distinct things.
$hasDocument = isset($_FILES["association_doc"]) && $_FILES["association_doc"]["error"] === UPLOAD_ERR_OK;
if (!$hasDocument) {
    $errors[] = "Association Registration/Accreditation document is required.";
}
$hasRepId = isset($_FILES["rep_government_id"]) && $_FILES["rep_government_id"]["error"] === UPLOAD_ERR_OK;
if (!$hasRepId) {
    $errors[] = "A valid government-issued ID for the Authorized Representative is required.";
}
// Board Resolution or authorization letter — proves the representative is
// actually authorized to register on the organization's behalf. Reuses the
// already fully-dormant supporting_document_url column (migration 043,
// deprecated migration 044, confirmed zero live code references anywhere
// before this) rather than adding a new one.
$hasBoardResolution = isset($_FILES["board_resolution"]) && $_FILES["board_resolution"]["error"] === UPLOAD_ERR_OK;
if (!$hasBoardResolution) {
    $errors[] = "A Board Resolution or authorization letter is required.";
}

if (!termsWereAccepted($terms_accepted)) {
    $errors[] = "You must agree to the Association Terms & Conditions and Privacy Policy to continue.";
}

if (!empty($errors)) {
    http_response_code(422);
    echo json_encode(["message" => implode(" ", $errors)]);
    exit;
}

// ── CHECK DUPLICATE EMAIL (across every login-eligible table, not just
// associations — see commuter_register.php's identical note). Only
// contact_email is a login credential; official_email doesn't participate
// in this uniqueness check. ─────────────────────────────────────────────
if (emailAlreadyRegistered($conn, $contact_email)) {
    http_response_code(409);
    echo json_encode(["message" => "An account with this email already exists."]);
    exit;
}

// ── CHECK DUPLICATE PHONE (across all user tables) ────────────────────────────
$phoneChecks = [
    "SELECT id FROM commuters   WHERE phone         = ?",
    "SELECT id FROM operators   WHERE phone         = ?",
    "SELECT id FROM drivers     WHERE phone         = ?",
    "SELECT id FROM associations WHERE contact_phone = ?",
];
foreach ($phoneChecks as $sql) {
    $s = $conn->prepare($sql);
    $s->bind_param("s", $contact_phone);
    $s->execute();
    $s->store_result();
    if ($s->num_rows > 0) {
        http_response_code(409);
        echo json_encode(["message" => "This phone number is already linked to an existing account."]);
        exit;
    }
}

// ── PHONE OTP VERIFICATION (rep's own contact_phone — the login-adjacent
// number, not official_phone) — must have been verified before the account
// can be created, see migration 048. ───────────────────────────────────────
if (!isPhoneOtpVerified($conn, $contact_phone)) {
    http_response_code(403);
    echo json_encode(["message" => "Please verify the Authorized Representative's phone number first."]);
    exit;
}

// ── UPLOAD DOCUMENTS ───────────────────────────────────────────────────────────
$upload_dir = dirname(dirname(__DIR__)) . "/uploads/associations/";
$upload_dir = str_replace("\\", "/", $upload_dir);

if (!is_dir($upload_dir)) {
    mkdir($upload_dir, 0777, true);
}

$ext      = pathinfo($_FILES["association_doc"]["name"], PATHINFO_EXTENSION) ?: "jpg";
$filename = "assoc_" . time() . "_" . uniqid() . "." . $ext;
$target   = $upload_dir . $filename;

if (!move_uploaded_file($_FILES["association_doc"]["tmp_name"], $target)) {
    http_response_code(500);
    echo json_encode(["message" => "Failed to save document. Check folder permissions."]);
    exit;
}

$document_url = "uploads/associations/" . $filename;

$repIdExt      = pathinfo($_FILES["rep_government_id"]["name"], PATHINFO_EXTENSION) ?: "jpg";
$repIdFilename = "assoc_rep_id_" . time() . "_" . uniqid() . "." . $repIdExt;
if (!move_uploaded_file($_FILES["rep_government_id"]["tmp_name"], $upload_dir . $repIdFilename)) {
    http_response_code(500);
    echo json_encode(["message" => "Failed to save the representative's government ID. Check folder permissions."]);
    exit;
}
$rep_government_id_url = "uploads/associations/" . $repIdFilename;

$boardResExt      = pathinfo($_FILES["board_resolution"]["name"], PATHINFO_EXTENSION) ?: "jpg";
$boardResFilename = "assoc_board_res_" . time() . "_" . uniqid() . "." . $boardResExt;
if (!move_uploaded_file($_FILES["board_resolution"]["tmp_name"], $upload_dir . $boardResFilename)) {
    http_response_code(500);
    echo json_encode(["message" => "Failed to save the Board Resolution document. Check folder permissions."]);
    exit;
}
$supporting_document_url = "uploads/associations/" . $boardResFilename;

// ── INSERT — status = 'pending' so admin must verify first ────────────────────
$hashed = password_hash($password, PASSWORD_BCRYPT);

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("
        INSERT INTO associations
            (name, acronym, rep_first_name, rep_middle_name, rep_last_name, rep_suffix, rep_position,
             rep_government_id_url, address, contact_email, contact_phone, official_email, official_phone,
             coverage_area, estimated_fleet_size,
             password, document_url, supporting_document_url, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    ");
    $stmt->bind_param(
        "ssssssssssssssisss",
        $name, $acronym, $rep_first_name, $rep_middle_name, $rep_last_name, $rep_suffix, $rep_position,
        $rep_government_id_url, $address, $contact_email, $contact_phone, $official_email, $official_phone,
        $coverage_area, $estimated_fleet_size,
        $hashed, $document_url, $supporting_document_url
    );
    $stmt->execute();
    $association_id = $conn->insert_id;

    recordConsent($conn, "association", $association_id);
    consumePhoneOtpVerification($conn, $contact_phone);

    $conn->commit();
} catch (\Throwable $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["message" => "Registration failed. Please try again."]);
    exit;
}

http_response_code(201);
echo json_encode([
    "message"     => "Registration submitted. Please wait for admin verification before logging in.",
    "association" => [
        "id"            => $association_id,
        "name"          => $name,
        "contact_email" => $contact_email,
        "status"        => "pending",
    ]
]);
