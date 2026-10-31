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

// Structured personal-info fields — replaces the old single free-text
// `name` field so future Student/PWD/Senior verification can match identity
// fields reliably instead of parsing one. `name` (the column every existing
// screen already reads) is still populated below, concatenated from these,
// so nothing downstream needs to change.
$first_name    = trim($_POST["first_name"]    ?? "");
$middle_name   = trim($_POST["middle_name"]   ?? "") ?: null;
$last_name     = trim($_POST["last_name"]     ?? "");
$suffix        = trim($_POST["suffix"]        ?? "") ?: null;
// Date of Birth is no longer collected on the (redesigned, 2-step)
// registration screen — kept fully optional here rather than removed
// outright, since the column itself stays nullable and any historical/
// direct caller that still sends it keeps working unchanged.
$date_of_birth = trim($_POST["date_of_birth"] ?? "") ?: null;

$email          = trim($_POST["email"]    ?? "");
$phone          = trim($_POST["phone"]    ?? "");
$password       = $_POST["password"]      ?? "";
$category       = $_POST["category"]      ?? "default";
$terms_accepted = $_POST["terms_accepted"] ?? null;

$valid_categories = ["default", "student", "disabled", "elderly"];
if (!in_array($category, $valid_categories)) $category = "default";

if (!$first_name || !$last_name || !$email || !$phone || !$password) {
    http_response_code(400);
    echo json_encode(["message" => "All required fields must be filled in."]);
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
    echo json_encode(["message" => "You must agree to the Terms & Conditions and Privacy Policy to continue."]);
    exit;
}

if (!isValidEmailFormat($email)) {
    http_response_code(400);
    echo json_encode(["message" => "Please enter a valid email address."]);
    exit;
}

// Check duplicate email across every login-eligible table, not just
// commuters — otherwise the same email could exist as both a commuter and
// (say) an operator, and login_mobile.php's first-match-wins search would
// silently make one of the two accounts unreachable.
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

// Handle ID photo upload
$discount_id_url = null;
if (isset($_FILES["id_photo"]) && $_FILES["id_photo"]["error"] === UPLOAD_ERR_OK) {
    $ext        = pathinfo($_FILES["id_photo"]["name"], PATHINFO_EXTENSION) ?: "jpg";
    $filename   = "commuter_" . time() . "_" . uniqid() . "." . $ext;
    $upload_dir = dirname(dirname(__DIR__)) . "/uploads/commuters/";
    $upload_dir = str_replace("\\", "/", $upload_dir);

    if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);

    if (move_uploaded_file($_FILES["id_photo"]["tmp_name"], $upload_dir . $filename)) {
        $discount_id_url = "uploads/commuters/" . $filename;
    }
}

$name   = trim(implode(" ", array_filter([$first_name, $middle_name, $last_name, $suffix])));
$hashed = password_hash($password, PASSWORD_BCRYPT);

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("
        INSERT INTO commuters
            (name, first_name, middle_name, last_name, suffix, date_of_birth,
             email, phone, password, category, discount_id_url, status, is_verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)
    ");
    $stmt->bind_param(
        "sssssssssss",
        $name, $first_name, $middle_name, $last_name, $suffix, $date_of_birth,
        $email, $phone, $hashed, $category, $discount_id_url
    );
    $stmt->execute();
    $commuter_id = $conn->insert_id;

    $wallet = $conn->prepare("INSERT INTO wallets (commuter_id, balance) VALUES (?, 0.00)");
    $wallet->bind_param("i", $commuter_id);
    $wallet->execute();

    recordConsent($conn, "commuter", $commuter_id);
    consumePhoneOtpVerification($conn, $phone);

    $conn->commit();
} catch (\Throwable $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["message" => "Registration failed. Please try again."]);
    exit;
}

echo json_encode(["message" => "Registration successful."]);
