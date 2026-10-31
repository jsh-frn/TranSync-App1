<?php
// Shared driver/operator/system remittance split for Bus/UV Express — used at
// boarding scan (board_reservation.php), post-cutoff commuter cancellation
// (reservations/cancel_late.php), and no-show forfeiture (sweep_departed_trips.php).
// Always the same instant 3-way percentage split off remittance_rates, computed
// fresh at the moment of crediting — money movement is never deferred to a
// separate submission/approval step.

// $association_id is the specific association this fare's ROUTE belongs to
// (routes.association_id — always unambiguous, even for a pooled UV Express
// slot with no fixed vehicle/driver at booking time) — an operator can hold
// the same vehicle type approved at several associations at once now, so
// the operator's cut must land in that specific association's own wallet
// (operator_association_wallets), never a single combined balance. Pass
// null only if no association could be derived at all (shouldn't happen
// for a real booking, since every route is association-owned) — the
// operator's cut then falls back to their frozen Legacy wallet balance
// rather than the money going nowhere.
function creditRemittanceSplit($conn, $driver_id, $operator_id, $association_id, $vehicle_category, $fare_amount, $reservation_id, $note_label) {
    // System's cut is a flat, admin-tunable rate — no per-operator override
    // anymore (see migration 020). Seeded at 5%.
    $stmt = $conn->prepare("SELECT system_fee_pct FROM remittance_rates WHERE vehicle_type = ? AND scope = 'default'");
    $stmt->bind_param("s", $vehicle_category);
    $stmt->execute();
    $rateRow = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $system_fee_pct = $rateRow ? (float)$rateRow["system_fee_pct"] : 5.0;

    // Operator's cut depends on the operator's own choice: 'percentage' mode
    // auto-deducts their own configured rate every booking; 'quota' mode takes
    // nothing automatically — the operator instead collects a manually
    // submitted lump sum from the driver via the existing quota pipeline, so
    // the driver keeps the entire remainder here.
    $stmt = $conn->prepare("SELECT remittance_mode, operator_fee_pct FROM operators WHERE id = ?");
    $stmt->bind_param("i", $operator_id);
    $stmt->execute();
    $opRow = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    $operator_fee_pct = ($opRow && $opRow["remittance_mode"] === "percentage" && $opRow["operator_fee_pct"] !== null)
        ? (float)$opRow["operator_fee_pct"]
        : 0.0;

    // Compute system/operator cuts from the rate, driver keeps the remainder —
    // avoids rounding drift where three independently-rounded percentages don't
    // sum back to the original fare.
    $system_fee   = round($fare_amount * ($system_fee_pct / 100), 2);
    $operator_fee = round($fare_amount * ($operator_fee_pct / 100), 2);
    $driver_net   = round($fare_amount - $system_fee - $operator_fee, 2);

    // UV Express slot bookings have no fixed driver (queue-based rollover — see
    // project notes) — when there's no specific driver to pay (forfeiture paths
    // only; a real boarding scan always passes a driver_id), fold the driver's
    // share into the operator's credit instead of leaving it unpaid.
    $driver_paid      = 0.0;
    $operator_credit  = $operator_fee;

    if ($driver_id) {
        $stmt = $conn->prepare("SELECT wallet_balance FROM drivers WHERE id = ?");
        $stmt->bind_param("i", $driver_id);
        $stmt->execute();
        $driver_bal = (float)($stmt->get_result()->fetch_assoc()["wallet_balance"] ?? 0);
        $stmt->close();

        $new_driver_bal = round($driver_bal + $driver_net, 2);
        $stmt = $conn->prepare("UPDATE drivers SET wallet_balance = ? WHERE id = ?");
        $stmt->bind_param("di", $new_driver_bal, $driver_id);
        $stmt->execute();
        $stmt->close();

        $note = "{$note_label} (booking #{$reservation_id})";
        $stmt = $conn->prepare("
            INSERT INTO wallet_transactions
                (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
            VALUES ('driver', ?, 'credit', ?, 'booking', ?, ?, ?)
        ");
        $stmt->bind_param("idids", $driver_id, $driver_net, $reservation_id, $new_driver_bal, $note);
        $stmt->execute();
        $stmt->close();

        $driver_paid = $driver_net;
    } else {
        $operator_credit = round($operator_fee + $driver_net, 2);
    }

    if ($operator_credit > 0) {
        if ($association_id) {
            // Atomic upsert into the operator's per-association wallet —
            // avoids the old read-then-write race entirely.
            $stmt = $conn->prepare("
                INSERT INTO operator_association_wallets (operator_id, association_id, balance)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)
            ");
            $stmt->bind_param("iid", $operator_id, $association_id, $operator_credit);
            $stmt->execute();
            $stmt->close();

            $stmt = $conn->prepare("SELECT balance FROM operator_association_wallets WHERE operator_id = ? AND association_id = ?");
            $stmt->bind_param("ii", $operator_id, $association_id);
            $stmt->execute();
            $new_op_bal = (float)($stmt->get_result()->fetch_assoc()["balance"] ?? $operator_credit);
            $stmt->close();
        } else {
            // No association derivable — fall back to the frozen Legacy
            // bucket rather than dropping the money.
            $stmt = $conn->prepare("SELECT wallet_balance FROM operators WHERE id = ?");
            $stmt->bind_param("i", $operator_id);
            $stmt->execute();
            $op_balance = (float)($stmt->get_result()->fetch_assoc()["wallet_balance"] ?? 0);
            $stmt->close();

            $new_op_bal = round($op_balance + $operator_credit, 2);
            $stmt = $conn->prepare("UPDATE operators SET wallet_balance = ? WHERE id = ?");
            $stmt->bind_param("di", $new_op_bal, $operator_id);
            $stmt->execute();
            $stmt->close();
        }

        $opNote = "{$note_label} — operator share (booking #{$reservation_id})";
        $stmt = $conn->prepare("
            INSERT INTO wallet_transactions
                (owner_type, owner_id, association_id, type, amount, reference_type, reference_id, balance_after, note)
            VALUES ('operator', ?, ?, 'credit', ?, 'remittance_fee', ?, ?, ?)
        ");
        $stmt->bind_param("iidids", $operator_id, $association_id, $operator_credit, $reservation_id, $new_op_bal, $opNote);
        $stmt->execute();
        $stmt->close();
    }

    if ($system_fee > 0) {
        $sysNote = "{$note_label} — system share (booking #{$reservation_id})";
        $stmt = $conn->prepare("
            INSERT INTO wallet_transactions
                (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
            VALUES ('system', 0, 'credit', ?, 'remittance_fee', ?, ?, ?)
        ");
        $stmt->bind_param("dids", $system_fee, $reservation_id, $system_fee, $sysNote);
        $stmt->execute();
        $stmt->close();
    }

    $stmt = $conn->prepare("
        UPDATE reservations
        SET system_fee_amount = ?, operator_fee_amount = ?, driver_net_amount = ?
        WHERE id = ?
    ");
    $stmt->bind_param("dddi", $system_fee, $operator_credit, $driver_paid, $reservation_id);
    $stmt->execute();
    $stmt->close();

    return ["system_fee" => $system_fee, "operator_fee" => $operator_credit, "driver_net" => $driver_paid];
}
