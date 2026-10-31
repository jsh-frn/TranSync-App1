-- Registration redesign — structured personal-info fields (replacing a
-- single free-text name field) plus a Terms & Conditions / Privacy Policy
-- consent audit trail, added across all three self-registering roles.
--
-- `name` (commuters/operators) and the association's own `name` are left
-- untouched and unrenamed — every existing reader of `.name` across the
-- mobile app, admin panel, and backend keeps working unchanged. The
-- registration endpoints now populate `name` by concatenating the new
-- structured columns below, rather than reading it as free text.

-- Commuters: structured personal name + date of birth. All nullable —
-- existing rows are unaffected; only new registrations populate these.
ALTER TABLE commuters
    ADD COLUMN first_name    VARCHAR(50)  NULL AFTER name,
    ADD COLUMN middle_name   VARCHAR(50)  NULL AFTER first_name,
    ADD COLUMN last_name     VARCHAR(50)  NULL AFTER middle_name,
    ADD COLUMN suffix        VARCHAR(20)  NULL AFTER last_name,
    ADD COLUMN date_of_birth DATE         NULL AFTER suffix;

-- Operators: `name` has always represented the account-holder's own person
-- name (see the operator dashboard's greeting/avatar-initial usage), not a
-- business name — business_name/business_address below are genuinely new
-- data, not a rename of anything that already existed.
ALTER TABLE operators
    ADD COLUMN first_name       VARCHAR(50)  NULL AFTER name,
    ADD COLUMN middle_name      VARCHAR(50)  NULL AFTER first_name,
    ADD COLUMN last_name        VARCHAR(50)  NULL AFTER middle_name,
    ADD COLUMN suffix           VARCHAR(20)  NULL AFTER last_name,
    ADD COLUMN date_of_birth    DATE         NULL AFTER suffix,
    ADD COLUMN business_name    VARCHAR(150) NULL AFTER date_of_birth,
    ADD COLUMN business_address VARCHAR(255) NULL AFTER business_name;

-- Associations: an Authorized Representative person record didn't exist at
-- all before this (only contact_email/contact_phone, no name) — these are
-- new columns, not a split of anything pre-existing. official_email/
-- official_phone are the association's own org-level contact info, kept
-- deliberately distinct from contact_email/contact_phone (the
-- representative's own login credentials). association_type is left alone
-- (already deprecated, nullable, unread by current code, see migration 022)
-- — this migration does not touch it; the new registration form simply
-- stops populating it, keeping this app's association-is-type-agnostic
-- architecture intact.
ALTER TABLE associations
    ADD COLUMN rep_first_name          VARCHAR(50)  NULL AFTER name,
    ADD COLUMN rep_middle_name         VARCHAR(50)  NULL AFTER rep_first_name,
    ADD COLUMN rep_last_name           VARCHAR(50)  NULL AFTER rep_middle_name,
    ADD COLUMN rep_suffix              VARCHAR(20)  NULL AFTER rep_last_name,
    ADD COLUMN rep_position            VARCHAR(100) NULL AFTER rep_suffix,
    ADD COLUMN acronym                 VARCHAR(20)  NULL AFTER name,
    ADD COLUMN official_email          VARCHAR(150) NULL AFTER contact_email,
    ADD COLUMN official_phone          VARCHAR(20)  NULL AFTER contact_phone,
    ADD COLUMN supporting_document_url VARCHAR(255) NULL AFTER document_url;

-- Terms & Conditions / Privacy Policy consent audit trail — polymorphic
-- across account types, matching this schema's existing owner_type/
-- owner_id convention (see wallet_transactions). One row per successful
-- registration; no FK to a single table since account_id resolves against
-- a different table depending on account_type. terms_version/
-- privacy_version let a future policy update require re-acceptance without
-- losing the history of what an account originally agreed to.
CREATE TABLE consent_acceptances (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    account_type    ENUM('commuter','operator','association') NOT NULL,
    account_id      INT NOT NULL,
    terms_version   VARCHAR(20) NOT NULL,
    privacy_version VARCHAR(20) NOT NULL,
    accepted_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_consent_account (account_type, account_id)
);
