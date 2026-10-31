<?php
// Best-effort SMS to an operator when one of their drivers raises an emergency
// (drivers/send_emergency.php). This is the one channel that reaches an
// operator whose app is closed — the in-app popup and the admin page only work
// while they're open.
//
// OPT-IN: sends nothing unless BOTH an IPROG token is configured AND
// EMERGENCY_SMS_ENABLED=1 is set in transync-backend/.env. Off by default so
// testing/demoing the emergency button never texts a real person by accident
// (each message also costs SMS credit).
//
// Never part of the alert's success: the alert is already saved before this
// runs, and any failure here is logged and swallowed.
require_once __DIR__ . '/sms.php';

function emergencySmsEnabled(): bool {
    return IPROG_SMS_API_TOKEN !== '' && getenv('EMERGENCY_SMS_ENABLED') === '1';
}

function buildEmergencySmsText(string $driverName, ?string $plate, ?string $driverPhone, ?float $lat, ?float $lng): string {
    $who  = $driverName . ($plate ? " ($plate)" : "");
    $text = "TRANSYNC EMERGENCY: $who sent an emergency alert.";
    if ($driverPhone) $text .= " Call: $driverPhone.";
    $text .= ($lat !== null && $lng !== null)
        ? " Location: https://maps.google.com/?q=$lat,$lng"
        : " Location unavailable.";
    return $text;
}

// IPROG plain-SMS endpoint (POST /sms_messages, JSON). Returns true only when
// IPROG accepts the message into its queue. $baseUrl is overridable purely so
// the request format can be tested against a local mock without sending a text.
function sendPlainSms(string $phone, string $message, ?string $baseUrl = null): bool {
    $ch = curl_init(($baseUrl ?? IPROG_SMS_BASE_URL) . '/sms_messages');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'api_token'    => IPROG_SMS_API_TOKEN,
            'phone_number' => $phone,
            'message'      => $message,
        ]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT        => 6,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err      = curl_error($ch);
    curl_close($ch);

    if ($err) { error_log("emergency SMS: network error: $err"); return false; }
    $result = json_decode((string)$response, true);
    // Docs show {"status":200,...} for /sms_messages; the OTP endpoint uses
    // "success" — accept either rather than depend on which one IPROG returns.
    $ok = $httpCode === 200 && (($result['status'] ?? null) === 200 || ($result['status'] ?? null) === 'success');
    if (!$ok) error_log("emergency SMS: rejected (HTTP $httpCode): " . substr((string)$response, 0, 200));
    return $ok;
}
