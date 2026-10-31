-- Run this in phpMyAdmin or MySQL CLI against the `transync` database
-- Tracks PayMongo sources to prevent double-crediting wallets

CREATE TABLE IF NOT EXISTS `paymongo_sources` (
    `id`           INT AUTO_INCREMENT PRIMARY KEY,
    `source_id`    VARCHAR(255) NOT NULL UNIQUE COMMENT 'PayMongo source ID (src_...)',
    `commuter_id`  INT NOT NULL,
    `amount`       DECIMAL(10,2) NOT NULL,
    `method`       ENUM('gcash', 'paymaya') NOT NULL,
    `payment_id`   VARCHAR(255) DEFAULT NULL COMMENT 'PayMongo payment ID set after successful charge',
    `status`       ENUM('pending', 'credited', 'failed') NOT NULL DEFAULT 'pending',
    `created_at`   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`commuter_id`) REFERENCES `commuters`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
