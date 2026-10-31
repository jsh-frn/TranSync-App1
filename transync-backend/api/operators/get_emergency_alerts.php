<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Emergency alerts raised by THIS operator's own drivers (drivers.operator_id),
// active ones first then recently resolved. ?status=active returns only the
// unresolved ones (what the dashboard banner polls); default returns both.
$operator_id = (int)($_GET["operator_id"] ?? 0);
$onlyActive  = ($_GET["status"] ?? "") === "active";

if (!$operator_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

$sql = "
    SELECT ea.id, ea.driver_id, ea.vehicle_id, ea.message, ea.latitude, ea.longitude,
           ea.status, ea.created_at,
           d.name AS driver_name, d.phone AS driver_phone,
           v.plate_number, v.vehicle_number, v.type AS vehicle_type
    FROM emergency_alerts ea
    JOIN drivers d ON d.id = ea.driver_id
    LEFT JOIN vehicles v ON v.id = ea.vehicle_id
    WHERE d.operator_id = ?
";
if ($onlyActive) $sql .= " AND ea.status = 'active'";
$sql .= " ORDER BY (ea.status = 'active') DESC, ea.created_at DESC LIMIT 50";

$stmt = $conn->prepare($sql);
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$res = $stmt->get_result();

$alerts = [];
$activeCount = 0;
while ($row = $res->fetch_assoc()) {
    $row["id"]        = (int)$row["id"];
    $row["driver_id"] = (int)$row["driver_id"];
    $row["latitude"]  = $row["latitude"]  !== null ? (float)$row["latitude"]  : null;
    $row["longitude"] = $row["longitude"] !== null ? (float)$row["longitude"] : null;
    if ($row["status"] === "active") $activeCount++;
    $alerts[] = $row;
}
$stmt->close();

echo json_encode(["success" => true, "alerts" => $alerts, "active_count" => $activeCount]);
