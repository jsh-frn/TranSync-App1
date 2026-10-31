<?php
header("Content-Type: application/json");
require_once "../../config/db.php";

$operator_id = $_GET['operator_id'] ?? null;

if (!$operator_id) {
    http_response_code(400);
    echo json_encode(["message" => "operator_id is required."]);
    exit;
}

// Total drivers
$stmt = $conn->prepare("SELECT COUNT(*) AS total FROM drivers WHERE operator_id = ?");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$totalDrivers = $stmt->get_result()->fetch_assoc()["total"];

// Active drivers
$stmt = $conn->prepare("SELECT COUNT(*) AS total FROM drivers WHERE operator_id = ? AND status = 'active'");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$activeDrivers = $stmt->get_result()->fetch_assoc()["total"];

// Total vehicles
$stmt = $conn->prepare("SELECT COUNT(*) AS total FROM vehicles WHERE operator_id = ?");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$totalVehicles = $stmt->get_result()->fetch_assoc()["total"];

// Active vehicles
$stmt = $conn->prepare("SELECT COUNT(*) AS total FROM vehicles WHERE operator_id = ? AND status = 'active'");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$activeVehicles = $stmt->get_result()->fetch_assoc()["total"];

echo json_encode([
    "total_drivers"   => (int)$totalDrivers,
    "active_drivers"  => (int)$activeDrivers,
    "total_vehicles"  => (int)$totalVehicles,
    "active_vehicles" => (int)$activeVehicles,
]);