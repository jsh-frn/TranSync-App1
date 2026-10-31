-- Run once against the `transync` database.
-- UV slots gain the same boarding/departed states Bus trips already have,
-- so drivers can signal "vehicle here, boarding now" / "departed" for
-- book-ahead UV slots too. See update_slot_status.php for the new actions.

ALTER TABLE uv_slots
  MODIFY status ENUM('scheduled','boarding','departed','completed','cancelled') NOT NULL DEFAULT 'scheduled';
