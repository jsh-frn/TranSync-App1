-- PWD discount category becomes renewable: the physical PWD ID's own printed
-- Validity Date is now collected and OCR-cross-checked (see
-- config/discount_switch_validation.php's checkPwdValidity(), mirroring
-- checkSeniorAge()'s pattern) — once past, expires_at gates the discount the
-- same way Student's academic-period expiry already does. PWD/Senior
-- previously never expired at all (see migration 038's original comment).
-- Senior Citizen verification is unaffected by this migration — it still
-- never expires; this column is PWD-only.
--
-- Distinct from date_issued (migration 041, Senior-only, "when was this
-- card issued") and from expires_at (pipeline-computed from this column,
-- never OCR'd directly) — validity_date is the raw date printed on the PWD
-- ID itself, commuter-typed and cross-checked against the OCR'd document the
-- same way birthdate already is for Senior Citizen.
ALTER TABLE commuter_id_verifications
    ADD COLUMN validity_date DATE NULL AFTER date_issued;
