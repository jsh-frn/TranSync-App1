-- Run once against the `transync` database.
-- Makes the booking payment lifecycle explicit: today a commuter is debited at
-- booking time and the driver is credited only at boarding, but nothing tracks
-- that in-between "held" state, and an unboarded reservation silently
-- evaporates the money (no refund, no payout, no record). This adds the
-- state; who writes each transition:
--   held      -> default at booking (create_reservation.php)
--   released  -> board_reservation.php, on successful boarding
--   refunded  -> request_refund.php
--   forfeited -> Phase 3's post-departure grace-period sweep

ALTER TABLE reservations
  ADD COLUMN payment_status ENUM('held','released','refunded','forfeited') NOT NULL DEFAULT 'held' AFTER fare_amount,
  ADD INDEX idx_res_payment_status (payment_status);
