<?php
/**
 * Token-based session helpers.
 * Include after config/db.php is already required.
 *
 * createSession()  — call on login to issue a new token.
 * requireAuth()    — call at the top of any protected endpoint.
 * destroySession() — call on logout to invalidate a token.
 */

function createSession($conn, string $owner_type, int $owner_id, int $days = 30): string {
    $token      = bin2hex(random_bytes(32)); // 64-char hex, cryptographically secure
    $expires_at = date('Y-m-d H:i:s', strtotime("+{$days} days"));

    $stmt = $conn->prepare(
        "INSERT INTO sessions (token, owner_type, owner_id, expires_at) VALUES (?, ?, ?, ?)"
    );
    $stmt->bind_param("ssis", $token, $owner_type, $owner_id, $expires_at);
    $stmt->execute();

    return $token;
}

function getAuthorizationHeader(): string {
    // $_SERVER['HTTP_AUTHORIZATION'] is stripped by Apache in many XAMPP setups.
    // apache_request_headers() is the reliable fallback.
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!$h && function_exists('apache_request_headers')) {
        $all = apache_request_headers();
        $h   = $all['Authorization'] ?? $all['authorization'] ?? '';
    }
    return $h;
}

function requireAuth($conn, array $allowed_types = []): array {
    $header = getAuthorizationHeader();

    if (!preg_match('/^Bearer\s+(\S+)$/', $header, $m)) {
        http_response_code(401);
        echo json_encode(["message" => "Authentication required."]);
        exit;
    }

    $token = $m[1];
    $stmt  = $conn->prepare(
        "SELECT owner_type, owner_id FROM sessions WHERE token = ? AND expires_at > NOW()"
    );
    $stmt->bind_param("s", $token);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();

    if (!$row) {
        http_response_code(401);
        echo json_encode(["message" => "Invalid or expired session. Please log in again."]);
        exit;
    }

    if (!empty($allowed_types) && !in_array($row['owner_type'], $allowed_types, true)) {
        http_response_code(403);
        echo json_encode(["message" => "Access denied."]);
        exit;
    }

    return $row; // ['owner_type' => '...', 'owner_id' => int]
}

function destroySession($conn, string $token): void {
    $stmt = $conn->prepare("DELETE FROM sessions WHERE token = ?");
    $stmt->bind_param("s", $token);
    $stmt->execute();
}
