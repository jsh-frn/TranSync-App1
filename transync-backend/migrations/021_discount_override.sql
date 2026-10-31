-- Driver QR-scan discount override (Bus/UV Express reservation boarding only).
-- base_fare_amount stores the pre-discount, pre-rounding fare so board_reservation.php
-- can reconstruct both the full and discounted fare exactly when a driver overrides
-- the discount at boarding time (grant a cashback, or decline with a surcharge).
ALTER TABLE reservations ADD COLUMN base_fare_amount DECIMAL(10,2) NULL AFTER fare_amount;

ALTER TABLE wallet_transactions MODIFY COLUMN reference_type ENUM(
  'jeepney_ride','booking','topup','refund','quota_submission','quota_refund','quota_cashout',
  'rebooking_fee','remittance_fee','withdrawal','subscription',
  'discount_surcharge','discount_cashback'
) NOT NULL;
