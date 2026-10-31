<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$method = $_SERVER["REQUEST_METHOD"];

// ── GET: list an association's service/class catalog ──────────────────────────
if ($method === "GET") {
    $association_id = (int)($_GET["association_id"] ?? 0);
    if (!$association_id) {
        echo json_encode(["success" => false, "message" => "association_id is required."]);
        exit;
    }
    $stmt = $conn->prepare("SELECT id, name, description FROM bus_service_types WHERE association_id = ? ORDER BY name ASC");
    $stmt->bind_param("i", $association_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $types = [];
    while ($row = $result->fetch_assoc()) {
        $types[] = ["id" => (int)$row["id"], "name" => $row["name"], "description" => $row["description"]];
    }
    echo json_encode(["success" => true, "service_types" => $types]);
    exit;
}

// ── POST: create a class (association owns the catalog, e.g. Ordinary/Deluxe/Royal) ──
if ($method === "POST") {
    $body           = json_decode(file_get_contents("php://input"), true);
    $association_id = (int)($body["association_id"] ?? 0);
    $name           = trim($body["name"] ?? "");
    $description    = trim($body["description"] ?? "");

    if (!$association_id || $name === "") {
        echo json_encode(["success" => false, "message" => "association_id and name are required."]);
        exit;
    }

    $stmt = $conn->prepare("INSERT INTO bus_service_types (association_id, name, description) VALUES (?, ?, ?)");
    $stmt->bind_param("iss", $association_id, $name, $description);
    if ($stmt->execute()) {
        echo json_encode(["success" => true, "id" => $conn->insert_id]);
    } else {
        $msg = str_contains($conn->error, "unique_association_service_name")
            ? "You already have a class with that name."
            : "Failed to create class.";
        echo json_encode(["success" => false, "message" => $msg]);
    }
    exit;
}

// ── DELETE: remove a class ──────────────────────────────────────────────────────
if ($method === "DELETE") {
    $body           = json_decode(file_get_contents("php://input"), true);
    $id             = (int)($body["id"] ?? 0);
    $association_id = (int)($body["association_id"] ?? 0);
    if (!$id || !$association_id) {
        echo json_encode(["success" => false, "message" => "id and association_id are required."]);
        exit;
    }
    $stmt = $conn->prepare("DELETE FROM bus_service_types WHERE id = ? AND association_id = ?");
    $stmt->bind_param("ii", $id, $association_id);
    $stmt->execute();
    echo json_encode(["success" => true]);
    exit;
}

echo json_encode(["success" => false, "message" => "Method not allowed."]);
