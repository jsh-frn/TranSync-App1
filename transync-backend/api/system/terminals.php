<?php
header("Content-Type: application/json");

require_once "../../config/db.php";
require_once "../../config/auth.php";

requireAuth($conn, ['admin']);

// DELETE terminal
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $id = $_GET['id'] ?? null;
    if (!$id) {
        http_response_code(400);
        echo json_encode(["message" => "Missing terminal ID"]);
        exit;
    }
    $stmt = $conn->prepare("DELETE FROM terminals WHERE id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(["message" => "Terminal deleted"]);
    exit;
}

// GET all terminals
// route_from/route_to are legacy free-text columns; r.name is the actual linked
// route (routes.terminal_id), which is how terminals created via the mobile
// association route-builder are connected.
$result = $conn->query("
    SELECT t.id, t.terminal_name, t.location, t.latitude, t.longitude, t.route_from, t.route_to,
           r.name AS linked_route_name,
           COALESCE(o.name, a.name) as operator_name,
           t.vehicle_type as operator_type,
           DATE_FORMAT(t.created_at, '%Y-%m-%d') as date_added
    FROM terminals t
    LEFT JOIN operators o ON t.operator_id = o.id
    LEFT JOIN associations a ON t.association_id = a.id
    LEFT JOIN routes r ON r.terminal_id = t.id
    ORDER BY t.created_at DESC
");

$terminals = [];
while ($row = $result->fetch_assoc()) {
    $terminals[] = $row;
}

echo json_encode($terminals);