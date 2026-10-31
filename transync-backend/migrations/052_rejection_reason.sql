-- Run once against the `transync` database.
-- Lets an admin record why a commuter/operator registration was rejected
-- via auth/verify.php's reject action, so the applicant's own account row
-- carries a real, admin-facing basis for the decision — previously
-- rejected_at only recorded WHEN, never WHY. Scoped to commuters and
-- operators only (associations use a different status model — pending/
-- active/inactive, no separate is_verified/rejected_at pair — out of scope
-- for this pass). Nullable: existing/legacy rejections predate this column
-- and simply have no reason on file.
ALTER TABLE commuters ADD COLUMN rejection_reason TEXT NULL AFTER rejected_at;
ALTER TABLE operators ADD COLUMN rejection_reason TEXT NULL AFTER rejected_at;
