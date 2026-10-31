<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/policy.php";

// Read-only preview of a scanned ticket, so the driver's scanner can decide
// whether to show a discount accept/decline prompt (or auto-grant on a
// physical-ID toggle) BEFORE committing the boarding action. Mirrors
// board_reservation.php's validation exactly but never mutates anything.

$driver_id = (int)($_GET["driver_id"] ?? 0);
$qr_code   = trim($_GET["qr_code"] ?? "");

if (!$driver_id || $qr_code === "") {
    echo json_encode(["success" => false, "message" => "Invalid request."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT r.id, r.trip_id, r.uv_session_id, r.uv_slot_id, r.boarding_status, r.passenger_name,
           r.queue_number, r.destination_terminal, r.fare_amount, r.base_fare_amount,
           r.discount_type, r.departure_time, r.vehicle_category, r.payment_status,
           r.rebooked_from_reservation_id, r.rebooking_fee_amount,
           c.category AS commuter_category, c.is_verified AS commuter_is_verified
    FROM reservations r
    JOIN commuters c ON c.id = r.commuter_id
    WHERE r.qr_code = ?
");
$stmt->bind_param("s", $qr_code);
$stmt->execute();
$res = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$res) {
    echo json_encode(["success" => false, "message" => "Invalid ticket."]);
    exit;
}

if ($res["boarding_status"] !== "reserved") {
    $labels = [
        "boarded"   => "This ticket has already been boarded.",
        "completed" => "This ticket's trip has already completed.",
        "no_show"   => "This ticket expired without boarding.",
        "cancelled" => "This ticket has been cancelled.",
    ];
    echo json_encode(["success" => false, "message" => $labels[$res["boarding_status"]] ?? "This ticket is no longer valid."]);
    exit;
}

// ── QR validity window — identical rule to board_reservation.php ─────────────
if ($res["trip_id"] || $res["uv_slot_id"]) {
    $db_now        = $conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"];
    $db_now_ts     = strtotime($db_now);
    $departure_ts  = strtotime($res["departure_time"]);

    if ($res["uv_slot_id"]) {
        $active_at = $departure_ts - 1800;
        if ($db_now_ts < $active_at) {
            echo json_encode([
                "success" => false,
                "message" => "This ticket isn't active yet — it opens at " . date("g:i A", $active_at) . ".",
            ]);
            exit;
        }
    }

    $grace_minutes = QR_GRACE_MINUTES[$res["vehicle_category"]] ?? 30;
    $expires_at    = $departure_ts + $grace_minutes * 60;
    if ($db_now_ts > $expires_at) {
        echo json_encode([
            "success" => false,
            "message" => "This ticket has expired — the grace period after departure has passed.",
        ]);
        exit;
    }
}

// ── Authorize — identical three branches to board_reservation.php ────────────
$authorized = false;
if ($res["trip_id"]) {
    $stmt = $conn->prepare("SELECT id FROM trips WHERE id = ? AND driver_id = ?");
    $stmt->bind_param("ii", $res["trip_id"], $driver_id);
    $stmt->execute();
    $authorized = (bool)$stmt->get_result()->fetch_assoc();
    $stmt->close();
} elseif ($res["uv_session_id"]) {
    $stmt = $conn->prepare("SELECT id FROM uv_sessions WHERE id = ? AND driver_id = ?");
    $stmt->bind_param("ii", $res["uv_session_id"], $driver_id);
    $stmt->execute();
    $authorized = (bool)$stmt->get_result()->fetch_assoc();
    $stmt->close();
} elseif ($res["uv_slot_id"]) {
    // Route-scoped only, matching board_reservation.php exactly (Core Flow
    // 8b point 4) — a pooled slot has operator_id = NULL, so a join on
    // dq.operator_id = s.operator_id can never match (NULL never equals
    // anything in SQL), which silently failed authorization for every pooled
    // slot at the preview step even though the actual boarding endpoint
    // authorized correctly. Any driver currently dispatched for this route,
    // regardless of operator, is authorized.
    $stmt = $conn->prepare("
        SELECT dq.id
        FROM uv_slots s
        JOIN dispatch_queue dq ON dq.route_id = s.route_id
        WHERE s.id = ? AND dq.status = 'dispatched' AND dq.driver_id = ?
    ");
    $stmt->bind_param("ii", $res["uv_slot_id"], $driver_id);
    $stmt->execute();
    $authorized = (bool)$stmt->get_result()->fetch_assoc();
    $stmt->close();
}

if (!$authorized) {
    echo json_encode(["success" => false, "message" => "This ticket is not for your current trip."]);
    exit;
}

// ── UV Express Vehicle Type -> Route -> Driver -> Daily Quota — identical
// check to board_reservation.php (kept in sync per this pair's own
// documented convention), since the scanner always calls this preview first
// and never attempts to board on a failed preview.
if ($res["uv_slot_id"]) {
    $stmt = $conn->prepare("SELECT route_id FROM uv_slots WHERE id = ?");
    $stmt->bind_param("i", $res["uv_slot_id"]);
    $stmt->execute();
    $slotRouteId = $stmt->get_result()->fetch_assoc()["route_id"] ?? null;
    $stmt->close();

    if ($slotRouteId !== null) {
        $stmt = $conn->prepare("SELECT daily_quota FROM driver_route_quotas WHERE route_id = ? AND driver_id = ?");
        $stmt->bind_param("ii", $slotRouteId, $driver_id);
        $stmt->execute();
        $quotaRow = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if ($quotaRow) {
            $travel_date = date("Y-m-d", strtotime($res["departure_time"]));
            $stmt = $conn->prepare("
                SELECT COUNT(*) AS cnt
                FROM reservations r
                JOIN uv_slots s ON s.id = r.uv_slot_id
                WHERE r.boarding_driver_id = ? AND s.route_id = ? AND DATE(r.departure_time) = ?
                  AND r.boarding_status IN ('boarded', 'completed')
            ");
            $stmt->bind_param("iis", $driver_id, $slotRouteId, $travel_date);
            $stmt->execute();
            $used = (int)$stmt->get_result()->fetch_assoc()["cnt"];
            $stmt->close();

            if ($used >= (int)$quotaRow["daily_quota"]) {
                echo json_encode([
                    "success"        => false,
                    "quota_exceeded" => true,
                    "message"        => "You've reached your daily booking quota for this route. Please contact your operator.",
                ]);
                exit;
            }
        }
    }
}

$fare_amount       = (float)$res["fare_amount"];
$base_fare_amount  = $res["base_fare_amount"] !== null ? (float)$res["base_fare_amount"] : null;
$discount_type     = $res["discount_type"];
$commuter_category = $res["commuter_category"];
$payment_status    = $res["payment_status"];

// Reconstructed exactly (not derived from the already-rounded fare_amount) —
// matches create_reservation.php's rounding rule.
$full_fare       = $base_fare_amount !== null ? round($base_fare_amount * 4) / 4 : $fare_amount;
$discounted_fare = $base_fare_amount !== null ? round($base_fare_amount * 0.80 * 4) / 4 : $fare_amount;

$can_decline = $discount_type !== "default" && $payment_status !== "released" && $base_fare_amount !== null;
$can_grant   = $discount_type === "default" && $commuter_category !== "default" && $payment_status !== "released" && $base_fare_amount !== null;

$response = [
    "success"              => true,
    "passenger_name"       => $res["passenger_name"],
    "queue_number"         => $res["queue_number"] !== null ? (int)$res["queue_number"] : null,
    "destination_terminal" => $res["destination_terminal"],
    "fare_amount"          => $fare_amount,
    "discount_type"        => $discount_type,
    "payment_status"       => $payment_status,
    "commuter_category"    => $commuter_category,
    "commuter_is_verified" => (int)$res["commuter_is_verified"],
    "full_fare"            => $full_fare,
    "discounted_fare"      => $discounted_fare,
    "can_decline"          => $can_decline,
    "can_grant"            => $can_grant,
];

// Kept in sync with board_reservation.php's own rebooking fields — see this
// codebase's Do-Not-Break note on these two endpoints drifting apart before.
if ($res["rebooked_from_reservation_id"] !== null) {
    $response["is_rebooked"]          = true;
    $response["original_fare_amount"] = $fare_amount;
    $response["rebooking_fee_amount"] = $res["rebooking_fee_amount"] !== null ? (float)$res["rebooking_fee_amount"] : null;
    $response["additional_fare_due"]  = 0;
}

echo json_encode($response);
