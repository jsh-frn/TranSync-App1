<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$body        = json_decode(file_get_contents("php://input"), true);
$template_id = (int)($body["template_id"] ?? 0);

if (!$template_id) {
    echo json_encode(["success" => false, "message" => "template_id is required."]);
    exit;
}

// Never affects vehicles that already applied this template — they hold
// independent copies in `seats`, not a reference to this row (bus_layout_template_seats
// cascades on delete, but `seats` has no FK to either template table at all).
$stmt = $conn->prepare("DELETE FROM bus_layout_templates WHERE id = ?");
$stmt->bind_param("i", $template_id);
$stmt->execute();

if ($stmt->affected_rows > 0) {
    echo json_encode(["success" => true, "message" => "Template deleted."]);
} else {
    echo json_encode(["success" => false, "message" => "Template not found."]);
}
