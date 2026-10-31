<?php
// Shared email validation used by every account-creating/editing endpoint
// (commuter/operator/association/driver registration, plus an operator's
// driver-edit action). Added because format checking and duplicate
// detection had drifted independently per endpoint — only
// association_register.php validated format at all, and every duplicate
// check was scoped to its own table only, so the same email could exist in
// two different tables at once and silently shadow one of the accounts at
// login (login_mobile.php's first-match-wins search across
// commuters -> drivers -> operators -> associations only ever reaches
// whichever table it hits first).

function isValidEmailFormat(string $email): bool {
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

/**
 * True if $email is already used by ANY account across all four
 * login-eligible tables — matches login_mobile.php's own cross-table email
 * search, so a new account can never collide with (and silently shadow) an
 * existing one in a different table. Pass $excludeTable/$excludeId when
 * editing an already-existing row (e.g. a driver's own update_details) so a
 * resubmission of that same row's own unchanged email isn't flagged as a
 * duplicate of itself.
 */
function emailAlreadyRegistered(mysqli $conn, string $email, ?string $excludeTable = null, ?int $excludeId = null): bool {
    $tables = [
        'commuters'    => 'email',
        'operators'    => 'email',
        'drivers'      => 'email',
        'associations' => 'contact_email',
    ];
    foreach ($tables as $table => $column) {
        $excludeSelf = $excludeTable === $table && $excludeId !== null;
        $sql = "SELECT id FROM {$table} WHERE {$column} = ?" . ($excludeSelf ? " AND id != ?" : "");
        $stmt = $conn->prepare($sql);
        if ($excludeSelf) {
            $stmt->bind_param("si", $email, $excludeId);
        } else {
            $stmt->bind_param("s", $email);
        }
        $stmt->execute();
        $stmt->store_result();
        if ($stmt->num_rows > 0) {
            return true;
        }
    }
    return false;
}

/**
 * Same shape as emailAlreadyRegistered() — the phone-number equivalent.
 * commuter_register.php used to inline this same 4-table loop directly;
 * centralized here (with the same $excludeTable/$excludeId support for
 * editing an already-existing row) rather than copied a second time for
 * commuter/update_contact.php.
 */
function phoneAlreadyRegistered(mysqli $conn, string $phone, ?string $excludeTable = null, ?int $excludeId = null): bool {
    $tables = [
        'commuters'    => 'phone',
        'operators'    => 'phone',
        'drivers'      => 'phone',
        'associations' => 'contact_phone',
    ];
    foreach ($tables as $table => $column) {
        $excludeSelf = $excludeTable === $table && $excludeId !== null;
        $sql = "SELECT id FROM {$table} WHERE {$column} = ?" . ($excludeSelf ? " AND id != ?" : "");
        $stmt = $conn->prepare($sql);
        if ($excludeSelf) {
            $stmt->bind_param("si", $phone, $excludeId);
        } else {
            $stmt->bind_param("s", $phone);
        }
        $stmt->execute();
        $stmt->store_result();
        if ($stmt->num_rows > 0) {
            return true;
        }
    }
    return false;
}
