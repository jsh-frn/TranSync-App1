import API_BASE from "../config/api";
import { authFetch } from "../config/session";
import type {
  Route, BusTrip, UvSlot, CommuterReservation, BookingActivityEntry,
  CreateTripReservationPayload, CreateReservationResult,
  RefundResult, RebookingResult,
} from "../types/booking";

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function fetchRoutes(search?: string): Promise<Route[]> {
  try {
    let url = `${API_BASE}/routes/get_commuter_routes.php`;
    if (search && search.trim()) {
      url += `?search=${encodeURIComponent(search.trim())}`;
    }
    const res  = await fetch(url);
    const data = await res.json();
    if (data.success && Array.isArray(data.routes)) return data.routes;
  } catch {
    // network failure — return empty
  }
  return [];
}

// ─── Bus trips (commuter browse + operator/driver management) ───────────────

export async function fetchBusTrips(routeId?: number, date?: string, operatorId?: number): Promise<BusTrip[]> {
  try {
    const params = new URLSearchParams();
    if (routeId) params.set("route_id", String(routeId));
    if (date) params.set("date", date);
    // Scopes results to one operator's own fleet — used by the rebooking
    // "Select New Trip" flow (same-operator-only, see complete_rebook.php).
    if (operatorId) params.set("operator_id", String(operatorId));
    const qs  = params.toString();
    const res = await fetch(`${API_BASE}/bus_trips/get_upcoming_trips.php${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.trips)) return data.trips;
  } catch {
    // network failure — return empty
  }
  return [];
}

export async function fetchOperatorTrips(operatorId: number): Promise<BusTrip[]> {
  try {
    const res  = await fetch(`${API_BASE}/bus_trips/get_operator_trips.php?operator_id=${operatorId}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.trips)) return data.trips;
  } catch {
    // network failure — return empty
  }
  return [];
}

// Date-scoped Pending Assignment view (one calendar date at a time) — see
// Core Flow 12a's date-based rewrite. date defaults to today server-side if
// omitted; pass "YYYY-MM-DD".
export async function fetchPendingTrips(operatorId: number, date?: string): Promise<BusTrip[]> {
  try {
    const qs  = date ? `&date=${date}` : "";
    const res  = await fetch(`${API_BASE}/bus_trips/get_pending_trips.php?operator_id=${operatorId}${qs}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.trips)) return data.trips;
  } catch {
    // network failure — return empty
  }
  return [];
}

export async function fetchDriverTrips(driverId: number): Promise<BusTrip[]> {
  try {
    const res  = await fetch(`${API_BASE}/bus_trips/get_driver_trips.php?driver_id=${driverId}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.trips)) return data.trips;
  } catch {
    // network failure — return empty
  }
  return [];
}

export interface TripBooking {
  id: number;
  passenger_name: string;
  passenger_phone: string;
  passenger_age: number | null;
  fare_amount: number;
  discount_type: string | null;
  boarding_status: "reserved" | "boarded" | "completed" | "no_show" | "cancelled";
  boarded_at: string | null;
  created_at: string;
  // True only while a commuter's rebook request on this booking is still
  // pending (this app has no notification system, so this manifest flag is
  // the only place that request ever surfaces — see Core Flow 9a).
  rebook_requested?: boolean;
}

export async function fetchTripBookings(tripId: number): Promise<TripBooking[]> {
  try {
    const res  = await fetch(`${API_BASE}/bus_trips/get_trip_bookings.php?trip_id=${tripId}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.bookings)) return data.bookings;
  } catch {
    // network failure — return empty
  }
  return [];
}

export interface CreateBusTripPayload {
  operator_id: number;
  schedule_id: number;
  vehicle_id: number;
  driver_id: number;
  fare_override?: number;
  // The date is no longer picked by the operator — the backend computes the
  // next valid occurrence from the schedule's own recurrence. `preview: true`
  // runs the same computation without creating the trip, so the UI can show
  // the resolved date before the operator commits.
  preview?: boolean;
}

export async function createBusTrip(
  payload: CreateBusTripPayload
): Promise<{ success: boolean; trip_id?: number; date?: string; departure_time?: string; preview?: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/bus_trips/create_trip.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

export interface AssignTripPayload {
  operator_id: number;
  trip_id: number;
  vehicle_id: number;
  driver_id: number;
  conductor_name?: string;
  conductor_phone?: string;
}

// Assigns a vehicle/driver/optional conductor to an already-generated
// pending_assignment trip (bus_trips/assign_trip.php) — replaces the old
// flow of creating a trip from scratch. createBusTrip()/create_trip.php
// below stays functional for any historical/direct caller but is no longer
// called by the operator's "Assign Trip" UI. See Core Flow 12a.
export async function assignTrip(
  payload: AssignTripPayload
): Promise<{ success: boolean; trip_id?: number; status?: string; message?: string }> {
  const res = await fetch(`${API_BASE}/bus_trips/assign_trip.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

export interface ReassignTripPayload {
  operator_id: number;
  trip_id: number;
  vehicle_id: number;
  driver_id: number;
  conductor_name?: string;
  conductor_phone?: string;
}

// Swaps the vehicle/driver/conductor already assigned to a 'scheduled' trip
// (bus_trips/reassign_trip.php) — for when a vehicle breaks down or a driver
// can't make it, without creating a duplicate pending assignment. The
// trip's own departure_time is never sent/changed (Do Not Break rule #58).
// Server rejects a vehicle change if the trip already has real bookings
// (their seat_labels would become invalid against a different vehicle's
// seat map) — the driver/conductor can still be swapped freely either way.
export async function reassignTrip(
  payload: ReassignTripPayload
): Promise<{ success: boolean; trip_id?: number; status?: string; message?: string }> {
  const res = await fetch(`${API_BASE}/bus_trips/reassign_trip.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

export async function updateTripStatus(
  tripId: number,
  action: "start_boarding" | "depart" | "complete" | "cancel",
  actor: { driverId?: number; operatorId?: number }
): Promise<{ success: boolean; status?: string; message?: string }> {
  const res = await fetch(`${API_BASE}/bus_trips/update_trip_status.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trip_id: tripId, action,
      driver_id: actor.driverId, operator_id: actor.operatorId,
    }),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

// ─── UV Express scheduled slots (association-scheduled, commuter-resolved) ──
// Booking availability for UV Express is entirely operator/association-
// controlled (route Active/Not Active + published operating hours) — there
// is no driver-initiated "go online" live session anymore. The backend's
// uv_sessions/*.php endpoints and uv_session_id booking path still exist
// (dormant — never called by this app) purely so historical reservations
// created before this change keep resolving correctly.

export async function fetchAvailableSlots(routeId?: number, operatorId?: number): Promise<UvSlot[]> {
  try {
    const params = new URLSearchParams();
    if (routeId) params.set("route_id", String(routeId));
    // Scopes results to one operator's own fleet — see fetchBusTrips' own
    // note. Naturally excludes pooled route-level slots when set.
    if (operatorId) params.set("operator_id", String(operatorId));
    const qs  = params.toString();
    const res = await fetch(`${API_BASE}/uv_slots/get_available_slots.php${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.slots)) return data.slots;
  } catch {
    // network failure — return empty
  }
  return [];
}

export async function fetchOperatorSlots(operatorId: number): Promise<UvSlot[]> {
  try {
    const res  = await fetch(`${API_BASE}/uv_slots/get_operator_slots.php?operator_id=${operatorId}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.slots)) return data.slots;
  } catch {
    // network failure — return empty
  }
  return [];
}

export interface CreateUvSlotPayload {
  operator_id: number;
  route_id: number;
  departure_time: string;
  capacity: number;
}

export async function createUvSlot(
  payload: CreateUvSlotPayload
): Promise<{ success: boolean; slot_id?: number; message?: string }> {
  const res = await fetch(`${API_BASE}/uv_slots/create_slot.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

export async function fetchSlotBookings(slotId: number): Promise<TripBooking[]> {
  try {
    const res  = await fetch(`${API_BASE}/uv_slots/get_slot_bookings.php?slot_id=${slotId}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.bookings)) return data.bookings;
  } catch {
    // network failure — return empty
  }
  return [];
}

export async function updateSlotStatus(
  slotId: number,
  action: "start_boarding" | "depart" | "complete" | "cancel",
  actor: number | { operatorId?: number; driverId?: number }
): Promise<{ success: boolean; status?: string; message?: string }> {
  const body = typeof actor === "number"
    ? { slot_id: slotId, action, operator_id: actor }
    : { slot_id: slotId, action, operator_id: actor.operatorId, driver_id: actor.driverId };
  const res = await fetch(`${API_BASE}/uv_slots/update_slot_status.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

export interface SlotPassenger {
  id: number;
  uv_slot_id: number;
  passenger_name: string;
  passenger_phone: string;
  passenger_age: number | null;
  fare_amount: number;
  discount_type: string | null;
  boarding_status: "reserved" | "boarded" | "completed" | "no_show" | "cancelled";
  boarded_at: string | null;
  departure_time: string;
  qr_active_at: string;
  qr_active: boolean;
}

export async function fetchSlotPassengers(driverId: number): Promise<{
  dispatched: boolean;
  passengers: SlotPassenger[];
}> {
  try {
    const res  = await fetch(`${API_BASE}/uv_slots/get_slot_passengers.php?driver_id=${driverId}`);
    const data = await res.json();
    if (data.success) return { dispatched: !!data.dispatched, passengers: data.passengers ?? [] };
  } catch {
    // network failure
  }
  return { dispatched: false, passengers: [] };
}

// ─── Commuter upcoming bookings / booking history ─────────────────────────────
// scope="upcoming" (default) = active bookings only, soonest departure first —
// what "My Upcoming Bookings" shows. scope="all" = every booking regardless
// of status, newest-created first, capped at 100 — Booking History, and also
// what Recent Activity is derived from (see deriveBookingActivity below).

export async function fetchCommuterReservations(
  commuterId: number,
  scope: "upcoming" | "all" = "upcoming"
): Promise<CommuterReservation[]> {
  try {
    const res  = await fetch(
      `${API_BASE}/reservations/get_commuter_reservations.php?commuter_id=${commuterId}&scope=${scope}`
    );
    const data = await res.json();
    if (data.success && Array.isArray(data.bookings)) return data.bookings;
  } catch {
    // network failure — return empty
  }
  return [];
}

// Recent Activity has no persisted event log of its own — each reservation
// row already carries enough state (created_at, resolved_at, status) to
// derive the required event types without a new table/endpoint. A booking
// is confirmed atomically at creation in this system (no separate pending-
// confirmation step), so "Booking Created" and "Booking Confirmed" collapse
// into one entry rather than two identical-timestamp rows.
export function deriveBookingActivity(bookings: CommuterReservation[]): BookingActivityEntry[] {
  const entries: BookingActivityEntry[] = [];
  for (const b of bookings) {
    entries.push({
      key:             `${b.id}-confirmed`,
      reservationId:   b.id,
      kind:            "confirmed",
      label:           "Booking Confirmed",
      routeName:       b.route_name,
      vehicleCategory: b.vehicle_category,
      timestamp:       b.created_at,
      status:          b.boarding_status,
      qrCode:          b.qr_code,
    });
    if (b.boarding_status === "boarded" && !b.resolved_at) {
      // Scanned by the driver — the ticket is used. resolved_at isn't set
      // until the trip itself is completed, so fall back to boarded_at.
      entries.push({
        key:             `${b.id}-resolved`,
        reservationId:   b.id,
        kind:            "completed",
        label:           "Trip Completed",
        routeName:       b.route_name,
        vehicleCategory: b.vehicle_category,
        timestamp:       b.boarded_at ?? b.created_at,
        status:          b.boarding_status,
        qrCode:          b.qr_code,
      });
    } else if (b.resolved_at) {
      const completed = b.status === "completed";
      entries.push({
        key:             `${b.id}-resolved`,
        reservationId:   b.id,
        kind:            completed ? "completed" : "cancelled",
        label:           completed ? "Trip Completed" : "Booking Cancelled",
        routeName:       b.route_name,
        vehicleCategory: b.vehicle_category,
        timestamp:       b.resolved_at,
        status:          b.boarding_status,
        qrCode:          b.qr_code,
      });
    }
  }
  return entries.sort(
    (a, c) => new Date(c.timestamp.replace(" ", "T")).getTime() - new Date(a.timestamp.replace(" ", "T")).getTime()
  );
}

// ─── Reservations ─────────────────────────────────────────────────────────────

export async function createTripReservation(
  payload: CreateTripReservationPayload
): Promise<CreateReservationResult> {
  const res = await authFetch(`${API_BASE}/reservations/create_reservation.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return { success: false, message: `Server error (${res.status})` };
  }

  return res.json();
}

export async function requestRefund(
  reservationId: number,
  commuterId: number
): Promise<RefundResult> {
  const res = await authFetch(`${API_BASE}/reservations/request_refund.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reservation_id: reservationId, commuter_id: commuterId }),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

// DEPRECATED (2026-08-11) — cancel_late.php is frozen at the old binary
// refund policy and no longer called anywhere in this app. requestRefund()
// above is now the single cancellation entry point; the server itself
// determines the tiered outcome (100%/50%/0%, see request_refund.php) and
// this function is only kept so the wrapper still exists for any other
// (non-mobile) caller of the frozen endpoint. Rebooking a missed booking is
// operator-initiated now, not commuter self-service — see operatorRebook()
// below, called from the operator's trip manifest screen, not from this
// commuter-facing service function.
export async function cancelLateNoRefund(
  reservationId: number,
  commuterId: number
): Promise<RefundResult> {
  const res = await fetch(`${API_BASE}/reservations/cancel_late.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reservation_id: reservationId, commuter_id: commuterId }),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

// Commuter-initiated — only flags a missed booking as wanting a rebook, on
// the operator's own trip/slot manifest (this app has no notification
// system, so that's the only place it can surface). Does not rebook
// anything itself; only operatorRebook() below actually creates the new
// reservation. See Core Flow 9a.
export async function requestRebook(
  commuterId: number,
  reservationId: number
): Promise<{ success: boolean; request_id?: number; message?: string }> {
  const res = await fetch(`${API_BASE}/reservations/request_rebook.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commuter_id: commuterId, reservation_id: reservationId }),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

// DEPRECATED — superseded by reviewRebookRequest() + completeRebook(),
// which split "operator grants permission" from "commuter picks the new
// trip themselves." Kept for any lingering reference; operator_rebook.php
// is still functional server-side but no current screen calls this.
export async function operatorRebook(
  operatorId: number,
  reservationId: number,
  target: { newTripId?: number; newUvSlotId?: number; newSeatLabel?: string }
): Promise<RebookingResult> {
  const res = await fetch(`${API_BASE}/reservations/operator_rebook.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operator_id: operatorId,
      reservation_id: reservationId,
      new_trip_id: target.newTripId,
      new_uv_slot_id: target.newUvSlotId,
      new_seat_label: target.newSeatLabel,
    }),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

// DEPRECATED — kept for any lingering reference, superseded by
// reviewRebookRequest() below. operator_rebook.php/reject_rebook.php are
// still functional server-side but no current screen calls them.
export async function rejectRebook(
  operatorId: number,
  reservationId: number
): Promise<{ success: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/reservations/reject_rebook.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_id: operatorId, reservation_id: reservationId }),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

// Operator's half of the 2-step rebooking flow — approves or rejects a
// pending request. Grants/denies permission only: no reservation is
// created and no money moves here. Once approved, the commuter picks their
// own new trip/seat and pays the fee via completeRebook() below.
export async function reviewRebookRequest(
  operatorId: number,
  reservationId: number,
  action: "approve" | "reject",
  rejectionReason?: string
): Promise<{ success: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/reservations/operator_review_rebook.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operator_id: operatorId,
      reservation_id: reservationId,
      action,
      rejection_reason: rejectionReason,
    }),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

// Commuter's half of the 2-step rebooking flow — only reachable once
// reviewRebookRequest() has approved the request. reservationId is the
// ORIGINAL booking's id (matches the request/eligibility contract, not a
// separate rebook_requests.id). Charges the 10% (of the original fare) fee
// and creates the new reservation.
export async function completeRebook(
  commuterId: number,
  reservationId: number,
  target: { newTripId?: number; newUvSlotId?: number; newSeatLabel?: string }
): Promise<RebookingResult> {
  const res = await authFetch(`${API_BASE}/reservations/complete_rebook.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commuter_id: commuterId,
      reservation_id: reservationId,
      new_trip_id: target.newTripId,
      new_uv_slot_id: target.newUvSlotId,
      new_seat_label: target.newSeatLabel,
    }),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}

// Cross-trip aggregation of every pending rebook request across an
// operator's own fleet — powers the "Rebooking Requests" section on the
// Trips screen, so the operator doesn't have to open each trip's manifest
// individually just to notice one. See Core Flow 9a.
export interface RebookRequestSummary {
  reservation_id:  number;
  requested_at:    string;
  passenger_name:  string;
  passenger_phone: string;
  fare_amount:     number;
  departure_time:  string;
  trip_id:         number | null;
  uv_slot_id:      number | null;
  vehicle_category:string;
  route_id:        number | null;
  route_name:      string | null;
  from_location:   string;
  to_location:     string;
}

export async function fetchRebookRequests(operatorId: number): Promise<RebookRequestSummary[]> {
  try {
    const res  = await fetch(`${API_BASE}/reservations/get_rebook_requests.php?operator_id=${operatorId}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.requests)) return data.requests;
  } catch {}
  return [];
}

export interface SeatInfo {
  seat_label: string;
  seat_row:   number;
  seat_col:   number;
  // "blank" marks the aisle path itself — never a real seat, never bookable.
  seat_type:  "window" | "aisle" | "sleeper" | "driver" | "conductor" | "blank";
  is_blocked: boolean;
  state:      "available" | "booked" | "blocked" | "driver" | "conductor" | "blank";
  available:  boolean;
}

export async function fetchAvailableSeats(tripId: number): Promise<SeatInfo[]> {
  try {
    const res  = await fetch(`${API_BASE}/reservations/get_available_seats.php?trip_id=${tripId}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.seats)) return data.seats;
  } catch {
    // network failure — return empty
  }
  return [];
}

export interface ReservationStatus {
  success: boolean;
  id?: number;
  status?: string;
  boarding_status?: string;
  payment_status?: string;
  vehicle_status?: string | null;
  qr_expires_at?: string;
  grace_seconds_remaining?: number | null;
  message?: string;
}

export async function getReservationStatus(reservationId: number): Promise<ReservationStatus> {
  try {
    const res  = await fetch(`${API_BASE}/reservations/get_reservation_status.php?reservation_id=${reservationId}`);
    return await res.json();
  } catch {
    return { success: false };
  }
}

export type DiscountDecision = "keep" | "decline" | "grant";

export interface PreviewTicketResult {
  success: boolean;
  message?: string;
  passenger_name?: string;
  queue_number?: number | null;
  destination_terminal?: string;
  fare_amount?: number;
  discount_type?: string | null;
  payment_status?: string;
  commuter_category?: string | null;
  commuter_is_verified?: number;
  full_fare?: number;
  discounted_fare?: number;
  can_decline?: boolean;
  can_grant?: boolean;
  // Set only when this reservation is a continuation of an earlier
  // rebooked-away booking — see complete_rebook.php. can_decline/can_grant
  // are already false for these (payment_status is 'released'), so this is
  // informational only, not a gate.
  is_rebooked?: boolean;
  original_fare_amount?: number | null;
  rebooking_fee_amount?: number | null;
  additional_fare_due?: number | null;
}

export async function previewTicket(driverId: number, qrCode: string): Promise<PreviewTicketResult> {
  try {
    const res = await fetch(
      `${API_BASE}/reservations/preview_ticket.php?driver_id=${driverId}&qr_code=${encodeURIComponent(qrCode)}`
    );
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}

export async function boardReservation(
  driverId: number,
  qrCode: string,
  discountDecision?: DiscountDecision
): Promise<{
  success: boolean; message?: string; passenger_name?: string; queue_number?: number | null;
  destination_terminal?: string; fare_amount?: number; discount_type?: string | null;
  discount_decision_applied?: DiscountDecision; surcharge_charged?: number | null; cashback_credited?: number | null;
  // Set only when this reservation is a continuation of an earlier
  // rebooked-away booking — see complete_rebook.php.
  is_rebooked?: boolean; original_fare_amount?: number | null;
  rebooking_fee_amount?: number | null; additional_fare_due?: number | null;
}> {
  const res = await authFetch(`${API_BASE}/reservations/board_reservation.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      driver_id: driverId,
      qr_code: qrCode,
      ...(discountDecision ? { discount_decision: discountDecision } : {}),
    }),
  });
  if (!res.ok) return { success: false, message: `Server error (${res.status})` };
  return res.json();
}
