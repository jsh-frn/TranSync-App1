-- Run once against the `transync` database.
-- Adds cancellation tracking for the new refund/rebooking policy:
-- refunds are only allowed 24h+ before departure; inside that window a
-- passenger can rebook (pay a 10% surcharge, no refund) instead. The two
-- outcomes are mutually exclusive per reservation, hence the linked FKs.

ALTER TABLE reservations
  ADD COLUMN cancellation_type ENUM('refunded','rebooked','operator_cancelled','no_show') NULL AFTER boarding_status,
  ADD COLUMN rebooked_from_reservation_id INT NULL AFTER cancellation_type,
  ADD COLUMN rebooked_to_reservation_id   INT NULL AFTER rebooked_from_reservation_id;

ALTER TABLE reservations
  ADD CONSTRAINT fk_res_rebook_from FOREIGN KEY (rebooked_from_reservation_id) REFERENCES reservations(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_res_rebook_to   FOREIGN KEY (rebooked_to_reservation_id)   REFERENCES reservations(id) ON DELETE SET NULL;

ALTER TABLE wallet_transactions
  MODIFY COLUMN reference_type ENUM('jeepney_ride','booking','topup','refund','quota_submission','quota_refund','quota_cashout','rebooking_fee') NOT NULL;
