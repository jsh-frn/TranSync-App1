<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

$operator_id = (int)($_GET['operator_id'] ?? 0);
if (!$operator_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT
        qs.id,
        qs.driver_id,
        d.name      AS driver_name,
        qs.amount,
        qs.period_type,
        qs.status,
        qs.note,
        qs.submitted_at,
        qs.reviewed_at,
        qs.cashed_out_at,
        dq.amount   AS quota_target,
        dq.frequency
    FROM quota_submissions qs
    JOIN drivers  d  ON qs.driver_id   = d.id
    LEFT JOIN driver_quotas dq ON dq.driver_id = qs.driver_id
    WHERE qs.operator_id = ?
    ORDER BY
        FIELD(qs.status, 'pending', 'confirmed', 'rejected'),
        qs.submitted_at DESC
");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$result = $stmt->get_result();

$submissions = [];
while ($row = $result->fetch_assoc()) {
    $row['amount']       = (float)$row['amount'];
    $row['quota_target'] = $row['quota_target'] !== null ? (float)$row['quota_target'] : null;
    $submissions[] = $row;
}

echo json_encode(["success" => true, "submissions" => $submissions]);
