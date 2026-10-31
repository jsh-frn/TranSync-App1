<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/policy.php";
require_once __DIR__ . "/../../config/refund.php";
require_once __DIR__ . "/../../config/remittance.php";
require_once __DIR__ . "/../../config/auth.php";

$auth = requireAuth($conn, ['commuter']);

// Single, sole commuter-facing cancellation endpoint (rewritten 2026-08-11,
// simplified same day — dropped the 0% tier and the 30-minute post-booking
// grace period). Supersedes the old two-endpoint split (request_refund.php
// = 100% only outside a binary cutoff, cancel_late.php = 0% only inside it)
// with a two-tier schedule: 100% at or beyond the vehicle type's threshold,
// 50% for anything short of it, all the way up to departure — never 0% —
// see config/refund.php's computeRefundOutcome() and config/policy.php's
// REFUND_TIERS. cancel_late.php is left in place, frozen at the old binary
// behavior, for any historical/direct caller; nothing in the mobile client
// calls it anymore.
$body           = json_decode(file_get_contents("php://input"), true);
$reservation_id = (int)($body["reservation_id"] ?? 0);
$commuter_id    = $auth['owner_id'];

if (!$reservation_id) {
    echo json_encode(["success" => false, "message" => "Invalid request."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, trip_id, uv_session_id, uv_slot_id, fare_amount, departure_time, created_at, boarding_status, vehicle_category
    FROM reservations WHERE id = ? AND commuter_id = ?
");
$stmt->bind_param("ii", $reservation_id, $commuter_id);
$stmt->execute();
$res = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$res) {
    echo json_encode(["success" => false, "message" => "Booking not found."]);
    exit;
}
if ($res["uv_session_id"]) {
    echo json_encode(["success" => false, "message" => "Live UV Express bookings aren't eligible for cancellation this way."]);
    exit;
}
if ($res["boarding_status"] !== "reserved") {
    echo json_encode(["success" => false, "message" => "This booking can no longer be cancelled."]);
    exit;
}

// DB clock, not PHP's — computeRefundOutcome() itself pulls SELECT NOW().
$db_now       = $conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"];
$departure_ts = strtotime($res["departure_time"]);
if ($departure_ts <= strtotime($db_now)) {
    echo json_encode(["success" => false, "message" => "This booking's departure has already passed."]);
    exit;
}

$outcome = computeRefundOutcome($conn, $res["vehicle_category"], $res["created_at"], $res["departure_time"]);
$pct     = $outcome["pct"];
$fare    = (float)$res["fare_amount"];

$refund_amount    = round($fare * $pct, 2);
$forfeited_amount = round($fare - $refund_amount, 2);

// $pct is always 0.50 or 1.00 under the current policy (there is no 0%
// outcome), so this always resolves to 'refunded'/'refunded' in practice —
// the $pct > 0 branch is kept as a safety fallback rather than hardcoded,
// in case REFUND_TIERS is ever given a 0% floor again. refund_amount/
// refund_pct on the row record exactly how much was refunded, so
// "refunded" is never assumed to mean "refunded in full."
$cancellation_type = $pct > 0 ? "refunded" : "late_cancelled";
$payment_status    = $pct > 0 ? "refunded" : "forfeited";

$conn->begin_transaction();
try {
    $stmt = $conn->prepare("
        UPDATE reservations
        SET status = 'cancelled', boarding_status = 'cancelled',
            cancellation_type = ?, payment_status = ?,
            refund_amount = ?, refund_pct = ?, resolved_at = NOW()
        WHERE id = ? AND boarding_status = 'reserved'
    ");
    $pctPercent = $pct * 100;
    $stmt->bind_param("ssddi", $cancellation_type, $payment_status, $refund_amount, $pctPercent, $reservation_id);
    $stmt->execute();
    $cancelled = $stmt->affected_rows > 0;
    $stmt->close();

    if (!$cancelled) {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "This booking can no longer be cancelled."]);
        exit;
    }

    // Release the seat — a same-day rebooking by another commuter is still
    // possible if there's time left before departure.
    if ($res["trip_id"]) {
        $stmt = $conn->prepare("UPDATE trips SET seats_booked = GREATEST(0, seats_booked - 1) WHERE id = ?");
        $stmt->bind_param("i", $res["trip_id"]);
    } else {
        $stmt = $conn->prepare("UPDATE uv_slots SET seats_booked = GREATEST(0, seats_booked - 1) WHERE id = ?");
        $stmt->bind_param("i", $res["uv_slot_id"]);
    }
    $stmt->execute();
    $stmt->close();

    $new_balance = null;
    if ($refund_amount > 0) {
        $stmt = $conn->prepare("SELECT balance FROM wallets WHERE commuter_id = ?");
        $stmt->bind_param("i", $commuter_id);
        $stmt->execute();
        $balance = (float)($stmt->get_result()->fetch_assoc()["balance"] ?? 0);
        $stmt->close();

        $new_balance = round($balance + $refund_amount, 2);
        $stmt = $conn->prepare("UPDATE wallets SET balance = ? WHERE commuter_id = ?");
        $stmt->bind_param("di", $new_balance, $commuter_id);
        $stmt->execute();
        $stmt->close();

        $pctLabel = (int)round($pct * 100);
        $note = "Refund ({$pctLabel}%) — booking #{$reservation_id}";
        $stmt = $conn->prepare("
            INSERT INTO wallet_transactions
                (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
            VALUES ('commuter', ?, 'credit', ?, 'refund', ?, ?, ?)
        ");
        $stmt->bind_param("idids", $commuter_id, $refund_amount, $reservation_id, $new_balance, $note);
        $stmt->execute();
        $stmt->close();
    }

    // Whatever wasn't refunded (all of it on a 0% outcome, half of it on a
    // 50% outcome) is settled to the driver/operator/system via the normal
    // remittance split — the seat couldn't be resold once the commuter
    // stepped away from it this close to departure, same reasoning
    // cancel_late.php always used for its 0%-only case.
    $split = null;
    if ($forfeited_amount > 0) {
        $driver_id   = null;
        $operator_id = 0;
        if ($res["trip_id"]) {
            $stmt = $conn->prepare("SELECT t.driver_id, v.operator_id FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = ?");
            $stmt->bind_param("i", $res["trip_id"]);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            $stmt->close();
            $driver_id   = $row ? (int)$row["driver_id"] : null;
            $operator_id = $row ? (int)$row["operator_id"] : 0;
        } else {
            $stmt = $conn->prepare("SELECT operator_id FROM uv_slots WHERE id = ?");
            $stmt->bind_param("i", $res["uv_slot_id"]);
            $stmt->execute();
            $operator_id = (int)($stmt->get_result()->fetch_assoc()["operator_id"] ?? 0);
            $stmt->close();
        }

        // Derive the specific association this fare's route belongs to (see
        // board_reservation.php for why this goes through routes.association_id
        // rather than the vehicle/operator).
        if ($res["trip_id"]) {
            $stmt = $conn->prepare("SELECT r.association_id FROM trips t JOIN routes r ON r.id = t.route_id WHERE t.id = ?");
            $stmt->bind_param("i", $res["trip_id"]);
        } else {
            $stmt = $conn->prepare("SELECT r.association_id FROM uv_slots s JOIN routes r ON r.id = s.route_id WHERE s.id = ?");
            $stmt->bind_param("i", $res["uv_slot_id"]);
        }
        $stmt->execute();
        $assocRow = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $association_id = ($assocRow && $assocRow["association_id"] !== null) ? (int)$assocRow["association_id"] : null;

        $noteLabel = $pct > 0
            ? "Partial cancellation forfeiture ({$outcome['reason']})"
            : "Late cancellation forfeiture ({$outcome['reason']})";
        $split = creditRemittanceSplit($conn, $driver_id, $operator_id, $association_id, $res["vehicle_category"], $forfeited_amount, $reservation_id, $noteLabel);
    }

    $conn->commit();

    echo json_encode([
        "success"         => true,
        "refunded"        => $refund_amount,
        "refund_pct"      => $pct * 100,
        "forfeited"       => $forfeited_amount,
        "new_balance"     => $new_balance,
        "driver_credited" => $split["driver_net"] ?? 0,
        "operator_fee"    => $split["operator_fee"] ?? 0,
        "system_fee"      => $split["system_fee"] ?? 0,
        "message"         => $pct >= 1.0
            ? "Booking cancelled — full refund credited to your wallet."
            : ($pct > 0
                ? "Booking cancelled — " . (int)round($pct * 100) . "% refunded to your wallet, the rest forfeited."
                : "Booking cancelled — no refund past the refund window."),
    ]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to process cancellation."]);
}
