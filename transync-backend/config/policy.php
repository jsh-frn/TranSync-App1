<?php
// Centralized booking-policy constants — referenced by create_reservation.php,
// request_refund.php, cancel_late.php, operator_rebook.php, and the trip/slot
// listing endpoints so the numbers only ever live in one place.

const ADVANCE_BOOKING_HOURS = [
    "Bus"        => 24,
    "UV Express" => 24,
];

// Tiered refund schedule (simplified 2026-08-11 — dropped the 0% tier and
// the 30-minute post-booking grace period both) — a single threshold per
// vehicle type: 100% at or beyond it, 50% for any cancellation short of it,
// all the way up to departure. There is no cancellation timing that ever
// yields a 0% refund anymore — see computeRefundOutcome() in
// config/refund.php, the single implementation of this logic
// (reservations/request_refund.php is its only caller).
//
// Each vehicle type's list must stay sorted descending by "hours" — the
// first tier whose threshold the remaining time still satisfies wins, and
// the last tier's "hours" must stay 0 so every remaining-time value matches
// something (the floor tier).
//   Bus:        >=72h -> 100%, <72h -> 50% (never 0%)
//   UV Express: >=24h -> 100%, <24h -> 50% (never 0%)
const REFUND_TIERS = [
    "Bus" => [
        ["hours" => 72, "pct" => 1.00],
        ["hours" => 0,  "pct" => 0.50],
    ],
    "UV Express" => [
        ["hours" => 24, "pct" => 1.00],
        ["hours" => 0,  "pct" => 0.50],
    ],
];

const REBOOKING_SURCHARGE_PCT = 0.10;

// How long after a booking gets swept to no_show the commuter still has a
// chance to request a rebook ("give the commuter a chance") — measured from
// reservations.resolved_at (set by sweepDepartedReservations()), not
// departure_time. A proactive request while the booking is still 'reserved'
// has no cutoff at all; this constant only governs the after-the-fact
// no_show path. See config/rebook_eligibility.php.
const NO_SHOW_REBOOK_REQUEST_GRACE_HOURS = 24;

// How long after departure_time a booked QR can still be scanned. Differs by
// vehicle type: a Bus's fixed schedule/vehicle means less slack is needed
// than UV Express's queue-based rollover. Keyed by `reservations.vehicle_category`.
const QR_GRACE_MINUTES = [
    "Bus"        => 20,
    "UV Express" => 30,
];

// How many days ahead of today an Active bus_schedules row gets pre-generated
// into pending_assignment trips (config/trip_generation.php). Configurable in
// one place per the "configurable booking window (default: the next 30 days)"
// requirement — nothing else in this codebase hardcodes this number. Raised
// from 30 to 60 on request — must stay in lockstep with PENDING_WINDOW_DAYS
// in (operator)/trips.tsx, which caps how far the Pending Assignment date
// picker can navigate; if the two ever drift, the picker will let an
// operator select a date nothing was ever generated for (or stop short of
// a date that actually has trips waiting).
const BUS_TRIP_GENERATION_WINDOW_DAYS = 60;

// Current Terms & Conditions / Privacy Policy version accepted at
// registration (config/consent.php's recordConsent()) — bump either string
// to require every *new* registration to record acceptance of the updated
// version. Does not retroactively invalidate a past acceptance; that's what
// consent_acceptances' per-row terms_version/privacy_version is for. Must be
// kept in lockstep with TERMS_VERSION/PRIVACY_VERSION in
// src/constants/registrationTerms.ts on the mobile side, the same
// cross-language-constant convention already used for
// BUS_TRIP_GENERATION_WINDOW_DAYS/PENDING_WINDOW_DAYS above.
const CURRENT_TERMS_VERSION   = "1.0";
const CURRENT_PRIVACY_VERSION = "1.0";
