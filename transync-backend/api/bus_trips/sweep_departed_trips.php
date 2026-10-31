<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/sweep.php";

// Idempotent, DB-clock-only sweep: any reservation still 'reserved' once its
// trip/slot has departed and the QR grace period has passed is abandoned —
// no refund. Unlike a plain forfeiture, the fare is still distributed to the
// driver/operator/system via the normal split (same as a real boarding would
// have paid out) since the seat was held and couldn't be resold. Safe to call
// from anywhere (driver dashboard load, get_reservation_status.php, etc.).
// Shared with get_reservation_status.php's own opportunistic sweep — see
// config/sweep.php's header comment for why both must go through one place.
$swept = sweepDepartedReservations($conn);

echo json_encode(["success" => true, "swept" => $swept]);
