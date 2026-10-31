<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Commuter-facing: a UV Express route's association-set schedule (operating
// hours + recurrence) plus whether it's actually bookable right now (at
// least one operator has activated it). Powers the book-ahead date/time
// picker in (main)/book.tsx — see Core Flow 8b's UV scheduling rewrite. A
// route with no schedule row, or one no operator has activated, has no
// book-ahead option (live "go online" walk-up sessions are unaffected).

$route_id = (int)($_GET["route_id"] ?? 0);
if (!$route_id) {
    echo json_encode(["success" => false, "message" => "route_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT h.id, h.start_time, h.end_time, h.recurrence_type, h.weekdays, h.status,
           (SELECT COUNT(*) FROM uv_schedule_activations a WHERE a.uv_operating_hours_id = h.id AND a.status = 'active') AS active_operators
    FROM uv_operating_hours h
    WHERE h.route_id = ?
");
$stmt->bind_param("i", $route_id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row || $row["status"] !== "active") {
    echo json_encode(["success" => true, "schedule" => null]);
    exit;
}

echo json_encode([
    "success"  => true,
    "schedule" => [
        "id"              => (int)$row["id"],
        "start_time"      => substr($row["start_time"], 0, 5),
        "end_time"        => substr($row["end_time"], 0, 5),
        "recurrence_type" => $row["recurrence_type"],
        "weekdays"        => $row["weekdays"] !== null ? array_map("intval", explode(",", $row["weekdays"])) : null,
        "is_bookable"     => (int)$row["active_operators"] > 0,
    ],
]);
