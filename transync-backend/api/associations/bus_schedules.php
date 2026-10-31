<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/trip_generation.php";

$method = $_SERVER["REQUEST_METHOD"];

// Association-owned recurring Bus schedule (route + class + boarding/departure
// time + recurrence). This is a template only — the System auto-generates
// pending_assignment trip instances from every Active schedule for a rolling
// window (config/trip_generation.php), and an operator belonging to the
// association assigns their own vehicle+driver+optional conductor to an
// already-generated trip (see bus_trips/assign_trip.php) rather than
// creating one from scratch.

// ── GET: list an association's schedules ──────────────────────────────────────
if ($method === "GET") {
    $association_id = (int)($_GET["association_id"] ?? 0);
    if (!$association_id) {
        echo json_encode(["success" => false, "message" => "association_id is required."]);
        exit;
    }

    // Opportunistic sweep + top-up (see get_operator_trips.php's identical
    // calls) — an association viewing their own schedules is another natural
    // chance to expire stale pending trips and backfill any rolling window
    // that's fallen short.
    expirePastPendingTrips($conn);
    generateTripsForAllActiveSchedules($conn);
    $stmt = $conn->prepare("
        SELECT bs.id, bs.route_id, bs.service_type_id, bs.boarding_time, bs.departure_time,
               bs.recurrence_type, bs.weekdays, bs.status,
               r.name AS route_name, r.from_location, r.to_location,
               st.name AS service_type_name
        FROM bus_schedules bs
        JOIN routes r ON r.id = bs.route_id
        JOIN bus_service_types st ON st.id = bs.service_type_id
        WHERE bs.association_id = ?
        ORDER BY bs.created_at DESC
    ");
    $stmt->bind_param("i", $association_id);
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
            "service_type_id"   => (int)$row["service_type_id"],
            "service_type_name" => $row["service_type_name"],
            "boarding_time"     => substr($row["boarding_time"], 0, 5),
            "departure_time"    => substr($row["departure_time"], 0, 5),
            "recurrence_type"   => $row["recurrence_type"],
            "weekdays"          => $row["weekdays"] !== null ? array_map("intval", explode(",", $row["weekdays"])) : null,
            "status"            => $row["status"],
        ];
    }
    echo json_encode(["success" => true, "schedules" => $schedules]);
    exit;
}

// ── POST: create a schedule ────────────────────────────────────────────────────
if ($method === "POST") {
    $body            = json_decode(file_get_contents("php://input"), true);
    $association_id  = (int)($body["association_id"] ?? 0);
    $route_id        = (int)($body["route_id"] ?? 0);
    $service_type_id = (int)($body["service_type_id"] ?? 0);
    $boarding_time   = trim($body["boarding_time"] ?? "");
    $departure_time  = trim($body["departure_time"] ?? "");
    $recurrence_type = trim($body["recurrence_type"] ?? "daily");
    $weekdays        = $body["weekdays"] ?? null;

    if (!$association_id || !$route_id || !$service_type_id || $boarding_time === "" || $departure_time === "") {
        echo json_encode(["success" => false, "message" => "association_id, route_id, service_type_id, boarding_time, and departure_time are required."]);
        exit;
    }
    if (!preg_match('/^\d{1,2}:\d{2}$/', $boarding_time) || !preg_match('/^\d{1,2}:\d{2}$/', $departure_time)) {
        echo json_encode(["success" => false, "message" => "boarding_time and departure_time must be HH:MM."]);
        exit;
    }
    if (!in_array($recurrence_type, ["daily", "weekly"], true)) {
        echo json_encode(["success" => false, "message" => "recurrence_type must be daily or weekly."]);
        exit;
    }

    $weekdaysStr = null;
    if ($recurrence_type === "weekly") {
        if (!is_array($weekdays) || count($weekdays) === 0) {
            echo json_encode(["success" => false, "message" => "weekdays (array of 0=Sun..6=Sat) is required for weekly recurrence."]);
            exit;
        }
        $clean = array_values(array_unique(array_filter(array_map("intval", $weekdays), fn($d) => $d >= 0 && $d <= 6)));
        if (empty($clean)) {
            echo json_encode(["success" => false, "message" => "weekdays must contain valid values 0-6."]);
            exit;
        }
        sort($clean);
        $weekdaysStr = implode(",", $clean);
    }

    // Route and class must both belong to this association.
    $stmt = $conn->prepare("SELECT id FROM routes WHERE id = ? AND association_id = ? AND vehicle_type = 'Bus'");
    $stmt->bind_param("ii", $route_id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "Route not found or not owned by this association."]);
        exit;
    }
    $stmt->close();

    $stmt = $conn->prepare("SELECT id FROM bus_service_types WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $service_type_id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "Class not found for this association."]);
        exit;
    }
    $stmt->close();

    $stmt = $conn->prepare("
        INSERT INTO bus_schedules (association_id, route_id, service_type_id, boarding_time, departure_time, recurrence_type, weekdays)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->bind_param("iiissss", $association_id, $route_id, $service_type_id, $boarding_time, $departure_time, $recurrence_type, $weekdaysStr);
    $stmt->execute();
    $new_id = $conn->insert_id;

    // New schedule is always created 'active' (schema default) — populate its
    // rolling window immediately so it isn't empty until the next opportunistic
    // top-up (association/operator screens both trigger one too).
    generateTripsForSchedule($conn, [
        "id" => $new_id, "route_id" => $route_id, "boarding_time" => $boarding_time,
        "departure_time" => $departure_time, "recurrence_type" => $recurrence_type,
        "weekdays" => $weekdaysStr, "status" => "active",
    ]);

    echo json_encode(["success" => true, "id" => $new_id]);
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

    // Confirm the schedule actually belongs to this association before any update.
    $stmt = $conn->prepare("SELECT id FROM bus_schedules WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "Schedule not found."]);
        exit;
    }
    $stmt->close();

    $isFullEdit = isset($body["route_id"]) || isset($body["service_type_id"])
        || isset($body["boarding_time"]) || isset($body["departure_time"]) || isset($body["recurrence_type"]);

    if (!$isFullEdit) {
        // Quick status-only toggle — unchanged behavior.
        $status = trim($body["status"] ?? "");
        if (!in_array($status, ["active", "inactive"], true)) {
            echo json_encode(["success" => false, "message" => "A valid status is required."]);
            exit;
        }
        $stmt = $conn->prepare("UPDATE bus_schedules SET status = ? WHERE id = ? AND association_id = ?");
        $stmt->bind_param("sii", $status, $id, $association_id);
        $stmt->execute();

        // Reactivating: top up this schedule's rolling window right away
        // instead of waiting for the next opportunistic trigger. Deactivating
        // needs no extra action here — future not-yet-assigned trips already
        // generated simply stop being commuter-visible (get_upcoming_trips.php
        // checks the schedule's own status), nothing is deleted or cancelled.
        if ($status === "active") {
            $freshStmt = $conn->prepare("SELECT * FROM bus_schedules WHERE id = ?");
            $freshStmt->bind_param("i", $id);
            $freshStmt->execute();
            $fresh = $freshStmt->get_result()->fetch_assoc();
            $freshStmt->close();
            if ($fresh) generateTripsForSchedule($conn, $fresh);
        }

        echo json_encode(["success" => true]);
        exit;
    }

    // ── Full edit — same validation as POST ─────────────────────────────────────
    $route_id        = (int)($body["route_id"] ?? 0);
    $service_type_id = (int)($body["service_type_id"] ?? 0);
    $boarding_time   = trim($body["boarding_time"] ?? "");
    $departure_time  = trim($body["departure_time"] ?? "");
    $recurrence_type = trim($body["recurrence_type"] ?? "daily");
    $weekdays        = $body["weekdays"] ?? null;
    $status          = in_array(($body["status"] ?? ""), ["active", "inactive"], true) ? $body["status"] : "active";

    if (!$route_id || !$service_type_id || $boarding_time === "" || $departure_time === "") {
        echo json_encode(["success" => false, "message" => "route_id, service_type_id, boarding_time, and departure_time are required."]);
        exit;
    }
    if (!preg_match('/^\d{1,2}:\d{2}$/', $boarding_time) || !preg_match('/^\d{1,2}:\d{2}$/', $departure_time)) {
        echo json_encode(["success" => false, "message" => "boarding_time and departure_time must be HH:MM."]);
        exit;
    }
    if (!in_array($recurrence_type, ["daily", "weekly"], true)) {
        echo json_encode(["success" => false, "message" => "recurrence_type must be daily or weekly."]);
        exit;
    }

    $weekdaysStr = null;
    if ($recurrence_type === "weekly") {
        if (!is_array($weekdays) || count($weekdays) === 0) {
            echo json_encode(["success" => false, "message" => "weekdays (array of 0=Sun..6=Sat) is required for weekly recurrence."]);
            exit;
        }
        $clean = array_values(array_unique(array_filter(array_map("intval", $weekdays), fn($d) => $d >= 0 && $d <= 6)));
        if (empty($clean)) {
            echo json_encode(["success" => false, "message" => "weekdays must contain valid values 0-6."]);
            exit;
        }
        sort($clean);
        $weekdaysStr = implode(",", $clean);
    }

    $stmt = $conn->prepare("SELECT id FROM routes WHERE id = ? AND association_id = ? AND vehicle_type = 'Bus'");
    $stmt->bind_param("ii", $route_id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "Route not found or not owned by this association."]);
        exit;
    }
    $stmt->close();

    $stmt = $conn->prepare("SELECT id FROM bus_service_types WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $service_type_id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "Class not found for this association."]);
        exit;
    }
    $stmt->close();

    $stmt = $conn->prepare("
        UPDATE bus_schedules
        SET route_id = ?, service_type_id = ?, boarding_time = ?, departure_time = ?,
            recurrence_type = ?, weekdays = ?, status = ?
        WHERE id = ? AND association_id = ?
    ");
    $stmt->bind_param("iisssssii", $route_id, $service_type_id, $boarding_time, $departure_time, $recurrence_type, $weekdaysStr, $status, $id, $association_id);
    $stmt->execute();

    // Route/time/recurrence may have just changed, so any not-yet-assigned
    // placeholder trips generated under the OLD pattern are stale — safe to
    // drop (operator_id is still NULL, so nothing was ever assigned and no
    // commuter could have booked one), then regenerate fresh under the new
    // pattern. Never touches an already-assigned/boarded/completed/cancelled
    // trip — those keep their own historical schedule_id link regardless of
    // later schedule edits.
    $delStmt = $conn->prepare("DELETE FROM trips WHERE schedule_id = ? AND status = 'pending_assignment'");
    $delStmt->bind_param("i", $id);
    $delStmt->execute();
    $delStmt->close();

    if ($status === "active") {
        generateTripsForSchedule($conn, [
            "id" => $id, "route_id" => $route_id, "boarding_time" => $boarding_time,
            "departure_time" => $departure_time, "recurrence_type" => $recurrence_type,
            "weekdays" => $weekdaysStr, "status" => $status,
        ]);
    }

    echo json_encode(["success" => true]);
    exit;
}

// ── DELETE: remove a schedule ───────────────────────────────────────────────────
if ($method === "DELETE") {
    $body           = json_decode(file_get_contents("php://input"), true);
    $id             = (int)($body["id"] ?? 0);
    $association_id = (int)($body["association_id"] ?? 0);

    if (!$id || !$association_id) {
        echo json_encode(["success" => false, "message" => "id and association_id are required."]);
        exit;
    }

    // Unassigned placeholder trips have nothing worth preserving once their
    // own schedule is gone (no operator, no booking) — clean them up first.
    // Already-assigned/boarded/completed/cancelled trips are untouched here;
    // the FK's own ON DELETE SET NULL keeps them intact with schedule_id
    // nulled out, same as before this redesign.
    $delStmt = $conn->prepare("DELETE FROM trips WHERE schedule_id = ? AND status = 'pending_assignment'");
    $delStmt->bind_param("i", $id);
    $delStmt->execute();
    $delStmt->close();

    $stmt = $conn->prepare("DELETE FROM bus_schedules WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $id, $association_id);
    $stmt->execute();
    echo json_encode(["success" => true]);
    exit;
}

echo json_encode(["success" => false, "message" => "Method not allowed."]);
