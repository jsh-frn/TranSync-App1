<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$association_id = (int)($_GET["association_id"] ?? 0);
if (!$association_id) {
    echo json_encode(["success" => false, "message" => "association_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT a.id, a.operator_id, a.vehicle_type, a.status, a.rejection_reason, a.created_at, a.reviewed_at,
           o.name AS operator_name, o.phone AS operator_phone, o.email AS operator_email,
           o.registration_document_url, o.drivers_license_url, o.vehicle_or_cr_url,
           a.doc_lto_cr_url, a.doc_capacity_spec_url, a.doc_engine_cert_url, a.doc_lto_stencil_url,
           a.doc_model_proof_url, a.doc_terminal_route_map_url, a.doc_garage_proof_url,
           a.doc_speed_limiter_url, a.doc_gps_cert_url, a.doc_pami_policy_url, a.doc_fare_matrix_url
    FROM operator_association_applications a
    JOIN operators o ON o.id = a.operator_id
    WHERE a.association_id = ?
    ORDER BY a.created_at DESC
");
$stmt->bind_param("i", $association_id);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$base_url = BACKEND_PUBLIC_URL;
$docCols  = [
    "doc_lto_cr_url", "doc_capacity_spec_url", "doc_engine_cert_url", "doc_lto_stencil_url",
    "doc_model_proof_url", "doc_terminal_route_map_url", "doc_garage_proof_url",
    "doc_speed_limiter_url", "doc_gps_cert_url", "doc_pami_policy_url", "doc_fare_matrix_url",
];

$stats = ["pending" => 0, "approved" => 0, "rejected" => 0, "removed" => 0];
$applications = array_map(function ($row) use (&$stats, $base_url, $docCols) {
    $stats[$row["status"]]++;
    $documents = [];
    foreach ($docCols as $col) {
        $documents[$col] = $row[$col] ? $base_url . $row[$col] : null;
    }
    return array_merge([
        "id"             => (int)$row["id"],
        "operator_id"    => (int)$row["operator_id"],
        "operator_name"  => $row["operator_name"],
        "vehicle_type"   => $row["vehicle_type"],
        "operator_phone" => $row["operator_phone"],
        "operator_email" => $row["operator_email"],
        // The operator's registration-time documents — separate from the
        // vehicle-type-specific checklist below, shown here too so the
        // association can see everything the operator submitted.
        // registration_document_url is deprecated in place (migration 054),
        // still returned for any legacy operator that has one.
        "registration_document_url" => $row["registration_document_url"] ? $base_url . $row["registration_document_url"] : null,
        "drivers_license_url"       => $row["drivers_license_url"]       ? $base_url . $row["drivers_license_url"]       : null,
        "vehicle_or_cr_url"         => $row["vehicle_or_cr_url"]         ? $base_url . $row["vehicle_or_cr_url"]         : null,
        "status"           => $row["status"],
        "rejection_reason" => $row["rejection_reason"],
        "created_at"       => $row["created_at"],
        "reviewed_at"      => $row["reviewed_at"],
    ], $documents);
}, $rows);

echo json_encode(["success" => true, "applications" => $applications, "stats" => $stats]);
