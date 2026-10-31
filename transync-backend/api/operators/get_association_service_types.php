<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Read-only: an operator can only pick from the classes their own association
// has defined (see associations/service_types.php for the owning CRUD) —
// operators no longer create/edit classes themselves.
//
// An operator can be Bus-approved at several associations at once, so
// without an association_id filter this unions every one of their Bus
// associations' classes into a single flat, untagged list — fine for
// display, but ambiguous for picking a class to register a specific
// vehicle under. association_id is optional (falls back to the old
// union-everything behavior) but the mobile app always passes the
// operator's currently active association.
$operator_id    = (int)($_GET["operator_id"]    ?? 0);
$association_id = (int)($_GET["association_id"] ?? 0);
if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

$sql = "
    SELECT st.id, st.name, st.description, ocd.details, st.association_id
    FROM operator_association_applications oaa
    JOIN bus_service_types st ON st.association_id = oaa.association_id
    LEFT JOIN operator_class_details ocd
        ON ocd.service_type_id = st.id AND ocd.operator_id = oaa.operator_id
    WHERE oaa.operator_id = ? AND oaa.vehicle_type = 'Bus' AND oaa.status = 'approved'
";
if ($association_id) {
    $sql .= " AND st.association_id = ?";
}
$sql .= " ORDER BY st.name ASC";

$stmt = $conn->prepare($sql);
if ($association_id) {
    $stmt->bind_param("ii", $operator_id, $association_id);
} else {
    $stmt->bind_param("i", $operator_id);
}
$stmt->execute();
$result = $stmt->get_result();
$types = [];
while ($row = $result->fetch_assoc()) {
    $types[] = [
        "id" => (int)$row["id"], "name" => $row["name"], "description" => $row["description"],
        "details" => $row["details"], "association_id" => (int)$row["association_id"],
    ];
}
echo json_encode(["success" => true, "service_types" => $types]);
