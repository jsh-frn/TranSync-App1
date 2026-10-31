<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once "../../config/db.php";
require_once "../../config/account_validation.php";

$method = $_SERVER['REQUEST_METHOD'];

// ── GET: list drivers for operator ──
if ($method === 'GET') {
    $operator_id = $_GET['operator_id'] ?? null;
    if (!$operator_id) {
        http_response_code(400);
        echo json_encode(["message" => "operator_id is required."]);
        exit;
    }
    $stmt = $conn->prepare("
        SELECT d.id, d.name, d.email, d.phone, d.license_number, d.status,
               d.vehicle_id, v.type AS vehicle_type, v.plate_number AS vehicle_plate,
               v.association_id AS vehicle_association_id,
               r.id AS route_id, r.name AS route_name, r.from_location, r.to_location
        FROM drivers d
        LEFT JOIN vehicles v ON v.id = d.vehicle_id
        LEFT JOIN route_assignments ra ON ra.vehicle_id = d.vehicle_id
        LEFT JOIN routes r ON r.id = ra.route_id
        WHERE d.operator_id = ?
        ORDER BY d.created_at DESC
    ");
    $stmt->bind_param("i", $operator_id);
    $stmt->execute();
    $result  = $stmt->get_result();
    $drivers = [];
    while ($row = $result->fetch_assoc()) {
        $drivers[] = [
            "id"            => (int)$row["id"],
            "name"          => $row["name"],
            "email"         => $row["email"],
            "phone"         => $row["phone"],
            "license_number"=> $row["license_number"],
            "status"        => $row["status"],
            "vehicle_id"    => $row["vehicle_id"]    ? (int)$row["vehicle_id"]    : null,
            "vehicle_type"  => $row["vehicle_type"]  ?? null,
            "vehicle_plate" => $row["vehicle_plate"] ?? null,
            // Which association this driver's CURRENT vehicle belongs to —
            // an operator can hold the same vehicle_type approved at several
            // associations at once, so vehicle_type alone can't disambiguate
            // which workspace a driver belongs to (see Switch Association).
            "vehicle_association_id" => $row["vehicle_association_id"] ? (int)$row["vehicle_association_id"] : null,
            "route_id"      => $row["route_id"] ? (int)$row["route_id"] : null,
            "route_name"    => $row["route_id"]
                ? ($row["route_name"] ?: "{$row['from_location']} \u{2192} {$row['to_location']}")
                : null,
        ];
    }
    echo json_encode($drivers);
    exit;
}

// ── POST: register driver ──
if ($method === 'POST') {
    $data           = json_decode(file_get_contents("php://input"), true);
    $operator_id    = (int)($data['operator_id'] ?? 0);
    $name           = trim($data['name']         ?? "");
    $email          = trim($data['email']        ?? "");
    $phone          = trim($data['phone']        ?? "");
    $license_number = strtoupper(trim($data['license'] ?? ""));
    $password       = $data['password']          ?? "";
    $vehicle_id     = (int)($data['vehicle_id']  ?? 0);

    if (!$operator_id || !$name || !$email || !$phone || !$license_number || !$password) {
        http_response_code(400);
        echo json_encode(["message" => "All fields are required."]);
        exit;
    }

    // Validate Philippine mobile number format: 09XX-XXX-XXXX
    if (!preg_match('/^09\d{2}-\d{3}-\d{4}$/', $phone)) {
        http_response_code(400);
        echo json_encode(["message" => "Invalid phone number format. Use 09XX-XXX-XXXX (e.g. 0917-123-4567)."]);
        exit;
    }

    // Validate Philippine LTO license format: A##-##-######
    if (!preg_match('/^[A-Z]\d{2}-\d{2}-\d{6}$/', $license_number)) {
        http_response_code(400);
        echo json_encode(["message" => "Invalid license number format. Use A##-##-###### (e.g. N01-00-000000)."]);
        exit;
    }

    // Check license uniqueness
    $stmt = $conn->prepare("SELECT id FROM drivers WHERE license_number = ?");
    $stmt->bind_param("s", $license_number);
    $stmt->execute();
    if ($stmt->get_result()->fetch_assoc()) {
        http_response_code(409);
        echo json_encode(["message" => "License number is already registered."]);
        exit;
    }

    // Check email format + uniqueness across every login-eligible table, not
    // just drivers — see commuter_register.php's identical note.
    if (!isValidEmailFormat($email)) {
        http_response_code(400);
        echo json_encode(["message" => "Please enter a valid email address."]);
        exit;
    }
    if (emailAlreadyRegistered($conn, $email)) {
        http_response_code(409);
        echo json_encode(["message" => "Email is already registered."]);
        exit;
    }

    // Check phone uniqueness
    $stmt = $conn->prepare("SELECT id FROM drivers WHERE phone = ?");
    $stmt->bind_param("s", $phone);
    $stmt->execute();
    if ($stmt->get_result()->fetch_assoc()) {
        http_response_code(409);
        echo json_encode(["message" => "Phone number is already registered."]);
        exit;
    }

    // Validate vehicle belongs to operator and is unassigned (if provided)
    if ($vehicle_id) {
        $stmt = $conn->prepare("SELECT id FROM vehicles WHERE id = ? AND operator_id = ? AND (driver_id IS NULL OR driver_id = 0)");
        $stmt->bind_param("ii", $vehicle_id, $operator_id);
        $stmt->execute();
        if (!$stmt->get_result()->fetch_assoc()) {
            http_response_code(400);
            echo json_encode(["message" => "Selected vehicle is unavailable or does not belong to you."]);
            exit;
        }
    }

    $hashed = password_hash($password, PASSWORD_BCRYPT);
    $vid    = $vehicle_id ?: null;

    $conn->begin_transaction();
    try {
        $stmt = $conn->prepare("INSERT INTO drivers (operator_id, name, email, phone, password, license_number, vehicle_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')");
        $stmt->bind_param("isssssi", $operator_id, $name, $email, $phone, $hashed, $license_number, $vid);
        $stmt->execute();
        $driver_id = $conn->insert_id;

        if ($vehicle_id) {
            $stmt = $conn->prepare("UPDATE vehicles SET driver_id = ? WHERE id = ?");
            $stmt->bind_param("ii", $driver_id, $vehicle_id);
            $stmt->execute();
        }

        $conn->commit();
        echo json_encode(["message" => "Driver registered.", "id" => $driver_id]);
    } catch (Exception $e) {
        $conn->rollback();
        http_response_code(500);
        echo json_encode(["message" => "Failed to register driver.", "error" => $e->getMessage()]);
    }
    exit;
}

// ── PUT: update driver details or status ──
if ($method === 'PUT') {
    $data   = json_decode(file_get_contents("php://input"), true);
    $id     = (int)($data['id'] ?? 0);
    $action = trim($data['action'] ?? "status");

    if (!$id) {
        http_response_code(400);
        echo json_encode(["message" => "id is required."]);
        exit;
    }

    // Edit a driver's own details (name/email/phone/license, optionally
    // password and vehicle assignment too) — separate from the plain status
    // toggle, same format rules as registration.
    if ($action === 'update_details') {
        $name           = trim($data['name']  ?? "");
        $email          = trim($data['email'] ?? "");
        $phone          = trim($data['phone'] ?? "");
        $license_number = strtoupper(trim($data['license'] ?? ""));
        $password       = trim($data['password'] ?? ""); // optional — blank means unchanged
        $operator_id    = (int)($data['operator_id'] ?? 0);
        $vehicle_id     = isset($data['vehicle_id']) && $data['vehicle_id'] !== "" ? (int)$data['vehicle_id'] : null;

        if (!$name || !$email || !$phone || !$license_number) {
            http_response_code(400);
            echo json_encode(["message" => "All fields are required."]);
            exit;
        }
        if (!preg_match('/^09\d{2}-\d{3}-\d{4}$/', $phone)) {
            http_response_code(400);
            echo json_encode(["message" => "Invalid phone number format. Use 09XX-XXX-XXXX (e.g. 0917-123-4567)."]);
            exit;
        }
        if (!preg_match('/^[A-Z]\d{2}-\d{2}-\d{6}$/', $license_number)) {
            http_response_code(400);
            echo json_encode(["message" => "Invalid license number format. Use A##-##-###### (e.g. N01-00-000000)."]);
            exit;
        }
        if ($password !== "" && strlen($password) < 6) {
            http_response_code(400);
            echo json_encode(["message" => "Password must be at least 6 characters."]);
            exit;
        }

        // Uniqueness checks exclude this driver's own current row.
        $stmt = $conn->prepare("SELECT id FROM drivers WHERE license_number = ? AND id != ?");
        $stmt->bind_param("si", $license_number, $id);
        $stmt->execute();
        if ($stmt->get_result()->fetch_assoc()) {
            http_response_code(409);
            echo json_encode(["message" => "License number is already registered."]);
            exit;
        }

        if (!isValidEmailFormat($email)) {
            http_response_code(400);
            echo json_encode(["message" => "Please enter a valid email address."]);
            exit;
        }
        // Excludes this driver's own row so resubmitting an unchanged email
        // isn't flagged as a duplicate of itself, but still checks every
        // login-eligible table — see commuter_register.php's identical note.
        if (emailAlreadyRegistered($conn, $email, 'drivers', $id)) {
            http_response_code(409);
            echo json_encode(["message" => "Email is already registered."]);
            exit;
        }

        $stmt = $conn->prepare("SELECT id FROM drivers WHERE phone = ? AND id != ?");
        $stmt->bind_param("si", $phone, $id);
        $stmt->execute();
        if ($stmt->get_result()->fetch_assoc()) {
            http_response_code(409);
            echo json_encode(["message" => "Phone number is already registered."]);
            exit;
        }

        $stmt = $conn->prepare("SELECT vehicle_id FROM drivers WHERE id = ?");
        $stmt->bind_param("i", $id);
        $stmt->execute();
        $currentVehicleId = (int)($stmt->get_result()->fetch_assoc()["vehicle_id"] ?? 0);
        $stmt->close();

        $conn->begin_transaction();
        try {
            // Reassign vehicle only if a different one was explicitly provided.
            if ($vehicle_id !== null && $vehicle_id !== $currentVehicleId) {
                $stmt = $conn->prepare("SELECT id, driver_id FROM vehicles WHERE id = ? AND operator_id = ? AND status = 'active'");
                $stmt->bind_param("ii", $vehicle_id, $operator_id);
                $stmt->execute();
                $newVehicle = $stmt->get_result()->fetch_assoc();
                $stmt->close();

                if (!$newVehicle) {
                    $conn->rollback();
                    http_response_code(400);
                    echo json_encode(["message" => "Selected vehicle does not belong to you or is inactive."]);
                    exit;
                }
                if (!empty($newVehicle["driver_id"])) {
                    $conn->rollback();
                    http_response_code(409);
                    echo json_encode(["message" => "Selected vehicle is already assigned to another driver."]);
                    exit;
                }

                if ($currentVehicleId) {
                    $stmt = $conn->prepare("UPDATE vehicles SET driver_id = NULL WHERE id = ?");
                    $stmt->bind_param("i", $currentVehicleId);
                    $stmt->execute();
                    $stmt->close();
                }

                $stmt = $conn->prepare("UPDATE vehicles SET driver_id = ? WHERE id = ?");
                $stmt->bind_param("ii", $id, $vehicle_id);
                $stmt->execute();
                $stmt->close();

                $stmt = $conn->prepare("UPDATE drivers SET vehicle_id = ? WHERE id = ?");
                $stmt->bind_param("ii", $vehicle_id, $id);
                $stmt->execute();
                $stmt->close();
            }

            if ($password !== "") {
                $hashed = password_hash($password, PASSWORD_BCRYPT);
                $stmt = $conn->prepare("UPDATE drivers SET name = ?, email = ?, phone = ?, license_number = ?, password = ? WHERE id = ?");
                $stmt->bind_param("sssssi", $name, $email, $phone, $license_number, $hashed, $id);
            } else {
                $stmt = $conn->prepare("UPDATE drivers SET name = ?, email = ?, phone = ?, license_number = ? WHERE id = ?");
                $stmt->bind_param("ssssi", $name, $email, $phone, $license_number, $id);
            }
            $stmt->execute();
            $stmt->close();

            $conn->commit();
            echo json_encode(["message" => "Driver details updated."]);
        } catch (Exception $e) {
            $conn->rollback();
            http_response_code(500);
            echo json_encode(["message" => "Failed to update driver.", "error" => $e->getMessage()]);
        }
        exit;
    }

    // Default: toggle status
    $status = $data['status'] ?? null;
    if (!$status) {
        http_response_code(400);
        echo json_encode(["message" => "status required."]);
        exit;
    }

    $stmt = $conn->prepare("UPDATE drivers SET status = ? WHERE id = ?");
    $stmt->bind_param("si", $status, $id);
    $stmt->execute();
    echo json_encode(["message" => "Driver updated."]);
    exit;
}

// ── DELETE: remove driver ──
if ($method === 'DELETE') {
    $data = json_decode(file_get_contents("php://input"), true);
    $id   = $data['id'] ?? null;

    if (!$id) {
        http_response_code(400);
        echo json_encode(["message" => "id is required."]);
        exit;
    }

    // Unlink vehicle before deleting driver
    $stmt = $conn->prepare("UPDATE vehicles SET driver_id = NULL WHERE driver_id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();

    // Clean up association records so membership counts stay accurate
    $stmt = $conn->prepare("DELETE FROM association_memberships WHERE subject_type = 'driver' AND subject_id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();

    $stmt = $conn->prepare("DELETE FROM association_applications WHERE subject_type = 'driver' AND subject_id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();

    $stmt = $conn->prepare("DELETE FROM drivers WHERE id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(["message" => "Driver removed."]);
    exit;
}

http_response_code(405);
echo json_encode(["message" => "Method not allowed."]);