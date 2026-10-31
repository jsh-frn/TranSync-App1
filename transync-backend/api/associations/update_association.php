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

// Extended for Association Profile/Settings (Core Flow "Association
// Settings") — was previously name-only with zero authentication (any
// request carrying a valid association_id could rename any association).
// Profile's existing inline Name edit still sends just {association_id,
// name} and keeps working with zero added friction; password is required
// only when contact_email/contact_phone (the login-credential-adjacent
// fields) are being changed — Settings' fuller "Edit Organization Info"
// form always sends it when touching either of those two.
$data           = json_decode(file_get_contents("php://input"), true);
$association_id = (int)($data["association_id"] ?? 0);
$name           = trim($data["name"] ?? "");
$acronym        = array_key_exists("acronym", $data) ? (trim($data["acronym"]) ?: null) : null;
$hasAcronym     = array_key_exists("acronym", $data);
$contact_email  = isset($data["contact_email"]) ? trim($data["contact_email"]) : null;
$contact_phone  = isset($data["contact_phone"]) ? trim($data["contact_phone"]) : null;
$address        = isset($data["address"]) ? trim($data["address"]) : null;
$password       = $data["password"] ?? "";

if (!$association_id || $name === "") {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "association_id and name are required."]);
    exit;
}

$changingCredentialFields = $contact_email !== null || $contact_phone !== null;

if ($changingCredentialFields) {
    if ($password === "") {
        echo json_encode(["success" => false, "message" => "Password confirmation is required to change email or phone."]);
        exit;
    }
    $stmt = $conn->prepare("SELECT password FROM associations WHERE id = ?");
    $stmt->bind_param("i", $association_id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row) {
        echo json_encode(["success" => false, "message" => "Association not found."]);
        exit;
    }
    if (!password_verify($password, $row["password"])) {
        echo json_encode(["success" => false, "message" => "Password is incorrect."]);
        exit;
    }

    if ($contact_email !== null) {
        if (!isValidEmailFormat($contact_email)) {
            echo json_encode(["success" => false, "message" => "Please enter a valid email address."]);
            exit;
        }
        if (emailAlreadyRegistered($conn, $contact_email, "associations", $association_id)) {
            echo json_encode(["success" => false, "message" => "This email is already linked to another account."]);
            exit;
        }
    }
    if ($contact_phone !== null) {
        if (phoneAlreadyRegistered($conn, $contact_phone, "associations", $association_id)) {
            echo json_encode(["success" => false, "message" => "This phone number is already linked to another account."]);
            exit;
        }
        // OTP verification for a phone change was tried and reverted on
        // request — password confirmation (already required above) is the
        // only gate now.
    }
}

$sets   = ["name = ?"];
$types  = "s";
$values = [$name];
if ($hasAcronym)             { $sets[] = "acronym = ?";       $types .= "s"; $values[] = $acronym; }
if ($contact_email !== null) { $sets[] = "contact_email = ?"; $types .= "s"; $values[] = $contact_email; }
if ($contact_phone !== null) { $sets[] = "contact_phone = ?"; $types .= "s"; $values[] = $contact_phone; }
if ($address !== null)       { $sets[] = "address = ?";       $types .= "s"; $values[] = $address; }
$types .= "i";
$values[] = $association_id;

$sql  = "UPDATE associations SET " . implode(", ", $sets) . " WHERE id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param($types, ...$values);
if (!$stmt->execute()) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Update failed."]);
    exit;
}

echo json_encode([
    "success"        => true,
    "name"           => $name,
    "acronym"        => $hasAcronym ? $acronym : null,
    "contact_email"  => $contact_email,
    "contact_phone"  => $contact_phone,
    "address"        => $address,
]);
