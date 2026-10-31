-- Run this in phpMyAdmin or MySQL CLI against the `transync` database
-- Lets an operator attach their own descriptive "details" blurb to an
-- association-owned Bus class (bus_service_types), without writing to that
-- association-owned table (Do Not Break rule #24). Purely additive overlay —
-- one row per (operator, class); different operators sharing the same
-- association class can word their own details independently.

CREATE TABLE IF NOT EXISTS operator_class_details (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    operator_id     INT NOT NULL,
    service_type_id INT NOT NULL,
    details         TEXT NULL,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_operator_class (operator_id, service_type_id),
    FOREIGN KEY (operator_id)     REFERENCES operators(id)         ON DELETE CASCADE,
    FOREIGN KEY (service_type_id) REFERENCES bus_service_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
