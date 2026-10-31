<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/account_validation.php";

// Settings → Account Information — Name, Email, Phone edited together under
// one password confirmation (Core Flow 2b). Name fields are optional: only
// present when the commuter actually changed one (client sends them only if
// different from the current value, same convention already used for
// email/phone below). Freely editable, no verification-status gate — the
// discount pipeline checks category/is_verified at fare time, not a live
// name re-match against commuter_id_verifications, so nothing breaks.
$data        = json_decode(file_get_contents("php://input"), true) ?? $_POST;
$commuter_id = (int)($data["commuter_id"] ?? 0);
$password    = $data["password"] ?? "";
$email       = isset($data["email"]) ? trim($data["email"]) : null;
$phone       = isset($data["phone"]) ? trim($data["phone"]) : null;

// Suffix is no longer collected/editable from the mobile UI (dropped
// alongside the registration redesign) — deliberately not read from $data
// or written to at all here anymore, so an existing account's on-file
// suffix (from before this change) is never silently cleared just because
// the client stopped sending it.
$editing_name = isset($data["first_name"]) || isset($data["last_name"]);
$first_name   = isset($data["first_name"])  ? trim($data["first_name"])  : null;
$middle_name  = isset($data["middle_name"]) ? (trim($data["middle_name"]) ?: null) : null;
$last_name    = isset($data["last_name"])   ? trim($data["last_name"])   : null;

if (!$commuter_id || $password === "") {
    echo json_encode(["success" => false, "message" => "Password confirmation is required."]);
    exit;
}
if (!$email && !$phone && !$editing_name) {
    echo json_encode(["success" => false, "message" => "Change your name, email, and/or phone number before saving."]);
    exit;
}
if ($editing_name && (!$first_name || !$last_name)) {
    echo json_encode(["success" => false, "message" => "First and last name are required."]);
    exit;
}

$stmt = $conn->prepare("SELECT password, suffix FROM commuters WHERE id = ?");
$stmt->bind_param("i", $commuter_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    echo json_encode(["success" => false, "message" => "Commuter not found."]);
    exit;
}
if (!password_verify($password, $row["password"])) {
    echo json_encode(["success" => false, "message" => "Password is incorrect."]);
    exit;
}

if ($email) {
    if (!isValidEmailFormat($email)) {
        echo json_encode(["success" => false, "message" => "Please enter a valid email address."]);
        exit;
    }
    if (emailAlreadyRegistered($conn, $email, "commuters", $commuter_id)) {
        echo json_encode(["success" => false, "message" => "This email is already linked to another account."]);
        exit;
    }
}
if ($phone) {
    if (phoneAlreadyRegistered($conn, $phone, "commuters", $commuter_id)) {
        echo json_encode(["success" => false, "message" => "This phone number is already linked to another account."]);
        exit;
    }
    // OTP verification for a phone change was tried and reverted on request
    // — password confirmation (already required above) is the only gate now,
    // matching every other field on this form.
}

$sets   = [];
$types  = "";
$values = [];
if ($email) { $sets[] = "email = ?"; $types .= "s"; $values[] = $email; }
if ($phone) { $sets[] = "phone = ?"; $types .= "s"; $values[] = $phone; }

$name = null;
if ($editing_name) {
    // Same concatenation commuter_register.php uses — `name` stays the
    // single field every existing screen reads, kept in sync with the
    // structured fields underneath it. Suffix is no longer editable here
    // (see the note above) but a pre-existing one (from before this
    // redesign) must still appear in the concatenated `name`, not silently
    // drop out just because first/last name was edited.
    $name = trim(implode(" ", array_filter([$first_name, $middle_name, $last_name, $row["suffix"]])));
    $sets[] = "name = ?";          $types .= "s"; $values[] = $name;
    $sets[] = "first_name = ?";    $types .= "s"; $values[] = $first_name;
    $sets[] = "middle_name = ?";   $types .= "s"; $values[] = $middle_name;
    $sets[] = "last_name = ?";     $types .= "s"; $values[] = $last_name;
}

$types .= "i";
$values[] = $commuter_id;

$sql = "UPDATE commuters SET " . implode(", ", $sets) . " WHERE id = ?";
$update = $conn->prepare($sql);
$update->bind_param($types, ...$values);
$update->execute();

echo json_encode([
    "success" => true,
    "message" => "Account information updated.",
    "name"    => $name,
    "email"   => $email ?? null,
    "phone"   => $phone ?? null,
]);
