<?php
// PayMongo API credentials — get your keys at https://dashboard.paymongo.com/developers.
// Set via transync-backend/.env (gitignored, see .env.example). No hardcoded
// fallback here since a real secret must never live in source. If
// PAYMONGO_SECRET_KEY is unset, PayMongo calls will fail at PayMongo's side —
// fill in .env to fix.
require_once __DIR__ . '/env.php';

define('PAYMONGO_SECRET_KEY', getenv('PAYMONGO_SECRET_KEY') ?: '');
define('PAYMONGO_PUBLIC_KEY', getenv('PAYMONGO_PUBLIC_KEY') ?: '');


