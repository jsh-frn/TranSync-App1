<?php
header("Content-Type: application/json");

require_once "../../config/db.php";

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

$id   = $_POST["id"]   ?? null;
$type = $_POST["type"] ?? null; // "commuter" or "operator"

if (!$id || !$type) {
    http_response_code(400);
    echo json_encode(["message" => "Missing required fields."]);
    exit;
}

$table = $type === "commuter" ? "commuters" : "operators";

// Check 24-hour cooldown
$stmt = $conn->prepare("SELECT rejected_at FROM $table WHERE id = ? AND status = 'inactive'");
$stmt->bind_param("i", $id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row) {
    http_response_code(400);
    echo json_encode(["message" => "Account not found or not rejected."]);
    exit;
}

if ($row["rejected_at"]) {
    $rejected_at  = new DateTime($row["rejected_at"]);
    $now          = new DateTime();
    $hours_passed = ($now->getTimestamp() - $rejected_at->getTimestamp()) / 3600;

    if ($hours_passed < 24) {
        $hours_left = ceil(24 - $hours_passed);
        http_response_code(429);
        echo json_encode([
            "message"    => "Please wait before resubmitting.",
            "hours_left" => $hours_left,
        ]);
        exit;
    }
}

// Build upload dir
$folder     = $type === "commuter" ? "commuters" : "operators";
$upload_dir = dirname(dirname(__DIR__)) . "/uploads/$folder/";
$upload_dir = str_replace("\\", "/", $upload_dir);
if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);

// Handle file upload
$field = $type === "commuter" ? "id_photo" : "cpc_photo";
if (!isset($_FILES[$field]) || $_FILES[$field]["error"] !== UPLOAD_ERR_OK) {
    $err = isset($_FILES[$field]) ? $_FILES[$field]["error"] : "not received";
    http_response_code(400);
    echo json_encode(["message" => "Document is required. Error: $err"]);
    exit;
}

$ext      = pathinfo($_FILES[$field]["name"], PATHINFO_EXTENSION) ?: "jpg";
$filename = $type . "_resubmit_" . time() . "_" . uniqid() . "." . $ext;
$target   = $upload_dir . $filename;

if (!move_uploaded_file($_FILES[$field]["tmp_name"], $target)) {
    http_response_code(500);
    echo json_encode(["message" => "Failed to save file. Check folder permissions."]);
    exit;
}

$file_url = "uploads/$folder/" . $filename;

// Update record — reset to pending
if ($type === "commuter") {
    $stmt = $conn->prepare("
        UPDATE commuters
        SET discount_id_url = ?, status = 'active', is_verified = 0, rejected_at = NULL
        WHERE id = ?
    ");
    $stmt->bind_param("si", $file_url, $id);
} else {
    $stmt = $conn->prepare("
        UPDATE operators
        SET cpc_document_url = ?, status = 'active', is_verified = 0, rejected_at = NULL
        WHERE id = ?
    ");
    $stmt->bind_param("si", $file_url, $id);
}

if ($stmt->execute()) {
    echo json_encode(["message" => "Resubmitted successfully. Please wait for admin review."]);
} else {
    http_response_code(500);
    echo json_encode(["message" => "Database error: " . $conn->error]);
}