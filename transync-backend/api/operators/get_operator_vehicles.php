<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$operator_id = (int)($_GET["operator_id"] ?? 0);
if (!$operator_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

// Only return vehicles that have no driver assigned yet.
$stmt = $conn->prepare("
    SELECT id, type, plate_number, capacity, status, association_id
    FROM vehicles
    WHERE operator_id = ? AND (driver_id IS NULL OR driver_id = 0)
    ORDER BY plate_number ASC
");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$result = $stmt->get_result();

$vehicles = [];
while ($row = $result->fetch_assoc()) {
    $vehicles[] = [
        "id"             => (int)$row["id"],
        "type"           => $row["type"],
        "plate_number"   => $row["plate_number"],
        "capacity"       => $row["capacity"] ? (int)$row["capacity"] : null,
        "status"         => $row["status"],
        // An operator can hold the same vehicle type approved at several
        // associations at once — callers scoping to an active association
        // must filter on this, not just type (see Switch Association).
        "association_id" => $row["association_id"] ? (int)$row["association_id"] : null,
    ];
}

echo json_encode(["success" => true, "vehicles" => $vehicles]);
