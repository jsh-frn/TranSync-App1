-- Migration 050: Tiered refund policy (Bus/UV Express)
--
-- Supersedes the old binary "full refund before cutoff / zero refund after"
-- policy (REFUND_CUTOFF_HOURS, migrations 009/019) with a tiered percentage
-- schedule (100% / 50% / 0%) plus a flat 30-minute post-booking grace period
-- that always yields 100% regardless of what the departure-based tier would
-- otherwise say. See config/policy.php's REFUND_TIERS /
-- POST_BOOKING_REFUND_GRACE_MINUTES and config/refund.php's
-- computeRefundOutcome().
--
-- reservations.refund_amount / refund_pct record exactly what was actually
-- credited back to the commuter on a 'refunded' cancellation (100% or 50%),
-- mirroring this schema's existing convention of storing the real settled
-- amount rather than recomputing it later from a policy value that could
-- change (system_fee_amount/operator_fee_amount/driver_net_amount/
-- rebooking_fee_amount all follow the same pattern). NULL for a cancellation
-- that wasn't a refund at all (late_cancelled/no_show).
ALTER TABLE reservations
  ADD COLUMN refund_amount DECIMAL(10,2) NULL AFTER cancellation_type,
  ADD COLUMN refund_pct DECIMAL(5,2) NULL AFTER refund_amount;
