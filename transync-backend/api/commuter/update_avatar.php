<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

$commuter_id = (int)($_POST["commuter_id"] ?? 0);
$remove      = ($_POST["remove"] ?? "") === "1";

if (!$commuter_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "commuter_id is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT avatar_url FROM commuters WHERE id = ?");
$stmt->bind_param("i", $commuter_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Commuter not found."]);
    exit;
}

$upload_dir = str_replace("\\", "/", dirname(dirname(__DIR__)) . "/uploads/avatars/");
$old_relative = $row["avatar_url"];

// Removing a photo, or replacing one — either way the previous file (if any)
// is deleted so uploads/avatars/ doesn't accumulate orphans every time a
// commuter changes their picture.
$deleteOldFile = function () use ($old_relative, $upload_dir) {
    if (!$old_relative) return;
    $path = str_replace("\\", "/", dirname(dirname(__DIR__)) . "/" . $old_relative);
    if (is_file($path)) @unlink($path);
};

if ($remove) {
    $deleteOldFile();
    $upd = $conn->prepare("UPDATE commuters SET avatar_url = NULL WHERE id = ?");
    $upd->bind_param("i", $commuter_id);
    $upd->execute();
    echo json_encode(["success" => true, "avatar_url" => null]);
    exit;
}

if (!isset($_FILES["avatar"]) || $_FILES["avatar"]["error"] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "No photo was uploaded."]);
    exit;
}

$file = $_FILES["avatar"];
$ext  = strtolower(pathinfo($file["name"], PATHINFO_EXTENSION));
if (!in_array($ext, ["jpg", "jpeg", "png", "webp"], true)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Please upload a JPG, PNG, or WEBP image."]);
    exit;
}
if ($file["size"] > 5 * 1024 * 1024) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Image must be smaller than 5MB."]);
    exit;
}

if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);

$filename = "commuter_" . $commuter_id . "_" . time() . "_" . uniqid() . "." . $ext;
if (!move_uploaded_file($file["tmp_name"], $upload_dir . $filename)) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to save the photo. Please try again."]);
    exit;
}

$deleteOldFile();

$relative = "uploads/avatars/" . $filename;
$upd = $conn->prepare("UPDATE commuters SET avatar_url = ? WHERE id = ?");
$upd->bind_param("si", $relative, $commuter_id);
$upd->execute();

// Relative path only — the mobile client prefixes it with FILE_BASE (derived
// from the same host it already used to reach this endpoint), never a
// hardcoded "http://localhost/..." host, which only resolves on Expo web and
// not on a real device/emulator (see src/config/api.ts).
echo json_encode(["success" => true, "avatar_url" => $relative]);
