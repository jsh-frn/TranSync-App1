<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$search = trim($_GET['search'] ?? "");

$sql = "
    SELECT
        r.id,
        r.name,
        r.from_location,
        r.to_location,
        r.fare,
        r.vehicle_type,
        r.color,
        COUNT(DISTINCT rd.id)        AS driver_count,
        COALESCE(a.name, o.name)     AS owner_name
    FROM routes r
    LEFT JOIN route_assignments ra ON ra.route_id    = r.id
    LEFT JOIN vehicles          rv ON rv.id          = ra.vehicle_id
    LEFT JOIN drivers           rd ON rd.vehicle_id  = rv.id
    LEFT JOIN associations      a  ON a.id           = r.association_id
    LEFT JOIN operators         o  ON o.id           = r.operator_id
    WHERE r.status = 'active'
      AND r.vehicle_type IN ('UV Express', 'Bus')
";

$params = [];
$types  = "";

if ($search !== "") {
    $like     = "%" . $search . "%";
    $sql     .= " AND (r.name LIKE ? OR r.from_location LIKE ? OR r.to_location LIKE ?)";
    $params   = [$like, $like, $like];
    $types    = "sss";
}

$sql .= " GROUP BY r.id ORDER BY driver_count DESC, r.name ASC";

$stmt = $conn->prepare($sql);
if ($types !== "") {
    $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$result = $stmt->get_result();

$routes = [];
while ($row = $result->fetch_assoc()) {
    $routes[] = [
        "id"            => (int)$row["id"],
        "name"          => $row["name"]          ?? "",
        "from_location" => $row["from_location"] ?? "",
        "to_location"   => $row["to_location"]   ?? "",
        "fare"          => $row["fare"]  !== null ? (float)$row["fare"] : null,
        "vehicle_type"  => $row["vehicle_type"]  ?? null,
        "color"         => $row["color"]         ?? "#1a4a52",
        "driver_count"  => (int)$row["driver_count"],
        "owner_name"    => $row["owner_name"]    ?? null,
    ];
}

echo json_encode(["success" => true, "routes" => $routes]);
