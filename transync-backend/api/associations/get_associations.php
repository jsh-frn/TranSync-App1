<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";

$type = trim($_GET["type"] ?? "");
$allowed_types = ["Jeepney Op", "UV Op", "Bus Op"];

$where = "WHERE status = 'active'";
$params = [];
$types  = "";

if ($type && in_array($type, $allowed_types)) {
    $where   .= " AND association_type = ?";
    $params[] = $type;
    $types   .= "s";
}

$sql  = "SELECT id, name, association_type FROM associations $where ORDER BY name ASC";
$stmt = $conn->prepare($sql);
if ($params) $stmt->bind_param($types, ...$params);
$stmt->execute();
$result = $stmt->get_result();

if (!$result) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Query failed: " . $conn->error]);
    exit;
}

$list = [];
while ($row = $result->fetch_assoc()) {
    $list[] = [
        "id"               => (int)$row["id"],
        "name"             => $row["name"],
        "association_type" => $row["association_type"],
    ];
}

echo json_encode(["success" => true, "associations" => $list]);