-- Run once against the `transync` database.
-- (1) Bus trip scheduling moves to the association: a recurring schedule
--     template (route + class + boarding/departure time + recurrence), with
--     an operator still committing their own vehicle+driver per date.
-- (2) Operator remittance cut becomes a per-operator toggle: Quota (manual,
--     unchanged) or Percentage (operator sets their own automatic rate).
--     The system's cut becomes a flat, non-operator-overridable 5%.
-- (3) Subscription gains a 'daily' frequency and calendar-aligned periods.

-- ── Association-owned recurring Bus schedule ────────────────────────────────
CREATE TABLE bus_schedules (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    association_id   INT NOT NULL,
    route_id         INT NOT NULL,
    service_type_id  INT NOT NULL,
    boarding_time    TIME NOT NULL,
    departure_time   TIME NOT NULL,
    recurrence_type  ENUM('daily','weekly') NOT NULL DEFAULT 'daily',
    weekdays         VARCHAR(20) NULL COMMENT '0=Sun..6=Sat, comma-separated; only used when recurrence_type=weekly',
    status           ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
    FOREIGN KEY (service_type_id) REFERENCES bus_service_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE trips ADD COLUMN schedule_id INT NULL AFTER route_id;
ALTER TABLE trips ADD COLUMN boarding_time DATETIME NULL AFTER schedule_id;
ALTER TABLE trips ADD CONSTRAINT fk_trips_schedule FOREIGN KEY (schedule_id) REFERENCES bus_schedules(id) ON DELETE SET NULL;

-- ── Operator remittance mode (Quota vs Percentage) ──────────────────────────
ALTER TABLE operators
  ADD COLUMN remittance_mode ENUM('quota','percentage') NOT NULL DEFAULT 'percentage' AFTER wallet_balance,
  ADD COLUMN operator_fee_pct DECIMAL(5,2) NULL AFTER remittance_mode;

UPDATE remittance_rates SET system_fee_pct = 5.00 WHERE scope = 'default';

-- ── Subscription: daily frequency ───────────────────────────────────────────
ALTER TABLE subscription_rates MODIFY COLUMN frequency ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'monthly';
ALTER TABLE subscription_payments MODIFY COLUMN frequency ENUM('daily','weekly','monthly') NOT NULL;
