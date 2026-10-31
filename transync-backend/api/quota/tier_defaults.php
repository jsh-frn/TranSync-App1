<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// ── GET: list the capacity tiers ──────────────────────────────────────────────
if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $result = $conn->query("SELECT id, min_capacity, max_capacity, quota_amount FROM jeepney_quota_tiers ORDER BY min_capacity ASC");
    $tiers = [];
    while ($row = $result->fetch_assoc()) {
        $tiers[] = [
            "id"           => (int)$row["id"],
            "min_capacity" => (int)$row["min_capacity"],
            "max_capacity" => (int)$row["max_capacity"],
            "quota_amount" => (float)$row["quota_amount"],
        ];
    }
    echo json_encode(["success" => true, "tiers" => $tiers]);
    exit;
}

// ── POST: update a tier's quota amount (admin/operator retuning) ─────────────
if ($_SERVER["REQUEST_METHOD"] === "POST") {
    $body   = json_decode(file_get_contents("php://input"), true);
    $id     = (int)($body["id"] ?? 0);
    $amount = (float)($body["quota_amount"] ?? -1);

    if (!$id || $amount < 0) {
        echo json_encode(["success" => false, "message" => "id and a non-negative quota_amount are required."]);
        exit;
    }

    $stmt = $conn->prepare("UPDATE jeepney_quota_tiers SET quota_amount = ? WHERE id = ?");
    $stmt->bind_param("di", $amount, $id);
    $stmt->execute();

    if ($stmt->affected_rows === 0) {
        echo json_encode(["success" => false, "message" => "Tier not found or amount unchanged."]);
        exit;
    }

    echo json_encode(["success" => true]);
    exit;
}

echo json_encode(["success" => false, "message" => "Method not allowed."]);
