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

$driver_id = (int)($_GET['driver_id'] ?? 0);
if (!$driver_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "driver_id is required."]);
    exit;
}

// Quota assignment
$stmt = $conn->prepare("
    SELECT dq.id, dq.amount, dq.frequency,
           o.name AS operator_name
    FROM driver_quotas dq
    JOIN operators o ON dq.operator_id = o.id
    WHERE dq.driver_id = ?
");
$stmt->bind_param("i", $driver_id);
$stmt->execute();
$quota = $stmt->get_result()->fetch_assoc();

if ($quota) {
    $quota['amount'] = (float)$quota['amount'];

    // Current period boundaries computed by MySQL's own clock (daily = today,
    // weekly = Mon-Sun containing today) — must match the DB's clock, not PHP's,
    // since submitted_at is stamped via MySQL's CURRENT_TIMESTAMP and the two
    // can be in different timezones.
    if ($quota['frequency'] === 'weekly') {
        $period_label = 'This week';
        $sumStmt = $conn->prepare("
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM quota_submissions
            WHERE driver_id = ? AND status IN ('pending', 'confirmed')
              AND submitted_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(NOW()) DAY)
              AND submitted_at <  DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(NOW()) DAY), INTERVAL 7 DAY)
        ");
    } else {
        $period_label = 'Today';
        $sumStmt = $conn->prepare("
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM quota_submissions
            WHERE driver_id = ? AND status IN ('pending', 'confirmed')
              AND submitted_at >= CURDATE() AND submitted_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        ");
    }

    // Sum pending + confirmed submissions within the current period
    // (rejected submissions are refunded and don't count toward the quota)
    $sumStmt->bind_param("i", $driver_id);
    $sumStmt->execute();
    $period_total = (float)$sumStmt->get_result()->fetch_assoc()['total'];

    $quota['period_label']     = $period_label;
    $quota['period_total']     = $period_total;
    $quota['period_remaining'] = max($quota['amount'] - $period_total, 0);
    $quota['period_met']       = $period_total >= $quota['amount'];
}

// Last 10 submissions for this driver
$stmt2 = $conn->prepare("
    SELECT id, amount, period_type, status, note, submitted_at, reviewed_at
    FROM quota_submissions
    WHERE driver_id = ?
    ORDER BY submitted_at DESC
    LIMIT 10
");
$stmt2->bind_param("i", $driver_id);
$stmt2->execute();
$result = $stmt2->get_result();
$submissions = [];
while ($row = $result->fetch_assoc()) {
    $row['amount'] = (float)$row['amount'];
    $submissions[] = $row;
}

echo json_encode([
    "success"     => true,
    "quota"       => $quota ?: null,
    "submissions" => $submissions,
]);
