<?php
header("Content-Type: application/json");
require_once "../../config/db.php";

$data      = json_decode(file_get_contents("php://input"), true);
$driver_id = $data['driver_id'] ?? null;

if (!$driver_id) {
    echo json_encode(["success" => false, "message" => "Missing driver_id"]);
    exit;
}

// Mark dispatched entry as completed
$stmt = $conn->prepare("
    UPDATE dispatch_queue
    SET    status   = 'completed',
           ended_at = NOW()
    WHERE  driver_id = ?
      AND  status    = 'dispatched'
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();

// Nothing was actually dispatched for this driver (e.g. Start Trip never
// succeeded, or End Trip was tapped twice) — previously this endpoint
// always returned success regardless, so the driver's app claimed the trip
// ended with no indication nothing had actually happened server-side.
if ($stmt->affected_rows === 0) {
    echo json_encode(["success" => false, "message" => "No active trip found to end."]);
    exit;
}

// Mark driver as not full
$stmt = $conn->prepare("
    UPDATE drivers
    SET is_full = 0
    WHERE id = ?
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();

// Jeepney drivers don't move money through the app (fares are cash, off-app),
// so there's no per-ride percentage to take a cut from — instead give them a
// flat quota default sized to their vehicle's capacity the first time a shift
// ends, so quota/submit_quota.php has a sensible amount ready instead of
// requiring the operator to set one manually first. Only Jeepney: Bus/UV
// Express settle via the remittance split in board_reservation.php instead.
// Only seeds a default if the operator hasn't already set one — never
// overwrites an operator's own customization.
$stmt = $conn->prepare("
    SELECT d.operator_id, v.type AS vehicle_type, v.capacity, v.association_id
    FROM drivers d
    LEFT JOIN vehicles v ON v.id = d.vehicle_id
    WHERE d.id = ?
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$driverInfo = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($driverInfo && $driverInfo["vehicle_type"] === "Jeepney" && $driverInfo["capacity"]) {
    $stmt = $conn->prepare("SELECT id FROM driver_quotas WHERE driver_id = ?");
    $stmt->bind_param("i", $driver_id);
    $stmt->execute();
    $hasQuota = (bool)$stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$hasQuota) {
        $stmt = $conn->prepare("
            SELECT quota_amount FROM jeepney_quota_tiers
            WHERE ? BETWEEN min_capacity AND max_capacity
            LIMIT 1
        ");
        $capacity = (int)$driverInfo["capacity"];
        $stmt->bind_param("i", $capacity);
        $stmt->execute();
        $tier = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if ($tier) {
            $amount = (float)$tier["quota_amount"];
            $association_id = $driverInfo["association_id"] !== null ? (int)$driverInfo["association_id"] : null;
            $stmt = $conn->prepare("
                INSERT INTO driver_quotas (operator_id, driver_id, association_id, amount, frequency)
                VALUES (?, ?, ?, ?, 'daily')
            ");
            $stmt->bind_param("iiid", $driverInfo["operator_id"], $driver_id, $association_id, $amount);
            $stmt->execute();
            $stmt->close();
        }
    }
}

echo json_encode(["success" => true]);
