// Booking domain types

export type BookStep = "browse" | "detail" | "passenger" | "confirm";
export type BookMode = "bus" | "uv";

// ── Route (from DB routes table) ──────────────────────────────────────────────

export interface Route {
  id: number;
  name: string;
  from_location: string;
  to_location: string;
  fare: number | null;
  vehicle_type: string; // "Jeepney" | "UV Express" | "Bus"
  color: string;
  driver_count: number;
  owner_name: string | null;
}

export interface Passenger {
  name: string;
  phone: string;
  age: string;
  email: string;
  emergencyName: string;
  emergencyPhone: string;
}

// ── Bus: admin/operator-scheduled trip instance ───────────────────────────────

export interface BusTrip {
  id: number;
  route_id: number;
  route_name: string | null;
  from_location: string;
  to_location: string;
  color: string;
  fare: number;
  departure_time: string; // "YYYY-MM-DD HH:MM:SS"
  boarding_time?: string | null; // "YYYY-MM-DD HH:MM:SS" — from the association's schedule template
  // null only for a freshly-generated, not-yet-assigned trip (status
  // 'pending_assignment') — get_upcoming_trips.php (commuter-facing) never
  // returns one of these, only get_operator_trips.php does. See Core Flow 12a.
  capacity: number | null;
  seats_booked: number;
  seats_left: number | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  conductor_name?: string | null;
  conductor_phone?: string | null;
  schedule_id?: number | null;
  association_id?: number | null; // derived from the trip's own schedule (operator/get_operator_trips.php)
  status: "pending_assignment" | "scheduled" | "boarding" | "departed" | "completed" | "cancelled";
  service_type_id?: number | null;
  service_type_name?: string | null;        // association-owned class name
  service_type_description?: string | null; // association-owned class description
  class_details?: string | null;            // operator's own amenities overlay for this class
  // Rough estimate — Haversine distance along the route's own waypoints
  // divided by a flat per-vehicle-type speed (same method as the route
  // planner, Core Flow 6), computed server-side in get_upcoming_trips.php.
  // null when the route has no/invalid waypoints to estimate from — never
  // coerce to 0, that would read as "instant trip" rather than "unknown".
  estimated_duration_minutes?: number | null;
}

// ── UV Express: a driver's live "online for booking" session ─────────────────

export interface UvSession {
  id: number;
  driver_id: number;
  driver_name: string;
  route_id: number;
  route_name: string | null;
  from_location: string;
  to_location: string;
  color: string;
  fare: number;
  vehicle_plate: string;
  capacity: number;
  seats_booked: number;
  seats_left: number;
  status: "open" | "full" | "departed" | "cancelled";
  started_at: string;
  estimated_departure: string; // "YYYY-MM-DD HH:MM:SS" — rough heuristic, not a fixed schedule
}

// ── UV Express: operator-defined book-ahead departure slot ────────────────────
// Unlike UvSession, a slot isn't tied to a driver/vehicle — whichever driver
// is currently dispatched (queued) for the route boards its passengers, and
// that can change mid-slot if a vehicle fills up (see dispatch_queue).

export interface UvSlot {
  id: number;
  route_id: number;
  route_name: string | null;
  from_location: string;
  to_location: string;
  color: string;
  fare: number;
  departure_time: string; // "YYYY-MM-DD HH:MM:SS"
  // null = uncapped (a route-level pooled slot, Core Flow 8b) — only a
  // legacy operator-created slot still carries a real number here.
  capacity: number | null;
  seats_booked: number;
  seats_left: number | null;
  status: "scheduled" | "boarding" | "departed" | "completed" | "cancelled";
  // Same rough Haversine+speed estimate as BusTrip — see its own note.
  estimated_duration_minutes?: number | null;
}

export interface BookingDraft {
  mode: BookMode;
  selected: BusTrip | UvSession | UvSlot | null;
  passenger: Passenger;
}

// A UvSession (live, driver-initiated) always has a driver_id; a UvSlot
// (operator-scheduled, book-ahead) never does — cheap, reliable discriminant.
export function isUvSlot(sel: UvSession | UvSlot): sel is UvSlot {
  return !("driver_id" in sel);
}

export interface CreateTripReservationPayload {
  commuter_id: number;
  trip_id?: number;
  uv_session_id?: number;
  uv_slot_id?: number;
  passenger_name: string;
  passenger_phone: string;
  passenger_age: number | null;
  seat_label?: string;
}

export interface CreateReservationResult {
  success: boolean;
  reservation_id?: number;
  qr_code?: string;
  new_balance?: number;
  fare_amount?: number;
  discount_type?: string;
  discount_applied?: boolean;
  discount_capped?: boolean; // true when the discount was denied because it was already used on this trip/slot
  queue_number?: number | null;
  qr_active_at?: string | null; // set for uv_slot_id bookings — QR is inactive until this time
  message?: string;
  balance?: number;
  required?: number;
}

// ── Commuter's own upcoming reservations ──────────────────────────────────────

export interface CommuterReservation {
  id: number;
  trip_id: number | null;
  uv_session_id: number | null;
  uv_slot_id: number | null;
  route_id: number | null;
  origin_terminal: string;
  destination_terminal: string;
  departure_time: string;
  fare_amount: number;
  // Pre-discount, pre-rounding fare (Core Flow 16) — null for reservations
  // created before migration 021. Needed to show an accurate Base
  // Fare/Discount/Total breakdown on the Booking Details screen; never
  // reconstructable from fare_amount alone since the ×0.80 + round-to-
  // nearest-₱0.25 math is lossy in reverse.
  base_fare_amount?: number | null;
  discount_type: string | null;
  passenger_name: string;
  passenger_phone?: string;
  passenger_age?: number | null;
  passengers_count: number;
  vehicle_category: string;
  // Fixed per Bus trip, knowable ahead of boarding. UV Express is pooled/
  // queue-based (Core Flow 8b/12) — no fixed vehicle until a driver is
  // actually dispatched, so these stay null for a UV booking; render
  // "Assigned at boarding", never a fabricated plate.
  vehicle_plate?: string | null;
  vehicle_type?: string | null;
  driver_name?: string | null;
  status: "confirmed" | "cancelled" | "expired" | "completed";
  boarding_status: "reserved" | "boarded" | "completed" | "no_show" | "cancelled";
  payment_status?: "held" | "released" | "refunded" | "forfeited";
  cancellation_type?: "refunded" | "rebooked" | "operator_cancelled" | "no_show" | "late_cancelled" | null;
  // Set on a 'refunded' cancellation (tiered refund policy, added
  // 2026-08-11) — the actual peso amount and percentage credited back to
  // the wallet. A 'refunded' cancellation is no longer always a full
  // refund: refund_pct may be 100 or 50 (see getRefundTierPreview() in
  // this file for the client-side mirror of the server's tier table).
  // Both null for a 'late_cancelled'/'no_show' (0%) or any non-refund
  // cancellation_type.
  refund_amount?: number | null;
  refund_pct?: number | null;
  seat_labels?: string | null;
  queue_number: number | null;
  seats_ahead: number | null;
  qr_code: string;
  created_at: string;
  // Set once the booking leaves the active/reserved state (cancelled,
  // refunded, forfeited, or completed) — null while still upcoming.
  resolved_at?: string | null;
  boarded_at?: string | null;
  route_name: string | null;
  route_color: string;
  // Rough estimate only (Haversine-over-waypoints ÷ flat speed, Do Not
  // Break rule #71) — null when the route has no usable waypoints.
  estimated_duration_minutes?: number | null;
  // The most recent rebook request on this booking, if any (see
  // reservations/request_rebook.php). "pending" = awaiting operator review;
  // "approved" = commuter may now pick a new trip (complete_rebook.php);
  // "rejected"/"expired" = re-requestable; "fulfilled" = a new reservation
  // was created (see rebooked_to_reservation_id below).
  rebook_request_status?: "pending" | "approved" | "rejected" | "fulfilled" | "expired" | null;
  // Set only when rebook_request_status === "rejected".
  rebook_rejection_reason?: string | null;
  // Set on the NEW reservation created by a completed rebooking — points
  // back to the booking it replaced. Drives the "REBOOKED TICKET" badge.
  rebooked_from_reservation_id?: number | null;
  // Set on the OLD reservation once its rebooking completes — points to the
  // new booking it was replaced by.
  rebooked_to_reservation_id?: number | null;
  // The 10% (of the ORIGINAL fare) fee actually charged to complete a
  // rebooking — set only on the new reservation. Never derived from
  // fare_amount client-side (the rate could change over time) — always the
  // amount actually charged, persisted server-side.
  rebooking_fee_amount?: number | null;
  // The operator that owns this booking's trip/slot — used to scope the
  // "Select New Trip" flow to the same fleet once a rebook is approved.
  // Null only for a pooled route-level UV slot with no single operator.
  rebooking_operator_id?: number | null;
  // The underlying trip's/uv_slot's own lifecycle status (scheduled|boarding|
  // departed|completed|cancelled) — null for a legacy reservation with no
  // trip_id/uv_slot_id at all. Lets the display-status derivation below show
  // "Boarding" on a still-`reserved` booking once the vehicle itself has
  // started boarding, ahead of this passenger's own QR being scanned.
  vehicle_status?: string | null;
}

// ── Recent Activity — derived client-side from CommuterReservation rows,   ──
// ── not a separate persisted event log (see deriveBookingActivity()).      ──

export type BookingActivityKind = "confirmed" | "cancelled" | "completed";

export interface BookingActivityEntry {
  key: string;
  reservationId: number;
  kind: BookingActivityKind;
  label: string;
  routeName: string | null;
  vehicleCategory: string;
  timestamp: string;
  status: CommuterReservation["boarding_status"];
  qrCode: string;
}

// ── Refund / rebooking ─────────────────────────────────────────────────────────

export interface RefundResult {
  success: boolean;
  refunded?: number;
  refund_pct?: number; // 100 | 50 | 0 — see request_refund.php's tiered outcome
  forfeited?: number;
  new_balance?: number;
  driver_credited?: number;
  operator_fee?: number;
  system_fee?: number;
  message?: string;
}

// ── Tiered refund policy (simplified 2026-08-11 — dropped the 0% tier and
// the 30-minute post-booking grace period) — client-side mirror of
// config/policy.php's REFUND_TIERS and config/refund.php's
// computeRefundOutcome(), used only to preview the expected refund
// percentage before the commuter confirms a cancellation. The server
// (reservations/request_refund.php) stays authoritative — this never
// determines what's actually charged/refunded, only what's shown. There is
// no cancellation timing that yields 0% anymore — 50% is the floor, all
// the way up to departure.
export const REFUND_TIERS: Record<string, { hours: number; pct: number }[]> = {
  Bus: [
    { hours: 72, pct: 1.0 },
    { hours: 0, pct: 0.5 },
  ],
  "UV Express": [
    { hours: 24, pct: 1.0 },
    { hours: 0, pct: 0.5 },
  ],
};

export function previewRefundPct(
  vehicleCategory: string,
  createdAt: string,
  departureTime: string
): number {
  const depMs = new Date(departureTime.replace(" ", "T")).getTime();
  const nowMs = Date.now();

  const hoursLeft = (depMs - nowMs) / 3600000;
  const tiers = REFUND_TIERS[vehicleCategory] ?? REFUND_TIERS["UV Express"];
  for (const tier of tiers) {
    if (hoursLeft >= tier.hours) return tier.pct;
  }
  return 0.5;
}

export interface RebookingResult {
  success: boolean;
  new_reservation_id?: number;
  qr_code?: string;
  rebooking_fee_amount?: number;
  original_fare_amount?: number;
  surcharge_charged?: number; // alias of rebooking_fee_amount, kept for back-compat
  new_balance?: number;
  message?: string;
  balance?: number;
  required?: number;
}

// ── DB vehicle type UI metadata ───────────────────────────────────────────────

export const VEHICLE_META: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  "Jeepney":    { color: "#1a4a52", bg: "#f0fdfa", icon: "bus-outline",   label: "Jeepney"    },
  "UV Express": { color: "#9333ea", bg: "#faf5ff", icon: "car-outline",   label: "UV Express" },
  "Bus":        { color: "#2563eb", bg: "#eff6ff", icon: "bus",           label: "Bus"        },
};

// ── Passenger boarding-status display labels ──────────────────────────────────

export const BOARDING_STATUS_LABEL: Record<string, string> = {
  reserved:  "Waiting",
  boarded:   "Boarded",
  completed: "Completed",
  no_show:   "No Show",
  cancelled: "Cancelled",
};

// ── Commuter-facing unified booking lifecycle status ───────────────────────
// One consistent status vocabulary across My Upcoming Bookings, Booking
// History, and Booking Details — derived from boarding_status +
// cancellation_type + the underlying trip/slot's own vehicle_status, never a
// separate stored field (avoids a second source of truth that could drift
// from the reservation's real state). Operator/driver-facing manifests keep
// using the raw BOARDING_STATUS_LABEL above — they need the literal
// reserved/boarded/no_show states, not this consumer-friendly rollup.
export type DisplayStatus =
  | "Upcoming" | "Boarding" | "Completed" | "Cancelled" | "Refunded" | "Rebooked" | "Expired";

export function getDisplayStatus(
  bk: Pick<CommuterReservation, "boarding_status" | "cancellation_type" | "vehicle_status">
): DisplayStatus {
  switch (bk.boarding_status) {
    case "completed":
      return "Completed";
    case "boarded":
      // Already scanned — the ticket has been used, so from the commuter's
      // side it's done. (The DB row stays 'boarded' until the driver/operator
      // completes the trip, so seat locks and manifests are unaffected.)
      return "Completed";
    case "cancelled":
      // A proactive rebooking (requested and completed while still
      // 'reserved', before departure) force-settles the old booking to
      // 'cancelled' + cancellation_type='rebooked' (see complete_rebook.php)
      // — must be checked before the refunded/plain-cancelled fallback, or
      // it would incorrectly read as a plain cancellation.
      if (bk.cancellation_type === "rebooked") return "Rebooked";
      return bk.cancellation_type === "refunded" ? "Refunded" : "Cancelled";
    case "no_show":
      // A no_show that's since been rebooked carries cancellation_type=
      // 'rebooked' (complete_rebook.php) — otherwise it's just an expired
      // ticket nobody boarded before the QR grace period ran out.
      return bk.cancellation_type === "rebooked" ? "Rebooked" : "Expired";
    case "reserved":
    default:
      // Still waiting to board — but if the vehicle itself has already
      // started its boarding window, reflect that ahead of this passenger's
      // own QR scan (UV Express's queue-based rollover has no fixed
      // "departed" moment for an unscanned ticket the way Bus does, so both
      // states read as "Boarding" here).
      return bk.vehicle_status === "boarding" || bk.vehicle_status === "departed"
        ? "Boarding"
        : "Upcoming";
  }
}

export const DISPLAY_STATUS_COLOR: Record<DisplayStatus, string> = {
  Upcoming:  "#d97706",
  Boarding:  "#0369a1",
  Completed: "#16a34a",
  Cancelled: "#dc2626",
  Refunded:  "#dc2626",
  Rebooked:  "#7c3aed",
  Expired:   "#6b7280",
};
