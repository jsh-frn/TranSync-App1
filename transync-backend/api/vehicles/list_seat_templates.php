<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// The operator's Seat Layout Library — named, explicit templates the
// operator picks from when registering a new Bus, instead of silent reuse
// by exact (operator, class, capacity) key (supersedes Do Not Break rule #26).
$operator_id     = (int)($_GET["operator_id"] ?? 0);
$service_type_id = isset($_GET["service_type_id"]) && $_GET["service_type_id"] !== "" ? (int)$_GET["service_type_id"] : null;

if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

$sql = "
    SELECT t.id, t.name, t.service_type_id, st.name AS service_type_name, t.capacity, t.layout_style, t.created_at,
           (SELECT COUNT(*) FROM bus_layout_template_seats WHERE template_id = t.id) AS seat_count
    FROM bus_layout_templates t
    JOIN bus_service_types st ON st.id = t.service_type_id
    WHERE t.operator_id = ?
";
$params = [$operator_id];
$types  = "i";
if ($service_type_id) {
    $sql .= " AND t.service_type_id = ?";
    $params[] = $service_type_id;
    $types   .= "i";
}
$sql .= " ORDER BY t.created_at DESC";

$stmt = $conn->prepare($sql);
$stmt->bind_param($types, ...$params);
$stmt->execute();
$result = $stmt->get_result();
$templates = [];
while ($row = $result->fetch_assoc()) {
    $templates[] = [
        "id"                => (int)$row["id"],
        "name"              => $row["name"],
        "service_type_id"   => (int)$row["service_type_id"],
        "service_type_name" => $row["service_type_name"],
        "capacity"          => (int)$row["capacity"],
        "layout_style"      => $row["layout_style"],
        "seat_count"        => (int)$row["seat_count"],
        "created_at"        => $row["created_at"],
    ];
}

echo json_encode(["success" => true, "templates" => $templates]);
