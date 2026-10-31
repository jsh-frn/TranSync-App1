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

$operator_id = (int)($_GET["operator_id"] ?? 0);

if (!$operator_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT
        d.id                AS driver_id,
        am.association_id   AS member_association_id,
        ma.name             AS member_association_name,
        am.status           AS membership_status,
        aa.id               AS application_id,
        aa.association_id   AS applied_association_id,
        apa.name            AS applied_association_name,
        aa.status           AS application_status,
        aa.rejection_reason,
        r.id                AS assigned_route_id,
        r.name              AS assigned_route_name
    FROM drivers d

    LEFT JOIN association_memberships am
        ON  am.subject_type = 'driver'
        AND am.subject_id   = d.id
        AND am.status       = 'active'
    LEFT JOIN associations ma  ON ma.id  = am.association_id

    LEFT JOIN association_applications aa
        ON  aa.subject_type = 'driver'
        AND aa.subject_id   = d.id
        AND aa.id = (
            SELECT id FROM association_applications
            WHERE subject_type = 'driver' AND subject_id = d.id
            ORDER BY created_at DESC LIMIT 1
        )
    LEFT JOIN associations apa ON apa.id = aa.association_id

    LEFT JOIN route_assignments ra ON ra.driver_id = d.id
    LEFT JOIN routes r             ON r.id          = ra.route_id

    WHERE d.operator_id = ?
    ORDER BY d.name ASC
");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$rows = $stmt->get_result();

$map = [];
while ($row = $rows->fetch_assoc()) {
    $map[$row["driver_id"]] = [
        "driver_id"                => (int)$row["driver_id"],
        "member_association_id"    => $row["member_association_id"]    ? (int)$row["member_association_id"]    : null,
        "member_association_name"  => $row["member_association_name"]  ?? null,
        "membership_status"        => $row["membership_status"]        ?? null,
        "application_id"           => $row["application_id"]           ? (int)$row["application_id"]           : null,
        "applied_association_id"   => $row["applied_association_id"]   ? (int)$row["applied_association_id"]   : null,
        "applied_association_name" => $row["applied_association_name"] ?? null,
        "application_status"       => $row["application_status"]       ?? null,
        "rejection_reason"         => $row["rejection_reason"]         ?? null,
        "assigned_route_id"        => $row["assigned_route_id"]        ? (int)$row["assigned_route_id"]        : null,
        "assigned_route_name"      => $row["assigned_route_name"]      ?? null,
    ];
}

echo json_encode(["success" => true, "applications" => array_values($map)]);
