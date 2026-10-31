-- Run once against the `transync` database.
-- Bus Trip workflow redesign: the system now pre-generates trip instances
-- from every Active bus_schedules row for a rolling window (default 30
-- days, see config/policy.php BUS_TRIP_GENERATION_WINDOW_DAYS), instead of
-- an operator manually committing one trip at a time. A generated trip has
-- no operator/vehicle/driver yet ("Pending Assignment") until an operator
-- assigns them via bus_trips/assign_trip.php (new), at which point it
-- becomes 'scheduled' ("Ready/Open for Booking" — the existing status
-- value, unchanged, just newly reachable from a real pending state instead
-- of always being the row's very first status).
--
-- All changes below are additive or nullability-relaxing only — no existing
-- row is touched, no column is renamed or removed, no data is deleted.
-- Every existing trips row already has operator_id/vehicle_id/driver_id
-- populated, so relaxing those to nullable has zero effect on it.

-- capacity also relaxes to nullable: it's read live from the assigned
-- vehicle's own seat layout (Do Not Break rule #43), which doesn't exist
-- yet for a freshly-generated, not-yet-assigned trip — populated at
-- assignment time in bus_trips/assign_trip.php, same as vehicle_id/driver_id.
ALTER TABLE trips
  MODIFY COLUMN operator_id INT NULL,
  MODIFY COLUMN vehicle_id  INT NULL,
  MODIFY COLUMN driver_id   INT NULL,
  MODIFY COLUMN capacity    INT NULL,
  MODIFY COLUMN status ENUM('pending_assignment','scheduled','boarding','departed','completed','cancelled')
    NOT NULL DEFAULT 'pending_assignment',
  ADD COLUMN conductor_name  VARCHAR(100) NULL AFTER driver_id,
  ADD COLUMN conductor_phone VARCHAR(20)  NULL AFTER conductor_name;

-- Deliberately NOT adding a UNIQUE (schedule_id, departure_time) constraint
-- here: this live database already has real duplicate rows for the same
-- (schedule_id, departure_time) pair (different vehicles/drivers, from the
-- old one-at-a-time create_trip.php flow having no schedule+date
-- uniqueness check at all) — exactly the class of bug this redesign fixes
-- going forward. Adding a hard constraint now would fail the migration
-- against that existing data, and per this app's data-preservation
-- requirement, existing rows are never deleted/merged automatically to make
-- room for a new constraint. Instead, transync-backend/config/trip_generation.php
-- enforces no-duplicates at the application level (SELECT-before-INSERT
-- inside a transaction), the same pattern bus_trips/create_trip.php's own
-- "final race-condition re-check right before INSERT" already uses
-- elsewhere in this codebase. If the existing duplicate rows are ever
-- manually reconciled, a follow-up migration can add the DB-level
-- constraint on top for extra safety.
