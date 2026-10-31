-- Lets a commuter flag a missed (no_show) booking as wanting a rebook,
-- surfaced as a visible badge on the operator's own trip/slot manifest
-- (the same screen that already has the "Rebook" action, Core Flow 9.4) —
-- this app has no push/in-app notification system, so a request can't be
-- "delivered" to the operator any other way than showing up where the
-- operator already looks. One row per commuter request; a reservation can
-- have at most one active (pending) request at a time.

CREATE TABLE IF NOT EXISTS rebook_requests (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    reservation_id  INT NOT NULL,
    commuter_id     INT NOT NULL,
    status          ENUM('pending', 'fulfilled', 'dismissed') NOT NULL DEFAULT 'pending',
    requested_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at     DATETIME NULL,
    UNIQUE KEY unique_pending_per_reservation (reservation_id, status),
    KEY idx_reservation (reservation_id),
    KEY idx_commuter (commuter_id),
    CONSTRAINT fk_rebook_requests_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    CONSTRAINT fk_rebook_requests_commuter FOREIGN KEY (commuter_id) REFERENCES commuters(id)
);
