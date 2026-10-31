<?php
// Minimal .env loader — this project has no Composer/vendor autoloading, so
// no vlucas/phpdotenv or similar. Reads transync-backend/.env (gitignored,
// see .env.example) if present, only setting a value when it isn't already
// defined in the real environment (e.g. Apache/php-fpm SetEnv), so a real
// server-level env var always wins over the file.
function loadEnv(string $path): void {
    if (!file_exists($path)) {
        return;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        [$key, $value] = array_pad(explode('=', $line, 2), 2, '');
        $key = trim($key);
        $value = trim($value, " \t\n\r\0\x0B\"'");
        if ($key !== '' && getenv($key) === false) {
            putenv("$key=$value");
        }
    }
}

loadEnv(dirname(__DIR__) . '/.env');

// Public base URL of this backend, used only where a document/file URL must
// be returned as a fully-qualified link (e.g. verify.php/
// pending_operator_applications.php for the admin panel and association
// app's document viewers) instead of a relative path a client prefixes
// itself (see src/config/api.ts's FILE_BASE for that other, preferred
// pattern). Must end with a trailing slash, matching how callers use it.
define('BACKEND_PUBLIC_URL', rtrim(getenv('BACKEND_PUBLIC_URL') ?: 'http://localhost/TranSync-App/transync-backend', '/') . '/');
