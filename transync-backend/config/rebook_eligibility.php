<?php
// Shared eligibility rules for the rebooking feature (see
// api/reservations/request_rebook.php, operator_review_rebook.php,
// complete_rebook.php). A reservation is eligible to request/hold a rebook
// while EITHER:
//   - it's still boarding_status='reserved' and hasn't departed yet
//     (proactive — "I know I can't make it", no cutoff), OR
//   - it's boarding_status='no_show' but within NO_SHOW_REBOOK_REQUEST_GRACE_HOURS
//     of the moment it was swept (reactive — "I missed it, give me a chance").
// Always compares against the DB's own NOW(), never PHP time()/date() — see
// the PHP/MySQL clock mismatch note elsewhere in this codebase.

require_once __DIR__ . "/policy.php";

function isRebookEligible($conn, array $res): bool {
    $db_now_ts = strtotime($conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"]);

    if ($res["boarding_status"] === "reserved") {
        return isset($res["departure_time"]) && strtotime($res["departure_time"]) > $db_now_ts;
    }

    if ($res["boarding_status"] === "no_show" && !empty($res["resolved_at"])) {
        return $db_now_ts <= strtotime($res["resolved_at"]) + NO_SHOW_REBOOK_REQUEST_GRACE_HOURS * 3600;
    }

    return false;
}

// Opportunistic, no-cron sweep (matches sweepDepartedReservations()'s own
// pattern, config/sweep.php) — flips any 'pending' or 'approved' request
// whose underlying reservation no longer satisfies isRebookEligible() to
// 'expired'. A request can go stale in EITHER status: a 'pending' one if
// nobody reviews it in time, an 'approved' one if the commuter sits on it
// past their own booking's eligibility window (e.g. the no-show grace
// period runs out before they pick a new trip).
function expireStaleRebookRequests($conn): int {
    $rows = $conn->query("
        SELECT rr.id, r.boarding_status, r.departure_time, r.resolved_at
        FROM rebook_requests rr
        JOIN reservations r ON r.id = rr.reservation_id
        WHERE rr.status IN ('pending', 'approved')
    ")->fetch_all(MYSQLI_ASSOC);

    $expired = 0;
    foreach ($rows as $row) {
        if (!isRebookEligible($conn, $row)) {
            $stmt = $conn->prepare("
                UPDATE rebook_requests
                SET status = 'expired', resolved_at = NOW()
                WHERE id = ? AND status IN ('pending', 'approved')
            ");
            $stmt->bind_param("i", $row["id"]);
            $stmt->execute();
            $expired += $stmt->affected_rows;
            $stmt->close();
        }
    }
    return $expired;
}
