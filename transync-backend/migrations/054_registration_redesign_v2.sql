-- Run once against the `transync` database.
-- Supports the registration-flow redesign (multi-step forms, revised
-- document requirements) for Operator and Association self-registration.
--
-- Operator: the single generic `registration_document_url` ("valid ID or
-- business permit") is superseded by two specific, purpose-relevant
-- documents collected at registration — a Driver's License and the
-- vehicle's own OR/CR (Official Receipt/Certificate of Registration).
-- `registration_document_url` itself is left in place, deprecated-in-place
-- (matches this codebase's established convention, e.g. `business_address`)
-- since old rows already reference it and nothing reads it destructively.
ALTER TABLE operators
    ADD COLUMN drivers_license_url VARCHAR(255) NULL AFTER registration_document_url,
    ADD COLUMN vehicle_or_cr_url   VARCHAR(255) NULL AFTER drivers_license_url;

-- Association: two new free-text fields captured on the redesigned
-- registration wizard's profile step, for admin's own reference only (not
-- read by any routing/matching/booking logic).
ALTER TABLE associations
    ADD COLUMN coverage_area         VARCHAR(255) NULL AFTER address,
    ADD COLUMN estimated_fleet_size  INT NULL AFTER coverage_area;

-- Note: Association's "Board Resolution" document reuses the already
-- fully-dormant `supporting_document_url` column (migration 043, deprecated
-- migration 044, confirmed zero live code references anywhere) — no new
-- column needed for it.
