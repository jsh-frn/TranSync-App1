-- Run once against the `transync` database.
-- Driver/operator/system remittance for Bus & UV Express (percentage split at
-- the boarding-scan payout), a capacity-tiered flat quota default for
-- Jeepney (no online payment to take a percentage of), and an operator
-- withdrawal request flow for accumulated wallet_balance.

-- ── Bus/UV Express: percentage split, tunable per-operator ────────────────────
CREATE TABLE remittance_rates (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    scope             ENUM('default','operator_override') NOT NULL DEFAULT 'default',
    operator_id       INT NULL,
    vehicle_type      ENUM('Bus','UV Express') NOT NULL,
    system_fee_pct    DECIMAL(5,2) NOT NULL,
    operator_fee_pct  DECIMAL(5,2) NOT NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
    UNIQUE KEY unique_default_rate (scope, vehicle_type, operator_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO remittance_rates (scope, operator_id, vehicle_type, system_fee_pct, operator_fee_pct) VALUES
    ('default', NULL, 'Bus',        3.00, 7.00),
    ('default', NULL, 'UV Express', 3.00, 7.00);

ALTER TABLE reservations
  ADD COLUMN system_fee_amount   DECIMAL(10,2) NULL AFTER payment_status,
  ADD COLUMN operator_fee_amount DECIMAL(10,2) NULL AFTER system_fee_amount,
  ADD COLUMN driver_net_amount   DECIMAL(10,2) NULL AFTER operator_fee_amount;

-- ── Jeepney: flat quota tiered by vehicle capacity ─────────────────────────────
CREATE TABLE jeepney_quota_tiers (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    min_capacity  INT NOT NULL,
    max_capacity  INT NOT NULL,
    quota_amount  DECIMAL(10,2) NOT NULL,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO jeepney_quota_tiers (min_capacity, max_capacity, quota_amount) VALUES
    (12, 15,  700.00),
    (16, 19,  900.00),
    (20, 23, 1100.00),
    (24, 27, 1300.00),
    (28, 32, 1500.00);

-- ── Operator wallet withdrawal ─────────────────────────────────────────────────
CREATE TABLE withdrawal_requests (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    operator_id   INT NOT NULL,
    amount        DECIMAL(10,2) NOT NULL,
    status        ENUM('pending','paid','rejected') NOT NULL DEFAULT 'pending',
    requested_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at   TIMESTAMP NULL,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Ledger extensions to represent the system's own cut and withdrawals ──────
ALTER TABLE wallet_transactions
  MODIFY COLUMN owner_type ENUM('commuter','driver','operator','system') NOT NULL,
  MODIFY COLUMN reference_type ENUM('jeepney_ride','booking','topup','refund','quota_submission','quota_refund','quota_cashout','rebooking_fee','remittance_fee','withdrawal') NOT NULL;
