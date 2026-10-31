-- Refinement pass over migration 043's registration redesign, per direct
-- follow-up request:
--
-- Operator: registration must identify/verify the operator only, never tie
-- it to one association's address (an operator can apply to and manage
-- vehicles under multiple associations, including several for the same
-- vehicle type — Core Flow 8). business_address (added migration 043) is
-- dropped from the registration form as a result; the column itself is left
-- in place, unpopulated for new rows, matching this codebase's established
-- deprecate-in-place convention (never silently drop columns/data).
--
-- entity_type is a NEW, distinct concept from the legacy, deprecated
-- operators.operator_type column (Jeepney Op|UV Op|Bus Op — a VEHICLE type,
-- unread by any current code path, see migration 022's note). entity_type
-- instead answers "is this operator an individual or a business/company" —
-- unrelated to vehicle type, so it gets its own column rather than
-- overloading or reusing the deprecated one.
ALTER TABLE operators
    ADD COLUMN entity_type   ENUM('individual', 'business') NULL AFTER date_of_birth,
    ADD COLUMN business_phone VARCHAR(20) NULL AFTER business_name;

-- Association: adds a required government-issued ID for the Authorized
-- Representative — proves who the person is, distinct from document_url
-- (the association's own Registration/Accreditation document, which proves
-- the organization itself is legitimate). The optional
-- supporting_document_url column (added migration 043) is no longer
-- collected by the registration form as of this refinement — left in place,
-- unpopulated going forward, same deprecate-in-place convention as above.
ALTER TABLE associations
    ADD COLUMN rep_government_id_url VARCHAR(255) NULL AFTER rep_position;
