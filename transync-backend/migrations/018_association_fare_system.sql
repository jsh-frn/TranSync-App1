-- Run once against the `transync` database.
-- Moves the Bus service/class catalog (Ordinary/Deluxe/Royal) from operator
-- ownership to association ownership, adds reusable seat-layout templates
-- (seater/sleeper, keyed by operator+class+seat count so it's only built once
-- per combination), and turns Bus/UV Express remittance from an automatic
-- per-boarding wallet credit into a submit-then-admin-review flow — the
-- driver's share still credits instantly, only the operator/system cut waits.

-- ── Service/class catalog moves to the association ─────────────────────────
-- operator_id is kept (nullable) as a legacy column — no longer written by
-- any current code path, matching this project's existing convention for
-- superseded ownership columns (see drivers.association_id).
ALTER TABLE bus_service_types MODIFY COLUMN operator_id INT NULL;
ALTER TABLE bus_service_types ADD COLUMN association_id INT NULL AFTER operator_id;
ALTER TABLE bus_service_types ADD INDEX idx_bst_operator_id (operator_id);
ALTER TABLE bus_service_types ADD CONSTRAINT fk_bst_association FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE CASCADE;
ALTER TABLE bus_service_types ADD UNIQUE KEY unique_association_service_name (association_id, name);
ALTER TABLE bus_service_types DROP INDEX unique_operator_service_name;

-- ── Reusable Bus seat-layout templates ──────────────────────────────────────
-- Built once per (operator, class, seat count) the first time an operator
-- generates a seat map for that combination; every later vehicle with the
-- same class + seat count reuses it automatically instead of re-asking.
CREATE TABLE bus_layout_templates (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    operator_id      INT NOT NULL,
    service_type_id  INT NOT NULL,
    capacity         INT NOT NULL,
    layout_style     ENUM('seater','sleeper') NOT NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
    FOREIGN KEY (service_type_id) REFERENCES bus_service_types(id) ON DELETE CASCADE,
    UNIQUE KEY unique_operator_class_capacity (operator_id, service_type_id, capacity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Bus/UV remittance: submit → admin review → credit ──────────────────────
-- Driver's net share still credits at boarding scan (unchanged). The
-- operator's cut and the system's cut now accumulate as 'pending' instead of
-- crediting instantly; the operator submits a batch and an admin confirms it.
CREATE TABLE remittance_submissions (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    operator_id         INT NOT NULL,
    vehicle_type        ENUM('Bus','UV Express') NOT NULL,
    reservation_count   INT NOT NULL,
    total_operator_fee  DECIMAL(10,2) NOT NULL,
    total_system_fee    DECIMAL(10,2) NOT NULL,
    status              ENUM('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
    rejection_reason    VARCHAR(255) NULL,
    submitted_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at         TIMESTAMP NULL,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE reservations
  ADD COLUMN remittance_status ENUM('pending','submitted','confirmed') NOT NULL DEFAULT 'pending' AFTER driver_net_amount,
  ADD COLUMN remittance_submission_id INT NULL AFTER remittance_status,
  ADD CONSTRAINT fk_res_remittance_submission FOREIGN KEY (remittance_submission_id) REFERENCES remittance_submissions(id) ON DELETE SET NULL;
