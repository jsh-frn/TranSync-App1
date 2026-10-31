<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$method = $_SERVER["REQUEST_METHOD"];

// Association-defined daily operating window for a Jeepney route (start of
// operations -> end of operations). Purely informational — Jeepney has no
// scheduled-slot booking flow to gate (unlike uv_operating_hours), so this
// is never read by any booking/dispatch logic; it only powers a read-only
// display for commuters (map marker tap) and drivers (Dispatch tab), see
// routes/get_jeepney_operating_hours.php. One row per route (UNIQUE
// route_id). A route with no row, or whose row is 'inactive', has no
// published hours.

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
        SELECT h.id, h.route_id, h.start_time, h.end_time, h.status,
               r.name AS route_name, r.from_location, r.to_location
        FROM jeepney_operating_hours h
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
            "id"            => (int)$row["id"],
            "route_id"      => (int)$row["route_id"],
            "route_name"    => $row["route_name"],
            "from_location" => $row["from_location"],
            "to_location"   => $row["to_location"],
            "start_time"    => substr($row["start_time"], 0, 5),
            "end_time"      => substr($row["end_time"], 0, 5),
            "status"        => $row["status"],
        ];
    }
    echo json_encode(["success" => true, "operating_hours" => $rows]);
    exit;
}

// ── POST: create the operating-hours row for a route that doesn't have one yet ──
if ($method === "POST") {
    $body           = json_decode(file_get_contents("php://input"), true);
    $association_id = (int)($body["association_id"] ?? 0);
    $route_id       = (int)($body["route_id"] ?? 0);
    $start_time     = trim($body["start_time"] ?? "");
    $end_time       = trim($body["end_time"] ?? "");

    if (!$association_id || !$route_id || $start_time === "" || $end_time === "") {
        echo json_encode(["success" => false, "message" => "association_id, route_id, start_time, and end_time are required."]);
        exit;
    }
    if (!preg_match('/^\d{1,2}:\d{2}$/', $start_time) || !preg_match('/^\d{1,2}:\d{2}$/', $end_time)) {
        echo json_encode(["success" => false, "message" => "start_time and end_time must be HH:MM."]);
        exit;
    }
    // An overnight window (e.g. 23:00 start, 02:00 end, wrapping past
    // midnight) is valid and interpreted as ending the following day, same
    // as UV Express's operating hours. Only a zero-duration window
    // (identical start/end) is actually invalid.
    if (timeToMinutes($start_time) === timeToMinutes($end_time)) {
        echo json_encode(["success" => false, "message" => "start_time and end_time cannot be the same."]);
        exit;
    }

    // Route must belong to this association and be Jeepney.
    $stmt = $conn->prepare("SELECT id FROM routes WHERE id = ? AND association_id = ? AND vehicle_type = 'Jeepney'");
    $stmt->bind_param("ii", $route_id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "Route not found, not a Jeepney route, or not owned by this association."]);
        exit;
    }
    $stmt->close();

    $stmt = $conn->prepare("SELECT id FROM jeepney_operating_hours WHERE route_id = ?");
    $stmt->bind_param("i", $route_id);
    $stmt->execute();
    if ($stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "This route already has operating hours set — edit the existing one instead."]);
        exit;
    }
    $stmt->close();

    $stmt = $conn->prepare("
        INSERT INTO jeepney_operating_hours (association_id, route_id, start_time, end_time)
        VALUES (?, ?, ?, ?)
    ");
    $stmt->bind_param("iiss", $association_id, $route_id, $start_time, $end_time);
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

    $stmt = $conn->prepare("SELECT id FROM jeepney_operating_hours WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "Operating hours row not found."]);
        exit;
    }
    $stmt->close();

    $isFullEdit = isset($body["start_time"]) || isset($body["end_time"]);

    if (!$isFullEdit) {
        $status = trim($body["status"] ?? "");
        if (!in_array($status, ["active", "inactive"], true)) {
            echo json_encode(["success" => false, "message" => "A valid status is required."]);
            exit;
        }
        $stmt = $conn->prepare("UPDATE jeepney_operating_hours SET status = ? WHERE id = ? AND association_id = ?");
        $stmt->bind_param("sii", $status, $id, $association_id);
        $stmt->execute();
        echo json_encode(["success" => true]);
        exit;
    }

    $start_time = trim($body["start_time"] ?? "");
    $end_time   = trim($body["end_time"] ?? "");
    $status     = in_array(($body["status"] ?? ""), ["active", "inactive"], true) ? $body["status"] : "active";

    if ($start_time === "" || $end_time === "") {
        echo json_encode(["success" => false, "message" => "start_time and end_time are required."]);
        exit;
    }
    if (!preg_match('/^\d{1,2}:\d{2}$/', $start_time) || !preg_match('/^\d{1,2}:\d{2}$/', $end_time)) {
        echo json_encode(["success" => false, "message" => "start_time and end_time must be HH:MM."]);
        exit;
    }
    if (timeToMinutes($start_time) === timeToMinutes($end_time)) {
        echo json_encode(["success" => false, "message" => "start_time and end_time cannot be the same."]);
        exit;
    }

    $stmt = $conn->prepare("
        UPDATE jeepney_operating_hours
        SET start_time = ?, end_time = ?, status = ?
        WHERE id = ? AND association_id = ?
    ");
    $stmt->bind_param("sssii", $start_time, $end_time, $status, $id, $association_id);
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
    $stmt = $conn->prepare("DELETE FROM jeepney_operating_hours WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $id, $association_id);
    $stmt->execute();
    echo json_encode(["success" => true]);
    exit;
}

echo json_encode(["success" => false, "message" => "Method not allowed."]);
