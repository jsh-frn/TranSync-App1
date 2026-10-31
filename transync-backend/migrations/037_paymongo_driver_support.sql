-- Generalizes paymongo_sources to track a driver-owned top-up alongside the
-- existing commuter one, mirroring this schema's existing convention for
-- "exactly one of several nullable FK columns is set per row" (e.g.
-- reservations.trip_id/uv_session_id/uv_slot_id) rather than inventing a
-- new owner_type/owner_id pattern just for this table. Enforced in
-- application code (create_source.php/verify_payment.php), not a DB CHECK
-- constraint, matching this app's general preference for app-level
-- validation of this kind of business rule.
ALTER TABLE paymongo_sources
    MODIFY COLUMN commuter_id INT NULL,
    ADD COLUMN driver_id INT NULL AFTER commuter_id,
    ADD CONSTRAINT fk_paymongo_sources_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
