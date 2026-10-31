<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Lets the Association app re-sync its own profile/status live (Association
// Profile/Settings) — mirrors commuter/get_profile.php's role. The
// login_mobile.php association branch never returns `acronym` at all, and
// only ever reflects whatever was true at login time, so Profile/Settings
// need their own live fetch rather than reading the stale AsyncStorage
// snapshot. official_email/official_phone/rep_*/document URLs are
// deliberately excluded — nothing in the current mobile app displays or
// edits them.
$association_id = (int)($_GET["association_id"] ?? 0);
if (!$association_id) {
    echo json_encode(["success" => false, "message" => "association_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, name, acronym, contact_email, contact_phone, address, status, created_at, avatar_url
    FROM associations WHERE id = ?
");
$stmt->bind_param("i", $association_id);
$stmt->execute();
$assoc = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$assoc) {
    echo json_encode(["success" => false, "message" => "Association not found."]);
    exit;
}

echo json_encode([
    "success" => true,
    "association" => [
        "id"             => (int)$assoc["id"],
        "name"           => $assoc["name"],
        "acronym"        => $assoc["acronym"],
        "email"          => $assoc["contact_email"],
        "phone"          => $assoc["contact_phone"],
        "address"        => $assoc["address"],
        "status"         => $assoc["status"],
        "created_at"     => $assoc["created_at"],
        // Relative path — see commuter/get_profile.php's comment.
        "avatar_url"     => $assoc["avatar_url"],
    ],
]);
