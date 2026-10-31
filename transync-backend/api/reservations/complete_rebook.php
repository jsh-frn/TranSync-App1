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
require_once __DIR__ . "/../../config/rebook_eligibility.php";
require_once __DIR__ . "/../../config/auth.php";

$auth = requireAuth($conn, ['commuter']);

// Commuter's half of the new 2-step rebooking flow — only reachable once an
// operator has approved a rebook request (operator_review_rebook.php). The
// commuter picks the new trip/seat and pays the 10% (of the ORIGINAL fare)
// rebooking fee themselves here; the operator never picks on their behalf.
// This replaces the reservation-creation logic that used to live inside
// operator_rebook.php.
$body           = json_decode(file_get_contents("php://input"), true);
$commuter_id    = $auth['owner_id'];
$reservation_id = (int)($body["reservation_id"] ?? 0); // the ORIGINAL booking
$new_trip_id    = isset($body["new_trip_id"]) && $body["new_trip_id"] !== "" ? (int)$body["new_trip_id"] : null;
$new_uv_slot_id = isset($body["new_uv_slot_id"]) && $body["new_uv_slot_id"] !== "" ? (int)$body["new_uv_slot_id"] : null;
$new_seat_label = trim($body["new_seat_label"] ?? "");

if (!$reservation_id || (($new_trip_id !== null) === ($new_uv_slot_id !== null))) {
    echo json_encode(["success" => false, "message" => "Provide reservation_id and exactly one of new_trip_id or new_uv_slot_id."]);
    exit;
}
if ($new_trip_id !== null && $new_seat_label === "") {
    echo json_encode(["success" => false, "message" => "Please select a seat for the new trip."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, commuter_id, trip_id, uv_session_id, uv_slot_id, fare_amount, base_fare_amount, discount_type,
           passenger_name, passenger_phone, passenger_age, vehicle_category,
           passengers_count, boarding_status, departure_time, resolved_at
    FROM reservations WHERE id = ?
");
$stmt->bind_param("i", $reservation_id);
$stmt->execute();
$old = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$old) {
    echo json_encode(["success" => false, "message" => "Booking not found."]);
    exit;
}
if ((int)$old["commuter_id"] !== $commuter_id) {
    echo json_encode(["success" => false, "message" => "This booking doesn't belong to you."]);
    exit;
}
if (($old["trip_id"] && $new_uv_slot_id) || ($old["uv_slot_id"] && $new_trip_id)) {
    echo json_encode(["success" => false, "message" => "Rebook onto the same vehicle category."]);
    exit;
}

expireStaleRebookRequests($conn);

$stmt = $conn->prepare("SELECT id FROM rebook_requests WHERE reservation_id = ? AND status = 'approved'");
$stmt->bind_param("i", $reservation_id);
$stmt->execute();
$request = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$request) {
    echo json_encode(["success" => false, "message" => "This rebooking hasn't been approved yet, or the approval has expired — please request again."]);
    exit;
}

// Derive the operator that owns the ORIGINAL booking's trip/slot — the new
// trip must belong to this same operator's fleet (user's decision: no
// cross-operator marketplace). A route-level pooled UV slot has no single
// operator to derive (operator_id IS NULL) — there's nothing to rebook
// "within" in that case.
if ($old["trip_id"]) {
    $stmt = $conn->prepare("SELECT v.operator_id FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = ?");
    $stmt->bind_param("i", $old["trip_id"]);
} else {
    $stmt = $conn->prepare("SELECT operator_id FROM uv_slots WHERE id = ?");
    $stmt->bind_param("i", $old["uv_slot_id"]);
}
$stmt->execute();
$ownerRow = $stmt->get_result()->fetch_assoc();
$stmt->close();
$operator_id = ($ownerRow && $ownerRow["operator_id"] !== null) ? (int)$ownerRow["operator_id"] : null;

if ($operator_id === null) {
    echo json_encode(["success" => false, "message" => "This booking has no single operator to rebook within — please contact support."]);
    exit;
}

$conn->begin_transaction();
try {
    // ── Fetch + validate the new target (must belong to the derived
    // operator and satisfy the advance-booking window like any other
    // booking) ────────────────────────────────────────────────────────────
    if ($new_trip_id !== null) {
        $stmt = $conn->prepare("
            SELECT t.route_id, t.status, t.departure_time, t.vehicle_id, t.driver_id, v.operator_id,
                   r.from_location, r.to_location, r.association_id
            FROM trips t JOIN routes r ON r.id = t.route_id JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.id = ? AND v.operator_id = ?
        ");
        $stmt->bind_param("ii", $new_trip_id, $operator_id);
        $min_lead_hours = ADVANCE_BOOKING_HOURS["Bus"];
    } else {
        $stmt = $conn->prepare("
            SELECT s.route_id, s.status, s.departure_time, s.operator_id,
                   r.from_location, r.to_location, r.association_id
            FROM uv_slots s JOIN routes r ON r.id = s.route_id
            WHERE s.id = ? AND s.operator_id = ?
        ");
        $stmt->bind_param("ii", $new_uv_slot_id, $operator_id);
        $min_lead_hours = ADVANCE_BOOKING_HOURS["UV Express"];
    }
    $stmt->execute();
    $target = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$target) {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "The selected departure wasn't found in your original operator's fleet."]);
        exit;
    }
    if ($target["status"] !== "scheduled") {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "The selected departure is no longer accepting bookings."]);
        exit;
    }

    // DB clock, not PHP's — see board_reservation.php for why mixing time()/date()
    // with strtotime() on a DB datetime string is unsafe here.
    $db_now_ts = strtotime($conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"]);
    if (strtotime($target["departure_time"]) - $db_now_ts < $min_lead_hours * 3600) {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "The selected departure must be at least {$min_lead_hours} hours from now."]);
        exit;
    }

    if ($new_trip_id !== null) {
        $stmt = $conn->prepare("SELECT id FROM seats WHERE vehicle_id = ? AND seat_label = ?");
        $stmt->bind_param("is", $target["vehicle_id"], $new_seat_label);
        $stmt->execute();
        if (!$stmt->get_result()->fetch_assoc()) {
            $stmt->close();
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "Invalid seat for this vehicle."]);
            exit;
        }
        $stmt->close();
    }

    // ── Claim the new seat atomically ─────────────────────────────────────────
    if ($new_trip_id !== null) {
        $stmt = $conn->prepare("UPDATE trips SET seats_booked = seats_booked + 1 WHERE id = ? AND seats_booked < capacity AND status = 'scheduled'");
        $stmt->bind_param("i", $new_trip_id);
    } else {
        $stmt = $conn->prepare("UPDATE uv_slots SET seats_booked = seats_booked + 1 WHERE id = ? AND seats_booked < capacity AND status = 'scheduled'");
        $stmt->bind_param("i", $new_uv_slot_id);
    }
    $stmt->execute();
    $claimed = $stmt->affected_rows > 0;
    $stmt->close();

    if (!$claimed) {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "The selected departure is full."]);
        exit;
    }

    // ── Charge the 10% rebooking fee, computed from the ORIGINAL fare —
    // never the new trip's own fare — then split via the normal
    // system/operator/driver remittance below, not credited to the
    // operator alone ────────────────────────────────────────────────────
    $original_fare = (float)$old["fare_amount"];
    $fee           = round($original_fare * REBOOKING_SURCHARGE_PCT * 4) / 4; // nearest ₱0.25

    $stmt = $conn->prepare("SELECT balance FROM wallets WHERE commuter_id = ?");
    $stmt->bind_param("i", $commuter_id);
    $stmt->execute();
    $balance = (float)$stmt->get_result()->fetch_assoc()["balance"];
    $stmt->close();

    if ($balance < $fee) {
        $conn->rollback();
        echo json_encode([
            "success"  => false,
            "message"  => "Wallet balance is insufficient for the rebooking fee.",
            "balance"  => $balance,
            "required" => $fee,
        ]);
        exit;
    }

    $new_commuter_balance = round($balance - $fee, 2);
    $stmt = $conn->prepare("UPDATE wallets SET balance = ? WHERE commuter_id = ?");
    $stmt->bind_param("di", $new_commuter_balance, $commuter_id);
    $stmt->execute();
    $stmt->close();

    $note = "Rebooking fee — booking #{$reservation_id}";
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
        VALUES ('commuter', ?, 'debit', ?, 'rebooking_fee', ?, ?, ?)
    ");
    $stmt->bind_param("idids", $commuter_id, $fee, $reservation_id, $new_commuter_balance, $note);
    $stmt->execute();
    $stmt->close();

    $rebook_association_id = $target["association_id"] !== null ? (int)$target["association_id"] : null;

    // ── Insert the new reservation, pre-settled (payment_status='released')
    // — carries the original fare forward (not re-charged, not
    // re-credited at boarding), plus the fee actually paid for audit ───────
    $qr_suffix = strtoupper(bin2hex(random_bytes(5)));
    $qr_code   = "TRN-R{$target["route_id"]}-{$qr_suffix}";
    $seat_labels_to_store = $new_trip_id !== null ? $new_seat_label : null;

    $stmt = $conn->prepare("
        INSERT INTO reservations
            (commuter_id, route_id, trip_id, uv_session_id, uv_slot_id,
             origin_terminal, destination_terminal, departure_time, fare_amount, base_fare_amount,
             payment_status, discount_type, passenger_name, passenger_phone, passenger_age,
             vehicle_category, passengers_count, boarding_status, qr_code,
             rebooked_from_reservation_id, seat_labels, rebooking_fee_amount)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'released', ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?)
    ");
    $stmt->bind_param(
        "iiiisssddsssisisisd",
        $commuter_id, $target["route_id"], $new_trip_id, $new_uv_slot_id,
        $target["from_location"], $target["to_location"], $target["departure_time"], $original_fare, $old["base_fare_amount"],
        $old["discount_type"], $old["passenger_name"], $old["passenger_phone"], $old["passenger_age"],
        $old["vehicle_category"], $old["passengers_count"], $qr_code, $reservation_id, $seat_labels_to_store, $fee
    );
    $stmt->execute();
    $new_reservation_id = $conn->insert_id;
    $stmt->close();

    // ── Split the 10% rebooking fee the same way every other fare-related
    // payout in this app is split — system's flat cut, the operator's own
    // configured cut, and the driver keeps the remainder — instead of
    // crediting it to the operator outright. The new trip's own fixed
    // driver is used for a Bus rebooking; a UV Express rebooking has no
    // fixed driver (pooled), so this passes null and the driver's share
    // folds into the operator's credit, same as every other UV payout.
    // Recorded against the NEW reservation's own audit columns
    // (system_fee_amount/operator_fee_amount/driver_net_amount), not the
    // OLD reservation's — the old reservation's own forfeiture settlement
    // (below) already uses those columns for the original fare's split. ──
    $new_driver_id = $new_trip_id !== null && !empty($target["driver_id"]) ? (int)$target["driver_id"] : null;
    creditRemittanceSplit($conn, $new_driver_id, $operator_id, $rebook_association_id, $old["vehicle_category"], $fee, $new_reservation_id, "Rebooking fee");

    // ── Settle the OLD reservation ──────────────────────────────────────────
    if ($old["boarding_status"] === "reserved") {
        // Still active — force-settle as a forfeiture, exactly like
        // cancel_late.php: the commuter isn't taking this ride, but the
        // driver/operator/system are paid the original fare as if it had
        // happened, same as any other forfeiture in this app.
        $stmt = $conn->prepare("
            UPDATE reservations
            SET status = 'cancelled', boarding_status = 'cancelled', cancellation_type = 'rebooked',
                payment_status = 'forfeited', resolved_at = NOW(), rebooked_to_reservation_id = ?
            WHERE id = ? AND boarding_status = 'reserved'
        ");
        $stmt->bind_param("ii", $new_reservation_id, $reservation_id);
        $stmt->execute();
        $settled = $stmt->affected_rows > 0;
        $stmt->close();

        if (!$settled) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This booking's status changed — please try again."]);
            exit;
        }

        // Release the old seat.
        if ($old["trip_id"]) {
            $stmt = $conn->prepare("UPDATE trips SET seats_booked = GREATEST(0, seats_booked - 1) WHERE id = ?");
            $stmt->bind_param("i", $old["trip_id"]);
        } else {
            $stmt = $conn->prepare("UPDATE uv_slots SET seats_booked = GREATEST(0, seats_booked - 1) WHERE id = ?");
            $stmt->bind_param("i", $old["uv_slot_id"]);
        }
        $stmt->execute();
        $stmt->close();

        // Resolve the old booking's own driver/operator/association — same
        // pattern as cancel_late.php.
        $old_driver_id   = null;
        $old_operator_id = $operator_id; // already derived above from this same trip/slot
        if ($old["trip_id"]) {
            $stmt = $conn->prepare("SELECT driver_id FROM trips WHERE id = ?");
            $stmt->bind_param("i", $old["trip_id"]);
            $stmt->execute();
            $old_driver_id = (int)($stmt->get_result()->fetch_assoc()["driver_id"] ?? 0) ?: null;
            $stmt->close();
        }

        if ($old["trip_id"]) {
            $stmt = $conn->prepare("SELECT r.association_id FROM trips t JOIN routes r ON r.id = t.route_id WHERE t.id = ?");
            $stmt->bind_param("i", $old["trip_id"]);
        } else {
            $stmt = $conn->prepare("SELECT r.association_id FROM uv_slots s JOIN routes r ON r.id = s.route_id WHERE s.id = ?");
            $stmt->bind_param("i", $old["uv_slot_id"]);
        }
        $stmt->execute();
        $oldAssocRow = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $old_association_id = ($oldAssocRow && $oldAssocRow["association_id"] !== null) ? (int)$oldAssocRow["association_id"] : null;

        if ($old_operator_id !== null) {
            creditRemittanceSplit($conn, $old_driver_id, $old_operator_id, $old_association_id, $old["vehicle_category"], $original_fare, $reservation_id, "Rebooking forfeiture");
        } else {
            // Defensive fallback for a pooled UV slot (shouldn't reach here —
            // already rejected earlier when the operator couldn't be
            // derived) — mirrors config/sweep.php's system-only credit.
            $sysNote = "Rebooking forfeiture — pooled route slot (booking #{$reservation_id})";
            $sysStmt = $conn->prepare("
                INSERT INTO wallet_transactions (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
                VALUES ('system', 0, 'credit', ?, 'remittance_fee', ?, ?, ?)
            ");
            $sysStmt->bind_param("dids", $original_fare, $reservation_id, $original_fare, $sysNote);
            $sysStmt->execute();
            $sysStmt->close();

            $updStmt = $conn->prepare("UPDATE reservations SET system_fee_amount = ?, operator_fee_amount = 0, driver_net_amount = 0 WHERE id = ?");
            $updStmt->bind_param("di", $original_fare, $reservation_id);
            $updStmt->execute();
            $updStmt->close();
        }
    } else {
        // Already 'no_show' — the sweep already paid its remittance split
        // when it happened. Just close the link, no double payment.
        $stmt = $conn->prepare("
            UPDATE reservations SET cancellation_type = 'rebooked', rebooked_to_reservation_id = ? WHERE id = ?
        ");
        $stmt->bind_param("ii", $new_reservation_id, $reservation_id);
        $stmt->execute();
        $stmt->close();
    }

    // ── Close out the request ────────────────────────────────────────────────
    $stmt = $conn->prepare("
        UPDATE rebook_requests SET status = 'fulfilled', resolved_at = NOW()
        WHERE reservation_id = ? AND status = 'approved'
    ");
    $stmt->bind_param("i", $reservation_id);
    $stmt->execute();
    $stmt->close();

    $conn->commit();

    echo json_encode([
        "success"              => true,
        "new_reservation_id"   => $new_reservation_id,
        "qr_code"              => $qr_code,
        "rebooking_fee_amount" => $fee,
        "original_fare_amount" => $original_fare,
        "surcharge_charged"    => $fee, // alias kept for any existing caller expecting this key
    ]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to complete rebooking."]);
}
