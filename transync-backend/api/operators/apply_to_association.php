<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";

// Operator applies to an association for ONE specific vehicle type, uploading
// that type's own LTO/LTFRB document checklist. An operator can hold multiple
// vehicle-type memberships at once, including the SAME vehicle type at
// several different associations simultaneously (e.g. UV Express approved at
// both DAU and Angeles City JODA) — so the only duplicate blocked is a
// second pending/approved application for the exact same (vehicle_type,
// association_id) pair; a different association is always allowed.

$operator_id    = (int)($_POST["operator_id"]    ?? 0);
$association_id = (int)($_POST["association_id"] ?? 0);
$vehicle_type   = trim($_POST["vehicle_type"]     ?? "");

// Optional — carried over from the registration wizard's Step 2 (vehicle
// type/plate/vehicle_number/capacity), where a real `vehicles` row can't be
// created yet (vehicles.php requires this exact application to already be
// approved). Stored here as a reminder, surfaced once approved so the
// operator's Vehicles tab can pre-fill "Add Vehicle" instead of asking
// again from scratch — see migration 055.
$intended_plate_number   = trim($_POST["intended_plate_number"]   ?? "") ?: null;
$intended_vehicle_number = trim($_POST["intended_vehicle_number"] ?? "") ?: null;
$intended_capacity       = isset($_POST["intended_capacity"]) && $_POST["intended_capacity"] !== "" ? (int)$_POST["intended_capacity"] : null;

if (!$operator_id || !$association_id || !in_array($vehicle_type, ["Jeepney", "UV Express", "Bus"], true)) {
    echo json_encode(["success" => false, "message" => "operator_id, association_id, and a valid vehicle_type are required."]);
    exit;
}

$stmt = $conn->prepare("SELECT id FROM operators WHERE id = ?");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "Operator not found."]);
    exit;
}
$stmt->close();

$stmt = $conn->prepare("SELECT id, status FROM associations WHERE id = ?");
$stmt->bind_param("i", $association_id);
$stmt->execute();
$association = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$association || $association["status"] !== "active") {
    echo json_encode(["success" => false, "message" => "Association not found or inactive."]);
    exit;
}

// One active (pending or approved) membership per (vehicle_type, association)
// pair at a time — leave the existing one first (operators/leave_association.php,
// itself now association_id-scoped) to re-apply at that SAME association. A
// pending/approved membership at a different association never blocks this.
$stmt = $conn->prepare("
    SELECT id FROM operator_association_applications
    WHERE operator_id = ? AND vehicle_type = ? AND association_id = ? AND status IN ('pending', 'approved')
");
$stmt->bind_param("isi", $operator_id, $vehicle_type, $association_id);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "You already have a pending or approved {$vehicle_type} application at this association."]);
    exit;
}
$stmt->close();

// ── Document checklist, one upload field per named document, required per type ──
$required_docs = [
    "Jeepney" => [
        "doc_lto_cr"        => "doc_lto_cr_url",
        "doc_capacity_spec" => "doc_capacity_spec_url",
        "doc_engine_cert"   => "doc_engine_cert_url",
        "doc_lto_stencil"   => "doc_lto_stencil_url",
    ],
    "UV Express" => [
        "doc_lto_cr"            => "doc_lto_cr_url",
        "doc_model_proof"       => "doc_model_proof_url",
        "doc_terminal_route_map"=> "doc_terminal_route_map_url",
        "doc_garage_proof"      => "doc_garage_proof_url",
    ],
    "Bus" => [
        "doc_lto_cr"        => "doc_lto_cr_url",
        "doc_speed_limiter" => "doc_speed_limiter_url",
        "doc_gps_cert"      => "doc_gps_cert_url",
        "doc_pami_policy"   => "doc_pami_policy_url",
        "doc_fare_matrix"   => "doc_fare_matrix_url",
    ],
];

$fields = $required_docs[$vehicle_type];
foreach ($fields as $fieldName => $column) {
    if (!isset($_FILES[$fieldName]) || $_FILES[$fieldName]["error"] !== UPLOAD_ERR_OK) {
        echo json_encode(["success" => false, "message" => "Missing required document: {$fieldName}."]);
        exit;
    }
}

$upload_dir = dirname(dirname(__DIR__)) . "/uploads/operators/";
$upload_dir = str_replace("\\", "/", $upload_dir);
if (!is_dir($upload_dir)) {
    mkdir($upload_dir, 0777, true);
}

$docUrls = [];
foreach ($fields as $fieldName => $column) {
    $ext      = pathinfo($_FILES[$fieldName]["name"], PATHINFO_EXTENSION) ?: "jpg";
    $filename = $fieldName . "_" . time() . "_" . uniqid() . "." . $ext;
    $target   = $upload_dir . $filename;

    if (!move_uploaded_file($_FILES[$fieldName]["tmp_name"], $target)) {
        echo json_encode(["success" => false, "message" => "Failed to save document: {$fieldName}."]);
        exit;
    }
    $docUrls[$column] = "uploads/operators/" . $filename;
}

// Build the INSERT with only the columns relevant to this vehicle_type populated.
$allColumns = [
    "doc_lto_cr_url", "doc_capacity_spec_url", "doc_engine_cert_url", "doc_lto_stencil_url",
    "doc_model_proof_url", "doc_terminal_route_map_url", "doc_garage_proof_url",
    "doc_speed_limiter_url", "doc_gps_cert_url", "doc_pami_policy_url", "doc_fare_matrix_url",
];
$values = [];
foreach ($allColumns as $col) {
    $values[] = $docUrls[$col] ?? null;
}

$columnList = implode(", ", $allColumns);
$placeholders = implode(", ", array_fill(0, count($allColumns), "?"));

$stmt = $conn->prepare("
    INSERT INTO operator_association_applications
        (operator_id, association_id, vehicle_type, {$columnList},
         intended_plate_number, intended_vehicle_number, intended_capacity)
    VALUES (?, ?, ?, {$placeholders}, ?, ?, ?)
");
$types = "iis" . str_repeat("s", count($allColumns)) . "ssi";
$params = array_merge(
    [$operator_id, $association_id, $vehicle_type], $values,
    [$intended_plate_number, $intended_vehicle_number, $intended_capacity]
);
$stmt->bind_param($types, ...$params);

if ($stmt->execute()) {
    echo json_encode(["success" => true, "application_id" => $conn->insert_id]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to submit application."]);
}
