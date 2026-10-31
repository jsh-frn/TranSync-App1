<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// ── GET: list per-class fares for a route (read-only, no ownership check) ────
if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $route_id = (int)($_GET["route_id"] ?? 0);
    if (!$route_id) {
        echo json_encode(["success" => false, "message" => "route_id is required."]);
        exit;
    }
    $stmt = $conn->prepare("
        SELECT fm.service_type_id, fm.base_fare, st.name AS service_type_name
        FROM fare_matrix fm
        JOIN bus_service_types st ON st.id = fm.service_type_id
        WHERE fm.route_id = ?
    ");
    $stmt->bind_param("i", $route_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $fares = [];
    while ($row = $result->fetch_assoc()) {
        $fares[] = [
            "service_type_id"   => (int)$row["service_type_id"],
            "service_type_name" => $row["service_type_name"],
            "base_fare"         => (float)$row["base_fare"],
        ];
    }
    echo json_encode(["success" => true, "fares" => $fares]);
    exit;
}

// ── DELETE: unassign a class from a route (removes its fare_matrix row) ──────
if ($_SERVER["REQUEST_METHOD"] === "DELETE") {
    $body            = json_decode(file_get_contents("php://input"), true);
    $route_id        = (int)($body["route_id"] ?? 0);
    $association_id  = (int)($body["association_id"] ?? 0);
    $service_type_id = (int)($body["service_type_id"] ?? 0);

    if (!$route_id || !$association_id || !$service_type_id) {
        echo json_encode(["success" => false, "message" => "route_id, association_id, and service_type_id are required."]);
        exit;
    }

    $stmt = $conn->prepare("SELECT id FROM routes WHERE id = ? AND vehicle_type = 'Bus' AND association_id = ?");
    $stmt->bind_param("ii", $route_id, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        echo json_encode(["success" => false, "message" => "Route not found or not owned by this association."]);
        exit;
    }
    $stmt->close();

    $stmt = $conn->prepare("DELETE FROM fare_matrix WHERE route_id = ? AND service_type_id = ?");
    $stmt->bind_param("ii", $route_id, $service_type_id);
    $stmt->execute();
    echo json_encode(["success" => true]);
    exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

// Fare-setting is association-only now — a route's point-to-point price and
// which classes apply to it belong entirely to the association that owns the
// route. Operators can no longer set or override a Bus fare (see vehicles.php
// / seed_seats.php for what operators can still do: assign a class to their
// vehicle and build its seat layout).
$body            = json_decode(file_get_contents("php://input"), true);
$route_id        = (int)($body["route_id"] ?? 0);
$association_id  = (int)($body["association_id"] ?? 0);
$service_type_id = (int)($body["service_type_id"] ?? 0);
$base_fare       = isset($body["base_fare"]) ? (float)$body["base_fare"] : null;

if (!$route_id || !$association_id || !$service_type_id || $base_fare === null || $base_fare < 0) {
    echo json_encode(["success" => false, "message" => "route_id, association_id, service_type_id, and a non-negative base_fare are required."]);
    exit;
}

$stmt = $conn->prepare("SELECT id FROM routes WHERE id = ? AND vehicle_type = 'Bus' AND association_id = ?");
$stmt->bind_param("ii", $route_id, $association_id);
$stmt->execute();
if (!$stmt->get_result()->fetch_assoc()) {
    $stmt->close();
    echo json_encode(["success" => false, "message" => "Route not found, not a Bus route, or not owned by this association."]);
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

$stmt = $conn->prepare("SELECT id FROM fare_matrix WHERE route_id = ? AND service_type_id = ?");
$stmt->bind_param("ii", $route_id, $service_type_id);
$stmt->execute();
$existing = $stmt->get_result()->fetch_assoc();
$stmt->close();

if ($existing) {
    $stmt = $conn->prepare("UPDATE fare_matrix SET base_fare = ? WHERE id = ?");
    $stmt->bind_param("di", $base_fare, $existing["id"]);
    $stmt->execute();
} else {
    $stmt = $conn->prepare("
        INSERT INTO fare_matrix (route_id, vehicle_type, service_type_id, pricing_type, base_fare)
        VALUES (?, 'Bus', ?, 'fixed', ?)
    ");
    $stmt->bind_param("iid", $route_id, $service_type_id, $base_fare);
    $stmt->execute();
}

echo json_encode(["success" => true]);
