-- Run this in phpMyAdmin or MySQL CLI against the `transync` database
-- Splits Bus (schedule-based) and UV Express (queue-based) booking from the
-- old flat Route+manual-time reservation flow.

-- ── Bus schedule instances ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    route_id       INT NOT NULL,
    operator_id    INT NOT NULL,
    vehicle_id     INT NOT NULL,
    driver_id      INT NOT NULL,
    departure_time DATETIME NOT NULL,
    fare_override  DECIMAL(10,2) NULL,
    capacity       INT NOT NULL,
    seats_booked   INT NOT NULL DEFAULT 0,
    status         ENUM('scheduled','boarding','departed','completed','cancelled') NOT NULL DEFAULT 'scheduled',
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (route_id)    REFERENCES routes(id)    ON DELETE CASCADE,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id)  REFERENCES vehicles(id)  ON DELETE CASCADE,
    FOREIGN KEY (driver_id)   REFERENCES drivers(id)   ON DELETE CASCADE,
    INDEX idx_trips_route_dep (route_id, departure_time),
    INDEX idx_trips_status    (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── UV Express live availability sessions ────────────────────────────────
CREATE TABLE IF NOT EXISTS uv_sessions (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    driver_id    INT NOT NULL,
    vehicle_id   INT NOT NULL,
    route_id     INT NOT NULL,
    operator_id  INT NOT NULL,
    capacity     INT NOT NULL,
    seats_booked INT NOT NULL DEFAULT 0,
    status       ENUM('open','full','departed','cancelled') NOT NULL DEFAULT 'open',
    started_at   DATETIME NOT NULL,
    ended_at     DATETIME NULL,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id)   REFERENCES drivers(id)   ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id)  REFERENCES vehicles(id)  ON DELETE CASCADE,
    FOREIGN KEY (route_id)    REFERENCES routes(id)    ON DELETE CASCADE,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
    INDEX idx_uv_status (status),
    INDEX idx_uv_driver (driver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── vehicles: real seat capacity, backfilled from seat_config ────────────
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS capacity INT NULL AFTER seat_config;

UPDATE vehicles SET capacity = CASE seat_config
    WHEN 'uv_standard' THEN 10
    WHEN 'uv_mini'     THEN 7
    WHEN '2x2'         THEN 10
    WHEN '2x3'         THEN 20
    ELSE 20
END WHERE capacity IS NULL;

-- ── reservations: free `trip_id` for a real FK, add booking/QR fields ────
-- (safe to skip if already renamed on a previous run)
ALTER TABLE reservations CHANGE trip_id legacy_trip_ref VARCHAR(50) NULL;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS trip_id         INT NULL AFTER route_id,
  ADD COLUMN IF NOT EXISTS uv_session_id   INT NULL AFTER trip_id,
  ADD COLUMN IF NOT EXISTS queue_number    INT NULL AFTER uv_session_id,
  ADD COLUMN IF NOT EXISTS discount_type   VARCHAR(20) NULL AFTER fare_amount,
  ADD COLUMN IF NOT EXISTS boarding_status ENUM('reserved','boarded','completed','no_show','cancelled') NOT NULL DEFAULT 'reserved' AFTER status,
  ADD COLUMN IF NOT EXISTS boarded_at      DATETIME NULL AFTER boarding_status;

ALTER TABLE reservations
  ADD CONSTRAINT fk_res_trip FOREIGN KEY (trip_id)       REFERENCES trips(id)       ON DELETE SET NULL,
  ADD CONSTRAINT fk_res_uv   FOREIGN KEY (uv_session_id) REFERENCES uv_sessions(id) ON DELETE SET NULL,
  ADD INDEX idx_res_trip (trip_id),
  ADD INDEX idx_res_uv   (uv_session_id);
