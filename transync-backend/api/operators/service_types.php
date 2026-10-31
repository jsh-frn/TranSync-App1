<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$method = $_SERVER["REQUEST_METHOD"];

// ── GET: list an operator's service types ─────────────────────────────────────
if ($method === "GET") {
    $operator_id = (int)($_GET["operator_id"] ?? 0);
    if (!$operator_id) {
        echo json_encode(["success" => false, "message" => "operator_id is required."]);
        exit;
    }
    $stmt = $conn->prepare("SELECT id, name, description FROM bus_service_types WHERE operator_id = ? ORDER BY name ASC");
    $stmt->bind_param("i", $operator_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $types = [];
    while ($row = $result->fetch_assoc()) {
        $types[] = ["id" => (int)$row["id"], "name" => $row["name"], "description" => $row["description"]];
    }
    echo json_encode(["success" => true, "service_types" => $types]);
    exit;
}

// ── POST: create a service type ────────────────────────────────────────────────
if ($method === "POST") {
    $body        = json_decode(file_get_contents("php://input"), true);
    $operator_id = (int)($body["operator_id"] ?? 0);
    $name        = trim($body["name"] ?? "");
    $description = trim($body["description"] ?? "");

    if (!$operator_id || $name === "") {
        echo json_encode(["success" => false, "message" => "operator_id and name are required."]);
        exit;
    }

    $stmt = $conn->prepare("INSERT INTO bus_service_types (operator_id, name, description) VALUES (?, ?, ?)");
    $stmt->bind_param("iss", $operator_id, $name, $description);
    if ($stmt->execute()) {
        echo json_encode(["success" => true, "id" => $conn->insert_id]);
    } else {
        $msg = str_contains($conn->error, "unique_operator_service_name")
            ? "You already have a service type with that name."
            : "Failed to create service type.";
        echo json_encode(["success" => false, "message" => $msg]);
    }
    exit;
}

// ── DELETE: remove a service type ──────────────────────────────────────────────
if ($method === "DELETE") {
    $body = json_decode(file_get_contents("php://input"), true);
    $id   = (int)($body["id"] ?? 0);
    if (!$id) {
        echo json_encode(["success" => false, "message" => "id is required."]);
        exit;
    }
    $stmt = $conn->prepare("DELETE FROM bus_service_types WHERE id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(["success" => true]);
    exit;
}

echo json_encode(["success" => false, "message" => "Method not allowed."]);
