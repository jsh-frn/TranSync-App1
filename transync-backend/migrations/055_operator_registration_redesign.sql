-- Run once against the `transync` database.
-- Supports the Operator registration redesign's Step 3 ("Business name
-- registration" — DTI for sole proprietor, SEC for corporation) and Step 2's
-- vehicle intent, which cannot be turned into a real `vehicles` row at
-- registration time: vehicles.php's POST hard-requires an already-APPROVED
-- operator_association_applications row before it will create anything, and
-- association approval is a manual review step that can't happen instantly.
-- So Step 2's vehicle type/plate/vehicle_number/capacity answers are stored
-- on the application row itself as a reminder, surfaced once approved
-- (pre-filling the Vehicles tab's Add Vehicle form) rather than submitted
-- immediately.
ALTER TABLE operators
    ADD COLUMN business_registration_url VARCHAR(255) NULL AFTER vehicle_or_cr_url;

ALTER TABLE operator_association_applications
    ADD COLUMN intended_plate_number   VARCHAR(20) NULL,
    ADD COLUMN intended_vehicle_number VARCHAR(50) NULL,
    ADD COLUMN intended_capacity       INT NULL,
    ADD COLUMN vehicle_added           TINYINT(1) NOT NULL DEFAULT 0;
