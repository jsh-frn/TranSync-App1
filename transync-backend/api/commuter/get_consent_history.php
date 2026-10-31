<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

$commuter_id = (int)($_GET["commuter_id"] ?? 0);
if (!$commuter_id) {
    echo json_encode(["success" => false, "message" => "commuter_id is required."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT terms_version, privacy_version, accepted_at
    FROM consent_acceptances
    WHERE account_type = 'commuter' AND account_id = ?
    ORDER BY accepted_at DESC
");
$stmt->bind_param("i", $commuter_id);
$stmt->execute();
$result = $stmt->get_result();

$history = [];
while ($row = $result->fetch_assoc()) {
    $history[] = [
        "terms_version"   => $row["terms_version"],
        "privacy_version" => $row["privacy_version"],
        "accepted_at"     => $row["accepted_at"],
    ];
}

echo json_encode(["success" => true, "history" => $history]);
