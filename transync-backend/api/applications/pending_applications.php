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

$association_id = $_GET['association_id'] ?? null;

if (!$association_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "association_id is required."]);
    exit;
}

// ── STATS: count per status ──────────────────────────────────────────────────
// For 'approved', only count rows whose subject still exists in the respective
// table (drivers or vehicles) so that deleted drivers/vehicles don't inflate
// the approved count.
$stmt = $conn->prepare("
    SELECT
        SUM(status = 'pending')  AS pending,
        SUM(
            status = 'approved' AND (
                (subject_type = 'driver'  AND EXISTS (SELECT 1 FROM drivers  WHERE id = subject_id)) OR
                (subject_type = 'vehicle' AND EXISTS (SELECT 1 FROM vehicles WHERE id = subject_id))
            )
        ) AS approved,
        SUM(status = 'rejected') AS rejected
    FROM association_applications
    WHERE association_id = ?
");
$stmt->bind_param("i", $association_id);
$stmt->execute();
$statsRow = $stmt->get_result()->fetch_assoc();

$stats = [
    "pending"  => (int)($statsRow["pending"]  ?? 0),
    "approved" => (int)($statsRow["approved"] ?? 0),
    "rejected" => (int)($statsRow["rejected"] ?? 0),
];

// ── APPLICATIONS: fetch all with resolved subject name ───────────────────────
// subject_type = 'driver'  → join drivers  for name and license_number
// subject_type = 'vehicle' → join vehicles for plate_number and type
//
// We use a UNION so both types come back in one query, then ORDER globally.

$stmt = $conn->prepare("
    SELECT
        aa.id,
        aa.operator_id,
        o.name                  AS operator_name,
        aa.subject_type,
        aa.subject_id,
        d.name                  AS subject_name,
        d.license_number        AS subject_detail,
        aa.status,
        aa.rejection_reason,
        aa.created_at,
        aa.reviewed_at

    FROM association_applications aa
    JOIN operators o ON aa.operator_id    = o.id
    JOIN drivers   d ON aa.subject_id     = d.id
    WHERE aa.association_id = ?
      AND aa.subject_type   = 'driver'

    UNION ALL

    SELECT
        aa.id,
        aa.operator_id,
        o.name                  AS operator_name,
        aa.subject_type,
        aa.subject_id,
        v.plate_number          AS subject_name,
        v.type                  AS subject_detail,
        aa.status,
        aa.rejection_reason,
        aa.created_at,
        aa.reviewed_at

    FROM association_applications aa
    JOIN operators o  ON aa.operator_id = o.id
    JOIN vehicles  v  ON aa.subject_id  = v.id
    WHERE aa.association_id = ?
      AND aa.subject_type   = 'vehicle'

    ORDER BY
        FIELD(status, 'pending', 'approved', 'rejected'),
        created_at DESC
");
$stmt->bind_param("ii", $association_id, $association_id);
$stmt->execute();

$result = $stmt->get_result();
$applications = [];
while ($row = $result->fetch_assoc()) {
    $applications[] = [
        "id"               => (int)$row["id"],
        "operator_id"      => (int)$row["operator_id"],
        "operator_name"    => $row["operator_name"],
        "subject_type"     => $row["subject_type"],
        "subject_id"       => (int)$row["subject_id"],
        "subject_name"     => $row["subject_name"],
        "subject_detail"   => $row["subject_detail"],
        "status"           => $row["status"],
        "rejection_reason" => $row["rejection_reason"],
        "created_at"       => $row["created_at"],
        "reviewed_at"      => $row["reviewed_at"],
    ];
}

echo json_encode([
    "success"      => true,
    "stats"        => $stats,
    "applications" => $applications,
]);