<?php
// Shared calendar-period boundary logic for the Jeepney driver platform
// subscription — used by drivers/subscription_status.php and
// drivers/pay_subscription.php so both always agree on "the current period".
//
// All boundaries are calendar-aligned (not a rolling window from an anchor
// date), matching the existing pattern in quota/get_driver_quota.php:
//   daily:   resets at midnight — period is [today, tomorrow)
//   weekly:  Monday-Sunday calendar week (WEEKDAY(NOW()) = 0..6, Mon..Sun)
//   monthly: 1st-to-end-of-month
// Computed entirely in MySQL (not PHP time()) to sidestep the documented
// PHP/MySQL clock-mismatch landmine.

function currentSubscriptionPeriod($conn, $frequency) {
    if ($frequency === "daily") {
        $sql = "SELECT CURDATE() AS period_start, DATE_ADD(CURDATE(), INTERVAL 1 DAY) AS period_end";
    } elseif ($frequency === "weekly") {
        $sql = "
            SELECT
                DATE_SUB(CURDATE(), INTERVAL WEEKDAY(NOW()) DAY) AS period_start,
                DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(NOW()) DAY), INTERVAL 7 DAY) AS period_end
        ";
    } else { // monthly
        $sql = "
            SELECT
                DATE_SUB(CURDATE(), INTERVAL DAYOFMONTH(CURDATE()) - 1 DAY) AS period_start,
                DATE_ADD(DATE_SUB(CURDATE(), INTERVAL DAYOFMONTH(CURDATE()) - 1 DAY), INTERVAL 1 MONTH) AS period_end
        ";
    }
    return $conn->query($sql)->fetch_assoc();
}
