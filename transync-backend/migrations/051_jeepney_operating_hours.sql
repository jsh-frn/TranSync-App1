-- Run once against the `transync` database.
-- Association-defined daily operating window per Jeepney route (start of
-- operations -> end of operations). Purely informational — unlike UV
-- Express's uv_operating_hours, nothing in the booking/dispatch flow reads
-- or enforces this (Jeepney has no scheduled-slot booking to gate — Core
-- Flow 4 is dormant). Commuters see it by tapping a jeepney driver marker
-- on the map; drivers see it on their Dispatch tab. A missing or inactive
-- row means "no hours published" for that route.

CREATE TABLE jeepney_operating_hours (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    association_id  INT NOT NULL,
    route_id        INT NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_jeepney_route_hours (route_id),
    FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
