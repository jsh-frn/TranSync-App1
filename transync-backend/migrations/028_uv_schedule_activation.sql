-- Run once against the `transync` database.
-- UV Express scheduling moves to the same association-template model as Bus
-- (Core Flow 12a), but stays queue-based (no operator vehicle/driver
-- commitment, no per-slot capacity): the association's uv_operating_hours
-- row gains a recurrence (daily/specific days), an operator "activates" that
-- schedule for their own fleet instead of manually creating individual
-- uv_slots rows, and a commuter's chosen time auto-creates (or reuses) a
-- pooled, operator-agnostic uv_slots row the first time it's booked.

-- ── Recurrence on the association's UV operating-hours row (mirrors
-- bus_schedules.recurrence_type/weekdays) ──────────────────────────────────
ALTER TABLE uv_operating_hours
  ADD COLUMN recurrence_type ENUM('daily','weekly') NOT NULL DEFAULT 'daily' AFTER end_time,
  ADD COLUMN weekdays VARCHAR(20) NULL COMMENT '0=Sun..6=Sat, comma-separated; only used when recurrence_type=weekly' AFTER recurrence_type;

-- ── Operator's per-schedule activate/deactivate (multiple operators can
-- each independently activate the same association route's schedule) ──────
CREATE TABLE uv_schedule_activations (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    operator_id             INT NOT NULL,
    uv_operating_hours_id   INT NOT NULL,
    status                  ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_operator_schedule (operator_id, uv_operating_hours_id),
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
    FOREIGN KEY (uv_operating_hours_id) REFERENCES uv_operating_hours(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── uv_slots: no longer operator-created one at a time, so no single owning
-- operator or fixed capacity — a commuter-triggered slot is route-level and
-- pooled across every operator active on that route/time (whichever
-- dispatched driver gets there boards them), and uncapped (NULL = unbounded;
-- create_reservation.php's claim treats NULL as "no cap", never blocking on
-- seats_booked). Operator-created legacy rows keep their existing values —
-- this only widens the columns to allow NULL going forward. ────────────────
ALTER TABLE uv_slots
  MODIFY COLUMN operator_id INT NULL,
  MODIFY COLUMN capacity INT NULL;
