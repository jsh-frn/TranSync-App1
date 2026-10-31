<?php
// Shared phone -> account lookup used by the OTP-based password reset flow
// (auth/lookup_account_by_phone.php, auth/reset_password_by_phone.php, and
// send_phone_otp.php's purpose=password_reset pre-check). Deliberately
// scoped to Commuter/Operator/Association only — Driver accounts are
// excluded from self-service password reset (they're operator-created and
// operator-managed, see Do Not Break rule #15; an operator can already set
// a driver's password directly via drivers/drivers.php's update_details
// action), so a driver's own phone number never resolves here.
//
// This is the reverse of config/account_validation.php's
// phoneAlreadyRegistered() (which checks all 4 login-eligible tables,
// including drivers, and is used to REJECT a duplicate at registration) —
// this one is used to FIND an existing account by its phone, for recovery.

function findAccountByPhone(mysqli $conn, string $phone): ?array {
    $tables = [
        'commuter'    => ['table' => 'commuters',    'phone_col' => 'phone',         'first' => 'first_name',      'last' => 'last_name'],
        'operator'    => ['table' => 'operators',    'phone_col' => 'phone',         'first' => 'first_name',      'last' => 'last_name'],
        'association' => ['table' => 'associations', 'phone_col' => 'contact_phone', 'first' => 'rep_first_name',  'last' => 'rep_last_name'],
    ];

    foreach ($tables as $type => $cfg) {
        $stmt = $conn->prepare("
            SELECT id, {$cfg['first']} AS first_name, {$cfg['last']} AS last_name, name AS legacy_name, avatar_url
            FROM {$cfg['table']} WHERE {$cfg['phone_col']} = ?
        ");
        $stmt->bind_param("s", $phone);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if (!$row) continue;

        $first = trim($row['first_name'] ?? '');
        $last  = trim($row['last_name'] ?? '');
        // Rows predating the structured-name migration (043) — or an
        // association whose Authorized Representative fields were never
        // filled in — have no first/last name to fall back on; use the
        // single `name` column (org name, for association) instead.
        if (!$first && !$last && !empty($row['legacy_name'])) {
            $parts = preg_split('/\s+/', trim($row['legacy_name']), 2);
            $first = $parts[0] ?? '';
            $last  = $parts[1] ?? '';
        }

        return [
            'account_type' => $type,
            'id'           => (int) $row['id'],
            'first_name'   => $first,
            'last_name'    => $last,
            // Relative path (or null) — same as every other avatar_url
            // response in this app, prefixed client-side with FILE_BASE, not
            // here (see commuter/get_profile.php's comment on why).
            'avatar_url'   => $row['avatar_url'] ?? null,
        ];
    }

    return null;
}

// First letter kept, remaining characters replaced with asterisks — same
// masking depth for every name part, e.g. "Juan" -> "J***", "Cruz" -> "C***".
function maskNamePart(string $s): string {
    $s = trim($s);
    if ($s === '') return '';
    if (mb_strlen($s) <= 1) return $s;
    return mb_substr($s, 0, 1) . str_repeat('*', mb_strlen($s) - 1);
}

function maskFullName(string $first, string $last): string {
    $parts = array_filter([maskNamePart($first), maskNamePart($last)], fn($p) => $p !== '');
    return $parts ? implode(' ', $parts) : 'Account holder';
}
