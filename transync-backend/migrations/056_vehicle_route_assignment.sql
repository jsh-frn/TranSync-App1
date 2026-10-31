-- Run once against the `transync` database.
-- Moves route assignment from the DRIVER to the VEHICLE. A route belongs to
-- a physical vehicle's franchise, not to whoever happens to be driving it
-- that week — an operator now sets a vehicle's route from Add/Edit Vehicle
-- instead of Add/Edit Driver. A driver's "current route" becomes a
-- read-through of their currently-assigned vehicle's own route_assignments
-- row, the same way a vehicle's "assigned route" used to be a read-through
-- of its driver's row (this flips that direction).
--
-- `driver_id` and its existing `unique_driver` key are left in place,
-- untouched, matching this codebase's deprecate-in-place convention —
-- routes/assign_route.php and the two legacy/dormant per-driver-application
-- endpoints (associations/assign_association_driver.php,
-- applications/review_application.php) keep working unmodified for any
-- historical/direct caller. Every current-UI code path moves to vehicle_id.

ALTER TABLE route_assignments
  ADD COLUMN vehicle_id INT NULL AFTER route_id,
  ADD CONSTRAINT fk_route_assignments_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  ADD UNIQUE KEY unique_vehicle (vehicle_id),
  -- New rows are vehicle-keyed only (driver_id stays populated for legacy
  -- rows and any historical/direct caller, but every current-UI write path
  -- now inserts (route_id, vehicle_id) with no driver_id at all).
  MODIFY COLUMN driver_id INT NULL;

-- Backfill: carry each currently-assigned driver's route forward onto
-- whichever vehicle that driver currently holds, so existing assignments
-- aren't silently lost the moment reads switch to the vehicle-keyed join.
UPDATE route_assignments ra
JOIN drivers d ON d.id = ra.driver_id
SET ra.vehicle_id = d.vehicle_id
WHERE d.vehicle_id IS NOT NULL;
