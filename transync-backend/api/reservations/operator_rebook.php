<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") { http_response_code(200); exit; }
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/policy.php";

// DEPRECATED — superseded by the 2-step operator_review_rebook.php +
// complete_rebook.php flow, where the operator only approves/rejects and
// the COMMUTER picks the new trip/seat themselves. Left functional (not
// deleted) for any historical/direct caller, per this codebase's
// deprecate-in-place convention — no current mobile screen calls this.
//
// Rebooking used to be operator-initiated only, reachable once a booking had
// already gone to 'no_show' (the sweep already ran and paid its remittance
// split to driver/operator/system — see sweep_departed_trips.php). Because
// that money has already been fully distributed, the new reservation created
// here is NOT re-charged the full fare and does NOT get re-credited at
// boarding — it's created with payment_status='released' directly (a
// pre-settled ticket) and board_reservation.php skips the remittance split
// for any reservation that's already 'released' at scan time. Only the 10%
// surcharge is new money — it goes to the operator as compensation for
// handling the rebooking.
$body           = json_decode(file_get_contents("php://input"), true);
$operator_id    = (int)($body["operator_id"] ?? 0);
$reservation_id = (int)($body["reservation_id"] ?? 0);
$new_trip_id    = isset($body["new_trip_id"]) && $body["new_trip_id"] !== "" ? (int)$body["new_trip_id"] : null;
$new_uv_slot_id = isset($body["new_uv_slot_id"]) && $body["new_uv_slot_id"] !== "" ? (int)$body["new_uv_slot_id"] : null;
$new_seat_label = trim($body["new_seat_label"] ?? "");

if (!$operator_id || !$reservation_id || (($new_trip_id !== null) === ($new_uv_slot_id !== null))) {
    echo json_encode(["success" => false, "message" => "Provide operator_id, reservation_id, and exactly one of new_trip_id or new_uv_slot_id."]);
    exit;
}
if ($new_trip_id !== null && $new_seat_label === "") {
    echo json_encode(["success" => false, "message" => "Please select a seat for the new trip."]);
    exit;
}

$stmt = $conn->prepare("
    SELECT id, commuter_id, trip_id, uv_session_id, uv_slot_id, fare_amount, discount_type,
           passenger_name, passenger_phone, passenger_age, vehicle_category,
           passengers_count, boarding_status
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
if ($old["boarding_status"] !== "no_show") {
    echo json_encode(["success" => false, "message" => "Only a missed (no-show) booking can be rebooked this way."]);
    exit;
}
if (($old["trip_id"] && $new_uv_slot_id) || ($old["uv_slot_id"] && $new_trip_id)) {
    echo json_encode(["success" => false, "message" => "Rebook onto the same vehicle category."]);
    exit;
}

// Verify the old booking actually belongs to this operator's fleet.
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
if (!$ownerRow || (int)$ownerRow["operator_id"] !== $operator_id) {
    echo json_encode(["success" => false, "message" => "This booking doesn't belong to your fleet."]);
    exit;
}

$commuter_id = (int)$old["commuter_id"];

$conn->begin_transaction();
try {
    // ── Fetch + validate the new target (must belong to the same operator and
    // satisfy the advance-booking window like any other booking) ──────────────
    if ($new_trip_id !== null) {
        $stmt = $conn->prepare("
            SELECT t.route_id, t.status, t.departure_time, t.vehicle_id, v.operator_id,
                   r.from_location, r.to_location, r.association_id
            FROM trips t JOIN routes r ON r.id = t.route_id JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.id = ?
        ");
        $stmt->bind_param("i", $new_trip_id);
        $stmt->execute();
        $target = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $min_lead_hours = ADVANCE_BOOKING_HOURS["Bus"];
    } else {
        $stmt = $conn->prepare("
            SELECT s.route_id, s.status, s.departure_time, s.operator_id,
                   r.from_location, r.to_location, r.association_id
            FROM uv_slots s JOIN routes r ON r.id = s.route_id
            WHERE s.id = ?
        ");
        $stmt->bind_param("i", $new_uv_slot_id);
        $stmt->execute();
        $target = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $min_lead_hours = ADVANCE_BOOKING_HOURS["UV Express"];
    }

    if (!$target) {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "The selected departure was not found."]);
        exit;
    }
    if ((int)$target["operator_id"] !== $operator_id) {
        $conn->rollback();
        echo json_encode(["success" => false, "message" => "The selected departure isn't one of your own."]);
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

    // ── Charge the 10% rebooking surcharge — new money, credited to the
    // operator for handling the rebooking (the original fare's value was
    // already fully distributed by the no-show sweep, see file header) ───────
    $fare      = (float)$old["fare_amount"];
    $surcharge = round($fare * REBOOKING_SURCHARGE_PCT * 4) / 4; // nearest ₱0.25

    $stmt = $conn->prepare("SELECT balance FROM wallets WHERE commuter_id = ?");
    $stmt->bind_param("i", $commuter_id);
    $stmt->execute();
    $balance = (float)$stmt->get_result()->fetch_assoc()["balance"];
    $stmt->close();

    if ($balance < $surcharge) {
        $conn->rollback();
        echo json_encode([
            "success"  => false,
            "message"  => "Commuter's wallet balance is insufficient for the rebooking surcharge.",
            "balance"  => $balance,
            "required" => $surcharge,
        ]);
        exit;
    }

    $new_commuter_balance = round($balance - $surcharge, 2);
    $stmt = $conn->prepare("UPDATE wallets SET balance = ? WHERE commuter_id = ?");
    $stmt->bind_param("di", $new_commuter_balance, $commuter_id);
    $stmt->execute();
    $stmt->close();

    $note = "Rebooking surcharge — booking #{$reservation_id}";
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
        VALUES ('commuter', ?, 'debit', ?, 'rebooking_fee', ?, ?, ?)
    ");
    $stmt->bind_param("idids", $commuter_id, $surcharge, $reservation_id, $new_commuter_balance, $note);
    $stmt->execute();
    $stmt->close();

    // Credit the specific association's wallet the new departure belongs to
    // (r.association_id, fetched alongside $target above) — same reasoning
    // as config/remittance.php's creditRemittanceSplit().
    $rebook_association_id = $target["association_id"] !== null ? (int)$target["association_id"] : null;

    if ($rebook_association_id) {
        $stmt = $conn->prepare("
            INSERT INTO operator_association_wallets (operator_id, association_id, balance)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)
        ");
        $stmt->bind_param("iid", $operator_id, $rebook_association_id, $surcharge);
        $stmt->execute();
        $stmt->close();

        $stmt = $conn->prepare("SELECT balance FROM operator_association_wallets WHERE operator_id = ? AND association_id = ?");
        $stmt->bind_param("ii", $operator_id, $rebook_association_id);
        $stmt->execute();
        $new_op_balance = (float)($stmt->get_result()->fetch_assoc()["balance"] ?? $surcharge);
        $stmt->close();
    } else {
        // No association derivable — fall back to the frozen Legacy bucket.
        $stmt = $conn->prepare("SELECT wallet_balance FROM operators WHERE id = ?");
        $stmt->bind_param("i", $operator_id);
        $stmt->execute();
        $op_balance = (float)($stmt->get_result()->fetch_assoc()["wallet_balance"] ?? 0);
        $stmt->close();

        $new_op_balance = round($op_balance + $surcharge, 2);
        $stmt = $conn->prepare("UPDATE operators SET wallet_balance = ? WHERE id = ?");
        $stmt->bind_param("di", $new_op_balance, $operator_id);
        $stmt->execute();
        $stmt->close();
    }

    $opNote = "Rebooking surcharge — booking #{$reservation_id}";
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, association_id, type, amount, reference_type, reference_id, balance_after, note)
        VALUES ('operator', ?, ?, 'credit', ?, 'rebooking_fee', ?, ?, ?)
    ");
    $stmt->bind_param("iidids", $operator_id, $rebook_association_id, $surcharge, $reservation_id, $new_op_balance, $opNote);
    $stmt->execute();
    $stmt->close();

    // ── Insert the new reservation, pre-settled (payment_status='released') —
    // carries the original fare forward for display/manifest purposes only,
    // it is not re-charged and will not be re-credited at boarding scan ──────
    $qr_suffix = strtoupper(bin2hex(random_bytes(5)));
    $qr_code   = "TRN-R{$target["route_id"]}-{$qr_suffix}";
    $seat_labels_to_store = $new_trip_id !== null ? $new_seat_label : null;

    $stmt = $conn->prepare("
        INSERT INTO reservations
            (commuter_id, route_id, trip_id, uv_session_id, uv_slot_id,
             origin_terminal, destination_terminal, departure_time, fare_amount,
             payment_status, discount_type, passenger_name, passenger_phone, passenger_age,
             vehicle_category, passengers_count, boarding_status, qr_code,
             rebooked_from_reservation_id, seat_labels)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'released', ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)
    ");
    $stmt->bind_param(
        "iiiisssdsssisisis",
        $commuter_id, $target["route_id"], $new_trip_id, $new_uv_slot_id,
        $target["from_location"], $target["to_location"], $target["departure_time"], $fare,
        $old["discount_type"], $old["passenger_name"], $old["passenger_phone"], $old["passenger_age"],
        $old["vehicle_category"], $old["passengers_count"], $qr_code, $reservation_id, $seat_labels_to_store
    );
    $stmt->execute();
    $new_reservation_id = $conn->insert_id;
    $stmt->close();

    // ── Close out the old reservation ─────────────────────────────────────────
    $stmt = $conn->prepare("
        UPDATE reservations
        SET cancellation_type = 'rebooked', rebooked_to_reservation_id = ?
        WHERE id = ?
    ");
    $stmt->bind_param("ii", $new_reservation_id, $reservation_id);
    $stmt->execute();
    $stmt->close();

    // Clear any pending commuter-initiated rebook request for the old
    // booking — it's been acted on, so the flag should stop showing on the
    // manifest (see Core Flow 9a's rebook-request note).
    $stmt = $conn->prepare("
        UPDATE rebook_requests SET status = 'fulfilled', resolved_at = NOW()
        WHERE reservation_id = ? AND status = 'pending'
    ");
    $stmt->bind_param("i", $reservation_id);
    $stmt->execute();
    $stmt->close();

    $conn->commit();

    echo json_encode([
        "success"            => true,
        "new_reservation_id" => $new_reservation_id,
        "qr_code"            => $qr_code,
        "surcharge_charged"  => $surcharge,
    ]);
} catch (Exception $e) {
    $conn->rollback();
    echo json_encode(["success" => false, "message" => "Failed to process rebooking."]);
}
