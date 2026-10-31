-- Operator registration still needs a submitted document for the admin to
-- verify the account against — a generic ID/business permit, separate from
-- (and in addition to) the vehicle-type-specific LTO/LTFRB documents
-- submitted later per association application (operator_association_applications).
ALTER TABLE operators ADD COLUMN registration_document_url VARCHAR(255) NULL AFTER password;
