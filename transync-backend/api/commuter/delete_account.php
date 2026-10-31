<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Permanent soft-delete (Commuter Settings — Delete Account, migration 046).
// Scrubs personally-identifying fields on the commuters row and permanently
// blocks login (the anonymized email/phone can never match a future login
// attempt with the original credentials) — but deliberately leaves wallets,
// reservations, wallet_transactions, and commuter_id_verifications fully
// intact. Reservations already store passenger_name independently at
// booking time (see reservations/operator_rebook.php's own INSERT), so
// nothing downstream breaks or goes blank once this account's name is gone.
$data        = json_decode(file_get_contents("php://input"), true) ?? $_POST;
$commuter_id = (int)($data["commuter_id"] ?? 0);
$password    = $data["password"] ?? "";

if (!$commuter_id || $password === "") {
    echo json_encode(["success" => false, "message" => "Password confirmation is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT password FROM commuters WHERE id = ?");
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

// ".invalid" is the RFC 2606-reserved TLD for exactly this — a placeholder
// that can never resolve or collide with a real address. Unique per id so
// the cross-table duplicate checks in registration/update_contact never
// treat two deleted accounts as clashing with each other.
$placeholder_email = "deleted_{$commuter_id}@transync.invalid";
$placeholder_phone = "deleted{$commuter_id}";
$random_password   = password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT);

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("
        UPDATE commuters SET
            name = 'Deleted User',
            first_name = NULL, middle_name = NULL, last_name = NULL, suffix = NULL, date_of_birth = NULL,
            email = ?, phone = ?, password = ?, discount_id_url = NULL, deleted_at = NOW()
        WHERE id = ?
    ");
    $stmt->bind_param("sssi", $placeholder_email, $placeholder_phone, $random_password, $commuter_id);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
} catch (\Throwable $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Couldn't delete your account. Please try again."]);
    exit;
}

echo json_encode(["success" => true, "message" => "Your account has been permanently deleted."]);
