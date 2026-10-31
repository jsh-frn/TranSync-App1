<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";
require_once "../../config/auth.php";

$data     = json_decode(file_get_contents("php://input"), true);
$email    = trim($data["email"]    ?? "");
$password = trim($data["password"] ?? "");

if (!$email || !$password) {
    http_response_code(400);
    echo json_encode(["message" => "Email and password are required."]);
    exit;
}

// ── 1. COMMUTER ───────────────────────────────────────────────────────────────
$stmt = $conn->prepare("SELECT * FROM commuters WHERE email = ?");
$stmt->bind_param("s", $email);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();

if ($user && password_verify($password, $user["password"])) {
    if ($user["status"] === "inactive" && !$user["rejected_at"]) {
        http_response_code(403);
        echo json_encode(["message" => "Your account has been deactivated. Please contact support."]);
        exit;
    }
    $category    = $user["category"];
    $is_verified = (int)$user["is_verified"];
    if ($user["rejected_at"]) {
        $category    = "default";
        $is_verified = 0;
    }

    // Student ID verification has a renewal window (10mo K-12 / 5mo
    // college, computed live — no cron in this app, same "check on read"
    // pattern as the Jeepney platform-quota period). Expiry isn't a
    // rejection (no fraud implied, no 48h cooldown), so it's surfaced as
    // its own flag rather than reusing rejected_at, which the mobile client
    // already treats as "admin rejected this, wait out the cooldown." It
    // still has to downgrade $category/$is_verified here too, the same way
    // the rejected_at branch above does — otherwise an expired Student
    // would keep silently getting the discount until they happened to
    // notice the banner and re-verify.
    $student_verification_expired = studentVerificationExpired($conn, (int)$user["id"], $category);
    if ($student_verification_expired) {
        $category    = "default";
        $is_verified = 0;
    }

    // PWD is renewable too (see migration 042 / commuter_register_pwd.php) —
    // a separate, category-scoped check rather than folding this into
    // studentVerificationExpired(), since that field name is read by
    // home.tsx's Student-specific expired banner and must keep meaning
    // "Student" only.
    $pwd_verification_expired = pwdVerificationExpired($conn, (int)$user["id"], $category);
    if ($pwd_verification_expired) {
        $category    = "default";
        $is_verified = 0;
    }

    // Reversible self-service deactivation (Commuter Settings page, migration
    // 045) — a commuter who deactivated their own account reactivates simply
    // by logging back in with the correct password, no admin step. This is
    // deliberately separate from the status/rejected_at gate above, which
    // means something else entirely (admin rejection).
    $reactivated = false;
    if ($user["deactivated_at"]) {
        $reactivateStmt = $conn->prepare("UPDATE commuters SET deactivated_at = NULL WHERE id = ?");
        $reactivateStmt->bind_param("i", $user["id"]);
        $reactivateStmt->execute();
        $reactivated = true;
    }

    // Same signal as commuter/get_profile.php — category/is_verified alone
    // can't tell a plain Regular commuter apart from one with a genuine
    // Student/PWD/Senior submission still awaiting admin review, since both
    // read category='default' the whole time it's pending.
    $pendingStmt = $conn->prepare("
        SELECT id FROM commuter_id_verifications
        WHERE commuter_id = ? AND verification_status = 'pending_review'
        ORDER BY id DESC LIMIT 1
    ");
    $pendingStmt->bind_param("i", $user["id"]);
    $pendingStmt->execute();
    $has_pending_discount_verification = $pendingStmt->get_result()->fetch_assoc() !== null;

    $token = createSession($conn, 'commuter', (int)$user["id"]);
    echo json_encode([
        "message"       => "Login successful",
        "role"          => "commuter",
        "session_token" => $token,
        "user"          => [
            "id"          => $user["id"],
            "name"        => $user["name"],
            // Structured name fields — the initial SELECT already fetches
            // these (SELECT *), just never sent them; Settings' Edit
            // Personal Info form reads them directly, and got_profile.php's
            // own equivalent gap is fixed the same way.
            "first_name"  => $user["first_name"],
            "middle_name" => $user["middle_name"],
            "last_name"   => $user["last_name"],
            "email"       => $user["email"],
            "phone"       => $user["phone"],
            "category"    => $category,
            "is_verified" => $is_verified,
            "status"      => $user["status"],
            "rejected_at" => $user["rejected_at"],
            "rejection_reason" => $user["rejection_reason"],
            "student_verification_expired" => $student_verification_expired,
            "pwd_verification_expired" => $pwd_verification_expired,
            "has_pending_discount_verification" => $has_pending_discount_verification,
            "reactivated" => $reactivated,
            // Relative path — the mobile client prefixes with FILE_BASE, never
            // a hardcoded host (see commuter/get_profile.php's comment).
            "avatar_url"  => $user["avatar_url"],
        ]
    ]);
    exit;
}

// ── 2. DRIVER ─────────────────────────────────────────────────────────────────
$user = findDriver($conn, $email);

if ($user && password_verify($password, $user["password"])) {
    if ($user["status"] === "inactive") {
        http_response_code(403);
        echo json_encode(["message" => "Your driver account is inactive. Contact your operator."]);
        exit;
    }
    if (empty($user["vehicle_id"])) {
        http_response_code(403);
        echo json_encode(["message" => "No vehicle assigned to your account. Contact your operator."]);
        exit;
    }
    $token = createSession($conn, 'driver', (int)$user["id"]);
    echo json_encode(buildDriverResponse($user, $token));
    exit;
}

// ── 3. OPERATOR ───────────────────────────────────────────────────────────────
$stmt = $conn->prepare("SELECT * FROM operators WHERE email = ?");
$stmt->bind_param("s", $email);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();

if ($user && password_verify($password, $user["password"])) {
    if ($user["status"] === "inactive") {
        http_response_code(403);
        echo json_encode(["message" => "Your account has been rejected. Please contact support."]);
        exit;
    }
    $token = createSession($conn, 'operator', (int)$user["id"]);
    echo json_encode([
        "message"       => "Login successful",
        "role"          => "operator",
        "session_token" => $token,
        "user"          => [
            "id"            => $user["id"],
            "name"          => $user["name"],
            "email"         => $user["email"],
            "phone"         => $user["phone"],
            "operator_type" => $user["operator_type"],
            "is_verified"   => (int)$user["is_verified"],
            "status"        => $user["status"],
            "rejected_at"   => $user["rejected_at"],
            "avatar_url"    => $user["avatar_url"],
        ]
    ]);
    exit;
}

// ── 4. ASSOCIATION ────────────────────────────────────────────────────────────
$stmt = $conn->prepare("SELECT * FROM associations WHERE contact_email = ?");
$stmt->bind_param("s", $email);
$stmt->execute();
$assoc = $stmt->get_result()->fetch_assoc();

if ($assoc && password_verify($password, $assoc["password"])) {
    if ($assoc["status"] === "pending") {
        http_response_code(403);
        echo json_encode(["message" => "Your association is pending admin verification. Please wait for approval."]);
        exit;
    }
    if ($assoc["status"] === "inactive") {
        http_response_code(403);
        echo json_encode(["message" => "This association account has been deactivated. Please contact the admin."]);
        exit;
    }
    $token = createSession($conn, 'association', (int)$assoc["id"]);
    echo json_encode([
        "message"       => "Login successful",
        "role"          => "association",
        "session_token" => $token,
        "user"          => [
            "id"               => $assoc["id"],
            "name"             => $assoc["name"],
            "email"            => $assoc["contact_email"],
            "phone"            => $assoc["contact_phone"],
            "address"          => $assoc["address"],
            "status"           => $assoc["status"],
            "association_type" => $assoc["association_type"],
            "avatar_url"       => $assoc["avatar_url"],
        ]
    ]);
    exit;
}

// ── No match in any table ─────────────────────────────────────────────────────
http_response_code(401);
echo json_encode(["message" => "Invalid email or password."]);

// ── Helpers ───────────────────────────────────────────────────────────────────

// True if this commuter's Student category has a lapsed verification —
// checked live against the most recent commuter_id_verifications row, same
// "no cron, compute on read" pattern this app already uses for Jeepney
// platform-quota periods.
function studentVerificationExpired($conn, int $commuterId, string $category): bool {
    if ($category !== "student") return false;
    // Comparison done inside MySQL (expires_at < NOW()), never PHP time()
    // against a DB datetime string — this server's php.ini timezone doesn't
    // match MySQL's actual clock (see the PHP/MySQL clock mismatch note in
    // this codebase's docs), so mixing the two silently skews by hours.
    $stmt = $conn->prepare("
        SELECT (expires_at < NOW()) AS is_expired FROM commuter_id_verifications
        WHERE commuter_id = ? AND verification_status = 'verified' AND expires_at IS NOT NULL
        ORDER BY verified_at DESC LIMIT 1
    ");
    $stmt->bind_param("i", $commuterId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    return $row ? (bool)$row["is_expired"] : false;
}

// PWD's own lapsed-verification check — same shape as
// studentVerificationExpired() (kept as a separate function rather than a
// generic parameterized one, matching this codebase's existing
// per-category-function style, e.g. checkSeniorAge()/checkPwdValidity()),
// but scoped `AND category = ?` in the query itself since, unlike Student
// (which only ever has one possible category to be scoped to already by the
// early-return above), a commuter could in principle carry PWD rows from a
// prior category before switching away — this must only ever match their
// CURRENT category's own latest verified row.
function pwdVerificationExpired($conn, int $commuterId, string $category): bool {
    if ($category !== "disabled") return false;
    $stmt = $conn->prepare("
        SELECT (expires_at < NOW()) AS is_expired FROM commuter_id_verifications
        WHERE commuter_id = ? AND category = 'disabled' AND verification_status = 'verified' AND expires_at IS NOT NULL
        ORDER BY verified_at DESC LIMIT 1
    ");
    $stmt->bind_param("i", $commuterId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    return $row ? (bool)$row["is_expired"] : false;
}

function findDriver($conn, $email) {
    // LEFT JOIN operators: a self-registered driver has no operator yet
    // (operator_id NULL) until an operator approves their application —
    // they must still be able to log in to see/submit that application.
    //
    // "operator_type" here is reported from the DRIVER'S OWN assigned
    // vehicle (v.type), not the operator's now-deprecated fixed
    // operator_type column — an operator can hold multiple vehicle-type
    // memberships now, so only the driver's own vehicle unambiguously says
    // what kind of driver this is. Kept as the same response field name
    // ("operator_type") so the mobile driver dashboard's existing
    // isBusDriver/isUvDriver/isJeepney checks keep working unchanged.
    //
    // Association is derived transitively via the operator's *approved
    // application for that same vehicle type* (operator_association_applications),
    // not operators.association_id (deprecated, single-FK, can't represent
    // multiple simultaneous memberships).
    $sql = "
        SELECT d.*, o.name AS operator_name,
               CASE v.type WHEN 'Jeepney' THEN 'Jeepney Op' WHEN 'UV Express' THEN 'UV Op' WHEN 'Bus' THEN 'Bus Op' ELSE NULL END AS operator_type,
               a.id AS association_id_effective, a.name AS association_name
        FROM drivers d
        LEFT JOIN operators    o ON d.operator_id = o.id
        LEFT JOIN vehicles     v ON d.vehicle_id = v.id
        LEFT JOIN operator_association_applications oaa
               ON oaa.operator_id = d.operator_id AND oaa.vehicle_type = v.type AND oaa.status = 'approved'
        LEFT JOIN associations a ON a.id = oaa.association_id
        WHERE d.email = ?
    ";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param("s", $email);
    $stmt->execute();
    return $stmt->get_result()->fetch_assoc();
}

function buildDriverResponse($user, string $token) {
    return [
        "message"       => "Login successful",
        "role"          => "driver",
        "session_token" => $token,
        "user"          => [
            "id"               => $user["id"],
            "name"             => $user["name"],
            "email"            => $user["email"],
            "phone"            => $user["phone"],
            "license_number"   => $user["license_number"],
            "status"           => $user["status"],
            "operator_id"      => $user["operator_id"],
            "operator_name"    => $user["operator_name"],
            "operator_type"    => $user["operator_type"],
            "association_id"   => $user["association_id_effective"] ?? null,
            "association_name" => $user["association_name"] ?? null,
            "avatar_url"       => $user["avatar_url"],
        ]
    ];
}
