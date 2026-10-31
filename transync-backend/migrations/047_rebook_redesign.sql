-- Rebooking redesign: rewrites the flow into two explicit steps — the
-- operator only grants/denies permission (approve/reject), the commuter
-- then self-serves picking the new trip/seat and paying the 10% fee
-- themselves. See config/rebook_eligibility.php and
-- api/reservations/{operator_review_rebook,complete_rebook}.php.

-- Safety: remap any existing 'dismissed' row to 'rejected' BEFORE widening
-- the ENUM — MySQL silently blanks a stored value that's no longer in a
-- new ENUM's allowed list otherwise. (Dev DB currently has zero rows in
-- this table, but this keeps the migration safe for any environment that
-- does have data.)
UPDATE rebook_requests SET status = 'rejected' WHERE status = 'dismissed';

ALTER TABLE rebook_requests
    MODIFY COLUMN status ENUM('pending','approved','rejected','fulfilled','expired') NOT NULL DEFAULT 'pending',
    ADD COLUMN reviewed_by_operator_id INT NULL AFTER commuter_id,
    ADD COLUMN reviewed_at DATETIME NULL AFTER requested_at,
    ADD COLUMN rejection_reason VARCHAR(255) NULL AFTER reviewed_at,
    ADD CONSTRAINT fk_rebook_requests_operator FOREIGN KEY (reviewed_by_operator_id) REFERENCES operators(id);

-- Persists the 10% fee actually charged at completion time, for audit —
-- mirrors reservations.system_fee_amount/operator_fee_amount/driver_net_amount's
-- existing pattern (rates could change over time, so this is not
-- recomputed later from REBOOKING_SURCHARGE_PCT).
ALTER TABLE reservations
    ADD COLUMN rebooking_fee_amount DECIMAL(10,2) NULL AFTER driver_net_amount;
