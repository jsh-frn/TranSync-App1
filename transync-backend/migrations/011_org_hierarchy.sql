-- Run once against the `transync` database.
-- Restructures the operator/association/driver hierarchy into a strict
-- two-hop chain: Operator applies to Association (fleet-level, no specific
-- driver/vehicle subject, no route needed); Driver applies to Operator
-- (drivers now self-register instead of being created only by an operator).
-- A driver's association affiliation becomes transitive: driver -> operator
-- -> association (see operators.association_id), not a separate per-driver
-- application to the association directly. The old subject-polymorphic
-- association_applications/association_memberships tables (driver/vehicle
-- applying straight to an association) are superseded by this for the
-- purpose of org-hierarchy membership and are left in place, unused by new
-- code, rather than dropped (no destructive change to historical rows).

-- ── Operator -> Association (fleet-level) ─────────────────────────────────────
ALTER TABLE operators
  ADD COLUMN association_id INT NULL AFTER operator_type;

ALTER TABLE operators
  ADD CONSTRAINT fk_operator_association FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE SET NULL,
  ADD INDEX idx_operator_association (association_id);

CREATE TABLE operator_association_applications (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    operator_id       INT NOT NULL,
    association_id    INT NOT NULL,
    status            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    rejection_reason  VARCHAR(255) NULL,
    reviewed_at       TIMESTAMP NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operator_id)    REFERENCES operators(id)    ON DELETE CASCADE,
    FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE CASCADE,
    INDEX idx_opassoc_operator    (operator_id, status),
    INDEX idx_opassoc_association (association_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Driver -> Operator ─────────────────────────────────────────────────────────
-- Drivers now self-register (see driver_register.php) instead of being
-- created only by an operator, so operator_id starts unassigned.
ALTER TABLE drivers
  MODIFY operator_id INT NULL;

CREATE TABLE driver_operator_applications (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    driver_id         INT NOT NULL,
    operator_id       INT NOT NULL,
    status            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    rejection_reason  VARCHAR(255) NULL,
    reviewed_at       TIMESTAMP NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id)   REFERENCES drivers(id)   ON DELETE CASCADE,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
    INDEX idx_drvop_driver   (driver_id, status),
    INDEX idx_drvop_operator (operator_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
