-- Supports the new "Change Discount Type" flow (Profile screen) — a commuter
-- whose current discount category has expired can automatically re-verify
-- into PWD or Senior Citizen, reusing the Student pipeline's OCR/face-match/
-- liveness machinery. Fixes a schema mismatch discovered while designing
-- this: commuter_id_verifications.category said 'pwd', but commuters.category
-- (the authoritative column) says 'disabled' — only 'student' rows have ever
-- been written so far (confirmed live), so this rename is safe.
ALTER TABLE commuter_id_verifications
    MODIFY COLUMN category ENUM('student', 'disabled', 'elderly') NOT NULL DEFAULT 'student';

-- Third outcome for this new flow's automated-but-uncertain case — falls
-- through to the admin's existing VerifyUsers pending queue instead of a
-- hard reject. 'failed' stays unused, same as before (a hard reject still
-- writes nothing and lets the commuter retry immediately).
ALTER TABLE commuter_id_verifications
    MODIFY COLUMN verification_status ENUM('verified', 'failed', 'pending_review') NOT NULL DEFAULT 'verified';

-- Student-only fields relax to nullable — PWD/Senior switch rows never
-- populate school/academic-year/ID-type, and use the new generic id_number
-- column below instead of student_id_number.
ALTER TABLE commuter_id_verifications
    MODIFY COLUMN school_name VARCHAR(150) NULL,
    MODIFY COLUMN academic_year VARCHAR(20) NULL,
    MODIFY COLUMN student_id_number VARCHAR(50) NULL,
    MODIFY COLUMN id_type ENUM('k12', 'college') NULL;

-- Generic PWD/Senior ID number — deliberately a new column rather than
-- overloading student_id_number, which stays Student-only and is referenced
-- by name in the existing pipeline's own duplicate-check query.
ALTER TABLE commuter_id_verifications
    ADD COLUMN id_number VARCHAR(50) NULL AFTER student_id_number,
    ADD INDEX idx_civ_id_number (id_number);

-- Senior Citizen only — enables an OCR-confirmed age>=60 cross-check,
-- analogous in spirit to Student's academic-year check but far simpler (no
-- periods, just a birthdate).
ALTER TABLE commuter_id_verifications
    ADD COLUMN birthdate DATE NULL AFTER id_number;
