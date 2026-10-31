<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";
require_once "../../config/auth.php";

requireAuth($conn, ['admin']);

// ── DELETE ────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $id   = (int)($_GET['id']   ?? 0);
    $type = trim($_GET['type'] ?? "");

    if (!$id || !$type) {
        http_response_code(400);
        echo json_encode(["message" => "Missing id or type."]);
        exit;
    }

    $conn->begin_transaction();
    try {
        if ($type === 'association') {
            // Routes are SET NULL on association delete — delete them explicitly.
            // route_assignments, route_waypoints, fare_matrix, bookings cascade from routes via FK.
            $s = $conn->prepare("DELETE FROM routes WHERE association_id = ?");
            $s->bind_param("i", $id); $s->execute();

            // association_applications and association_memberships cascade via FK.
            // drivers.association_id and vehicles.association_id are SET NULL via FK.
            $s = $conn->prepare("DELETE FROM associations WHERE id = ?");
            $s->bind_param("i", $id); $s->execute();

        } elseif ($type === 'operator') {
            // Collect driver IDs before cascading so we can clean wallet_transactions (no FK).
            $s = $conn->prepare("SELECT id FROM drivers WHERE operator_id = ?");
            $s->bind_param("i", $id); $s->execute();
            $rows = $s->get_result()->fetch_all(MYSQLI_ASSOC);
            $driver_ids = array_column($rows, 'id');

            if ($driver_ids) {
                $ph    = implode(',', array_fill(0, count($driver_ids), '?'));
                $types = str_repeat('i', count($driver_ids));
                $s = $conn->prepare("DELETE FROM wallet_transactions WHERE owner_type = 'driver' AND owner_id IN ($ph)");
                $s->bind_param($types, ...$driver_ids); $s->execute();
            }

            // Routes have no FK to operators — delete explicitly.
            // route_assignments, route_waypoints, fare_matrix, bookings cascade from routes via FK.
            $s = $conn->prepare("DELETE FROM routes WHERE operator_id = ?");
            $s->bind_param("i", $id); $s->execute();

            // drivers, vehicles, dispatch_queue, terminals, association_applications,
            // association_memberships all cascade via FK.
            $s = $conn->prepare("DELETE FROM operators WHERE id = ?");
            $s->bind_param("i", $id); $s->execute();

        } elseif ($type === 'commuter') {
            // wallet_transactions has no FK — delete explicitly.
            $s = $conn->prepare("DELETE FROM wallet_transactions WHERE owner_type = 'commuter' AND owner_id = ?");
            $s->bind_param("i", $id); $s->execute();

            // wallets, jeepney_rides, reservations, bookings, transactions all cascade via FK.
            $s = $conn->prepare("DELETE FROM commuters WHERE id = ?");
            $s->bind_param("i", $id); $s->execute();

        } else {
            $conn->rollback();
            http_response_code(400);
            echo json_encode(["message" => "Invalid type."]);
            exit;
        }

        $conn->commit();
        echo json_encode(["message" => "Deleted successfully."]);

    } catch (Exception $e) {
        $conn->rollback();
        http_response_code(500);
        echo json_encode(["message" => "Delete failed: " . $e->getMessage()]);
    }
    exit;
}

// ── GET ───────────────────────────────────────────────────────────────────────
$type = trim($_GET['type'] ?? 'commuter');

if ($type === 'association') {
    // association_type is deprecated — an association is no longer a single
    // fixed vehicle type, it can have operator members of any/all types.
    $result = $conn->query("
        SELECT
            id,
            name,
            contact_email    AS email,
            contact_phone    AS phone,
            address,
            'Association'    AS role,
            status,
            DATE_FORMAT(created_at, '%b %d, %Y') AS date_added
        FROM associations
        ORDER BY created_at DESC
    ");

    $list = [];
    while ($row = $result->fetch_assoc()) $list[] = $row;
    echo json_encode($list);
    exit;
}

if ($type === 'commuter') {
    // rejected_at/rejection_reason let the frontend distinguish a genuinely
    // still-pending applicant (is_verified=0, rejected_at NULL) from one the
    // admin already rejected (is_verified=0, rejected_at set) — both look
    // identical on is_verified alone, which is what made the "Verified"
    // column show "Pending" forever for a rejected user before this.
    $result = $conn->query("
        SELECT
            id, name, email,
            category        AS role,
            status,
            is_verified,
            rejected_at,
            rejection_reason,
            (
                discount_id_url IS NOT NULL
                OR EXISTS (
                    SELECT 1 FROM commuter_id_verifications v
                    WHERE v.commuter_id = commuters.id AND v.verification_status = 'pending_review'
                )
            ) AS has_pending_discount,
            DATE_FORMAT(created_at, '%b %d, %Y') AS date_added
        FROM commuters
        ORDER BY created_at DESC
    ");

    $list = [];
    while ($row = $result->fetch_assoc()) $list[] = $row;
    echo json_encode($list);
    exit;
}

if ($type === 'operator') {
    // operator_type is deprecated — an operator can hold multiple vehicle-type
    // memberships now, so "role" is a live summary of their approved types.
    $result = $conn->query("
        SELECT
            o.id, o.name, o.email,
            COALESCE(
                (SELECT GROUP_CONCAT(DISTINCT vehicle_type ORDER BY vehicle_type SEPARATOR ', ')
                 FROM operator_association_applications
                 WHERE operator_id = o.id AND status = 'approved'),
                'Unassigned'
            ) AS role,
            o.status,
            o.is_verified,
            o.rejected_at,
            o.rejection_reason,
            DATE_FORMAT(o.created_at, '%b %d, %Y') AS date_added
        FROM operators o
        ORDER BY o.created_at DESC
    ");

    $list = [];
    while ($row = $result->fetch_assoc()) $list[] = $row;
    echo json_encode($list);
    exit;
}

http_response_code(400);
echo json_encode(["message" => "Unknown type '$type'. Must be commuter, operator, or association."]);