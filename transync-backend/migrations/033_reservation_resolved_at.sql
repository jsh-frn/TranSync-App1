-- Run once against the `transync` database.
-- Adds a single timestamp marking when a reservation left the active/
-- reserved state (cancelled, refunded, forfeited via no-show, or completed).
-- No existing column captures this — `created_at` only marks booking time
-- and `boarded_at` (migration 029) only marks boarding time — so the
-- commuter-facing Recent Activity feed and Booking History screen have no
-- way to order or timestamp a "Booking Cancelled"/"Trip Completed" event.
--
-- Set at every place a reservation already transitions out of 'reserved':
-- reservations/request_refund.php, reservations/cancel_late.php,
-- config/sweep.php (no-show forfeiture, both Bus/legacy-UV and pooled-UV
-- branches), bus_trips/update_trip_status.php and
-- uv_slots/update_slot_status.php (complete / operator_cancelled / the
-- stranded-reserved-on-complete branch). Purely additive — no existing
-- column, endpoint, or behavior changes.

ALTER TABLE reservations
  ADD COLUMN resolved_at DATETIME NULL AFTER boarded_at;
