-- Run this in phpMyAdmin or MySQL CLI against the `transync` database
-- Vehicle Management module (generic vehicle_number for all 3 types) + full
-- Seat Layout Builder/Library. This intentionally supersedes Do Not Break
-- rule #26's silent-reuse-by-(operator,class,capacity)-key design: the new
-- model is a named, explicit Seat Layout Library the operator picks from,
-- and applying a template makes an independent copy (see CLAUDE.md update).

-- Generic vehicle-number field for all 3 types (additive; existing bus_number
-- stays, deprecated in place — same convention as operator_type/association_id).
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(50) NULL AFTER plate_number;

-- Bring the pre-existing (migration-untracked) `seats` table under tracking,
-- widen seat_type for driver/conductor seats, and add the operator-blocked
-- ("Reserved/Saved", yellow) state.
CREATE TABLE IF NOT EXISTS seats (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id   INT NOT NULL,
    seat_label   VARCHAR(10) NOT NULL,
    seat_row     INT NOT NULL,
    seat_col     INT NOT NULL,
    seat_type    ENUM('window','aisle','sleeper','driver','conductor') NOT NULL DEFAULT 'window',
    is_blocked   TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
    UNIQUE KEY unique_vehicle_seat (vehicle_id, seat_label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- In case `seats` already existed (pre-migrations base schema) without these —
-- on this project's actual DB it did, and lacked the uniqueness constraint
-- entirely (CREATE TABLE IF NOT EXISTS above is a no-op against an existing
-- table), which let save_seat_layout.php's upsert silently duplicate rows
-- instead of updating them. Add it explicitly and idempotently:
ALTER TABLE seats ADD COLUMN IF NOT EXISTS is_blocked TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE seats MODIFY COLUMN seat_type ENUM('window','aisle','sleeper','driver','conductor') NOT NULL DEFAULT 'window';
DELETE s1 FROM seats s1 INNER JOIN seats s2
    ON s1.vehicle_id = s2.vehicle_id AND s1.seat_label = s2.seat_label AND s1.id < s2.id;
ALTER TABLE seats ADD UNIQUE INDEX IF NOT EXISTS unique_vehicle_seat (vehicle_id, seat_label);

-- Seat Layout Library: named, explicit templates the operator picks from,
-- instead of silent reuse by exact (operator, class, capacity) key.
ALTER TABLE bus_layout_templates ADD COLUMN IF NOT EXISTS name VARCHAR(100) NULL AFTER service_type_id;
-- The composite unique key also backs both FK constraints (operator_id,
-- service_type_id) — add standalone indexes for those first so MariaDB will
-- allow dropping it.
ALTER TABLE bus_layout_templates ADD INDEX IF NOT EXISTS idx_blt_operator (operator_id);
ALTER TABLE bus_layout_templates ADD INDEX IF NOT EXISTS idx_blt_service_type (service_type_id);
ALTER TABLE bus_layout_templates DROP INDEX IF EXISTS unique_operator_class_capacity;

CREATE TABLE IF NOT EXISTS bus_layout_template_seats (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    template_id  INT NOT NULL,
    seat_label   VARCHAR(10) NOT NULL,
    seat_row     INT NOT NULL,
    seat_col     INT NOT NULL,
    seat_type    ENUM('window','aisle','sleeper','driver','conductor') NOT NULL DEFAULT 'window',
    FOREIGN KEY (template_id) REFERENCES bus_layout_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
