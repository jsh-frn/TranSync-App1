-- Run once against the `transync` database.
-- Corrects course from migration 018's remittance submit/review model, which
-- was wrong: the operator's and system's cut must credit automatically at
-- boarding scan (see config/remittance.php), same as the driver's — there is
-- no manual submission/approval step. Also adds the new late-cancellation
-- forfeiture path and the Jeepney driver subscription feature.

-- ── Drop the superseded submit/review remittance machinery ──────────────────
ALTER TABLE reservations DROP FOREIGN KEY fk_res_remittance_submission;
ALTER TABLE reservations DROP COLUMN remittance_submission_id;
ALTER TABLE reservations DROP COLUMN remittance_status;
DROP TABLE remittance_submissions;

-- ── New cancellation_type: a commuter who cancels after the refund cutoff
-- but before departure gets no refund — the fare is distributed to the
-- driver/operator/system via the normal split instead (see cancel_late.php).
ALTER TABLE reservations
  MODIFY COLUMN cancellation_type ENUM('refunded','rebooked','operator_cancelled','no_show','late_cancelled') NULL;

-- ── Jeepney driver subscription: system revenue separate from the operator's
-- quota cut. Single global admin-tunable rate (not per-operator/per-tier).
CREATE TABLE subscription_rates (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    frequency    ENUM('weekly','monthly') NOT NULL DEFAULT 'monthly',
    amount       DECIMAL(10,2) NOT NULL,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO subscription_rates (frequency, amount) VALUES ('monthly', 199.00);

CREATE TABLE subscription_payments (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    driver_id    INT NOT NULL,
    amount       DECIMAL(10,2) NOT NULL,
    frequency    ENUM('weekly','monthly') NOT NULL,
    period_start DATE NOT NULL,
    period_end   DATE NOT NULL,
    paid_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE wallet_transactions
  MODIFY COLUMN reference_type ENUM('jeepney_ride','booking','topup','refund','quota_submission','quota_refund','quota_cashout','rebooking_fee','remittance_fee','withdrawal','subscription') NOT NULL;
