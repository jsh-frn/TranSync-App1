<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    http_response_code(200);
    exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

require_once __DIR__ . "/../../config/db.php";
require_once __DIR__ . "/../../config/policy.php";
require_once __DIR__ . "/../../config/auth.php";

$auth        = requireAuth($conn, ['commuter']);
$commuter_id = $auth['owner_id'];

// ── Parse body ────────────────────────────────────────────────────────────────
$body = json_decode(file_get_contents("php://input"), true);

$required = ["passenger_name", "passenger_phone"];
foreach ($required as $field) {
    if (!isset($body[$field]) || $body[$field] === "" || $body[$field] === null) {
        echo json_encode(["success" => false, "message" => "Missing required field: $field"]);
        exit;
    }
}

$trip_id         = isset($body["trip_id"]) && $body["trip_id"] !== "" ? (int)$body["trip_id"] : null;
$uv_session_id   = isset($body["uv_session_id"]) && $body["uv_session_id"] !== "" ? (int)$body["uv_session_id"] : null;
$uv_slot_id      = isset($body["uv_slot_id"]) && $body["uv_slot_id"] !== "" ? (int)$body["uv_slot_id"] : null;
$passenger_name  = trim($body["passenger_name"]);
$passenger_phone = trim($body["passenger_phone"]);
$passenger_age   = isset($body["passenger_age"]) && $body["passenger_age"] !== null && $body["passenger_age"] !== ""
                   ? (int)$body["passenger_age"] : null;
$seat_label      = trim($body["seat_label"] ?? "");

$target_count = ($trip_id !== null ? 1 : 0) + ($uv_session_id !== null ? 1 : 0) + ($uv_slot_id !== null ? 1 : 0);
if ($target_count !== 1) {
    echo json_encode(["success" => false, "message" => "Provide exactly one of trip_id, uv_session_id, or uv_slot_id."]);
    exit;
}

// ── Commuter + wallet ─────────────────────────────────────────────────────────
$stmt = $conn->prepare("SELECT id, category, is_verified FROM commuters WHERE id = ? AND status = 'active'");
$stmt->bind_param("i", $commuter_id);
$stmt->execute();
$commuter = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$commuter) {
    echo json_encode(["success" => false, "message" => "Commuter not found or inactive"]);
    exit;
}

$stmt = $conn->prepare("SELECT id, balance FROM wallets WHERE commuter_id = ?");
$stmt->bind_param("i", $commuter_id);
$stmt->execute();
$wallet = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$wallet) {
    echo json_encode(["success" => false, "message" => "Wallet not found"]);
    exit;
}
$balance = (float)$wallet["balance"];

$discount_type = ((int)$commuter["is_verified"] === 1 && in_array($commuter["category"], ["student", "disabled", "elderly"]))
    ? $commuter["category"] : "default";

// A verified student/disabled/elderly commuter only gets the 20% discount once
// per vehicle/trip — block stacking it across multiple bookings on the same ride.
$discount_capped = false;
if ($discount_type !== "default") {
    $stmt = $conn->prepare("
        SELECT COUNT(*) AS cnt FROM reservations
        WHERE commuter_id = ?
          AND ((? IS NOT NULL AND trip_id = ?) OR (? IS NOT NULL AND uv_session_id = ?) OR (? IS NOT NULL AND uv_slot_id = ?))
          AND discount_type != 'default'
          AND boarding_status != 'cancelled'
    ");
    $stmt->bind_param(
        "iiiiiii",
        $commuter_id,
        $trip_id, $trip_id,
        $uv_session_id, $uv_session_id,
        $uv_slot_id, $uv_slot_id
    );
    $stmt->execute();
    $already_discounted = (int)$stmt->get_result()->fetch_assoc()["cnt"] > 0;
    $stmt->close();

    if ($already_discounted) {
        $discount_type    = "default";
        $discount_capped  = true;
    }
}

$conn->begin_transaction();

try {
    $queue_number = null;
    $route_id     = null;
    $qr_active_at = null;

    if ($trip_id !== null) {
        // ── Bus: fetch trip + route + vehicle, claim a seat atomically ────────
        if ($seat_label === "") {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "Please select a seat."]);
            exit;
        }

        $stmt = $conn->prepare("
            SELECT t.route_id, t.status, t.vehicle_id, t.driver_id, COALESCE(t.fare_override, r.fare) AS fare,
                   r.from_location, r.to_location, t.departure_time, v.service_type_id
            FROM trips t
            JOIN routes r ON r.id = t.route_id
            LEFT JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.id = ?
        ");
        $stmt->bind_param("i", $trip_id);
        $stmt->execute();
        $trip = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$trip) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "Trip not found."]);
            exit;
        }
        if ($trip["status"] !== "scheduled") {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This trip is no longer accepting bookings."]);
            exit;
        }

        // Confirm the seat actually exists on this trip's vehicle.
        $stmt = $conn->prepare("SELECT id FROM seats WHERE vehicle_id = ? AND seat_label = ?");
        $stmt->bind_param("is", $trip["vehicle_id"], $seat_label);
        $stmt->execute();
        if (!$stmt->get_result()->fetch_assoc()) {
            $stmt->close();
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "Invalid seat for this vehicle."]);
            exit;
        }
        $stmt->close();

        // Service-type-specific fare (e.g. Royal Class), falling back to the
        // route's flat fare if the vehicle has no service type or no matching
        // fare_matrix row exists.
        if ($trip["service_type_id"]) {
            $stmt = $conn->prepare("
                SELECT base_fare FROM fare_matrix
                WHERE route_id = ? AND service_type_id = ?
                LIMIT 1
            ");
            $stmt->bind_param("ii", $trip["route_id"], $trip["service_type_id"]);
            $stmt->execute();
            $fareRow = $stmt->get_result()->fetch_assoc();
            $stmt->close();
            if ($fareRow && $fareRow["base_fare"] !== null) {
                $trip["fare"] = $fareRow["base_fare"];
            }
        }

        // DB clock, not PHP's — see board_reservation.php for why mixing
        // time()/date() with strtotime() on a DB datetime string is unsafe here.
        $db_now = $conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"];
        $min_lead_hours = ADVANCE_BOOKING_HOURS["Bus"];
        if (strtotime($trip["departure_time"]) - strtotime($db_now) < $min_lead_hours * 3600) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "Bus bookings must be made at least {$min_lead_hours} hours before departure."]);
            exit;
        }

        // Vehicle Type -> Route -> Driver -> Daily Quota — an operator-set
        // booking cap for this specific driver on this specific route/date
        // (driver_route_quotas, migration 057). A separate concept from the
        // driver_quotas peso settlement target; unset means unlimited.
        // Counted live from reservations, so a cancellation/refund frees the
        // count up automatically with no decrement logic needed.
        if ($trip["driver_id"] !== null) {
            $quota_driver_id = (int)$trip["driver_id"];
            $stmt = $conn->prepare("SELECT daily_quota FROM driver_route_quotas WHERE route_id = ? AND driver_id = ?");
            $stmt->bind_param("ii", $trip["route_id"], $quota_driver_id);
            $stmt->execute();
            $quotaRow = $stmt->get_result()->fetch_assoc();
            $stmt->close();

            if ($quotaRow) {
                $travel_date = date("Y-m-d", strtotime($trip["departure_time"]));
                $stmt = $conn->prepare("
                    SELECT COUNT(*) AS cnt
                    FROM reservations r
                    JOIN trips t2 ON t2.id = r.trip_id
                    WHERE t2.driver_id = ? AND t2.route_id = ? AND DATE(t2.departure_time) = ?
                      AND r.boarding_status IN ('reserved', 'boarded', 'completed')
                ");
                $stmt->bind_param("iis", $quota_driver_id, $trip["route_id"], $travel_date);
                $stmt->execute();
                $used = (int)$stmt->get_result()->fetch_assoc()["cnt"];
                $stmt->close();

                if ($used >= (int)$quotaRow["daily_quota"]) {
                    $conn->rollback();
                    echo json_encode(["success" => false, "message" => "This driver has reached their booking quota for this route today. Please choose a different trip."]);
                    exit;
                }
            }
        }

        $stmt = $conn->prepare("
            UPDATE trips SET seats_booked = seats_booked + 1
            WHERE id = ? AND seats_booked < capacity AND status = 'scheduled'
        ");
        $stmt->bind_param("i", $trip_id);
        $stmt->execute();
        $claimed = $stmt->affected_rows > 0;
        $stmt->close();

        if (!$claimed) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This trip is full."]);
            exit;
        }

        $base_fare       = (float)$trip["fare"];
        $route_id        = (int)$trip["route_id"];
        $origin_terminal = $trip["from_location"];
        $dest_terminal   = $trip["to_location"];
        $departure_time  = $trip["departure_time"];
        $vehicle_category = "Bus";
    } elseif ($uv_session_id !== null) {
        // ── UV Express (live): fetch session + route, claim a queue slot atomically ─
        $stmt = $conn->prepare("
            SELECT s.route_id, s.status, r.fare, r.from_location, r.to_location
            FROM uv_sessions s
            JOIN routes r ON r.id = s.route_id
            WHERE s.id = ?
        ");
        $stmt->bind_param("i", $uv_session_id);
        $stmt->execute();
        $session = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$session) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This vehicle is no longer available."]);
            exit;
        }
        if ($session["status"] !== "open") {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This vehicle is no longer accepting bookings."]);
            exit;
        }

        $stmt = $conn->prepare("
            UPDATE uv_sessions SET seats_booked = seats_booked + 1
            WHERE id = ? AND seats_booked < capacity AND status = 'open'
        ");
        $stmt->bind_param("i", $uv_session_id);
        $stmt->execute();
        $claimed = $stmt->affected_rows > 0;
        $stmt->close();

        if (!$claimed) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This vehicle is full."]);
            exit;
        }

        $stmt = $conn->prepare("SELECT seats_booked, capacity FROM uv_sessions WHERE id = ?");
        $stmt->bind_param("i", $uv_session_id);
        $stmt->execute();
        $after = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $queue_number = (int)$after["seats_booked"];

        if ($queue_number >= (int)$after["capacity"]) {
            $stmt = $conn->prepare("UPDATE uv_sessions SET status = 'full' WHERE id = ?");
            $stmt->bind_param("i", $uv_session_id);
            $stmt->execute();
            $stmt->close();
        }

        $base_fare        = (float)$session["fare"];
        $route_id         = (int)$session["route_id"];
        $origin_terminal  = $session["from_location"];
        $dest_terminal    = $session["to_location"];
        $departure_time   = date("Y-m-d H:i:s");
        $vehicle_category = "UV Express";
    } else {
        // ── UV Express (scheduled slot): fetch slot + route, claim a booking slot ─
        $stmt = $conn->prepare("
            SELECT s.route_id, s.status, s.departure_time, r.fare, r.from_location, r.to_location
            FROM uv_slots s
            JOIN routes r ON r.id = s.route_id
            WHERE s.id = ?
        ");
        $stmt->bind_param("i", $uv_slot_id);
        $stmt->execute();
        $slot = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$slot) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This departure slot was not found."]);
            exit;
        }
        if ($slot["status"] !== "scheduled") {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This departure slot is no longer accepting bookings."]);
            exit;
        }
        // DB clock, not PHP's — see board_reservation.php for why mixing
        // time()/date() with strtotime() on a DB datetime string is unsafe here.
        $db_now = $conn->query("SELECT NOW() AS now_ts")->fetch_assoc()["now_ts"];
        if (strtotime($slot["departure_time"]) <= strtotime($db_now)) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This departure slot has already passed."]);
            exit;
        }
        $min_lead_hours = ADVANCE_BOOKING_HOURS["UV Express"];
        if (strtotime($slot["departure_time"]) - strtotime($db_now) < $min_lead_hours * 3600) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "UV Express bookings must be made at least {$min_lead_hours} hours before departure."]);
            exit;
        }

        // Route-level (commuter-triggered) slots have no fixed capacity — NULL
        // means unbounded, pooled across whichever operator ends up dispatched
        // (see Core Flow 8b's UV scheduling rewrite; uv_slots.capacity IS NULL
        // for these). A legacy operator-created slot still enforces its own
        // capacity as before.
        $stmt = $conn->prepare("
            UPDATE uv_slots SET seats_booked = seats_booked + 1
            WHERE id = ? AND (capacity IS NULL OR seats_booked < capacity) AND status = 'scheduled'
        ");
        $stmt->bind_param("i", $uv_slot_id);
        $stmt->execute();
        $claimed = $stmt->affected_rows > 0;
        $stmt->close();

        if (!$claimed) {
            $conn->rollback();
            echo json_encode(["success" => false, "message" => "This departure slot is full."]);
            exit;
        }

        $base_fare        = (float)$slot["fare"];
        $route_id         = (int)$slot["route_id"];
        $origin_terminal  = $slot["from_location"];
        $dest_terminal    = $slot["to_location"];
        $departure_time   = $slot["departure_time"];
        $vehicle_category = "UV Express";
        $qr_active_at     = date("Y-m-d H:i:s", strtotime($departure_time) - 1800); // 30 min before
    }

    $fare = $discount_type !== "default" ? $base_fare * 0.80 : $base_fare;
    $fare = round($fare * 4) / 4; // nearest ₱0.25, matches end_ride.php's rule

    if ($balance < $fare) {
        $conn->rollback();
        echo json_encode([
            "success"  => false,
            "message"  => "Insufficient wallet balance",
            "balance"  => $balance,
            "required" => $fare,
        ]);
        exit;
    }

    $qr_suffix = strtoupper(bin2hex(random_bytes(5)));
    $qr_code   = "TRN-R{$route_id}-{$qr_suffix}";
    $seat_labels_to_store = $trip_id !== null ? $seat_label : null;

    $stmt = $conn->prepare("
        INSERT INTO reservations
            (commuter_id, route_id, trip_id, uv_session_id, uv_slot_id, queue_number,
             origin_terminal, destination_terminal, departure_time, fare_amount, base_fare_amount,
             discount_type, passenger_name, passenger_phone, passenger_age,
             vehicle_category, passengers_count, boarding_status, qr_code, seat_labels)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'reserved', ?, ?)
    ");
    $stmt->bind_param(
        "iiiiiisssddsssisss",
        $commuter_id, $route_id, $trip_id, $uv_session_id, $uv_slot_id, $queue_number,
        $origin_terminal, $dest_terminal, $departure_time, $fare, $base_fare,
        $discount_type, $passenger_name, $passenger_phone, $passenger_age,
        $vehicle_category, $qr_code, $seat_labels_to_store
    );
    $stmt->execute();
    $reservation_id = $conn->insert_id;
    $stmt->close();

    $new_balance = round($balance - $fare, 2);
    $stmt = $conn->prepare("UPDATE wallets SET balance = ? WHERE commuter_id = ?");
    $stmt->bind_param("di", $new_balance, $commuter_id);
    $stmt->execute();
    $stmt->close();

    $owner_type = "commuter";
    $type       = "debit";
    $ref_type   = "booking";
    $note       = "Booking #{$reservation_id}: {$origin_terminal} → {$dest_terminal}";
    $stmt = $conn->prepare("
        INSERT INTO wallet_transactions
            (owner_type, owner_id, type, amount, reference_type, reference_id, balance_after, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->bind_param(
        "sisdsids",
        $owner_type, $commuter_id, $type, $fare,
        $ref_type, $reservation_id, $new_balance, $note
    );
    $stmt->execute();
    $stmt->close();

    $conn->commit();

    echo json_encode([
        "success"          => true,
        "reservation_id"   => $reservation_id,
        "qr_code"          => $qr_code,
        "new_balance"      => $new_balance,
        "fare_amount"      => $fare,
        "discount_type"    => $discount_type,
        "discount_applied" => $discount_type !== "default",
        "discount_capped"  => $discount_capped,
        "queue_number"     => $queue_number,
        "qr_active_at"     => $qr_active_at,
    ]);
} catch (Exception $e) {
    $conn->rollback();
    if (str_contains($e->getMessage(), "unique_trip_seat")) {
        echo json_encode(["success" => false, "message" => "That seat was just taken — please pick another."]);
        exit;
    }
    echo json_encode([
        "success" => false,
        "message" => "Transaction failed. Please try again.",
    ]);
}
