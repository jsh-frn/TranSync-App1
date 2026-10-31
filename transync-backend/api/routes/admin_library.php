<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$method = $_SERVER['REQUEST_METHOD'];
$data   = json_decode(file_get_contents("php://input"), true) ?? [];

// ── DELETE — soft-delete (status → inactive) ─────────────────────────────────
if ($method === 'DELETE') {
    $route_id = (int)($data['route_id'] ?? 0);
    if (!$route_id) {
        echo json_encode(["success" => false, "message" => "route_id required."]);
        exit;
    }
    $stmt = $conn->prepare("UPDATE routes SET status = 'inactive' WHERE id = ?");
    $stmt->bind_param("i", $route_id);
    $stmt->execute();
    echo json_encode(["success" => true, "rows_affected" => (int)$conn->affected_rows]);
    exit;
}

// ── PUT — edit metadata + optional waypoints ─────────────────────────────────
if ($method === 'PUT') {
    $route_id     = (int)($data['route_id']     ?? 0);
    $name         = trim($data['name']           ?? '');
    $from         = trim($data['from_location']  ?? '');
    $to           = trim($data['to_location']    ?? '');
    $color        = trim($data['color']          ?? '#1a4a52');
    $vehicle_type = trim($data['vehicle_type']   ?? 'Jeepney');
    $waypoints    = $data['waypoints']           ?? null;

    if (!$route_id || !$name) {
        echo json_encode(["success" => false, "message" => "route_id and name are required."]);
        exit;
    }

    try {
        if (is_array($waypoints) && count($waypoints) >= 2) {
            $wp_json = json_encode(array_map(function ($wp) {
                return [
                    "latitude"  => round((float)($wp['latitude']  ?? $wp['lat']  ?? 0), 7),
                    "longitude" => round((float)($wp['longitude'] ?? $wp['lng']  ?? 0), 7),
                ];
            }, $waypoints));
            $stmt = $conn->prepare("UPDATE routes SET name=?, from_location=?, to_location=?, color=?, vehicle_type=?, waypoints=? WHERE id=?");
            $stmt->bind_param("ssssssi", $name, $from, $to, $color, $vehicle_type, $wp_json, $route_id);
        } else {
            $stmt = $conn->prepare("UPDATE routes SET name=?, from_location=?, to_location=?, color=?, vehicle_type=? WHERE id=?");
            $stmt->bind_param("sssssi", $name, $from, $to, $color, $vehicle_type, $route_id);
        }
        $stmt->execute();
        echo json_encode(["success" => true]);
    } catch (Exception $e) {
        echo json_encode(["success" => false, "message" => $e->getMessage()]);
    }
    exit;
}

// ── POST — create new route (admin-sourced, no operator/association) ──────────
if ($method === 'POST') {
    $name         = trim($data['name']           ?? '');
    $from         = trim($data['from_location']  ?? '');
    $to           = trim($data['to_location']    ?? '');
    $color        = trim($data['color']          ?? '#1a4a52');
    $vehicle_type = trim($data['vehicle_type']   ?? 'Jeepney');
    $waypoints    = $data['waypoints']           ?? [];

    if (!$name) {
        echo json_encode(["success" => false, "message" => "Route name is required."]);
        exit;
    }
    if (count($waypoints) < 2) {
        echo json_encode(["success" => false, "message" => "At least 2 waypoints are required."]);
        exit;
    }

    $wp_json = json_encode(array_map(function ($wp) {
        return [
            "latitude"  => round((float)($wp['latitude']  ?? $wp['lat']  ?? 0), 7),
            "longitude" => round((float)($wp['longitude'] ?? $wp['lng']  ?? 0), 7),
        ];
    }, $waypoints));

    $stmt = $conn->prepare("
        INSERT INTO routes (name, from_location, to_location, color, vehicle_type, waypoints, has_waypoints, status, operator_id, association_id)
        VALUES (?, ?, ?, ?, ?, ?, 1, 'active', NULL, NULL)
    ");
    $stmt->bind_param("ssssss", $name, $from, $to, $color, $vehicle_type, $wp_json);
    try {
        $stmt->execute();
        echo json_encode(["success" => true, "route_id" => (int)$conn->insert_id]);
    } catch (Exception $e) {
        echo json_encode(["success" => false, "message" => $e->getMessage()]);
    }
    exit;
}

echo json_encode(["success" => false, "message" => "Method not allowed."]);
