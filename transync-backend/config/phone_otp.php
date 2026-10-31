<?php
require_once __DIR__ . "/sms.php"; // OTP_VERIFIED_VALID_MINUTES — self-included so any
                                     // caller that requires phone_otp.php doesn't also
                                     // have to separately require sms.php itself.

// Shared helpers gating every self-registration endpoint on a recent,
// unconsumed phone OTP verification (see auth/send_phone_otp.php /
// verify_phone_otp.php, and migration 048). Six call sites share this same
// phone_otp_verifications table: commuter_register.php, operator_register.php,
// association_register.php, and the three discount-category wizard endpoints
// that also create a brand-new commuter account directly —
// commuter_register_student.php / _pwd.php / _senior.php (Core Flow 2a) —
// since those bypass commuter_register.php entirely.

function isPhoneOtpVerified(mysqli $conn, string $phone): bool {
    $validMinutes = (int) OTP_VERIFIED_VALID_MINUTES;
    $stmt = $conn->prepare("
        SELECT id FROM phone_otp_verifications
        WHERE phone_number = ? AND verified = 1 AND consumed_at IS NULL
          AND verified_at >= (NOW() - INTERVAL {$validMinutes} MINUTE)
        ORDER BY id DESC LIMIT 1
    ");
    $stmt->bind_param("s", $phone);
    $stmt->execute();
    return $stmt->get_result()->fetch_assoc() !== null;
}

// Called only once a registration actually succeeds — marks this phone's
// verification as spent so it can't be reused to create a second account
// within the same trust window. Must never be called on a failed attempt
// (e.g. duplicate email caught after the phone check) — that would force a
// commuter to re-verify their phone just to retry an unrelated field.
function consumePhoneOtpVerification(mysqli $conn, string $phone): void {
    $stmt = $conn->prepare("
        UPDATE phone_otp_verifications
        SET consumed_at = NOW()
        WHERE phone_number = ? AND verified = 1 AND consumed_at IS NULL
        ORDER BY id DESC LIMIT 1
    ");
    $stmt->bind_param("s", $phone);
    $stmt->execute();
}
