<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$operator_id = (int)($_GET["operator_id"] ?? 0);
if (!$operator_id) {
    echo json_encode(["success" => false, "message" => "operator_id is required."]);
    exit;
}

// Membership is per (vehicle_type, association) pair now — an operator can
// hold the SAME vehicle type approved at several different associations at
// once (e.g. UV Express at both DAU and Angeles City JODA), not just
// different vehicle types at different associations. Returns one row per
// (vehicle_type, association) pair the operator has EVER applied for
// (latest application per pair), so a re-apply after rejection at that same
// association collapses to its newest attempt, but two different
// associations for the same type both surface independently.
$stmt = $conn->prepare("
    SELECT a.id, a.association_id, a.vehicle_type, a.status, a.rejection_reason, a.created_at,
           a.intended_plate_number, a.intended_vehicle_number, a.intended_capacity, a.vehicle_added,
           s.name AS association_name
    FROM operator_association_applications a
    JOIN associations s ON s.id = a.association_id
    WHERE a.operator_id = ?
      AND a.id = (
          SELECT a2.id FROM operator_association_applications a2
          WHERE a2.operator_id = a.operator_id AND a2.vehicle_type = a.vehicle_type AND a2.association_id = a.association_id
          ORDER BY a2.created_at DESC LIMIT 1
      )
    ORDER BY a.vehicle_type ASC, s.name ASC
");
$stmt->bind_param("i", $operator_id);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

$applications = array_map(fn($row) => [
    "id"               => (int)$row["id"],
    "association_id"   => (int)$row["association_id"],
    "association_name" => $row["association_name"],
    "vehicle_type"      => $row["vehicle_type"],
    "status"           => $row["status"],
    "rejection_reason" => $row["rejection_reason"],
    "created_at"       => $row["created_at"],
    // "Finish adding your vehicle" reminder from the registration wizard's
    // Step 2 (see migration 055) — only meaningful once status='approved'
    // and vehicle_added is still 0; the mobile Operator Dashboard uses this
    // to pre-fill the Vehicles tab's Add Vehicle form instead of asking again.
    "intended_plate_number"   => $row["intended_plate_number"],
    "intended_vehicle_number" => $row["intended_vehicle_number"],
    "intended_capacity"       => $row["intended_capacity"] !== null ? (int)$row["intended_capacity"] : null,
    "vehicle_added"           => (bool)$row["vehicle_added"],
], $rows);

echo json_encode(["success" => true, "applications" => $applications]);
