<?php
// IPROG SMS API credentials & OTP policy constants.
// Docs: https://www.iprogsms.com/api/v1/documentation
// Set via transync-backend/.env (gitignored, see .env.example) — no
// hardcoded fallback here (unlike the blank/demo-safe fallback
// config/rekognition.php uses), since a real secret must never live in
// source. If IPROG_SMS_API_TOKEN is unset, every OTP send simply fails at
// IPROG's side (empty api_token), not a crash here — fill in .env to fix.
require_once __DIR__ . '/env.php';

define('IPROG_SMS_API_TOKEN', getenv('IPROG_SMS_API_TOKEN') ?: '');
define('IPROG_SMS_BASE_URL', 'https://www.iprogsms.com/api/v1');

// OTP policy — used by auth/send_phone_otp.php, auth/verify_phone_otp.php,
// and config/phone_otp.php's isPhoneOtpVerified() gate on every
// self-registration endpoint (Commuter/Operator/Association, see Core Flow
// 15 / Do Not Break rule #15 — Driver is excluded, never self-service).
define('OTP_EXPIRY_MINUTES', 5);            // passed to IPROG as expires_in_minutes
define('OTP_RESEND_COOLDOWN_SECONDS', 60);  // IPROG's docs don't specify a rate limit, enforced here instead
define('OTP_MAX_ATTEMPTS', 3);              // wrong-code attempts before a fresh code must be requested
define('OTP_VERIFIED_VALID_MINUTES', 120);  // how long a verified phone stays trusted before registration must complete
