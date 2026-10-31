<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Admin view of every driver emergency alert, across all operators.
// GET  — active alerts first, then recently resolved (?status=active for just
//        the unresolved ones).
// POST — { alert_id } marks one resolved.
if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $onlyActive = ($_GET["status"] ?? "") === "active";
    $sql = "
        SELECT ea.id, ea.driver_id, ea.vehicle_id, ea.message, ea.latitude, ea.longitude,
               ea.status, ea.created_at,
               d.name AS driver_name, d.phone AS driver_phone,
               o.name AS operator_name, o.phone AS operator_phone,
               v.plate_number, v.vehicle_number, v.type AS vehicle_type
        FROM emergency_alerts ea
        JOIN drivers d ON d.id = ea.driver_id
        LEFT JOIN operators o ON o.id = d.operator_id
        LEFT JOIN vehicles v ON v.id = ea.vehicle_id
    ";
    if ($onlyActive) $sql .= " WHERE ea.status = 'active'";
    $sql .= " ORDER BY (ea.status = 'active') DESC, ea.created_at DESC LIMIT 100";

    $res = $conn->query($sql);
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
    echo json_encode(["success" => true, "alerts" => $alerts, "active_count" => $activeCount]);
    exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

$data     = json_decode(file_get_contents("php://input"), true) ?? [];
$alert_id = (int)($data["alert_id"] ?? 0);
if (!$alert_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "alert_id is required."]);
    exit;
}

$stmt = $conn->prepare("UPDATE emergency_alerts SET status = 'resolved' WHERE id = ? AND status = 'active'");
$stmt->bind_param("i", $alert_id);
$stmt->execute();
$changed = $stmt->affected_rows > 0;
$stmt->close();

echo json_encode($changed
    ? ["success" => true]
    : ["success" => false, "message" => "Alert not found or already resolved."]);
