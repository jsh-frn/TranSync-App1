-- Operator/association restructuring: membership becomes per-vehicle-type
-- instead of one fixed operator_type/association_id per account. An operator
-- can now hold multiple vehicle types (e.g. Jeepney under Association A, Bus
-- under Association B). operators.operator_type/association_id and
-- associations.association_type are deprecated in place (kept, unused going
-- forward) — never dropped, matching this codebase's established convention.

ALTER TABLE operator_association_applications
  ADD COLUMN vehicle_type ENUM('Jeepney','UV Express','Bus') NULL AFTER association_id,
  ADD COLUMN doc_lto_cr_url VARCHAR(255) NULL,
  ADD COLUMN doc_capacity_spec_url VARCHAR(255) NULL,
  ADD COLUMN doc_engine_cert_url VARCHAR(255) NULL,
  ADD COLUMN doc_lto_stencil_url VARCHAR(255) NULL,
  ADD COLUMN doc_model_proof_url VARCHAR(255) NULL,
  ADD COLUMN doc_terminal_route_map_url VARCHAR(255) NULL,
  ADD COLUMN doc_garage_proof_url VARCHAR(255) NULL,
  ADD COLUMN doc_speed_limiter_url VARCHAR(255) NULL,
  ADD COLUMN doc_gps_cert_url VARCHAR(255) NULL,
  ADD COLUMN doc_pami_policy_url VARCHAR(255) NULL,
  ADD COLUMN doc_fare_matrix_url VARCHAR(255) NULL,
  MODIFY COLUMN status ENUM('pending','approved','rejected','removed') NOT NULL DEFAULT 'pending';

-- Backfill existing rows from the operator's (still-present, now-legacy)
-- operator_type so historical applications aren't left with a NULL vehicle_type.
UPDATE operator_association_applications a
JOIN operators o ON o.id = a.operator_id
SET a.vehicle_type = CASE o.operator_type
  WHEN 'Jeepney Op' THEN 'Jeepney'
  WHEN 'UV Op'      THEN 'UV Express'
  WHEN 'Bus Op'     THEN 'Bus'
  ELSE 'Jeepney'
END
WHERE a.vehicle_type IS NULL;

ALTER TABLE operator_association_applications
  MODIFY COLUMN vehicle_type ENUM('Jeepney','UV Express','Bus') NOT NULL;
