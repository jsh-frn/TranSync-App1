<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once __DIR__ . "/../../config/db.php";

// Read-only on purpose — there is still no POST/PUT/DELETE in this file.
// Category rows themselves are fixed; only the PDF behind a category can be
// swapped, and only via the separate, admin-only
// reference/update_ltfrb_fare_guide.php. Optional ?vehicle_type= filter;
// omitted returns every guide (commuter's own screen fetches all and groups
// client-side).
$vehicle_type = trim($_GET['vehicle_type'] ?? '');
$admin_view   = ($_GET['admin'] ?? '') === '1';

if ($vehicle_type !== '') {
    $stmt = $conn->prepare("
        SELECT id, vehicle_type, label, file_path, sort_order, updated_at
        FROM ltfrb_fare_guides
        WHERE vehicle_type = ?
        ORDER BY sort_order ASC, id ASC
    ");
    $stmt->bind_param("s", $vehicle_type);
} else {
    $stmt = $conn->prepare("
        SELECT id, vehicle_type, label, file_path, sort_order, updated_at
        FROM ltfrb_fare_guides
        ORDER BY vehicle_type ASC, sort_order ASC, id ASC
    ");
}
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

// "url" is a bare relative path (e.g. "uploads/ltfrb_fare_guides/xxx.pdf")
// by default — never prefixed with a hardcoded host here, since a
// "http://localhost/..." prefix only ever resolves on Expo web, never on a
// physical device/emulator (see Core Flow 8f's avatar_url fix for the same
// root cause). The mobile client prefixes with its own FILE_BASE at the
// point of use. The admin panel has no such client-side base-URL concept
// (see verify.php's identical BACKEND_PUBLIC_URL prefixing), so it opts in
// via ?admin=1 to get an already-absolute, directly-openable link instead.
$base_url = $admin_view ? BACKEND_PUBLIC_URL : '';
$guides = array_map(function ($row) use ($base_url) {
    return [
        "id"           => (int)$row["id"],
        "vehicle_type" => $row["vehicle_type"],
        "label"        => $row["label"],
        "url"          => $base_url . $row["file_path"],
        "sort_order"   => (int)$row["sort_order"],
        "updated_at"   => $row["updated_at"],
    ];
}, $rows);

echo json_encode(["success" => true, "guides" => $guides]);
