-- Run once against the `transync` database.
-- Adds wallet support for operators so quota cash-outs can be credited,
-- and extends wallet_transactions enums to support quota reference/owner types.
-- Without this, owner_type='operator' and reference_type='quota_submission' /
-- 'quota_refund' / 'quota_cashout' inserts get silently truncated to '' by MySQL
-- (this DB does not run in STRICT_TRANS_TABLES mode).

ALTER TABLE operators
    ADD COLUMN wallet_balance DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER status;

ALTER TABLE wallet_transactions
    MODIFY COLUMN owner_type ENUM('commuter','driver','operator') NOT NULL;

ALTER TABLE wallet_transactions
    MODIFY COLUMN reference_type ENUM('jeepney_ride','booking','topup','refund','quota_submission','quota_refund','quota_cashout') NOT NULL;

-- Repair rows corrupted before this migration existed (reference_type silently
-- truncated to '' because 'quota_submission' wasn't yet a valid enum value).
UPDATE wallet_transactions
SET reference_type = 'quota_submission'
WHERE reference_type = '' AND note = 'Quota remittance';
