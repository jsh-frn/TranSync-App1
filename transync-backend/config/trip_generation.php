<?php
// Shared Bus trip generator — the "System" half of the Bus Trip workflow
// redesign's separation of responsibilities (Association defines recurring
// schedules → System generates trip instances → Operator assigns vehicle/
// driver/conductor → Commuter only sees fully-assigned, bookable trips).
//
// This codebase has no cron/scheduler infrastructure anywhere (confirmed —
// every time-based process runs synchronously inside a request, the same
// way config/sweep.php's sweepDepartedReservations() works). Generation
// follows that exact same lazy/opportunistic pattern: called from a normal
// request (bus_schedules.php on create/reactivate/edit, get_operator_trips.php
// on every operator page load) rather than a background job, and is safe to
// call repeatedly — each call only fills in whatever's still missing.

require_once __DIR__ . "/policy.php";

// Generates every still-missing pending_assignment trip for ONE schedule,
// from today through BUS_TRIP_GENERATION_WINDOW_DAYS ahead. Idempotent via
// a SELECT-before-INSERT check rather than a DB UNIQUE constraint — this
// database has pre-existing (schedule_id, departure_time) duplicate rows
// from before this redesign (the old one-trip-at-a-time flow never checked
// per-schedule-per-day uniqueness), so a hard constraint can't be added
// without touching that existing data, which this app never does silently.
// See migration 034's own comment for the full reasoning.
function generateTripsForSchedule($conn, array $schedule): int {
    if (($schedule["status"] ?? null) !== "active") return 0;

    // DB clock, not PHP's — same landmine as everywhere else in this app
    // (see the PHP/MySQL clock mismatch note in project docs). Mirrors
    // bus_trips/create_trip.php's own "next valid occurrence" computation
    // exactly, just applied across the whole window instead of stopping at
    // the first match.
    $db_now  = $conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"];
    $nowTs   = strtotime($db_now);
    $todayTs = strtotime(date("Y-m-d", $nowTs));

    $weekdaysAllowed = $schedule["recurrence_type"] === "weekly"
        ? array_map("intval", explode(",", (string)($schedule["weekdays"] ?? "")))
        : null; // null = every day (recurrence_type === 'daily')

    $boardingHms  = substr($schedule["boarding_time"], 0, 5);
    $departureHms = substr($schedule["departure_time"], 0, 5);

    $generated = 0;
    for ($i = 0; $i < BUS_TRIP_GENERATION_WINDOW_DAYS; $i++) {
        $dayTs = $todayTs + $i * 86400;
        // 0=Sun..6=Sat, matching this app's established weekdays convention.
        if ($weekdaysAllowed !== null && !in_array((int)date("w", $dayTs), $weekdaysAllowed, true)) {
            continue;
        }

        $date              = date("Y-m-d", $dayTs);
        $departure_time_dt = "{$date} {$departureHms}:00";
        $boarding_time_dt  = "{$date} {$boardingHms}:00";

        // Don't generate a placeholder for a moment that's already passed —
        // harmless either way, but wasteful and confusing in the operator's
        // pending-assignment list.
        if (strtotime($departure_time_dt) < $nowTs) continue;

        $stmt = $conn->prepare("SELECT id FROM trips WHERE schedule_id = ? AND departure_time = ? LIMIT 1");
        $stmt->bind_param("is", $schedule["id"], $departure_time_dt);
        $stmt->execute();
        $exists = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if ($exists) continue;

        $stmt = $conn->prepare("
            INSERT INTO trips (route_id, schedule_id, boarding_time, departure_time, status)
            VALUES (?, ?, ?, ?, 'pending_assignment')
        ");
        $stmt->bind_param("iiss", $schedule["route_id"], $schedule["id"], $boarding_time_dt, $departure_time_dt);
        $stmt->execute();
        $stmt->close();
        $generated++;
    }

    return $generated;
}

// Tops up every active schedule at once — the call this app actually makes
// from most trigger points (an association/operator screen doesn't know or
// care which one schedule might be short on generated days).
function generateTripsForAllActiveSchedules($conn): int {
    $schedules = $conn->query("SELECT * FROM bus_schedules WHERE status = 'active'")->fetch_all(MYSQLI_ASSOC);
    $total = 0;
    foreach ($schedules as $schedule) {
        $total += generateTripsForSchedule($conn, $schedule);
    }
    return $total;
}

// Moves any still-unassigned trip whose calendar DATE has already fully
// passed to 'cancelled' — reuses the existing trips.status terminal value
// (this trip never happened, no vehicle/driver/booking was ever attached to
// it) rather than adding a new 'expired' ENUM member for a state nothing
// else in this codebase needs to distinguish from a plain cancellation.
// Deliberately keyed on the whole DATE, not the exact departure_time — a
// 11pm trip is still manageable at 9am the same day (generateTripsForSchedule()
// above already refuses to generate anything whose exact time has already
// passed, which is the finer-grained same-day case; this sweep only ever
// catches trips left over from a PREVIOUS day that were never assigned).
// Runs entirely inside MySQL (CURDATE()) — no PHP time()/date() involved at
// all, so there's no PHP/MySQL clock-mismatch risk to reason about here.
// Same lazy/opportunistic pattern as the rest of this file — called from
// bus_trips/get_pending_trips.php, get_operator_trips.php, and
// associations/bus_schedules.php's GET.
function expirePastPendingTrips($conn): int {
    $conn->query("
        UPDATE trips
        SET status = 'cancelled'
        WHERE status = 'pending_assignment' AND DATE(departure_time) < CURDATE()
    ");
    return $conn->affected_rows;
}
