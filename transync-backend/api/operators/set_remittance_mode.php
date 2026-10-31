<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Bus/UV Express operators choose how their own cut of each booking works:
// 'quota' (nothing automatic — driver keeps the full remainder, operator
// collects a manually-submitted lump sum via the existing quota pipeline) or
// 'percentage' (operator sets their own rate, auto-deducted every booking
// alongside the system's flat 5%). See config/remittance.php.
if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $operator_id = (int)($_GET["operator_id"] ?? 0);
    if (!$operator_id) {
        echo json_encode(["success" => false, "message" => "operator_id is required."]);
        exit;
    }
    $stmt = $conn->prepare("SELECT remittance_mode, operator_fee_pct FROM operators WHERE id = ?");
    $stmt->bind_param("i", $operator_id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    if (!$row) {
        echo json_encode(["success" => false, "message" => "Operator not found."]);
        exit;
    }
    echo json_encode([
        "success"          => true,
        "remittance_mode"  => $row["remittance_mode"],
        "operator_fee_pct" => $row["operator_fee_pct"] !== null ? (float)$row["operator_fee_pct"] : null,
        "system_fee_pct"   => 5.0,
    ]);
    exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

$body            = json_decode(file_get_contents("php://input"), true);
$operator_id     = (int)($body["operator_id"] ?? 0);
$mode            = trim($body["remittance_mode"] ?? "");
$operator_fee_pct = isset($body["operator_fee_pct"]) && $body["operator_fee_pct"] !== "" ? (float)$body["operator_fee_pct"] : null;

if (!$operator_id || !in_array($mode, ["quota", "percentage"], true)) {
    echo json_encode(["success" => false, "message" => "operator_id and remittance_mode (quota|percentage) are required."]);
    exit;
}
if ($mode === "percentage" && ($operator_fee_pct === null || $operator_fee_pct < 0 || $operator_fee_pct > 100)) {
    echo json_encode(["success" => false, "message" => "A valid operator_fee_pct (0-100) is required for percentage mode."]);
    exit;
}
// Quota mode doesn't use a percentage — clear it so it's never accidentally read.
if ($mode === "quota") $operator_fee_pct = null;

$stmt = $conn->prepare("UPDATE operators SET remittance_mode = ?, operator_fee_pct = ? WHERE id = ?");
$stmt->bind_param("sdi", $mode, $operator_fee_pct, $operator_id);
$stmt->execute();
$stmt->close();

echo json_encode(["success" => true]);
