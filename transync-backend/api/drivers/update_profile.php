<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/account_validation.php";

// Driver Settings → Account Information. No existing inline-edit UX to
// preserve here — password is always required, same pattern as
// operators/update_profile.php. This is the driver's own self-service
// endpoint, distinct from drivers/drivers.php's action=update_details
// (the OPERATOR editing a driver they manage).
$data      = json_decode(file_get_contents("php://input"), true) ?? $_POST;
$driver_id = (int)($data["driver_id"] ?? 0);
$password  = $data["password"] ?? "";
$name      = isset($data["name"])  ? trim($data["name"])  : null;
$email     = isset($data["email"]) ? trim($data["email"]) : null;
$phone     = isset($data["phone"]) ? trim($data["phone"]) : null;

if (!$driver_id || $password === "") {
    echo json_encode(["success" => false, "message" => "Password confirmation is required."]);
    exit;
}
if (!$name && !$email && !$phone) {
    echo json_encode(["success" => false, "message" => "Change your name, email, and/or phone number before saving."]);
    exit;
}

$stmt = $conn->prepare("SELECT password FROM drivers WHERE id = ?");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    echo json_encode(["success" => false, "message" => "Driver not found."]);
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
    if (emailAlreadyRegistered($conn, $email, "drivers", $driver_id)) {
        echo json_encode(["success" => false, "message" => "This email is already linked to another account."]);
        exit;
    }
}
if ($phone) {
    if (phoneAlreadyRegistered($conn, $phone, "drivers", $driver_id)) {
        echo json_encode(["success" => false, "message" => "This phone number is already linked to another account."]);
        exit;
    }
    // OTP verification for a phone change was tried and reverted on request
    // — password confirmation (already required above) is the only gate now.
}

$sets   = [];
$types  = "";
$values = [];
if ($name)  { $sets[] = "name = ?";  $types .= "s"; $values[] = $name; }
if ($email) { $sets[] = "email = ?"; $types .= "s"; $values[] = $email; }
if ($phone) { $sets[] = "phone = ?"; $types .= "s"; $values[] = $phone; }
$types .= "i";
$values[] = $driver_id;

$sql = "UPDATE drivers SET " . implode(", ", $sets) . " WHERE id = ?";
$update = $conn->prepare($sql);
$update->bind_param($types, ...$values);
$update->execute();

echo json_encode([
    "success" => true,
    "message" => "Account information updated.",
    "name"    => $name,
    "email"   => $email,
    "phone"   => $phone,
]);
