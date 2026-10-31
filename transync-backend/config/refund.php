<?php
// Shared tiered-refund computation for Bus/UV Express cancellations — the
// single implementation of the REFUND_TIERS logic (config/policy.php), used
// by reservations/request_refund.php. Pulled out into its own file for the
// same reason config/remittance.php's creditRemittanceSplit() is its own
// file — one place, reused, rather than re-derived per caller.
//
// No post-booking grace period — a cancellation is judged purely on how far
// before departure/booked-time it happens, per REFUND_TIERS. (An earlier
// version of this policy had a 30-minute "cancel right after booking always
// refunds 100%" override; it was removed on request, along with the 0%
// floor tier — see config/policy.php's own comment on REFUND_TIERS.)

require_once __DIR__ . "/policy.php";

// Returns ["pct" => float (1.00 | 0.50), "reason" => string] for a
// cancellation happening right now against a reservation departing/booked
// for $departure_time. $created_at (the booking time) is accepted for call-
// site compatibility but no longer affects the outcome. Always compares
// against the DB clock (SELECT NOW()), never PHP's time()/date() — mixing
// PHP's Europe/Berlin-configured clock with a raw MySQL datetime string via
// strtotime() produces a multi-hour skew (see board_reservation.php).
function computeRefundOutcome($conn, $vehicle_category, $created_at, $departure_time) {
    $db_now = $conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"];
    $now_ts = strtotime($db_now);
    $dep_ts = strtotime($departure_time);

    $hours_before_departure = ($dep_ts - $now_ts) / 3600;
    $tiers = REFUND_TIERS[$vehicle_category] ?? REFUND_TIERS["UV Express"];

    foreach ($tiers as $tier) {
        if ($hours_before_departure >= $tier["hours"]) {
            $pctLabel = (int)round($tier["pct"] * 100);
            return [
                "pct"    => $tier["pct"],
                "reason" => "{$tier['hours']}+ hours before departure ({$pctLabel}% tier)",
            ];
        }
    }

    // Unreachable as long as every REFUND_TIERS list ends with "hours" => 0,
    // but stay safe rather than returning null. Matches the tier list's own
    // floor (50%), never 0% — there is no 0% outcome in this policy.
    return ["pct" => 0.50, "reason" => "inside the minimum refund window"];
}
