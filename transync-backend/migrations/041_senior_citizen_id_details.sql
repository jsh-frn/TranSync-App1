-- Adds the two Senior Citizen ID fields the OSCA-issued card carries that
-- the PWD/Senior "category switch" pipeline (migration 040) didn't yet
-- collect: which LGU (city/municipality) issued the card, and when. Both
-- are free-text/plain-date fields, never OCR-cross-checked against the
-- captured document (unlike name/id_number/birthdate) — there's no reliable
-- machine-normalizable format for either across the many OSCA offices'
-- differently-designed cards, so they're taken as commuter-entered record
-- data only, same trust level as `middle_name`.
ALTER TABLE commuter_id_verifications
    ADD COLUMN issuing_lgu VARCHAR(150) NULL AFTER birthdate,
    ADD COLUMN date_issued DATE NULL AFTER issuing_lgu;
