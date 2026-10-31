-- Run once against the `transync` database.
-- Some routes are genuinely one-way (a physical one-way road, or a loop that never
-- retraces itself) while others are a literal back-and-forth shuttle where the same
-- jeepney drives A->B then turns around and drives the same road B->A (e.g. Xevera
-- <-> Astro). The route planner needs to know which, since treating a one-way road's
-- northbound route as reversible caused it to be confused with a genuinely separate
-- southbound route running the same corridor.

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS direction_type ENUM('one_way','vice_versa') NOT NULL DEFAULT 'one_way' AFTER vehicle_type;
