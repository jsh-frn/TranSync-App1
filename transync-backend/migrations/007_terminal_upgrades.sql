-- Run once against the `transync` database.
-- Adds a vehicle-type classification to terminals (a terminal can host multiple
-- routes, even of different types, but keeps one primary badge for map display),
-- a free-text description on routes, and a route_stopovers join table so a route can
-- reference other existing terminals it passes by along the way (not just its own
-- origin terminal).

ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS vehicle_type ENUM('Jeepney','UV Express','Bus') NULL AFTER terminal_name;

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS description TEXT NULL AFTER to_location;

CREATE TABLE IF NOT EXISTS route_stopovers (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    route_id    INT NOT NULL,
    terminal_id INT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (route_id)    REFERENCES routes(id)    ON DELETE CASCADE,
    FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE,
    INDEX idx_stopover_route (route_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
