-- Run once against the `transync` database.
-- Driver accounts are created exclusively by the operator again (the
-- pre-existing `drivers/drivers.php` POST flow) — the driver self-registration
-- + apply-to-operator flow (migration 011) is retired. Table confirmed empty
-- before dropping (nothing ever wrote to it outside this session's own tests).
DROP TABLE IF EXISTS driver_operator_applications;
