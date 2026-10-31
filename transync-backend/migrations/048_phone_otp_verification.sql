-- Migration 048: Phone OTP Verification
--
-- Adds phone OTP verification (via IPROG SMS, https://www.iprogsms.com/api/v1)
-- ahead of Commuter/Operator/Association self-registration (Driver is
-- excluded — driver accounts are operator-created, never self-service, see
-- Core Flow 15 / Do Not Break rule #15). The phone must be verified BEFORE
-- the account row is created — every self-registration endpoint checks this
-- table and rejects if the submitted phone has no recent, unconsumed
-- verification.
--
-- We deliberately do NOT store the OTP code itself anywhere in this table.
-- IPROG's own POST /otp/verify_otp endpoint is the sole source of truth for
-- whether a submitted code is correct (it tracks the code server-side,
-- keyed by phone_number) — this table only tracks whether a given phone
-- number has been confirmed recently enough (verified/verified_at), and
-- whether that confirmation has already been spent by a completed
-- registration (consumed_at), so it can't be reused to create a second
-- account within the same trust window.

CREATE TABLE IF NOT EXISTS phone_otp_verifications (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    phone_number     VARCHAR(20) NOT NULL,
    otp_requested_at DATETIME NOT NULL,
    expires_at       DATETIME NOT NULL,
    verified         TINYINT(1) NOT NULL DEFAULT 0,
    verified_at      DATETIME NULL,
    attempts         INT NOT NULL DEFAULT 0,
    consumed_at      DATETIME NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_phone_otp_phone_number (phone_number)
);
