-- Run once against the `transync` database.
-- Multi-association-per-vehicle-type support: an operator can now hold the
-- same vehicle type (e.g. UV Express) approved at two different
-- associations simultaneously — previously operator_association_applications'
-- dedup check and every "the operator's association for type X" derivation
-- query assumed at most one approved association per vehicle type. Vehicles
-- had no association link at all before this (only operator_id + type), so
-- there was no way to tell which of an operator's two simultaneous
-- same-type memberships a given vehicle belonged to. This adds that link.

ALTER TABLE vehicles ADD COLUMN association_id INT NULL AFTER operator_id;

ALTER TABLE vehicles
  ADD CONSTRAINT fk_vehicles_association FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE SET NULL,
  ADD INDEX idx_vehicles_association (association_id);

-- Backfill: under the old one-association-per-type model every existing
-- vehicle's association is unambiguous — it's whichever association the
-- operator has (or had) approved for that vehicle's own type.
UPDATE vehicles v
JOIN operator_association_applications oaa
  ON oaa.operator_id = v.operator_id AND oaa.vehicle_type = v.type AND oaa.status = 'approved'
SET v.association_id = oaa.association_id
WHERE v.association_id IS NULL;
