-- Adds Semester, required for College students only (K-12 has no semester
-- concept) — see config/academic_validation.php. Manually picked by the
-- commuter in the wizard (same pattern as academic_year/student_id_number),
-- then cross-checked against OCR'd document text, same as those two fields.
ALTER TABLE commuter_id_verifications
    ADD COLUMN semester ENUM('1st', '2nd', 'midyear') NULL AFTER academic_year;
