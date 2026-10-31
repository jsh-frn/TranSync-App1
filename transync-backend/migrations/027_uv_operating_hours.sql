-- Run once against the `transync` database.
-- Association-defined daily operating window per UV Express route (start of
-- operations -> end of operations). Simpler than bus_schedules — no
-- recurrence, just one daily start/end time-of-day; a missing or inactive
-- row means "no restriction" for that route.

CREATE TABLE uv_operating_hours (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    association_id  INT NOT NULL,
    route_id        INT NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_route_hours (route_id),
    FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
