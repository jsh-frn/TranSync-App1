<?php
// Shared no-show forfeiture sweep — the single authoritative place that
// flips a still-'reserved' booking past its QR grace period to 'no_show'
// AND credits the driver/operator/system remittance split for it. Called
// from sweep_departed_trips.php (explicit) and get_reservation_status.php
// (opportunistic, on every status poll). Both must go through this same
// function — a raw status-flip UPDATE without creditRemittanceSplit() would
// silently leave the driver/operator/system unpaid for a seat that was held
// and never resold, and would also make the row invisible to any other
// sweep call afterward (boarding_status no longer 'reserved').
//
// Purely time-based (NOW() > departure_time + grace) — never gated on the
// trip/slot's own status being 'departed'. A driver who never taps Depart
// must not leave the reservation (and its QR) looking "still valid" forever.
// A trip/slot that's 'cancelled' or 'completed' never has a lingering
// 'reserved' row to match anyway (both resolve them synchronously
// elsewhere), so no status condition is needed here.

require_once __DIR__ . "/remittance.php";

function sweepDepartedReservations($conn) {
    require_once __DIR__ . "/policy.php";
    // Grace period differs by vehicle type (Core Flow 11) — each candidate
    // query filters on its own vehicle type's own grace window.
    $busGrace = (int)QR_GRACE_MINUTES["Bus"];
    $uvGrace  = (int)QR_GRACE_MINUTES["UV Express"];

    $busCandidates = $conn->query("
        SELECT r.id, r.fare_amount, r.vehicle_category, t.driver_id, v.operator_id, rt.association_id
        FROM reservations r
        JOIN trips t ON t.id = r.trip_id
        JOIN vehicles v ON v.id = t.vehicle_id
        JOIN routes rt ON rt.id = t.route_id
        WHERE r.boarding_status = 'reserved'
          AND NOW() > DATE_ADD(t.departure_time, INTERVAL {$busGrace} MINUTE)
    ")->fetch_all(MYSQLI_ASSOC);

    $uvCandidates = $conn->query("
        SELECT r.id, r.fare_amount, r.vehicle_category, s.operator_id, rt.association_id
        FROM reservations r
        JOIN uv_slots s ON s.id = r.uv_slot_id
        JOIN routes rt ON rt.id = s.route_id
        WHERE r.boarding_status = 'reserved'
          AND NOW() > DATE_ADD(s.departure_time, INTERVAL {$uvGrace} MINUTE)
    ")->fetch_all(MYSQLI_ASSOC);

    $swept = 0;

    foreach ($busCandidates as $row) {
        $conn->begin_transaction();
        try {
            $stmt = $conn->prepare("
                UPDATE reservations
                SET boarding_status = 'no_show', status = 'expired', cancellation_type = 'no_show', payment_status = 'forfeited', resolved_at = NOW()
                WHERE id = ? AND boarding_status = 'reserved'
            ");
            $stmt->bind_param("i", $row["id"]);
            $stmt->execute();
            $affected = $stmt->affected_rows > 0;
            $stmt->close();

            if ($affected) {
                $assoc_id = $row["association_id"] !== null ? (int)$row["association_id"] : null;
                creditRemittanceSplit($conn, (int)$row["driver_id"], (int)$row["operator_id"], $assoc_id, $row["vehicle_category"], (float)$row["fare_amount"], (int)$row["id"], "No-show forfeiture");
                $swept++;
            }
            $conn->commit();
        } catch (Exception $e) {
            $conn->rollback();
        }
    }

    foreach ($uvCandidates as $row) {
        $conn->begin_transaction();
        try {
            $stmt = $conn->prepare("
                UPDATE reservations
                SET boarding_status = 'no_show', status = 'expired', cancellation_type = 'no_show', payment_status = 'forfeited', resolved_at = NOW()
                WHERE id = ? AND boarding_status = 'reserved'
            ");
            $stmt->bind_param("i", $row["id"]);
            $stmt->execute();
            $affected = $stmt->affected_rows > 0;
            $stmt->close();

            if ($affected) {
                if ($row["operator_id"] !== null) {
                    // No fixed driver on a UV slot booking — see config/remittance.php.
                    $assoc_id = $row["association_id"] !== null ? (int)$row["association_id"] : null;
                    creditRemittanceSplit($conn, null, (int)$row["operator_id"], $assoc_id, $row["vehicle_category"], (float)$row["fare_amount"], (int)$row["id"], "No-show forfeiture");
                } else {
                    // Route-level pooled slot (Core Flow 8b) — capacity is
                    // uncapped, so no single operator held a scarce seat that
                    // couldn't be resold; there's no operator to pay a cut to.
                    // The forfeited fare goes to the system ledger only,
                    // rather than crediting an arbitrary/nonexistent operator.
                    $fare = (float)$row["fare_amount"];
                    $note = "No-show forfeiture — pooled route slot (booking #{$row["id"]})";
                    $sysStmt = $conn->prepare("
                        INSERT INTO wallet_transactions (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
                        VALUES ('system', 0, 'credit', ?, 'remittance_fee', ?, ?, ?)
                    ");
                    $sysStmt->bind_param("dids", $fare, $row["id"], $fare, $note);
                    $sysStmt->execute();
                    $sysStmt->close();

                    $updStmt = $conn->prepare("UPDATE reservations SET system_fee_amount = ?, operator_fee_amount = 0, driver_net_amount = 0 WHERE id = ?");
                    $updStmt->bind_param("di", $fare, $row["id"]);
                    $updStmt->execute();
                    $updStmt->close();
                }
                $swept++;
            }
            $conn->commit();
        } catch (Exception $e) {
            $conn->rollback();
        }
    }

    return $swept;
}
