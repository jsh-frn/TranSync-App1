<?php
require_once __DIR__ . "/policy.php";

// Records a Terms & Conditions / Privacy Policy acceptance at registration
// time, one row per successful account creation. account_id resolves
// against whichever table account_type names (commuters/operators/
// associations) — polymorphic, same convention as wallet_transactions'
// owner_type/owner_id, since a single FK can't point at three different
// tables. Called from inside each registration endpoint's own transaction
// (see commuter_register.php, commuter_register_student.php/_pwd.php/
// _senior.php, operator_register.php, association_register.php) so the
// consent row is never created without the account it belongs to, or vice
// versa.
function recordConsent(mysqli $conn, string $accountType, int $accountId): void {
    // bind_param() binds its arguments by reference — a const (like
    // CURRENT_TERMS_VERSION) isn't an lvalue and can't be passed by
    // reference directly, so it must be copied into a local variable first.
    $termsVersion   = CURRENT_TERMS_VERSION;
    $privacyVersion = CURRENT_PRIVACY_VERSION;
    $stmt = $conn->prepare("
        INSERT INTO consent_acceptances (account_type, account_id, terms_version, privacy_version)
        VALUES (?, ?, ?, ?)
    ");
    $stmt->bind_param("siss", $accountType, $accountId, $termsVersion, $privacyVersion);
    $stmt->execute();
}

// Shared server-side gate for the `terms_accepted` field every registration
// endpoint now requires — accepts the same truthy string forms the mobile
// client sends ("1"/"true") since this is read from $_POST, never real JSON
// booleans. Centralized so all 6 call sites reject with the identical
// message rather than drifting.
function termsWereAccepted(?string $raw): bool {
    return in_array($raw, ["1", "true", "on"], true);
}
