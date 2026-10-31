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
require_once __DIR__ . "/../../config/remittance.php";
require_once __DIR__ . "/../../config/auth.php";

$auth      = requireAuth($conn, ['driver']);
$driver_id = $auth['owner_id'];

$body              = json_decode(file_get_contents("php://input"), true);
$qr_code           = trim($body["qr_code"] ?? "");
$discount_decision = trim($body["discount_decision"] ?? "keep");

if ($qr_code === "") {
    echo json_encode(["success" => false, "message" => "Invalid request."]);
    exit;
}
if (!in_array($discount_decision, ["keep", "decline", "grant"], true)) {
    echo json_encode(["success" => false, "message" => "Invalid discount_decision."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, commuter_id, trip_id, uv_session_id, uv_slot_id, boarding_status, passenger_name,
           queue_number, destination_terminal, fare_amount, base_fare_amount, discount_type,
           departure_time, vehicle_category, payment_status,
           rebooked_from_reservation_id, rebooking_fee_amount
    FROM reservations WHERE qr_code = ?
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

// ── QR validity window: booking-time through departure + grace period ────────
// Scheduled UV slots additionally stay inactive until 30 min before departure
// (prevents booking a slot and walking up to skip the physical line) — Bus
// trips and live UV sessions have no such lower bound. Upper bound (departure
// + QR_GRACE_MINUTES) applies to Bus and UV-slot bookings alike; live UV
// sessions have no fixed schedule to expire against, so they're exempt.
//
// Uses the DB's own clock (not PHP's time()/date()) for the "now" side of
// this comparison — this server's php.ini date.timezone doesn't match the
// system/MySQL timezone, so mixing time() with strtotime() on a DB datetime
// string silently produces a multi-hour skew. Parsing both sides with
// strtotime() keeps the (wrong but consistent) offset applied to both,
// which cancels out. Same pattern as get_active_sessions.php's $db_now.
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

// ── Authorize: the scanning driver must own the trip/session, or currently
// be the dispatched driver for the slot's route (slot bookings roll over to
// whichever driver is actively boarding, not a fixed driver at booking time) ─
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
    // Route-level slots (commuter-triggered, no fixed operator_id — see Core
    // Flow 8b) pool across every operator active on the route: whichever
    // driver is currently dispatched for this route, regardless of which
    // operator they belong to, is authorized to board it. A legacy
    // operator-created slot (operator_id still set) is unaffected by this —
    // it was already only ever scoped by route_id here, not by operator_id
    // matching, so no behavior changes for those rows.
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

// ── UV Express Vehicle Type -> Route -> Driver -> Daily Quota
// (driver_route_quotas, migration 057) — a separate concept from the
// driver_quotas peso settlement target. UV slots have no fixed driver until
// dispatch, so this is enforced here at boarding/scan time, not at booking
// (Bus is already checked in create_reservation.php, since its driver is
// known the moment the trip is bookable). Unset means unlimited.
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

// ── Validate the discount decision against the ticket's current state, before
// anything is mutated. A pre-settled (operator-rebooked) ticket never gets
// discount-adjusted — that would reopen the double-payment guard from
// board_reservation's payment_status==='released' skip below.
if ($discount_decision !== "keep" && $res["payment_status"] === "released") {
    echo json_encode(["success" => false, "message" => "This ticket was already settled and can't have its discount changed."]);
    exit;
}
if ($discount_decision === "decline" && $res["discount_type"] === "default") {
    echo json_encode(["success" => false, "message" => "This booking has no discount to decline."]);
    exit;
}
if ($discount_decision === "grant" && $res["discount_type"] !== "default") {
    echo json_encode(["success" => false, "message" => "This booking is already discounted."]);
    exit;
}
if (($discount_decision === "decline" || $discount_decision === "grant") && $res["base_fare_amount"] === null) {
    echo json_encode(["success" => false, "message" => "This ticket predates discount overrides and can't be adjusted."]);
    exit;
}

$commuter_category = null;
if ($discount_decision === "grant") {
    $stmt = $conn->prepare("SELECT category FROM commuters WHERE id = ?");
    $stmt->bind_param("i", $res["commuter_id"]);
    $stmt->execute();
    $commuter_category = $stmt->get_result()->fetch_assoc()["category"] ?? "default";
    $stmt->close();
    if ($commuter_category === "default") {
        echo json_encode(["success" => false, "message" => "No discount category on file for this passenger."]);
        exit;
    }
}

// ── Audit trail (migration 029): who scanned this, what they decided, and
// where the resulting discount (if any) came from. discount_source describes
// the *applied* discount's provenance, not the decision itself — "system"
// means it was already verified at booking time and kept as-is, "physical_id"
// means a driver granted it here after the commuter showed a physical ID, and
// null covers both "declined" and "never had a discount to begin with".
$discount_source = null;
if ($discount_decision === "grant") {
    $discount_source = "physical_id";
} elseif ($discount_decision === "keep" && $res["discount_type"] !== "default") {
    $discount_source = "system";
}

// ── Atomic: mark boarded + pay the driver their fare ──────────────────────────
$conn->begin_transaction();
try {
    $stmt = $conn->prepare("
        UPDATE reservations
        SET boarding_status = 'boarded', boarded_at = NOW(), payment_status = 'released',
            boarding_driver_id = ?, discount_decision = ?, discount_source = ?
        WHERE id = ? AND boarding_status = 'reserved'
    ");
    $stmt->bind_param("issi", $driver_id, $discount_decision, $discount_source, $res["id"]);
    $stmt->execute();
    $boarded = $stmt->affected_rows > 0;
    $stmt->close();

    if (!$boarded) {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "This ticket was already boarded."]);
        exit;
    }

    $fare_amount = (float)$res["fare_amount"];

    // ── Driver-side discount override: the fare was already deducted from
    // escrow at booking time, so correcting the discount here means an actual
    // wallet debit (decline) or credit (grant) — the remittance split below
    // then runs on this corrected, final settled amount.
    $surcharge_charged = 0.0;
    $cashback_credited = 0.0;
    $final_discount_type = $res["discount_type"];

    if ($discount_decision === "decline" || $discount_decision === "grant") {
        $base_fare_amount = (float)$res["base_fare_amount"];
        $full_fare        = round($base_fare_amount * 4) / 4;
        $discounted_fare  = round($base_fare_amount * 0.80 * 4) / 4;

        $wStmt = $conn->prepare("SELECT balance FROM wallets WHERE commuter_id = ?");
        $wStmt->bind_param("i", $res["commuter_id"]);
        $wStmt->execute();
        $wallet = $wStmt->get_result()->fetch_assoc();
        $wStmt->close();
        $balance = (float)($wallet["balance"] ?? 0);

        if ($discount_decision === "decline") {
            $surcharge_charged = min($full_fare - $fare_amount, $balance);
            $new_balance = round($balance - $surcharge_charged, 2);
            $upd = $conn->prepare("UPDATE wallets SET balance = ? WHERE commuter_id = ?");
            $upd->bind_param("di", $new_balance, $res["commuter_id"]);
            $upd->execute();
            $upd->close();

            $note = "Discount declined — no valid ID shown ({$res["passenger_name"]})";
            $ins = $conn->prepare("
                INSERT INTO wallet_transactions (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
                VALUES ('commuter', ?, 'debit', ?, 'discount_surcharge', ?, ?, ?)
            ");
            $ins->bind_param("idids", $res["commuter_id"], $surcharge_charged, $res["id"], $new_balance, $note);
            $ins->execute();
            $ins->close();

            $final_discount_type = "default";
            $fare_amount = round($fare_amount + $surcharge_charged, 2);
        } else {
            $cashback_credited = $fare_amount - $discounted_fare;
            $new_balance = round($balance + $cashback_credited, 2);
            $upd = $conn->prepare("UPDATE wallets SET balance = ? WHERE commuter_id = ?");
            $upd->bind_param("di", $new_balance, $res["commuter_id"]);
            $upd->execute();
            $upd->close();

            $note = "Discount granted — valid ID shown onboard ({$res["passenger_name"]})";
            $ins = $conn->prepare("
                INSERT INTO wallet_transactions (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
                VALUES ('commuter', ?, 'credit', ?, 'discount_cashback', ?, ?, ?)
            ");
            $ins->bind_param("idids", $res["commuter_id"], $cashback_credited, $res["id"], $new_balance, $note);
            $ins->execute();
            $ins->close();

            $final_discount_type = $commuter_category;
            $fare_amount = $discounted_fare;
        }

        $updRes = $conn->prepare("UPDATE reservations SET discount_type = ?, fare_amount = ? WHERE id = ?");
        $updRes->bind_param("sdi", $final_discount_type, $fare_amount, $res["id"]);
        $updRes->execute();
        $updRes->close();
    }

    // A reservation created by operator_rebook.php is already 'released' —
    // its fare's value was already fully distributed when the original
    // no-show booking was forfeited (see that file's header comment). Scanning
    // this ticket just confirms the ride happened; it must NOT pay out again.
    if ($res["payment_status"] === "released") {
        $split = ["driver_net" => 0, "operator_fee" => 0, "system_fee" => 0];
    } else {
        $stmt = $conn->prepare("SELECT operator_id FROM drivers WHERE id = ?");
        $stmt->bind_param("i", $driver_id);
        $stmt->execute();
        $operator_id = (int)($stmt->get_result()->fetch_assoc()["operator_id"] ?? 0);
        $stmt->close();

        // Derive the specific association this fare's route belongs to —
        // always unambiguous via routes.association_id, even for a pooled
        // UV Express slot with no fixed vehicle/driver at booking time — so
        // the operator's cut lands in the right per-association wallet.
        $association_id = null;
        if ($res["trip_id"]) {
            $stmt = $conn->prepare("SELECT r.association_id FROM trips t JOIN routes r ON r.id = t.route_id WHERE t.id = ?");
            $stmt->bind_param("i", $res["trip_id"]);
        } elseif ($res["uv_session_id"]) {
            $stmt = $conn->prepare("SELECT r.association_id FROM uv_sessions s JOIN routes r ON r.id = s.route_id WHERE s.id = ?");
            $stmt->bind_param("i", $res["uv_session_id"]);
        } else {
            $stmt = $conn->prepare("SELECT r.association_id FROM uv_slots s JOIN routes r ON r.id = s.route_id WHERE s.id = ?");
            $stmt->bind_param("i", $res["uv_slot_id"]);
        }
        $stmt->execute();
        $assocRow = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if ($assocRow && $assocRow["association_id"] !== null) $association_id = (int)$assocRow["association_id"];

        // Automatic 3-way split, credited instantly in this same transaction —
        // no separate submission/approval step (see config/remittance.php).
        $split = creditRemittanceSplit($conn, $driver_id, $operator_id, $association_id, $res["vehicle_category"], $fare_amount, $res["id"], "Fare — {$res["passenger_name"]}");
    }

    $conn->commit();

    $response = [
        "success"                  => true,
        "passenger_name"           => $res["passenger_name"],
        "queue_number"             => $res["queue_number"] !== null ? (int)$res["queue_number"] : null,
        "destination_terminal"     => $res["destination_terminal"],
        "fare_amount"              => $fare_amount,
        "discount_type"            => $final_discount_type,
        "driver_credited"          => $split["driver_net"],
        "operator_fee"             => $split["operator_fee"],
        "system_fee"               => $split["system_fee"],
        "discount_decision_applied"=> $discount_decision,
        "surcharge_charged"        => $surcharge_charged > 0 ? $surcharge_charged : null,
        "cashback_credited"        => $cashback_credited > 0 ? $cashback_credited : null,
    ];

    // A ticket that's a continuation of an earlier rebooked-away booking —
    // the original fare's remittance was already settled at rebooking time
    // (see complete_rebook.php), so there's nothing additional due here; the
    // scanner just needs enough context to show the driver what happened.
    if ($res["rebooked_from_reservation_id"] !== null) {
        $response["is_rebooked"]          = true;
        $response["original_fare_amount"] = (float)$res["fare_amount"];
        $response["rebooking_fee_amount"] = $res["rebooking_fee_amount"] !== null ? (float)$res["rebooking_fee_amount"] : null;
        $response["additional_fare_due"]  = 0;
    }

    echo json_encode($response);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to process boarding."]);
}
