-- Run once against the `transync` database.
-- Bus service types (Ordinary/Royal Class etc.), vehicle bus_number, and
-- per-service-type fares (reviving the previously-dead `fare_matrix` table).
-- Seat selection reuses the existing dead `seats` table and the existing
-- `reservations.seat_labels` column — no new columns needed for that part.

CREATE TABLE bus_service_types (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    operator_id INT NOT NULL,
    name        VARCHAR(50) NOT NULL,
    description VARCHAR(255) NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
    UNIQUE KEY unique_operator_service_name (operator_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE vehicles
  ADD COLUMN bus_number VARCHAR(20) NULL AFTER plate_number,
  ADD COLUMN service_type_id INT NULL AFTER bus_number,
  ADD CONSTRAINT fk_vehicle_service_type FOREIGN KEY (service_type_id) REFERENCES bus_service_types(id) ON DELETE SET NULL;

ALTER TABLE fare_matrix
  ADD COLUMN service_type_id INT NULL AFTER vehicle_type,
  ADD CONSTRAINT fk_farematrix_service_type FOREIGN KEY (service_type_id) REFERENCES bus_service_types(id) ON DELETE CASCADE;
