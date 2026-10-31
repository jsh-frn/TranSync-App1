<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed."]);
    exit;
}

require_once "../../config/db.php";

$data           = json_decode(file_get_contents("php://input"), true);
$association_id = (int)($data['association_id'] ?? 0);
$driver_id      = (int)($data['driver_id']      ?? 0);

if (!$association_id || !$driver_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "association_id and driver_id are required."]);
    exit;
}

// ── Verify the driver is an active member of this association ────────────────
$stmt = $conn->prepare("
    SELECT id FROM association_memberships
    WHERE subject_type    = 'driver'
      AND subject_id      = ?
      AND association_id  = ?
      AND status          = 'active'
    LIMIT 1
");
$stmt->bind_param("ii", $driver_id, $association_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Driver is not an active member of this association."]);
    exit;
}

// ── Execute removal in a transaction ────────────────────────────────────────
$conn->begin_transaction();

try {
    // 1. Delete all membership rows for this driver in this association
    $stmt = $conn->prepare("
        DELETE FROM association_memberships
        WHERE subject_type   = 'driver'
          AND subject_id     = ?
          AND association_id = ?
    ");
    $stmt->bind_param("ii", $driver_id, $association_id);
    $stmt->execute();

    // 2. Clear the driver's association
    $stmt = $conn->prepare("UPDATE drivers SET association_id = NULL WHERE id = ?");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();

    // 3. Remove route assignments for this driver
    $stmt = $conn->prepare("DELETE FROM route_assignments WHERE driver_id = ?");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();

    // 4. Reject the approved application so the driver can re-apply cleanly
    $stmt = $conn->prepare("
        UPDATE association_applications
        SET status = 'rejected'
        WHERE subject_type   = 'driver'
          AND subject_id     = ?
          AND association_id = ?
          AND status         = 'approved'
    ");
    $stmt->bind_param("ii", $driver_id, $association_id);
    $stmt->execute();

    $conn->commit();
    echo json_encode(["success" => true, "message" => "Driver has been removed from the association."]);

} catch (Exception $e) {
    $conn->rollback();
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to remove driver.", "error" => $e->getMessage()]);
}
