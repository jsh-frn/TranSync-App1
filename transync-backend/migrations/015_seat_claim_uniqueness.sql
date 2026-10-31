-- Run once against the `transync` database.
-- Enforces atomic per-trip seat claims at the DB level: MySQL unique indexes
-- treat NULL as distinct, so this only blocks two reservations from claiming
-- the same (trip_id, seat_labels) pair — rows where either is NULL (UV
-- bookings, or any legacy row with no seat) are unaffected.
ALTER TABLE reservations
  ADD UNIQUE KEY unique_trip_seat (trip_id, seat_labels);
