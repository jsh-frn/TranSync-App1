-- Run this script once against the `transync` database.
-- Creates the driver quota assignment and submission tables.

USE transync;

-- Operator assigns a quota target to each of their drivers
CREATE TABLE IF NOT EXISTS driver_quotas (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    operator_id INT            NOT NULL,
    driver_id   INT            NOT NULL,
    amount      DECIMAL(10,2)  NOT NULL,
    frequency   ENUM('daily','weekly') NOT NULL DEFAULT 'daily',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_driver_quota (driver_id),
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
    FOREIGN KEY (driver_id)   REFERENCES drivers(id)   ON DELETE CASCADE
);

-- Driver submits their quota remittance; operator confirms receipt
CREATE TABLE IF NOT EXISTS quota_submissions (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    driver_id    INT            NOT NULL,
    operator_id  INT            NOT NULL,
    amount       DECIMAL(10,2)  NOT NULL,
    period_type  ENUM('daily','weekly') NOT NULL,
    status       ENUM('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
    note         TEXT,
    submitted_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at    TIMESTAMP NULL,
    cashed_out_at  TIMESTAMP NULL,
    FOREIGN KEY (driver_id)   REFERENCES drivers(id)   ON DELETE CASCADE,
    FOREIGN KEY (operator_id) REFERENCES operators(id)  ON DELETE CASCADE
);

-- If tables were already created without cashed_out_at, run this:
-- ALTER TABLE quota_submissions ADD COLUMN cashed_out_at TIMESTAMP NULL DEFAULT NULL;
