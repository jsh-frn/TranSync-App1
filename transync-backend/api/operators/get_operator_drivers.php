<?php
header("Content-Type: application/json");
require_once "../../config/db.php";

$operator_id = intval($_GET['operator_id'] ?? 0);

if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "Missing operator_id"]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, name,
           COALESCE(CAST(latitude  AS DECIMAL(10,7)), 0) AS latitude,
           COALESCE(CAST(longitude AS DECIMAL(10,7)), 0) AS longitude,
           is_online, is_full
    FROM drivers
    WHERE operator_id = ?
    ORDER BY name ASC
");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$drivers = array_map(function($d) {
    $d['latitude']  = (float) $d['latitude'];
    $d['longitude'] = (float) $d['longitude'];
    $d['is_online'] = (int)   $d['is_online'];
    $d['is_full']   = (int)   $d['is_full'];
    return $d;
}, $stmt->get_result()->fetch_all(MYSQLI_ASSOC));

echo json_encode(["success" => true, "drivers" => $drivers]);