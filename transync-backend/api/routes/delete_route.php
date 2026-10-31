<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$data           = json_decode(file_get_contents("php://input"), true);
$route_id       = (int)($data['route_id']       ?? 0);
$operator_id    = (int)($data['operator_id']    ?? 0);
$association_id = (int)($data['association_id'] ?? 0);

if (!$route_id || (!$operator_id && !$association_id)) {
    echo json_encode(["success" => false, "message" => "route_id and owner id are required."]);
    exit;
}

if ($association_id) {
    $stmt = $conn->prepare("DELETE FROM routes WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $route_id, $association_id);
} else {
    $stmt = $conn->prepare("DELETE FROM routes WHERE id = ? AND operator_id = ?");
    $stmt->bind_param("ii", $route_id, $operator_id);
}

$stmt->execute();
echo json_encode(["success" => true, "rows_affected" => $conn->affected_rows]);