<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$method = $_SERVER["REQUEST_METHOD"];

// Association-defined daily operating window for a UV Express route (start of
// operations -> end of operations, plus a recurrence — daily or specific
// weekdays, mirroring bus_schedules.php). One row per route (UNIQUE
// route_id). A route with no row, or whose row is 'inactive', has no
// restriction/schedule — see Core Flow 8b. This row is also the schedule an
// operator "activates" (uv_schedule_activations) instead of manually
// creating individual uv_slots — see Core Flow 8b's UV scheduling rewrite.

function validWeekdays($input): ?string {
    if (!is_array($input) || count($input) === 0) return null;
    $clean = array_values(array_unique(array_filter(array_map("intval", $input), fn($d) => $d >= 0 && $d <= 6)));
    if (empty($clean)) return null;
    sort($clean);
    return implode(",", $clean);
}

// "5:00" vs "21:00" as raw strings sorts "5:00" AFTER "21:00" (byte-by-byte:
// '5' > '2'), incorrectly rejecting valid non-zero-padded input — compare as
// actual minutes-since-midnight instead. HH:MM only (already regex-validated
// by the caller before this runs).
function timeToMinutes(string $hhmm): int {
    [$h, $m] = array_map("intval", explode(":", $hhmm));
    return $h * 60 + $m;
}

// ── GET: list an association's operating-hours rows, optionally filtered to one route ──
if ($method === "GET") {
    $association_id = (int)($_GET["association_id"] ?? 0);
    if (!$association_id) {
        echo json_encode(["success" => false, "message" => "association_id is required."]);
        exit;
    }
    $route_id = isset($_GET["route_id"]) && $_GET["route_id"] !== "" ? (int)$_GET["route_id"] : null;

    $sql = "
        SELECT h.id, h.route_id, h.start_time, h.end_time, h.recurrence_type, h.weekdays, h.status,
               r.name AS route_name, r.from_location, r.to_location
        FROM uv_operating_hours h
        JOIN routes r ON r.id = h.route_id
        WHERE h.association_id = ?
    ";
    $params = [$association_id];
    $types  = "i";
    if ($route_id) {
        $sql     .= " AND h.route_id = ?";
        $params[] = $route_id;
        $types   .= "i";
    }
    $sql .= " ORDER BY r.name ASC";

    $stmt = $conn->prepare($sql);
    $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $result = $stmt->get_result();
    $rows = [];
    while ($row = $result->fetch_assoc()) {
        $rows[] = [
            "id"              => (int)$row["id"],
            "route_id"        => (int)$row["route_id"],
            "route_name"      => $row["route_name"],
            "from_location"   => $row["from_location"],
            "to_location"     => $row["to_location"],
            "start_time"      => substr($row["start_time"], 0, 5),
            "end_time"        => substr($row["end_time"], 0, 5),
            "recurrence_type" => $row["recurrence_type"],
            "weekdays"        => $row["weekdays"] !== null ? array_map("intval", explode(",", $row["weekdays"])) : null,
            "status"          => $row["status"],
        ];
    }
    echo json_encode(["success" => true, "operating_hours" => $rows]);
    exit;
}

// ── POST: create the operating-hours row for a route that doesn't have one yet ──
if ($method === "POST") {
    $body            = json_decode(file_get_contents("php://input"), true);
    $association_id  = (int)($body["association_id"] ?? 0);
    $route_id        = (int)($body["route_id"] ?? 0);
    $start_time      = trim($body["start_time"] ?? "");
    $end_time        = trim($body["end_time"] ?? "");
    $recurrence_type = trim($body["recurrence_type"] ?? "daily");
    $weekdays        = $body["weekdays"] ?? null;

    if (!$association_id || !$route_id || $start_time === "" || $end_time === "") {
        echo json_encode(["success" => false, "message" => "association_id, route_id, start_time, and end_time are required."]);
        exit;
    }
    if (!preg_match('/^\d{1,2}:\d{2}$/', $start_time) || !preg_match('/^\d{1,2}:\d{2}$/', $end_time)) {
        echo json_encode(["success" => false, "message" => "start_time and end_time must be HH:MM."]);
        exit;
    }
    // UV Express operates 24 hours — an overnight window (e.g. 23:00 start,
    // 02:00 end, wrapping past midnight) is valid and interpreted as ending
    // the following day. Only a zero-duration window (identical start/end)
    // is actually invalid.
    if (timeToMinutes($start_time) === timeToMinutes($end_time)) {
        echo json_encode(["success" => false, "message" => "start_time and end_time cannot be the same."]);
        exit;
    }
    if (!in_array($recurrence_type, ["daily", "weekly"], true)) {
        echo json_encode(["success" => false, "message" => "recurrence_type must be daily or weekly."]);
        exit;
    }
    $weekdaysStr = null;
    if ($recurrence_type === "weekly") {
        $weekdaysStr = validWeekdays($weekdays);
        if ($weekdaysStr === null) {
            echo json_encode(["success" => false, "message" => "weekdays (array of 0=Sun..6=Sat) is required for weekly recurrence."]);
            exit;
        }
    }

    // Route must belong to this association and be UV Express.
    $stmt = $conn->prepare("SELECT id FROM routes WHERE id = ? AND association_id = ? AND vehicle_type = 'UV Express'");
    $stmt->bind_param("ii", $route_id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "Route not found, not a UV Express route, or not owned by this association."]);
        exit;
    }
    $stmt->close();

    $stmt = $conn->prepare("SELECT id FROM uv_operating_hours WHERE route_id = ?");
    $stmt->bind_param("i", $route_id);
    $stmt->execute();
    if ($stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "This route already has a schedule set — edit the existing one instead."]);
        exit;
    }
    $stmt->close();

    $stmt = $conn->prepare("
        INSERT INTO uv_operating_hours (association_id, route_id, start_time, end_time, recurrence_type, weekdays)
        VALUES (?, ?, ?, ?, ?, ?)
    ");
    $stmt->bind_param("iissss", $association_id, $route_id, $start_time, $end_time, $recurrence_type, $weekdaysStr);
    $stmt->execute();
    echo json_encode(["success" => true, "id" => $conn->insert_id]);
    exit;
}

// ── PUT: full edit, or (if only `status` is sent) a quick status toggle ───────
if ($method === "PUT") {
    $body           = json_decode(file_get_contents("php://input"), true);
    $id             = (int)($body["id"] ?? 0);
    $association_id = (int)($body["association_id"] ?? 0);

    if (!$id || !$association_id) {
        echo json_encode(["success" => false, "message" => "id and association_id are required."]);
        exit;
    }

    $stmt = $conn->prepare("SELECT id FROM uv_operating_hours WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "Schedule not found."]);
        exit;
    }
    $stmt->close();

    $isFullEdit = isset($body["start_time"]) || isset($body["end_time"]) || isset($body["recurrence_type"]);

    if (!$isFullEdit) {
        $status = trim($body["status"] ?? "");
        if (!in_array($status, ["active", "inactive"], true)) {
            echo json_encode(["success" => false, "message" => "A valid status is required."]);
            exit;
        }
        $stmt = $conn->prepare("UPDATE uv_operating_hours SET status = ? WHERE id = ? AND association_id = ?");
        $stmt->bind_param("sii", $status, $id, $association_id);
        $stmt->execute();
        echo json_encode(["success" => true]);
        exit;
    }

    $start_time      = trim($body["start_time"] ?? "");
    $end_time        = trim($body["end_time"] ?? "");
    $recurrence_type = trim($body["recurrence_type"] ?? "daily");
    $weekdays        = $body["weekdays"] ?? null;
    $status          = in_array(($body["status"] ?? ""), ["active", "inactive"], true) ? $body["status"] : "active";

    if ($start_time === "" || $end_time === "") {
        echo json_encode(["success" => false, "message" => "start_time and end_time are required."]);
        exit;
    }
    if (!preg_match('/^\d{1,2}:\d{2}$/', $start_time) || !preg_match('/^\d{1,2}:\d{2}$/', $end_time)) {
        echo json_encode(["success" => false, "message" => "start_time and end_time must be HH:MM."]);
        exit;
    }
    // UV Express operates 24 hours — an overnight window (e.g. 23:00 start,
    // 02:00 end, wrapping past midnight) is valid and interpreted as ending
    // the following day. Only a zero-duration window (identical start/end)
    // is actually invalid.
    if (timeToMinutes($start_time) === timeToMinutes($end_time)) {
        echo json_encode(["success" => false, "message" => "start_time and end_time cannot be the same."]);
        exit;
    }
    if (!in_array($recurrence_type, ["daily", "weekly"], true)) {
        echo json_encode(["success" => false, "message" => "recurrence_type must be daily or weekly."]);
        exit;
    }
    $weekdaysStr = null;
    if ($recurrence_type === "weekly") {
        $weekdaysStr = validWeekdays($weekdays);
        if ($weekdaysStr === null) {
            echo json_encode(["success" => false, "message" => "weekdays (array of 0=Sun..6=Sat) is required for weekly recurrence."]);
            exit;
        }
    }

    $stmt = $conn->prepare("
        UPDATE uv_operating_hours
        SET start_time = ?, end_time = ?, recurrence_type = ?, weekdays = ?, status = ?
        WHERE id = ? AND association_id = ?
    ");
    $stmt->bind_param("sssssii", $start_time, $end_time, $recurrence_type, $weekdaysStr, $status, $id, $association_id);
    $stmt->execute();
    echo json_encode(["success" => true]);
    exit;
}

// ── DELETE: remove an operating-hours row ───────────────────────────────────────
if ($method === "DELETE") {
    $body           = json_decode(file_get_contents("php://input"), true);
    $id             = (int)($body["id"] ?? 0);
    $association_id = (int)($body["association_id"] ?? 0);

    if (!$id || !$association_id) {
        echo json_encode(["success" => false, "message" => "id and association_id are required."]);
        exit;
    }
    $stmt = $conn->prepare("DELETE FROM uv_operating_hours WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $id, $association_id);
    $stmt->execute();
    echo json_encode(["success" => true]);
    exit;
}

echo json_encode(["success" => false, "message" => "Method not allowed."]);
