-- Run once against the `transync` database.
-- Extends withdrawal_requests (previously operator-only, migration 013/031)
-- to also support driver-initiated withdrawals, so Bus/UV Express/Jeepney
-- drivers alike can withdraw from their own wallet_balance the same way an
-- operator withdraws from theirs.
--
-- A driver's wallet_balance stays a single flat column (drivers.wallet_balance,
-- unchanged) — unlike an operator, a driver can only ever be assigned to one
-- vehicle/operator/association at a time, so there is no "multiple
-- simultaneous associations" problem to split a balance across the way
-- migration 031 had to for operators. association_id on a driver's
-- withdrawal_requests/wallet_transactions row is captured purely for
-- record-keeping context (which association the driver was actively
-- working under at request time, derived live from
-- drivers.vehicle_id -> vehicles.association_id) — it never selects between
-- multiple balances the way it does for operators.
--
-- owner_type discriminates which of operator_id/driver_id is populated.
-- operator_id is relaxed to nullable; existing rows are all operator-owned
-- and get owner_type='operator' by the column default, so no backfill UPDATE
-- is needed.

ALTER TABLE withdrawal_requests
  ADD COLUMN owner_type ENUM('operator','driver') NOT NULL DEFAULT 'operator' AFTER id,
  MODIFY COLUMN operator_id INT NULL,
  ADD COLUMN driver_id INT NULL AFTER operator_id,
  ADD CONSTRAINT fk_withdrawal_requests_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
