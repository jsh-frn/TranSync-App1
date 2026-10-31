<?php
header("Content-Type: application/json");
require_once "../../config/db.php";

$method = $_SERVER['REQUEST_METHOD'];

// ── GET: list routes for operator ──
if ($method === 'GET') {
    $operator_id = $_GET['operator_id'] ?? null;
    if (!$operator_id) {
        http_response_code(400);
        echo json_encode(["message" => "operator_id is required."]);
        exit;
    }
    $stmt = $conn->prepare("
        SELECT id, from_location, to_location, fare, status,
               has_waypoints, color, waypoints, vehicle_type
        FROM routes
        WHERE operator_id = ?
        ORDER BY created_at DESC
    ");
    $stmt->bind_param("i", $operator_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $routes = [];
    while ($row = $result->fetch_assoc()) {
        $row['fare']          = $row['fare'] !== null ? (float) $row['fare'] : null;
        $row['has_waypoints'] = (bool) $row['has_waypoints'];
        $routes[] = $row;
    }
    echo json_encode($routes);
    exit;
}

// ── POST: add route ──
if ($method === 'POST') {
    $data          = json_decode(file_get_contents("php://input"), true);
    $operator_id   = intval($data['operator_id']   ?? 0);
    $from_location = trim($data['from_location']    ?? "");
    $to_location   = trim($data['to_location']      ?? "");
    $vehicle_type  = trim($data['vehicle_type']     ?? "");
    $fare          = isset($data['fare']) && $data['fare'] !== "" ? round((float)$data['fare'], 2) : null;

    if (!$operator_id || !$from_location || !$to_location) {
        http_response_code(400);
        echo json_encode(["message" => "operator_id, from, and to are required."]);
        exit;
    }

    // Bus routes are association-only now — this legacy endpoint only ever
    // creates operator-owned routes, so Bus can't go through it at all.
    if ($vehicle_type === "Bus") {
        http_response_code(400);
        echo json_encode(["message" => "Bus routes can only be created by an association — ask your association to add this route."]);
        exit;
    }

    $vt   = $vehicle_type !== "" ? $vehicle_type : null;
    $stmt = $conn->prepare("
        INSERT INTO routes (operator_id, from_location, to_location, vehicle_type, fare, status)
        VALUES (?, ?, ?, ?, ?, 'active')
    ");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(["message" => "Prepare failed: " . $conn->error]);
        exit;
    }
    $stmt->bind_param("isssd", $operator_id, $from_location, $to_location, $vt, $fare);
    if ($stmt->execute()) {
        echo json_encode(["message" => "Route added.", "id" => (int) $conn->insert_id]);
    } else {
        http_response_code(500);
        echo json_encode(["message" => "Failed to add route: " . $stmt->error]);
    }
    exit;
}

// ── PUT: update route status or fare ──
if ($method === 'PUT') {
    $data = json_decode(file_get_contents("php://input"), true);
    $id   = $data['id'] ?? null;

    if (!$id) {
        http_response_code(400);
        echo json_encode(["message" => "id is required."]);
        exit;
    }

    if (isset($data['fare'])) {
        $fare = $data['fare'] === null ? null : round((float)$data['fare'], 2);
        $stmt = $conn->prepare("UPDATE routes SET fare = ? WHERE id = ?");
        $stmt->bind_param("di", $fare, $id);
        $stmt->execute();
        echo json_encode(["message" => "Fare updated.", "fare" => $fare]);
        exit;
    }

    $status = $data['status'] ?? null;
    if (!$status) {
        http_response_code(400);
        echo json_encode(["message" => "status or fare is required."]);
        exit;
    }
    $stmt = $conn->prepare("UPDATE routes SET status = ? WHERE id = ?");
    $stmt->bind_param("si", $status, $id);
    $stmt->execute();
    echo json_encode(["message" => "Route updated."]);
    exit;
}

// ── DELETE: remove route ──
if ($method === 'DELETE') {
    $data = json_decode(file_get_contents("php://input"), true);
    $id   = $data['id'] ?? null;

    if (!$id) {
        http_response_code(400);
        echo json_encode(["message" => "id is required."]);
        exit;
    }

    $stmt = $conn->prepare("DELETE FROM routes WHERE id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(["message" => "Route removed."]);
    exit;
}

http_response_code(405);
echo json_encode(["message" => "Method not allowed."]);
