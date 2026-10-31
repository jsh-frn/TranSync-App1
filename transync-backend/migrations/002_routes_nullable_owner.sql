-- Run once against the `transync` database.
-- Allows admin-created library routes to have no operator or association owner.
-- operator_id and association_id are already documented as nullable in the schema;
-- this migration corrects the actual column constraint to match.

USE transync;

ALTER TABLE routes
  MODIFY COLUMN operator_id    INT NULL DEFAULT NULL,
  MODIFY COLUMN association_id INT NULL DEFAULT NULL;
