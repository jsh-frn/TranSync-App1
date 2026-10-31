<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/auth.php";

requireAuth($conn, ['admin']);

// Admin-only write path for the otherwise-fixed ltfrb_fare_guides catalog
// (see migration 036 / reference/ltfrb_fare_guides.php's own read-only
// comment, and migration 053). Replaces the PDF behind one of the 9
// existing category rows (1 Jeepney, 1 UV Express, 7 Bus classes) — never
// creates, renames, or removes a category; `id` must already exist. The old
// file is deleted from disk on replace, same convention as the avatar
// uploads (Core Flow 8f).
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

$id = (int)($_POST["id"] ?? 0);
if (!$id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "id is required."]);
    exit;
}

$stmt = $conn->prepare("SELECT id, vehicle_type, label, file_path FROM ltfrb_fare_guides WHERE id = ?");
$stmt->bind_param("i", $id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Fare guide category not found."]);
    exit;
}

if (!isset($_FILES["pdf"]) || $_FILES["pdf"]["error"] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "No PDF file was uploaded."]);
    exit;
}

$file = $_FILES["pdf"];
$ext  = strtolower(pathinfo($file["name"], PATHINFO_EXTENSION));
if ($ext !== "pdf") {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Please upload a PDF file."]);
    exit;
}
if ($file["size"] > 20 * 1024 * 1024) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "PDF must be smaller than 20MB."]);
    exit;
}

$upload_dir = str_replace("\\", "/", dirname(dirname(__DIR__)) . "/uploads/ltfrb_fare_guides/");
if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);

$filename = "ltfrbfg_" . $id . "_" . time() . "_" . uniqid() . ".pdf";
if (!move_uploaded_file($file["tmp_name"], $upload_dir . $filename)) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to save the PDF. Please try again."]);
    exit;
}

// Delete the previous file from disk only after the new one is safely saved.
$old_relative = $row["file_path"];
if ($old_relative) {
    $old_path = str_replace("\\", "/", dirname(dirname(__DIR__)) . "/" . $old_relative);
    if (is_file($old_path)) @unlink($old_path);
}

$relative = "uploads/ltfrb_fare_guides/" . $filename;
$upd = $conn->prepare("UPDATE ltfrb_fare_guides SET file_path = ?, updated_at = NOW() WHERE id = ?");
$upd->bind_param("si", $relative, $id);
$upd->execute();
$upd->close();

echo json_encode([
    "success"      => true,
    "id"           => $id,
    "vehicle_type" => $row["vehicle_type"],
    "label"        => $row["label"],
]);
