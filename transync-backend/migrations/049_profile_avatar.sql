-- Migration 049: Profile Picture / Avatar Upload
--
-- Lets a commuter, driver, operator, or association attach a photo to their
-- account, shown wherever that role's Profile screen currently renders an
-- initials-only (or icon-only, for Association) circle. Purely cosmetic —
-- never read by any verification, fare, discount, or matching logic; the
-- existing id_photo/discount_id_url/registration_document_url/document_url
-- columns remain the only documents anything actually checks.
--
-- Stored as a relative path under uploads/avatars/ — a new, dedicated folder
-- kept separate from uploads/{commuters,operators,associations}/'s existing
-- verification-document uploads, so avatar replace/remove logic never risks
-- touching a document file.

ALTER TABLE commuters    ADD COLUMN avatar_url VARCHAR(255) NULL AFTER discount_id_url;
ALTER TABLE drivers      ADD COLUMN avatar_url VARCHAR(255) NULL AFTER license_number;
ALTER TABLE operators    ADD COLUMN avatar_url VARCHAR(255) NULL AFTER registration_document_url;
ALTER TABLE associations ADD COLUMN avatar_url VARCHAR(255) NULL AFTER document_url;
