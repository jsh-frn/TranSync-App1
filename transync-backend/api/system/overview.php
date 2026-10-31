<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";
require_once "../../config/auth.php";

requireAuth($conn, ['admin']);

// Commuters
$total_commuters    = $conn->query("SELECT COUNT(*) AS c FROM commuters")->fetch_assoc()['c'];
$verified_commuters = $conn->query("SELECT COUNT(*) AS c FROM commuters WHERE is_verified = 1")->fetch_assoc()['c'];
// Mirrors the filter in verify.php: exclude rejected users (rejected_at IS NOT NULL)
// and only count those who actually submitted a discount document or have a non-default category
$pending_commuters  = $conn->query("
    SELECT COUNT(*) AS c FROM commuters
    WHERE is_verified = 0
      AND rejected_at IS NULL
      AND (category != 'default' OR discount_id_url IS NOT NULL)
")->fetch_assoc()['c'];

// Operators
$total_operators    = $conn->query("SELECT COUNT(*) AS c FROM operators")->fetch_assoc()['c'];
$verified_operators = $conn->query("SELECT COUNT(*) AS c FROM operators WHERE is_verified = 1")->fetch_assoc()['c'];
// Mirrors verify.php: exclude rejected operators (rejected_at IS NOT NULL)
$pending_operators  = $conn->query("
    SELECT COUNT(*) AS c FROM operators
    WHERE is_verified = 0
      AND rejected_at IS NULL
")->fetch_assoc()['c'];

// Associations
$total_associations    = $conn->query("SELECT COUNT(*) AS c FROM associations")->fetch_assoc()['c'];
$active_associations   = $conn->query("SELECT COUNT(*) AS c FROM associations WHERE status = 'active'")->fetch_assoc()['c'];
$pending_associations  = $conn->query("SELECT COUNT(*) AS c FROM associations WHERE status = 'pending'")->fetch_assoc()['c'];

// Vehicles
$total_vehicles = $conn->query("SELECT COUNT(*) AS c FROM vehicles")->fetch_assoc()['c'];
$jeepneys       = $conn->query("SELECT COUNT(*) AS c FROM vehicles WHERE type = 'Jeepney'")->fetch_assoc()['c'];
$uvs            = $conn->query("SELECT COUNT(*) AS c FROM vehicles WHERE type = 'UV Express'")->fetch_assoc()['c'];
$buses          = $conn->query("SELECT COUNT(*) AS c FROM vehicles WHERE type = 'Bus'")->fetch_assoc()['c'];

// Drivers
$total_drivers = $conn->query("SELECT COUNT(*) AS c FROM drivers")->fetch_assoc()['c'];

// Routes
$total_routes = $conn->query("SELECT COUNT(*) AS c FROM routes")->fetch_assoc()['c'];

// Pending applications (association approvals)
$pending_applications = $conn->query("
    SELECT COUNT(*) AS c FROM association_applications WHERE status = 'pending'
")->fetch_assoc()['c'];

// Recent commuters
$recent_result = $conn->query("
    SELECT name, email, category AS role, status,
           DATE_FORMAT(created_at, '%b %d, %Y') AS date_added
    FROM commuters
    ORDER BY created_at DESC
    LIMIT 5
");
$recent_users = [];
while ($row = $recent_result->fetch_assoc()) $recent_users[] = $row;

echo json_encode([
    "commuters" => [
        "total"    => (int)$total_commuters,
        "verified" => (int)$verified_commuters,
        "pending"  => (int)$pending_commuters,
    ],
    "operators" => [
        "total"    => (int)$total_operators,
        "verified" => (int)$verified_operators,
        "pending"  => (int)$pending_operators,
    ],
    "associations" => [
        "total"   => (int)$total_associations,
        "active"  => (int)$active_associations,
        "pending" => (int)$pending_associations,
    ],
    "vehicles" => [
        "total"    => (int)$total_vehicles,
        "jeepneys" => (int)$jeepneys,
        "uvs"      => (int)$uvs,
        "buses"    => (int)$buses,
    ],
    "drivers"              => (int)$total_drivers,
    "routes"               => (int)$total_routes,
    "pending_applications" => (int)$pending_applications,
    "recent_users"         => $recent_users,
]);