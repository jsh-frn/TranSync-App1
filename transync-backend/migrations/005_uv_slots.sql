-- Run once against the `transync` database.
-- Adds operator-defined same-day UV Express departure slots, distinct from
-- the driver-initiated live "go online" uv_sessions flow (which is untouched
-- and keeps running in parallel for walk-up bookings).
--
-- Slot reservations are not bound to a driver/vehicle at booking time --
-- UV drivers physically queue per route (dispatch_queue, extended below with
-- route_id) and whichever driver is currently 'dispatched' for that route
-- is authorized to board a slot's passengers. If that driver fills up and
-- ends their turn, the next queued driver inherits the remaining bookings.

CREATE TABLE IF NOT EXISTS uv_slots (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    route_id       INT NOT NULL,
    operator_id    INT NOT NULL,
    departure_time DATETIME NOT NULL,
    capacity       INT NOT NULL,
    seats_booked   INT NOT NULL DEFAULT 0,
    status         ENUM('scheduled','completed','cancelled') NOT NULL DEFAULT 'scheduled',
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (route_id)    REFERENCES routes(id)    ON DELETE CASCADE,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
    INDEX idx_slots_route_dep (route_id, departure_time),
    INDEX idx_slots_status    (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS uv_slot_id INT NULL AFTER uv_session_id;

ALTER TABLE reservations
  ADD CONSTRAINT fk_res_uv_slot FOREIGN KEY (uv_slot_id) REFERENCES uv_slots(id) ON DELETE SET NULL,
  ADD INDEX idx_res_uv_slot (uv_slot_id);

-- Route-scope the Jeepney dispatch queue so it can also serve UV Express
-- drivers per-route. NULL preserves existing Jeepney rows/queries untouched.
ALTER TABLE dispatch_queue
  ADD COLUMN IF NOT EXISTS route_id INT NULL AFTER operator_id;

ALTER TABLE dispatch_queue
  ADD CONSTRAINT fk_dispatch_route FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
  ADD INDEX idx_dispatch_route_status (route_id, status);
