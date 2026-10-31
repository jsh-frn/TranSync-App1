<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Lets Driver Settings/Verification re-sync live (Driver Profile & Settings)
// — mirrors the get_profile.php pattern already built for commuter/
// association/operator. login_mobile.php's findDriver() only ever reflects
// login-time state; this is the same live derivation (operator_type/
// association from the driver's own currently-assigned vehicle, never a
// fixed column), plus the assigned vehicle's own vehicle_number/
// plate_number — never returned by login, needed for a real "Assigned
// Vehicle" display instead of just a vehicle-type label.
$driver_id = (int)($_GET["driver_id"] ?? 0);
if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "driver_id is required."]);
    exit;
}

$sql = "
    SELECT d.id, d.name, d.email, d.phone, d.license_number, d.status, d.avatar_url,
           o.id AS operator_id, o.name AS operator_name,
           CASE v.type WHEN 'Jeepney' THEN 'Jeepney Op' WHEN 'UV Express' THEN 'UV Op' WHEN 'Bus' THEN 'Bus Op' ELSE NULL END AS operator_type,
           a.id AS association_id, a.name AS association_name,
           v.vehicle_number, v.plate_number, v.type AS vehicle_type
    FROM drivers d
    LEFT JOIN operators    o ON d.operator_id = o.id
    LEFT JOIN vehicles     v ON d.vehicle_id = v.id
    LEFT JOIN operator_association_applications oaa
           ON oaa.operator_id = d.operator_id AND oaa.vehicle_type = v.type AND oaa.status = 'approved'
    LEFT JOIN associations a ON a.id = oaa.association_id
    WHERE d.id = ?
";
$stmt = $conn->prepare($sql);
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$driver = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$driver) {
    echo json_encode(["success" => false, "message" => "Driver not found."]);
    exit;
}

echo json_encode([
    "success" => true,
    "driver" => [
        "id"              => (int)$driver["id"],
        "name"            => $driver["name"],
        "email"           => $driver["email"],
        "phone"           => $driver["phone"],
        "license_number"  => $driver["license_number"],
        "status"          => $driver["status"],
        // Relative path — see commuter/get_profile.php's comment.
        "avatar_url"      => $driver["avatar_url"],
        "operator_id"     => $driver["operator_id"] !== null ? (int)$driver["operator_id"] : null,
        "operator_name"   => $driver["operator_name"],
        "operator_type"   => $driver["operator_type"],
        "association_id"  => $driver["association_id"] !== null ? (int)$driver["association_id"] : null,
        "association_name"=> $driver["association_name"],
        "vehicle_number"  => $driver["vehicle_number"],
        "plate_number"    => $driver["plate_number"],
        "vehicle_type"    => $driver["vehicle_type"],
    ],
]);
