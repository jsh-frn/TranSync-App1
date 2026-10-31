<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$method = $_SERVER["REQUEST_METHOD"];

// Operator's activate/deactivate toggle on an association-published UV
// Express schedule (uv_operating_hours) — replaces the old operator-created
// uv_slots flow. Activating makes the schedule bookable by commuters for
// this operator's fleet; it does not commit a specific vehicle/driver (UV
// stays queue-based, see Core Flow 8b's UV scheduling rewrite).

// ── GET: this operator's UV-approved association's schedules, merged with
// the operator's own activation status per schedule ─────────────────────────
if ($method === "GET") {
    $operator_id    = (int)($_GET["operator_id"]    ?? 0);
    $association_id = (int)($_GET["association_id"] ?? 0);
    if (!$operator_id) {
        echo json_encode(["success" => false, "message" => "operator_id is required."]);
        exit;
    }

    // An operator can be UV-Express-approved at several associations at
    // once now, so without an explicit association_id there's no single
    // correct answer to "the operator's UV association" — the mobile app
    // always passes the operator's currently active association. Falling
    // back to an arbitrary approved one (old LIMIT 1 behavior) only if the
    // caller genuinely didn't supply one.
    if ($association_id) {
        $stmt = $conn->prepare("
            SELECT id FROM operator_association_applications
            WHERE operator_id = ? AND vehicle_type = 'UV Express' AND association_id = ? AND status = 'approved'
        ");
        $stmt->bind_param("ii", $operator_id, $association_id);
        $stmt->execute();
        $app = $stmt->get_result()->fetch_assoc();
        $stmt->close();
    } else {
        $stmt = $conn->prepare("
            SELECT association_id FROM operator_association_applications
            WHERE operator_id = ? AND vehicle_type = 'UV Express' AND status = 'approved'
            LIMIT 1
        ");
        $stmt->bind_param("i", $operator_id);
        $stmt->execute();
        $app = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $association_id = (int)($app["association_id"] ?? 0);
    }

    if (!$app) {
        echo json_encode(["success" => true, "schedules" => []]);
        exit;
    }

    $stmt = $conn->prepare("
        SELECT h.id, h.route_id, h.start_time, h.end_time, h.recurrence_type, h.weekdays, h.status AS schedule_status,
               r.name AS route_name, r.from_location, r.to_location,
               a.status AS activation_status
        FROM uv_operating_hours h
        JOIN routes r ON r.id = h.route_id
        LEFT JOIN uv_schedule_activations a ON a.uv_operating_hours_id = h.id AND a.operator_id = ?
        WHERE h.association_id = ?
        ORDER BY r.name ASC
    ");
    $stmt->bind_param("ii", $operator_id, $association_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $schedules = [];
    while ($row = $result->fetch_assoc()) {
        $schedules[] = [
            "id"                => (int)$row["id"],
            "route_id"          => (int)$row["route_id"],
            "route_name"        => $row["route_name"],
            "from_location"     => $row["from_location"],
            "to_location"       => $row["to_location"],
            "start_time"        => substr($row["start_time"], 0, 5),
            "end_time"          => substr($row["end_time"], 0, 5),
            "recurrence_type"   => $row["recurrence_type"],
            "weekdays"          => $row["weekdays"] !== null ? array_map("intval", explode(",", $row["weekdays"])) : null,
            "schedule_status"   => $row["schedule_status"],
            "activation_status" => $row["activation_status"], // 'active' | 'inactive' | null (never toggled)
        ];
    }
    echo json_encode(["success" => true, "schedules" => $schedules]);
    exit;
}

// ── POST: toggle this operator's activation for one schedule ────────────────
if ($method === "POST") {
    $body                  = json_decode(file_get_contents("php://input"), true);
    $operator_id           = (int)($body["operator_id"] ?? 0);
    $uv_operating_hours_id = (int)($body["uv_operating_hours_id"] ?? 0);
    $status                = trim($body["status"] ?? "");

    if (!$operator_id || !$uv_operating_hours_id || !in_array($status, ["active", "inactive"], true)) {
        echo json_encode(["success" => false, "message" => "operator_id, uv_operating_hours_id, and a valid status are required."]);
        exit;
    }

    // The operator must be approved for UV Express at the schedule's own association.
    $stmt = $conn->prepare("
        SELECT h.id FROM uv_operating_hours h
        JOIN operator_association_applications oaa
            ON oaa.association_id = h.association_id AND oaa.vehicle_type = 'UV Express' AND oaa.status = 'approved'
        WHERE h.id = ? AND oaa.operator_id = ?
    ");
    $stmt->bind_param("ii", $uv_operating_hours_id, $operator_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "This schedule isn't available to your operator account."]);
        exit;
    }
    $stmt->close();

    $stmt = $conn->prepare("
        INSERT INTO uv_schedule_activations (operator_id, uv_operating_hours_id, status)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE status = VALUES(status)
    ");
    $stmt->bind_param("iis", $operator_id, $uv_operating_hours_id, $status);
    $stmt->execute();
    echo json_encode(["success" => true, "status" => $status]);
    exit;
}

echo json_encode(["success" => false, "message" => "Method not allowed."]);
