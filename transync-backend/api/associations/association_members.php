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

$association_id = (int)($_GET['association_id'] ?? 0);

if (!$association_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "association_id is required."]);
    exit;
}

// ── Member operators, each with the drivers under them ────────────────────────
// Membership is per-vehicle-type now (operator_association_applications), not a
// single operators.association_id — an operator can be an approved member of
// this association for one vehicle type and not another, so drivers are scoped
// to the vehicle type(s) actually approved here, not the operator's entire fleet.

$stmt = $conn->prepare("
    SELECT DISTINCT operator_id FROM operator_association_applications
    WHERE association_id = ? AND status = 'approved'
    ORDER BY operator_id ASC
");
$stmt->bind_param("i", $association_id);
$stmt->execute();
$operatorIds = array_map(fn($r) => (int)$r["operator_id"], $stmt->get_result()->fetch_all(MYSQLI_ASSOC));
$stmt->close();

$operators = [];
foreach ($operatorIds as $opId) {
    $stmt = $conn->prepare("SELECT id, name, phone, email FROM operators WHERE id = ?");
    $stmt->bind_param("i", $opId);
    $stmt->execute();
    $op = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$op) continue;

    $stmt = $conn->prepare("
        SELECT vehicle_type FROM operator_association_applications
        WHERE operator_id = ? AND association_id = ? AND status = 'approved'
    ");
    $stmt->bind_param("ii", $opId, $association_id);
    $stmt->execute();
    $vehicleTypes = array_map(fn($r) => $r["vehicle_type"], $stmt->get_result()->fetch_all(MYSQLI_ASSOC));
    $stmt->close();

    if (empty($vehicleTypes)) continue;

    $placeholders = implode(",", array_fill(0, count($vehicleTypes), "?"));
    $stmt = $conn->prepare("
        SELECT d.id, d.name, d.phone, d.license_number, d.status,
               d.vehicle_id, v.type AS vehicle_type, v.plate_number AS vehicle_plate,
               r.id AS route_id, r.name AS route_name, r.color AS route_color
        FROM drivers d
        LEFT JOIN vehicles v ON v.id = d.vehicle_id
        LEFT JOIN route_assignments ra ON ra.vehicle_id = d.vehicle_id
        LEFT JOIN routes r ON r.id = ra.route_id
        WHERE d.operator_id = ? AND v.type IN ({$placeholders})
        ORDER BY d.name ASC
    ");
    $types  = "i" . str_repeat("s", count($vehicleTypes));
    $params = array_merge([$opId], $vehicleTypes);
    $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $driverRows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    $operators[] = [
        "id"            => (int)$op["id"],
        "name"          => $op["name"],
        "vehicle_types" => $vehicleTypes,
        "phone"         => $op["phone"],
        "email"         => $op["email"],
        "drivers"       => array_map(fn($d) => [
            "id"                   => (int)$d["id"],
            "name"                 => $d["name"],
            "phone"                => $d["phone"],
            "license_number"       => $d["license_number"],
            "status"               => $d["status"],
            "vehicle_id"           => $d["vehicle_id"] ? (int)$d["vehicle_id"] : null,
            "vehicle_type"         => $d["vehicle_type"],
            "vehicle_plate"        => $d["vehicle_plate"],
            "assigned_route_id"    => $d["route_id"]    ? (int)$d["route_id"] : null,
            "assigned_route"       => $d["route_name"]  ?? null,
            "assigned_route_color" => $d["route_color"] ?? null,
        ], $driverRows),
    ];
}

echo json_encode(["success" => true, "operators" => $operators]);
