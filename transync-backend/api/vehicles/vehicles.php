<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require_once "../../config/db.php";

$method = $_SERVER['REQUEST_METHOD'];

// ── GET: list vehicles for operator (with assigned driver name) ──────────────
if ($method === 'GET') {
    $operator_id = (int)($_GET['operator_id'] ?? 0);
    if (!$operator_id) {
        http_response_code(400);
        echo json_encode(["message" => "operator_id is required."]);
        exit;
    }

    // "Assigned route(s)" is the vehicle's own route_assignments row
    // (migration 056 — a route belongs to the vehicle itself now, not
    // whoever happens to be driving it; a driver's route is instead a
    // read-through of their currently-assigned vehicle's row).
    $stmt = $conn->prepare("
        SELECT v.id, v.type, v.plate_number, v.vehicle_number, v.bus_number, v.service_type_id, v.capacity, v.status,
               v.driver_id, d.name AS driver_name, st.name AS service_type_name,
               v.association_id, a.name AS association_name,
               r.id AS route_id, r.name AS route_name, r.from_location, r.to_location
        FROM vehicles v
        LEFT JOIN drivers d ON d.id = v.driver_id
        LEFT JOIN bus_service_types st ON st.id = v.service_type_id
        LEFT JOIN associations a ON a.id = v.association_id
        LEFT JOIN route_assignments ra ON ra.vehicle_id = v.id
        LEFT JOIN routes r ON r.id = ra.route_id
        WHERE v.operator_id = ?
        ORDER BY v.created_at DESC
    ");
    $stmt->bind_param("i", $operator_id);
    $stmt->execute();
    $result   = $stmt->get_result();
    $vehicles = [];
    while ($row = $result->fetch_assoc()) {
        $vehicles[] = [
            "id"                => (int)$row["id"],
            "type"              => $row["type"],
            "plate_number"      => $row["plate_number"],
            "vehicle_number"    => $row["vehicle_number"],
            "bus_number"        => $row["bus_number"],
            "service_type_id"   => $row["service_type_id"] ? (int)$row["service_type_id"] : null,
            "service_type_name" => $row["service_type_name"],
            "capacity"          => $row["capacity"] ? (int)$row["capacity"] : null,
            "status"            => $row["status"],
            "driver_id"         => $row["driver_id"]   ? (int)$row["driver_id"]   : null,
            "driver_name"       => $row["driver_name"] ?? null,
            "association_id"    => $row["association_id"]   ? (int)$row["association_id"] : null,
            "association_name"  => $row["association_name"] ?? null,
            "assigned_routes"   => $row["route_id"] ? [[
                "id"   => (int)$row["route_id"],
                "name" => $row["route_name"] ?: "{$row['from_location']} \u{2192} {$row['to_location']}",
            ]] : [],
        ];
    }
    echo json_encode($vehicles);
    exit;
}

// ── POST: register a new vehicle ─────────────────────────────────────────────
if ($method === 'POST') {
    $data           = json_decode(file_get_contents("php://input"), true);
    $operator_id    = (int)($data['operator_id']  ?? 0);
    $type           = trim($data['type']          ?? "");
    $plate_number   = strtoupper(trim($data['plate_number'] ?? ""));
    $vehicle_number = trim($data['vehicle_number'] ?? "");
    $bus_number     = trim($data['bus_number']    ?? "");
    $association_id = (int)($data['association_id'] ?? 0);
    $service_type_id = isset($data['service_type_id']) && $data['service_type_id'] !== "" ? (int)$data['service_type_id'] : null;
    $capacity       = isset($data['capacity']) && $data['capacity'] !== "" ? (int)$data['capacity'] : null;
    // Optional — a route now belongs to the vehicle itself (migration 056),
    // settable right at registration instead of only via Add/Edit Driver.
    $route_id       = isset($data['route_id']) && $data['route_id'] !== "" ? (int)$data['route_id'] : null;

    if (!$operator_id || !$type || !$plate_number || !$vehicle_number || !$association_id) {
        http_response_code(400);
        echo json_encode(["message" => "All fields are required."]);
        exit;
    }

    $valid_types = ["Jeepney", "UV Express", "Bus"];
    if (!in_array($type, $valid_types)) {
        http_response_code(400);
        echo json_encode(["message" => "Invalid vehicle type."]);
        exit;
    }

    // A vehicle now belongs to a SPECIFIC association, not just a vehicle
    // type — an operator can hold the same type approved at several
    // associations at once, so vehicle_type alone no longer identifies which
    // one a new vehicle should register under. The caller (mobile app)
    // always sends the operator's currently active association here.
    $stmt = $conn->prepare("
        SELECT id FROM operator_association_applications
        WHERE operator_id = ? AND vehicle_type = ? AND association_id = ? AND status = 'approved'
    ");
    $stmt->bind_param("isi", $operator_id, $type, $association_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        $stmt->close();
        http_response_code(400);
        echo json_encode(["message" => "You aren't approved for {$type} at this association."]);
        exit;
    }
    $stmt->close();

    // Route must belong to THIS vehicle's own type + association — same
    // check the old driver-level assign_route.php used to run against the
    // driver's vehicle, just checked directly against the vehicle now.
    if ($route_id) {
        $stmt = $conn->prepare("SELECT id FROM routes WHERE id = ? AND vehicle_type = ? AND association_id = ?");
        $stmt->bind_param("isi", $route_id, $type, $association_id);
        $stmt->execute();
        if (!$stmt->get_result()->fetch_assoc()) {
            $stmt->close();
            http_response_code(400);
            echo json_encode(["message" => "Selected route doesn't belong to your association, or doesn't match this vehicle's type."]);
            exit;
        }
        $stmt->close();
    }

    // Seat-count rules differ by vehicle type. Jeepney and UV Express need a
    // capacity up front; Bus doesn't (its seat count/layout is set later via
    // seed_seats.php once a class has been chosen — see that file).
    if ($type === "Jeepney") {
        if (!$capacity || $capacity < 12 || $capacity > 36 || $capacity % 2 !== 0) {
            http_response_code(400);
            echo json_encode(["message" => "Seat count must be an even number between 12 and 36."]);
            exit;
        }
    } elseif ($type === "UV Express") {
        // 9–18 total, including the driver's seat.
        if (!$capacity || $capacity < 9 || $capacity > 18) {
            http_response_code(400);
            echo json_encode(["message" => "Seat count (including the driver) must be between 9 and 18."]);
            exit;
        }
    } elseif ($type === "Bus") {
        if (!$service_type_id) {
            http_response_code(400);
            echo json_encode(["message" => "A class/service type is required for Bus vehicles."]);
            exit;
        }
        // Must belong to THIS vehicle's own association (already confirmed
        // approved above) — operators can only assign a class their
        // association has defined, never invent their own or borrow one
        // from a different association they also happen to be approved at.
        $stmt = $conn->prepare("SELECT id FROM bus_service_types WHERE id = ? AND association_id = ?");
        $stmt->bind_param("ii", $service_type_id, $association_id);
        $stmt->execute();
        if (!$stmt->get_result()->fetch_assoc()) {
            http_response_code(400);
            echo json_encode(["message" => "Selected class does not belong to your association."]);
            exit;
        }
        // Capacity/seat layout is set later via seed_seats.php, once — not asked here.
        $capacity = null;
    }

    // Validate Philippine LTO plate format: 3 uppercase letters + space + 3–4 digits
    if (!preg_match('/^[A-Z]{3} \d{3,4}$/', $plate_number)) {
        http_response_code(400);
        echo json_encode(["message" => "Invalid plate number format. Use ABC 1234 (3 letters + 3–4 digits)."]);
        exit;
    }

    // Check plate uniqueness
    $stmt = $conn->prepare("SELECT id FROM vehicles WHERE plate_number = ?");
    $stmt->bind_param("s", $plate_number);
    $stmt->execute();
    if ($stmt->get_result()->fetch_assoc()) {
        http_response_code(409);
        echo json_encode(["message" => "Plate number is already registered."]);
        exit;
    }

    $stmt = $conn->prepare("
        INSERT INTO vehicles (operator_id, association_id, type, plate_number, vehicle_number, bus_number, service_type_id, capacity, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    ");
    $busNumberVal = $bus_number !== "" ? $bus_number : null;
    $stmt->bind_param("iissssii", $operator_id, $association_id, $type, $plate_number, $vehicle_number, $busNumberVal, $service_type_id, $capacity);
    if ($stmt->execute()) {
        $vehicleId = $conn->insert_id;

        if ($route_id) {
            $raStmt = $conn->prepare("INSERT INTO route_assignments (route_id, vehicle_id) VALUES (?, ?)");
            $raStmt->bind_param("ii", $route_id, $vehicleId);
            $raStmt->execute();
        }

        // Best-effort: clears the registration wizard's "finish adding your
        // vehicle" reminder on the matching approved application, if any
        // (see migration 055) — never blocks the actual vehicle registration
        // above, which already succeeded regardless of this outcome.
        $clearReminder = $conn->prepare("
            UPDATE operator_association_applications
            SET vehicle_added = 1
            WHERE operator_id = ? AND vehicle_type = ? AND association_id = ? AND status = 'approved'
        ");
        $clearReminder->bind_param("isi", $operator_id, $type, $association_id);
        $clearReminder->execute();

        echo json_encode(["message" => "Vehicle registered.", "id" => $vehicleId]);
    } else {
        http_response_code(500);
        echo json_encode(["message" => "Failed to register vehicle.", "error" => $conn->error]);
    }
    exit;
}

// ── PUT: toggle status  OR  unassign driver ──────────────────────────────────
if ($method === 'PUT') {
    $data   = json_decode(file_get_contents("php://input"), true);
    $id     = (int)($data['id']     ?? 0);
    $action = trim($data['action']  ?? "status");

    if (!$id) {
        http_response_code(400);
        echo json_encode(["message" => "id is required."]);
        exit;
    }

    // Assign a driver to this vehicle (re-activation flow)
    if ($action === 'assign') {
        $driver_id = (int)($data['driver_id'] ?? 0);
        if (!$driver_id) {
            http_response_code(400);
            echo json_encode(["message" => "driver_id is required."]);
            exit;
        }
        $conn->begin_transaction();
        try {
            // Verify vehicle is currently unassigned
            $stmt = $conn->prepare("SELECT driver_id FROM vehicles WHERE id = ?");
            $stmt->bind_param("i", $id);
            $stmt->execute();
            $vRow = $stmt->get_result()->fetch_assoc();
            if (!$vRow) {
                $conn->rollback();
                http_response_code(404);
                echo json_encode(["message" => "Vehicle not found."]);
                exit;
            }
            if (!empty($vRow['driver_id'])) {
                $conn->rollback();
                http_response_code(409);
                echo json_encode(["message" => "Vehicle is already assigned to another driver."]);
                exit;
            }

            // Link vehicle → driver
            $stmt = $conn->prepare("UPDATE vehicles SET driver_id = ? WHERE id = ?");
            $stmt->bind_param("ii", $driver_id, $id);
            $stmt->execute();

            // Link driver → vehicle and reactivate account
            $stmt = $conn->prepare("UPDATE drivers SET vehicle_id = ?, status = 'active' WHERE id = ?");
            $stmt->bind_param("ii", $id, $driver_id);
            $stmt->execute();

            $conn->commit();
            echo json_encode(["message" => "Vehicle assigned. Driver account reactivated."]);
        } catch (Exception $e) {
            $conn->rollback();
            http_response_code(500);
            echo json_encode(["message" => "Failed to assign vehicle.", "error" => $e->getMessage()]);
        }
        exit;
    }

    // Unassign driver from vehicle and deactivate driver account
    if ($action === 'unassign') {
        $conn->begin_transaction();
        try {
            // Get the current driver_id
            $stmt = $conn->prepare("SELECT driver_id FROM vehicles WHERE id = ?");
            $stmt->bind_param("i", $id);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            if ($row && $row['driver_id']) {
                $driver_id = (int)$row['driver_id'];
                // Clear vehicle_id on driver and deactivate their account
                $stmt = $conn->prepare("UPDATE drivers SET vehicle_id = NULL, status = 'inactive' WHERE id = ?");
                $stmt->bind_param("i", $driver_id);
                $stmt->execute();
            }
            // Clear driver_id on vehicle
            $stmt = $conn->prepare("UPDATE vehicles SET driver_id = NULL WHERE id = ?");
            $stmt->bind_param("i", $id);
            $stmt->execute();
            $conn->commit();
            echo json_encode(["message" => "Driver unassigned. Driver account deactivated until a new vehicle is assigned."]);
        } catch (Exception $e) {
            $conn->rollback();
            http_response_code(500);
            echo json_encode(["message" => "Failed to unassign driver.", "error" => $e->getMessage()]);
        }
        exit;
    }

    // Update bus number / service type (Bus-specific details). Capacity is
    // no longer set here for Bus — it's set by seed_seats.php together with
    // the seat layout, since the two must stay in sync.
    if ($action === 'update_details') {
        $bus_number       = trim($data['bus_number'] ?? "");
        $service_type_id  = isset($data['service_type_id']) && $data['service_type_id'] !== "" ? (int)$data['service_type_id'] : null;
        $busNumberVal     = $bus_number !== "" ? $bus_number : null;

        // All-or-nothing: every validation exit below leaves the transaction
        // uncommitted (mysqli rolls it back on close), so a bad plate/capacity
        // never leaves the other fields half-saved.
        $conn->begin_transaction();

        // A vehicle's class and its seat layout must stay consistent — block
        // an actual class change while a layout still exists for the old
        // class, rather than letting the class label silently drift out of
        // sync with the seats/capacity underneath it. Clearing the layout
        // first (save_seat_layout.php with seats: []) unblocks this.
        $stmt = $conn->prepare("SELECT service_type_id, type, association_id, operator_id FROM vehicles WHERE id = ?");
        $stmt->bind_param("i", $id);
        $stmt->execute();
        $current = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$current) {
            http_response_code(404);
            echo json_encode(["message" => "Vehicle not found."]);
            exit;
        }

        if ($current && (int)($current["service_type_id"] ?? 0) !== (int)$service_type_id) {
            $stmt = $conn->prepare("SELECT COUNT(*) AS n FROM seats WHERE vehicle_id = ?");
            $stmt->bind_param("i", $id);
            $stmt->execute();
            $seatCount = (int)($stmt->get_result()->fetch_assoc()["n"] ?? 0);
            $stmt->close();

            if ($seatCount > 0) {
                http_response_code(409);
                echo json_encode(["message" => "This vehicle already has a seat layout for its current class. Clear its seat layout before changing class."]);
                exit;
            }
        }

        $stmt = $conn->prepare("UPDATE vehicles SET bus_number = ?, service_type_id = ? WHERE id = ?");
        $stmt->bind_param("sii", $busNumberVal, $service_type_id, $id);
        $stmt->execute();

        // vehicle_number applies to every type — only touched when supplied,
        // so this action stays safe to call from the Bus-specific edit form
        // without clobbering it when the form doesn't include the field.
        if (isset($data['vehicle_number']) && trim($data['vehicle_number']) !== "") {
            $vehicle_number = trim($data['vehicle_number']);
            $stmt = $conn->prepare("UPDATE vehicles SET vehicle_number = ? WHERE id = ?");
            $stmt->bind_param("si", $vehicle_number, $id);
            $stmt->execute();
        }

        // Plate number — only touched when supplied (e.g. reissued after a
        // lost/damaged plate). Was previously never editable after
        // registration at all. Same format + uniqueness rules as
        // registration; excludes this vehicle's own current row from the
        // uniqueness check so resubmitting the same plate is never an error.
        if (isset($data['plate_number']) && trim($data['plate_number']) !== "") {
            $plate_number = strtoupper(trim($data['plate_number']));
            if (!preg_match('/^[A-Z]{3} \d{3,4}$/', $plate_number)) {
                http_response_code(400);
                echo json_encode(["message" => "Invalid plate number format. Use ABC 1234 (3 letters + 3–4 digits)."]);
                exit;
            }
            $stmt = $conn->prepare("SELECT id FROM vehicles WHERE plate_number = ? AND id != ?");
            $stmt->bind_param("si", $plate_number, $id);
            $stmt->execute();
            if ($stmt->get_result()->fetch_assoc()) {
                http_response_code(409);
                echo json_encode(["message" => "Plate number is already registered to another vehicle."]);
                exit;
            }
            $stmt->close();
            $stmt = $conn->prepare("UPDATE vehicles SET plate_number = ? WHERE id = ?");
            $stmt->bind_param("si", $plate_number, $id);
            $stmt->execute();
        }

        // Capacity — Jeepney / UV Express only, same rules as registration.
        // Bus capacity is owned by the Seat Layout Builder (save_seat_layout.php)
        // and is never settable here.
        if (isset($data['capacity']) && $data['capacity'] !== "" && in_array($current['type'], ["Jeepney", "UV Express"], true)) {
            $newCapacity = (int)$data['capacity'];
            if ($current['type'] === "Jeepney" && ($newCapacity < 12 || $newCapacity > 36 || $newCapacity % 2 !== 0)) {
                http_response_code(400);
                echo json_encode(["message" => "Seat count must be an even number between 12 and 36."]);
                exit;
            }
            if ($current['type'] === "UV Express" && ($newCapacity < 9 || $newCapacity > 18)) {
                http_response_code(400);
                echo json_encode(["message" => "Seat count (including the driver) must be between 9 and 18."]);
                exit;
            }
            $stmt = $conn->prepare("UPDATE vehicles SET capacity = ? WHERE id = ?");
            $stmt->bind_param("ii", $newCapacity, $id);
            $stmt->execute();
            $stmt->close();
        }

        // Route reassignment — optional. `unassign_route:true` clears it;
        // a `route_id` validates against this vehicle's own type +
        // association (same rule as registration above), then upserts,
        // keyed by vehicle_id (migration 056 — one active route per vehicle).
        if (!empty($data['unassign_route'])) {
            $stmt = $conn->prepare("DELETE FROM route_assignments WHERE vehicle_id = ?");
            $stmt->bind_param("i", $id);
            $stmt->execute();
        } elseif (isset($data['route_id']) && $data['route_id'] !== "") {
            $newRouteId = (int)$data['route_id'];
            $vType  = $current['type']           ?? null;
            $vAssoc = $current['association_id'] ?? null;
            if (!$vAssoc) {
                // Older vehicle with no saved association: if this operator
                // has exactly ONE approved association for this vehicle type
                // there's no ambiguity — use (and save) it.
                $stmt = $conn->prepare("
                    SELECT association_id FROM operator_association_applications
                    WHERE operator_id = ? AND vehicle_type = ? AND status = 'approved'
                ");
                $stmt->bind_param("is", $current['operator_id'], $vType);
                $stmt->execute();
                $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                $stmt->close();
                if (count($rows) === 1) {
                    $vAssoc = (int)$rows[0]['association_id'];
                    $stmt = $conn->prepare("UPDATE vehicles SET association_id = ? WHERE id = ?");
                    $stmt->bind_param("ii", $vAssoc, $id);
                    $stmt->execute();
                    $stmt->close();
                }
            }
            $stmt = $conn->prepare("SELECT id FROM routes WHERE id = ? AND vehicle_type = ? AND association_id = ?");
            $stmt->bind_param("isi", $newRouteId, $vType, $vAssoc);
            $stmt->execute();
            if (!$stmt->get_result()->fetch_assoc()) {
                $stmt->close();
                http_response_code(400);
                echo json_encode(["message" => "Selected route doesn't belong to your association, or doesn't match this vehicle's type."]);
                exit;
            }
            $stmt->close();
            $stmt = $conn->prepare("
                INSERT INTO route_assignments (route_id, vehicle_id)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE route_id = VALUES(route_id), assigned_at = NOW()
            ");
            $stmt->bind_param("ii", $newRouteId, $id);
            $stmt->execute();
        }

        $conn->commit();
        echo json_encode(["message" => "Vehicle details updated."]);
        exit;
    }

    // Default: toggle status
    $status = trim($data['status'] ?? "");
    if (!in_array($status, ["active", "inactive"])) {
        http_response_code(400);
        echo json_encode(["message" => "Valid status is required."]);
        exit;
    }
    $stmt = $conn->prepare("UPDATE vehicles SET status = ? WHERE id = ?");
    $stmt->bind_param("si", $status, $id);
    $stmt->execute();
    echo json_encode(["message" => "Vehicle updated."]);
    exit;
}

// ── DELETE: remove vehicle ───────────────────────────────────────────────────
if ($method === 'DELETE') {
    $data = json_decode(file_get_contents("php://input"), true);
    $id   = (int)($data['id'] ?? 0);

    if (!$id) {
        http_response_code(400);
        echo json_encode(["message" => "id is required."]);
        exit;
    }

    // Unlink from driver before deleting
    $stmt = $conn->prepare("UPDATE drivers SET vehicle_id = NULL WHERE vehicle_id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();

    $stmt = $conn->prepare("DELETE FROM vehicles WHERE id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(["message" => "Vehicle removed."]);
    exit;
}

http_response_code(405);
echo json_encode(["message" => "Method not allowed."]);
