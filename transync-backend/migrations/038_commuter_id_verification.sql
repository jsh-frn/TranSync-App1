-- Automated Student ID verification pipeline (OCR cross-check + face-match +
-- pose-challenge liveness), pilot scoped to the Student discount category
-- only. Deliberately a dedicated table rather than new columns on
-- `commuters` — mirrors this schema's existing convention of putting
-- structured per-submission verification data in its own table (see
-- `operator_association_applications`'s doc_*_url columns) instead of
-- bloating the core account row. `category` already spans student/pwd/
-- elderly so a future pass for Senior/PWD doesn't need another migration,
-- but this pass only ever writes 'student' rows.
CREATE TABLE commuter_id_verifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    commuter_id INT NOT NULL,
    category ENUM('student', 'pwd', 'elderly') NOT NULL DEFAULT 'student',

    last_name VARCHAR(100) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100) NULL,
    school_name VARCHAR(150) NOT NULL,
    academic_year VARCHAR(20) NOT NULL,
    student_id_number VARCHAR(50) NOT NULL,
    id_type ENUM('k12', 'college') NOT NULL,

    id_front_path VARCHAR(255) NOT NULL,
    id_back_path VARCHAR(255) NOT NULL,
    enrollment_form_path VARCHAR(255) NULL,
    selfie_center_path VARCHAR(255) NOT NULL,
    selfie_left_path VARCHAR(255) NOT NULL,
    selfie_right_path VARCHAR(255) NOT NULL,

    ocr_raw_text TEXT NULL,
    ocr_match_result JSON NULL,
    face_match_score DECIMAL(5,2) NULL,
    liveness_result JSON NULL,
    provider VARCHAR(30) NOT NULL COMMENT 'demo | aws_rekognition',

    -- This pipeline only ever inserts a row on a full pass (see
    -- commuter_register_student.php) — a failed attempt returns its error
    -- to the client immediately and writes nothing, so the commuter can
    -- retry right away without a stale row to clean up. 'failed' is kept in
    -- the enum for a possible future audit-trail pass, not written today.
    verification_status ENUM('verified', 'failed') NOT NULL DEFAULT 'verified',

    verified_at DATETIME NULL,
    expires_at DATETIME NULL COMMENT 'verified_at + 10mo (K-12) or 5mo (college)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_civ_commuter FOREIGN KEY (commuter_id) REFERENCES commuters(id) ON DELETE CASCADE,
    INDEX idx_civ_student_id_number (student_id_number)
    -- Deliberately no UNIQUE constraint here (confirmed by live testing —
    -- an earlier version of this migration had one and it broke renewal:
    -- a commuter renewing re-submits the SAME real student_id_number they
    -- already own, which needs a second row, not a rejected insert).
    -- Different-commuter duplicate prevention is enforced at the
    -- application level instead (`WHERE student_id_number = ? AND
    -- commuter_id != ?`, see commuter_register_student.php /
    -- commuter_renew_student.php), mirroring this schema's existing
    -- precedent for the same tradeoff (migration 034's trip generation:
    -- "duplicate-prevention... enforced at the application level instead").
);
