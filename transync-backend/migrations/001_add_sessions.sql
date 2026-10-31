-- Run once against the `transync` database.
-- Creates the sessions table used by config/auth.php for token-based authentication.

CREATE TABLE IF NOT EXISTS sessions (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token      CHAR(64)        NOT NULL,
    owner_type ENUM('commuter','driver','operator','association','admin') NOT NULL,
    owner_id   INT UNSIGNED    NOT NULL,
    expires_at DATETIME        NOT NULL,
    created_at DATETIME        DEFAULT NOW(),
    UNIQUE KEY uk_token  (token),
    KEY        idx_owner (owner_type, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
