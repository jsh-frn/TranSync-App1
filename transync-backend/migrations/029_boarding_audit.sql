-- Run once against the `transync` database.
-- Structured audit trail for the driver discount-override scanner (Core Flow 16).
-- The scanner/toggle/accept-decline-grant/cashback logic (migration 021) already
-- works end-to-end — this only adds queryable columns for *who* scanned a
-- reservation and *what* was decided, which previously existed only as
-- free-text notes on wallet_transactions rows (discount_surcharge/discount_cashback),
-- not attributable to a driver or reconstructable without diffing discount_type.

ALTER TABLE reservations
  ADD COLUMN boarding_driver_id INT NULL AFTER boarded_at,
  ADD COLUMN discount_decision  ENUM('keep','decline','grant') NULL AFTER boarding_driver_id,
  ADD COLUMN discount_source    ENUM('system','physical_id')   NULL AFTER discount_decision;

-- boarding_driver_id is set on every successful board_reservation.php scan
-- (not just discount-adjusted ones) — general "which driver boarded this"
-- audit data, independent of the discount feature.
--
-- discount_decision records the driver's explicit choice at scan time
-- ('keep' = no override attempted, 'decline' = surcharge charged,
-- 'grant' = cashback credited) — every scan sets this, since board_reservation.php
-- already always passes a decision (defaulting to "keep").
--
-- discount_source records the provenance of whatever discount is applied to
-- the reservation *after* boarding: 'system' when the discount was already
-- verified at booking time and kept as-is, 'physical_id' when a driver
-- granted it at boarding after the commuter showed a physical ID, and NULL
-- when no discount applies (booked at default fare, or declined at boarding).
ALTER TABLE reservations
  ADD CONSTRAINT fk_res_boarding_driver FOREIGN KEY (boarding_driver_id) REFERENCES drivers(id) ON DELETE SET NULL,
  ADD INDEX idx_res_boarding_driver (boarding_driver_id);
