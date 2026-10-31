-- Run once against the `transync` database.
-- Wires up the previously-unused `terminals` table to actual map coordinates and to
-- associations, and links each route to the one terminal it departs from. Terminals
-- are the anchor a route is drawn from: associations must place a terminal before
-- drawing a route's waypoints (enforced in save_route.php), and the commuter map shows
-- terminal pins by default with routes hidden until their terminal pin is tapped.

ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS association_id INT NULL AFTER operator_id,
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10,8) NULL AFTER location,
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8) NULL AFTER latitude,
  MODIFY operator_id INT NULL;

ALTER TABLE terminals
  ADD CONSTRAINT fk_terminal_association FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE CASCADE;

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS terminal_id INT NULL AFTER association_id;

ALTER TABLE routes
  ADD CONSTRAINT fk_route_terminal FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE SET NULL;
