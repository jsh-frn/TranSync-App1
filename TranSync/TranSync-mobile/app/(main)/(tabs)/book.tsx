import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, ActivityIndicator, TextInput, Modal, useWindowDimensions, BackHandler,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type {
  BookingDraft, BookStep, BookMode, Route, BusTrip, UvSlot, CommuterReservation,
} from "../../../src/types/booking";
import { VEHICLE_META, getDisplayStatus, DISPLAY_STATUS_COLOR } from "../../../src/types/booking";
import {
  fetchRoutes, fetchBusTrips, fetchAvailableSlots,
  createTripReservation,
  fetchAvailableSeats, type SeatInfo,
} from "../../../src/services/bookingService";
import { PassengerForm } from "../../../src/components/booking/PassengerForm";
import { BookingConfirm } from "../../../src/components/booking/BookingConfirm";
import { BookingDetailsModal } from "../../../src/components/booking/BookingDetailsModal";
import { formatTime12h } from "../../../src/utils/time";
import API_BASE from "../../../src/config/api";
import { useBookings } from "../../../src/context/BookingsContext";
import { useUser } from "../../../src/context/UserContext";

// ─── Constants ────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

const BLANK_DRAFT: BookingDraft = {
  mode: "bus", selected: null,
  passenger: { name: "", phone: "", age: "", email: "", emergencyName: "", emergencyPhone: "" },
};

const STEP_ORDER: BookStep[] = ["browse", "detail", "passenger", "confirm"];
const UV_POLL_MS = 5000;
// Matches home.tsx's Recent Activity poll cadence — keeps "My Upcoming
// Bookings" reflecting status changes (e.g. a booking expiring past its QR
// grace period, or the vehicle entering its boarding window) while this tab
// stays open, not just on focus/re-entry.
const UPCOMING_POLL_MS = 18000;

// Bus browsing is a 3-stage wizard: route → travel date → that day's departures.
type BusBrowseStage = "route" | "date" | "trips";
// UV Express browsing is a 2-stage wizard: route → book-ahead departures on it.
// Booking availability is entirely operator/association-controlled (route
// Active/Not Active + published operating hours) — there is no driver-
// initiated "go online" live session to browse anymore.
type UvBrowseStage = "route" | "book";

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BookScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const router = useRouter();
  const {
    upcoming, refreshUpcoming, refreshAll, addOptimistic,
  } = useBookings();
  const { user: liveUser, refreshUser } = useUser();

  const [step,        setStep]        = useState<BookStep>("browse");
  const [draft,       setDraft]       = useState<BookingDraft>(BLANK_DRAFT);

  // "My Upcoming Bookings" scoped to whichever mode tab is active — previously
  // this showed every upcoming booking (Bus + UV mixed) regardless of which
  // tab was selected.
  const myBookings = useMemo(
    () => upcoming.filter((bk) => bk.vehicle_category === (draft.mode === "bus" ? "Bus" : "UV Express")),
    [upcoming, draft.mode]
  );

  // Bus wizard state
  const [busStage,    setBusStage]    = useState<BusBrowseStage>("route");
  const [busRoutes,   setBusRoutes]   = useState<Route[]>([]);
  const [routeSearch, setRouteSearch] = useState("");
  const [pickedRoute, setPickedRoute] = useState<Route | null>(null);
  const [travelDate,  setTravelDate]  = useState(TODAY);
  const [busTrips,    setBusTrips]    = useState<BusTrip[]>([]);

  // UV Express wizard state
  const [uvStage,       setUvStage]       = useState<UvBrowseStage>("route");
  const [uvRoutes,      setUvRoutes]      = useState<Route[]>([]);
  const [uvRouteSearch, setUvRouteSearch] = useState("");
  const [pickedUvRoute, setPickedUvRoute] = useState<Route | null>(null);
  const [uvSlots,       setUvSlots]       = useState<UvSlot[]>([]);

  // UV Express book-ahead: the association's schedule for the picked route
  // (operating hours + recurrence), and the commuter's own chosen date/time
  // within it — replaces picking from operator-pre-made slots only; the
  // first commuter to pick a given time creates the pooled slot, later ones
  // join it (see Core Flow 8b).
  const [uvSchedule,      setUvSchedule]      = useState<{
    start_time: string; end_time: string;
    recurrence_type: "daily" | "weekly"; weekdays: number[] | null;
    is_bookable: boolean;
  } | null>(null);
  const [uvBookDate,    setUvBookDate]    = useState(TODAY);
  const [uvBookTime,    setUvBookTime]    = useState("08:00");
  const [uvResolving,   setUvResolving]   = useState(false);
  const [uvResolveError,setUvResolveError]= useState<string | null>(null);

  const [listLoad,    setListLoad]    = useState(true);
  const [listErr,     setListErr]     = useState<string | null>(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed,   setConfirmed]   = useState<{
    id: number; qrCode: string; newBalance?: number;
    fareAmount: number; discountType: string | null; discountCapped: boolean; queueNumber: number | null;
    qrActiveAt: string | null; seatLabel: string | null;
  } | null>(null);
  const [commuterId,  setCommuterId]  = useState<number | null>(null);
  // Real, admin-verified discount eligibility — the Passenger Type selector
  // (informational only, see PassengerForm) reads this to know what's
  // actually verified; it never drives what create_reservation.php charges.
  // Derived from UserContext (not its own fetch/state) so a commuter who
  // gets verified mid-session sees the correct discount preview here
  // without restarting the app — see src/context/UserContext.tsx.
  const commuterProfile = liveUser
    ? { category: liveUser.category ?? "default", isVerified: liveUser.is_verified == 1 }
    : null;
  const [walletBalance,   setWalletBalance]   = useState<number | null>(null);
  // Booking Details modal (BookingDetailsModal) reads this — it owns its
  // own live-status polling, cancel, and rebook-request flows internally.
  const [viewBooking, setViewBooking] = useState<CommuterReservation | null>(null);

  // Bus seat picker (mandatory — a Bus trip has a fixed vehicle/seat map)
  const [seatOptions,  setSeatOptions]  = useState<SeatInfo[]>([]);
  // Seat cell size: 44dp normally, shrunk so the widest row (crew cells are
  // ~2.1x wide) never overflows narrow screens. Gap between cells is 10dp.
  const seatSize = (() => {
    const rows: Record<number, { units: number; n: number }> = {};
    seatOptions.forEach(st => {
      const r = (rows[st.seat_row] ??= { units: 0, n: 0 });
      r.units += (st.state === "driver" || st.state === "conductor") ? 92 / 44 : 1;
      r.n += 1;
    });
    const avail = windowWidth - 72; // screen + card horizontal padding
    let size = 44;
    Object.values(rows).forEach(r => {
      size = Math.min(size, Math.floor((avail - 10 * (r.n - 1)) / r.units));
    });
    return Math.max(28, size);
  })();
  const [seatsLoading, setSeatsLoading] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);

  const routeSearchTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uvRouteSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uvPoll             = useRef<ReturnType<typeof setInterval> | null>(null);

  const update = useCallback((patch: Partial<BookingDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  function resetBusWizard() {
    setBusStage("route");
    setPickedRoute(null);
    setTravelDate(TODAY);
    setRouteSearch("");
  }

  function resetUvWizard() {
    setUvStage("route");
    setPickedUvRoute(null);
    setUvRouteSearch("");
    setUvSchedule(null);
    setUvBookDate(TODAY);
    setUvBookTime("08:00");
    setUvResolveError(null);
  }

  function goBack() {
    if (step === "browse" && draft.mode === "bus" && busStage !== "route") {
      setBusStage(busStage === "trips" ? "date" : "route");
      return;
    }
    if (step === "browse" && draft.mode === "uv" && uvStage !== "route") {
      setUvStage("route");
      return;
    }
    // A completed booking is done — stepping "back" into a now-stale Passenger
    // Info form (this screen's normal previous step) makes no sense once
    // payment already went through. Go to My Upcoming Bookings instead, same
    // as the confirmation screen's own "Book Another Trip" action.
    if (step === "confirm") {
      resetToBrowse();
      return;
    }
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) setStep(STEP_ORDER[idx - 1]);
  }

  // ── Bootstrap: commuter profile (auto-fills passenger info) + bookings ──────
  // Sourced from UserContext (liveUser) instead of its own AsyncStorage read
  // — commuterProfile above is derived from the same object, so both stay
  // in sync with whatever UserContext's periodic refresh last saw.

  useEffect(() => {
    if (!liveUser?.id) return;
    setCommuterId(liveUser.id);
    setDraft((prev) => ({
      ...prev,
      passenger: { ...prev.passenger, name: liveUser.name ?? "", phone: liveUser.phone ?? "", email: liveUser.email ?? "" },
    }));
    fetch(`${API_BASE}/wallet/wallet.php?commuter_id=${liveUser.id}`)
      .then((r) => r.json())
      .then((d) => { if (d?.success) setWalletBalance(d.balance); })
      .catch(() => {});
  }, [liveUser?.id]);

  // "My Upcoming Bookings" comes from BookingsContext (shared with Home's
  // Recent Activity and the Booking History screen) — refetch it whenever
  // this tab regains focus, same pattern wallet.tsx already uses, so a
  // booking made/cancelled elsewhere is reflected without a manual refresh.
  // Wallet balance is refreshed the same way, so the Passenger Info screen's
  // Payment Method Preview never shows a stale balance after a top-up done
  // on another tab.
  useFocusEffect(useCallback(() => {
    refreshUpcoming();
    refreshUser();
    if (commuterId) {
      fetch(`${API_BASE}/wallet/wallet.php?commuter_id=${commuterId}`)
        .then((r) => r.json())
        .then((d) => { if (d?.success) setWalletBalance(d.balance); })
        .catch(() => {});
    }
    // Light poll while this tab stays open (same cadence as home.tsx's
    // Recent Activity) — a booking sitting in "My Upcoming Bookings" must
    // reflect a status change (grace-period expiry, boarding starting) on
    // its own, not only when the commuter leaves and returns to this tab.
    // refreshUser() rides along so the discount preview above updates the
    // moment this commuter gets verified mid-session too.
    const interval = setInterval(() => { refreshUpcoming(); refreshUser(); }, UPCOMING_POLL_MS);
    return () => clearInterval(interval);
  }, [refreshUpcoming, refreshUser, commuterId]));

  // ── Seat map for the currently-selected Bus trip ─────────────────────────────
  // Keyed on the selected trip (not `step`) — this must NOT re-run when the
  // wizard advances from "detail" to "passenger"/"confirm" for the same trip,
  // or it wipes the commuter's already-picked seat out from under them right
  // before they submit, silently no-opping "Confirm Booking" with no feedback.
  useEffect(() => {
    setSelectedSeat(null);
    if (draft.mode !== "bus" || !draft.selected) {
      setSeatOptions([]);
      return;
    }
    setSeatsLoading(true);
    fetchAvailableSeats((draft.selected as BusTrip).id)
      .then(setSeatOptions)
      .finally(() => setSeatsLoading(false));
  }, [draft.mode, draft.selected]);

  // ── Route pickers (shared fetch, filtered by vehicle type) ──────────────────

  const loadRoutesByType = useCallback(async (
    type: "Bus" | "UV Express", q: string | undefined, setter: (r: Route[]) => void
  ) => {
    setListLoad(true);
    setListErr(null);
    try {
      const data = await fetchRoutes(q);
      const filtered = data.filter((r) => r.vehicle_type === type);
      setter(filtered);
      if (filtered.length === 0) setListErr(`No ${type} routes found.`);
    } catch {
      setListErr("Could not load routes. Check your connection.");
    } finally {
      setListLoad(false);
    }
  }, []);

  const loadBusRoutes = useCallback((q?: string) => loadRoutesByType("Bus", q, setBusRoutes), [loadRoutesByType]);
  const loadUvRoutes  = useCallback((q?: string) => loadRoutesByType("UV Express", q, setUvRoutes), [loadRoutesByType]);

  useFocusEffect(useCallback(() => {
    if (step !== "browse") return;
    if (draft.mode === "bus" && busStage === "route") loadBusRoutes(routeSearch);
    if (draft.mode === "uv"  && uvStage  === "route") loadUvRoutes(uvRouteSearch);
  }, [step, draft.mode, busStage, uvStage]));

  function handleRouteSearchChange(text: string) {
    setRouteSearch(text);
    if (routeSearchTimer.current) clearTimeout(routeSearchTimer.current);
    routeSearchTimer.current = setTimeout(() => loadBusRoutes(text), 400);
  }

  function handleUvRouteSearchChange(text: string) {
    setUvRouteSearch(text);
    if (uvRouteSearchTimer.current) clearTimeout(uvRouteSearchTimer.current);
    uvRouteSearchTimer.current = setTimeout(() => loadUvRoutes(text), 400);
  }

  function selectRoute(r: Route) {
    setPickedRoute(r);
    setBusStage("date");
  }

  function selectUvRoute(r: Route) {
    setPickedUvRoute(r);
    setUvStage("book");
  }

  // ── Bus: load trips for the picked route + date (stage 3) ───────────────────

  const loadBusTripsForSelection = useCallback(async () => {
    if (!pickedRoute) return;
    setListLoad(true);
    setListErr(null);
    try {
      const data = await fetchBusTrips(pickedRoute.id, travelDate);
      setBusTrips(data);
      if (data.length === 0) setListErr("No scheduled trips for this date.");
    } catch {
      setListErr("Could not load trips. Check your connection.");
    } finally {
      setListLoad(false);
    }
  }, [pickedRoute, travelDate]);

  useEffect(() => {
    if (step === "browse" && draft.mode === "bus" && busStage === "trips") {
      loadBusTripsForSelection();
    }
  }, [step, draft.mode, busStage, loadBusTripsForSelection]);

  function adjustTravelDate(delta: number) {
    const d   = new Date(travelDate);
    d.setDate(d.getDate() + delta);
    const min = new Date(TODAY);
    if (d < min) return;
    setTravelDate(d.toISOString().slice(0, 10));
  }

  // ── UV Express: poll scheduled slots + the association's schedule for the
  // picked route. Availability is entirely operator/association-controlled —
  // no live driver "go online" session to poll for anymore.

  const loadUvAvailability = useCallback(async (routeId: number) => {
    try {
      const [slots, scheduleRes] = await Promise.all([
        fetchAvailableSlots(routeId),
        fetch(`${API_BASE}/routes/get_uv_schedule.php?route_id=${routeId}`).then(r => r.json()).catch(() => null),
      ]);
      setUvSlots(slots);
      setUvSchedule(scheduleRes?.success ? scheduleRes.schedule : null);
      setListErr(slots.length === 0 && !scheduleRes?.schedule?.is_bookable
        ? "No SUV is currently available or scheduled for this route." : null);
    } catch {
      setListErr("Could not load available SUVs. Check your connection.");
    } finally {
      setListLoad(false);
    }
  }, []);

  // ── UV Express book-ahead: commuter picks their own date/time within the
  // route's schedule; resolve_slot.php finds-or-creates the pooled slot ─────
  // Steppers are clamped client-side to the association's own operating
  // window/recurrence so an out-of-range pick can never be scrolled to in
  // the first place — mirrors resolve_slot.php's own bounds exactly
  // (start_time/end_time inclusive both ends, weekdays 0=Sun..6=Sat matching
  // JS Date.getDay()) so the server can never reject a time the client
  // already showed as selectable.
  function isValidUvDate(dateStr: string): boolean {
    if (dateStr < TODAY) return false;
    if (!uvSchedule || uvSchedule.recurrence_type !== "weekly") return true;
    return (uvSchedule.weekdays ?? []).includes(new Date(dateStr).getDay());
  }

  function clampUvTime(time: string): string {
    if (!uvSchedule) return time;
    const toMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const mins       = toMinutes(time);
    const startMins  = toMinutes(uvSchedule.start_time);
    const endMins    = toMinutes(uvSchedule.end_time);

    // UV Express runs 24 hours, so the operating window can wrap past
    // midnight (start > end, e.g. 23:00 -> 02:00 next day) — mirrors
    // resolve_slot.php's own start<=end vs start>end split exactly.
    if (startMins <= endMins) {
      if (mins < startMins) return uvSchedule.start_time;
      if (mins > endMins)   return uvSchedule.end_time;
      return time;
    }
    // Overnight: valid range is [startMins, 1440) union [0, endMins]. Only
    // the excluded daytime gap (endMins, startMins) needs snapping — to
    // whichever boundary is closer.
    if (mins >= startMins || mins <= endMins) return time;
    const distToEnd   = mins - endMins;
    const distToStart = startMins - mins;
    return distToEnd <= distToStart ? uvSchedule.end_time : uvSchedule.start_time;
  }

  // Snap the current date/time picks back into range whenever the picked
  // route's schedule loads or changes (e.g. switching routes) — otherwise
  // the "08:00 today" defaults could start out already invalid for a
  // schedule that doesn't operate that early or run today.
  useEffect(() => {
    if (!uvSchedule) return;
    setUvBookTime((t) => clampUvTime(t));
    setUvBookDate((d) => {
      if (isValidUvDate(d)) return d;
      const cursor = new Date(d < TODAY ? TODAY : d);
      for (let i = 0; i < 60; i++) {
        const candidate = cursor.toISOString().slice(0, 10);
        if (candidate >= TODAY && isValidUvDate(candidate)) return candidate;
        cursor.setDate(cursor.getDate() + 1);
      }
      return d;
    });
  }, [uvSchedule]);

  function adjustUvBookDate(delta: number) {
    const step = delta > 0 ? 1 : -1;
    const d = new Date(uvBookDate);
    for (let i = 0; i < 60; i++) {
      d.setDate(d.getDate() + step);
      const candidate = d.toISOString().slice(0, 10);
      if (candidate < TODAY) return; // never go before today
      if (isValidUvDate(candidate)) { setUvBookDate(candidate); return; }
    }
  }

  function adjustUvBookTime(field: "hour" | "minute", delta: number) {
    const [h, m] = uvBookTime.split(":").map(Number);
    const next = field === "hour"
      ? `${String((h + delta + 24) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      : `${String(h).padStart(2, "0")}:${String((m + delta + 60) % 60).padStart(2, "0")}`;
    setUvBookTime(clampUvTime(next));
  }

  async function handleResolveUvSlot() {
    if (!pickedUvRoute) return;
    setUvResolving(true);
    setUvResolveError(null);
    try {
      const departure_time = `${uvBookDate} ${uvBookTime}:00`;
      const res = await fetch(`${API_BASE}/uv_slots/resolve_slot.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route_id: pickedUvRoute.id, departure_time }),
      }).then(r => r.json());
      if (!res.success) {
        setUvResolveError(res.message ?? "Couldn't book that time — try another.");
        return;
      }
      const slot: UvSlot = {
        id: res.slot_id,
        route_id: pickedUvRoute.id,
        route_name: pickedUvRoute.name,
        from_location: pickedUvRoute.from_location,
        to_location: pickedUvRoute.to_location,
        color: pickedUvRoute.color,
        fare: pickedUvRoute.fare ?? 0,
        departure_time,
        capacity: null,
        seats_booked: 0,
        seats_left: null,
        status: "scheduled",
      };
      update({ mode: "uv", selected: slot });
      setStep("detail");
    } catch {
      setUvResolveError("Cannot connect to server.");
    } finally {
      setUvResolving(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      if (step !== "browse" || draft.mode !== "uv" || uvStage !== "book" || !pickedUvRoute) return;
      setListLoad(true);
      const poll = () => loadUvAvailability(pickedUvRoute.id);
      poll();
      uvPoll.current = setInterval(poll, UV_POLL_MS);
      return () => {
        if (uvPoll.current) clearInterval(uvPoll.current);
      };
    }, [draft.mode, step, uvStage, pickedUvRoute])
  );

  function switchMode(mode: BookMode) {
    if (mode === draft.mode) return;
    update({ mode, selected: null });
    if (mode === "bus") resetBusWizard();
    if (mode === "uv")  resetUvWizard();
    setListLoad(true);
    setListErr(null);
  }

  // ── Booking submit ───────────────────────────────────────────────────────────

  async function handleConfirmBooking() {
    if (!draft.selected || !draft.passenger.name.trim() || !draft.passenger.phone.trim() || !commuterId) return;
    if (draft.mode === "bus" && !selectedSeat) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await createTripReservation({
        commuter_id:     commuterId,
        trip_id:         draft.mode === "bus" ? draft.selected.id : undefined,
        uv_slot_id:      draft.mode === "uv" ? draft.selected.id : undefined,
        passenger_name:  draft.passenger.name.trim(),
        passenger_phone: draft.passenger.phone.trim(),
        passenger_age:   draft.passenger.age ? Number(draft.passenger.age) : null,
        seat_label:      draft.mode === "bus" ? selectedSeat! : undefined,
      });

      if (!result.success) {
        const msg = result.message ?? "Booking failed.";
        const extra = result.balance !== undefined
          ? ` (Balance: ₱${result.balance}, Required: ₱${result.required})`
          : "";
        setSubmitError(msg + extra);
        return;
      }

      setConfirmed({
        id:           result.reservation_id!,
        qrCode:       result.qr_code!,
        newBalance:   result.new_balance,
        fareAmount:   result.fare_amount ?? 0,
        discountType: result.discount_type ?? null,
        discountCapped: result.discount_capped ?? false,
        queueNumber:  result.queue_number ?? null,
        qrActiveAt:   result.qr_active_at ?? null,
        // Captured here (not read live from `selectedSeat` in the success
        // screen) because resetToBrowse() clears selectedSeat the moment the
        // commuter leaves this screen — the success screen must keep showing
        // the seat that was actually booked regardless of that reset.
        seatLabel:    draft.mode === "bus" ? selectedSeat : null,
      });

      // create_reservation.php doesn't echo back route/vehicle-type/seat info
      // (BookingConfirm already reads those from draft.selected, not the API
      // response — same pattern here) — reconstruct a full CommuterReservation
      // locally so it shows up in "My Upcoming Bookings" instantly, without
      // waiting for a refetch or a "Book Another Trip" tap.
      const sel = draft.selected as BusTrip | UvSlot;
      addOptimistic({
        id: result.reservation_id!,
        trip_id: draft.mode === "bus" ? sel.id : null,
        uv_session_id: null,
        uv_slot_id: draft.mode === "uv" ? sel.id : null,
        route_id: sel.route_id,
        origin_terminal: sel.from_location,
        destination_terminal: sel.to_location,
        departure_time: (sel as BusTrip | UvSlot).departure_time,
        fare_amount: result.fare_amount ?? 0,
        discount_type: result.discount_type ?? null,
        passenger_name: draft.passenger.name.trim(),
        passengers_count: 1,
        vehicle_category: draft.mode === "bus" ? "Bus" : "UV Express",
        status: "confirmed",
        boarding_status: "reserved",
        payment_status: "held",
        cancellation_type: null,
        seat_labels: draft.mode === "bus" ? selectedSeat : null,
        queue_number: result.queue_number ?? null,
        seats_ahead: result.queue_number != null ? Math.max(0, result.queue_number - 1) : null,
        qr_code: result.qr_code!,
        created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        resolved_at: null,
        route_name: sel.route_name,
        route_color: sel.color,
      });

      setStep("confirm");
    } catch (err: any) {
      setSubmitError(err?.message ?? "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Shared by "Book Another Trip", "Back to Home", and "View My Bookings" —
  // all three leave the confirmation screen and should never show it again
  // if the commuter comes back to this tab. The booking itself is already
  // saved server-side and synced into BookingsContext (see addOptimistic()
  // at booking time, Core Flow 9a); refreshAll() here just reconciles it,
  // it doesn't create or move anything.
  function resetToBrowse() {
    setDraft((prev) => ({ ...BLANK_DRAFT, mode: prev.mode, passenger: prev.passenger }));
    resetBusWizard();
    resetUvWizard();
    setConfirmed(null);
    setSubmitError(null);
    setStep("browse");
    refreshAll();
  }

  function handleNewBooking() {
    resetToBrowse();
  }

  function handleBackHome() {
    resetToBrowse();
    // replace (not push) so the confirmation screen isn't left in history —
    // the device Back button won't return to it.
    router.replace("/(main)/home");
  }

  function handleViewBookings() {
    resetToBrowse();
    router.push("/(main)/booking-history");
  }

  // ── Cancel / refund / rebook ─────────────────────────────────────────────────

  // ── Header copy ──────────────────────────────────────────────────────────────

  const showBackBtn = step !== "browse"
    || (draft.mode === "bus" && busStage !== "route")
    || (draft.mode === "uv"  && uvStage  !== "route");

  // The phone's own Back button / back gesture. Without this, Back on this tab
  // fell through to the tab navigator, which jumps to another tab — so after a
  // finished booking, Back sent the commuter away from (or back into) the
  // booking flow instead of to My Upcoming Bookings. Now it behaves exactly
  // like the on-screen Back arrow: one wizard step back, and from the finished
  // confirmation screen straight to My Upcoming Bookings (see goBack()). On the
  // first browse stage there's nothing to go back to inside this screen, so it's
  // handed back to the system (leaves the tab as before). The ref keeps the
  // listener reading the latest state without re-subscribing on every render.
  const hardwareBackRef = useRef<() => boolean>(() => false);
  hardwareBackRef.current = () => {
    if (!showBackBtn) return false;
    goBack();
    return true;
  };
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => hardwareBackRef.current());
      return () => sub.remove();
    }, [])
  );

  function headerTitle(): string {
    if (step === "detail")    return "Trip Details";
    if (step === "passenger") return "Passenger Info";
    if (step === "confirm")   return "Confirmation";
    if (draft.mode === "bus") return busStage === "route" ? "Choose Route" : busStage === "date" ? "Choose Travel Date" : "Available Trips";
    return uvStage === "route" ? "Choose Route" : "Available SUVs";
  }

  function headerSub(): string | null {
    if (step !== "browse") return null;
    if (draft.mode === "bus") {
      if (busStage === "route") return "Scheduled Bus trips";
      return pickedRoute ? `${pickedRoute.from_location} → ${pickedRoute.to_location}` : null;
    }
    if (uvStage === "route") return "Live UV Express vehicles";
    return pickedUvRoute ? `${pickedUvRoute.from_location} → ${pickedUvRoute.to_location}` : null;
  }

  const onFirstStage =
    (draft.mode === "bus" && busStage === "route") ||
    (draft.mode === "uv"  && uvStage  === "route");

  // "My Upcoming X Bookings" — rendered inline (not as a fixed sibling above
  // the route list) so it scrolls away together with the route list beneath
  // it, instead of staying pinned on screen. Reused at every place the route-
  // picking stage can render (loading / empty / populated), so it never
  // disappears or flickers depending on route-list state.
  const myUpcomingBlock = (
    <>
      <Text style={mb.heading}>My Upcoming {draft.mode === "bus" ? "Bus" : "UV Express"} Bookings</Text>
      {myBookings.length === 0 ? (
        <Text style={mb.emptyText}>You don't have any upcoming trips.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={mb.hScroll}>
          {myBookings.map((bk) => {
            const meta = VEHICLE_META[bk.vehicle_category] ?? VEHICLE_META["UV Express"];
            const dep  = new Date(bk.departure_time.replace(" ", "T"));
            const depStr = (bk.uv_session_id
              ? `Queue #${bk.queue_number ?? "—"}`
              : dep.toLocaleDateString("en-PH", { month: "short", day: "numeric" }) + " · " +
                dep.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }))
              + (bk.seat_labels ? ` · Seat ${bk.seat_labels}` : "");
            return (
              <TouchableOpacity key={bk.id} style={mb.card} onPress={() => setViewBooking(bk)} activeOpacity={0.85}>
                <View style={[mb.colorBar, { backgroundColor: bk.route_color || meta.color }]} />
                <View style={mb.body}>
                  <View style={mb.badgeRow}>
                    <View style={[mb.badge, { backgroundColor: meta.bg }]}>
                      <Ionicons name={meta.icon as any} size={10} color={meta.color} />
                      <Text style={[mb.badgeTxt, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                    <Text style={[mb.statusTxt, { color: DISPLAY_STATUS_COLOR[getDisplayStatus(bk)] }]}>{getDisplayStatus(bk)}</Text>
                  </View>
                  <Text style={mb.route} numberOfLines={1}>
                    {bk.route_name ?? `${bk.origin_terminal} → ${bk.destination_terminal}`}
                  </Text>
                  <View style={mb.locRow}>
                    <View style={[mb.dot, { backgroundColor: "#1a4a52" }]} />
                    <Text style={mb.loc} numberOfLines={1}>{bk.origin_terminal}</Text>
                  </View>
                  <View style={[mb.dot, { backgroundColor: "#e5e7eb", width: 2, height: 8, borderRadius: 1, marginLeft: 3 }]} />
                  <View style={mb.locRow}>
                    <View style={[mb.dot, { backgroundColor: "#a8d832" }]} />
                    <Text style={mb.loc} numberOfLines={1}>{bk.destination_terminal}</Text>
                  </View>
                  <View style={mb.footer}>
                    <Ionicons name="time-outline" size={11} color="#6b7280" />
                    <Text style={mb.dep} numberOfLines={1}>{depStr}</Text>
                    <Text style={mb.fare}>₱{bk.fare_amount}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </>
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={s.root}>

      {/* ── Sticky header ── */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerRow}>
          {showBackBtn && (
            <TouchableOpacity style={s.backBtn} onPress={goBack} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={18} color="#1a4a52" />
              <Text style={s.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>{headerTitle()}</Text>
            {headerSub() && <Text style={s.headerSub}>{headerSub()}</Text>}
          </View>
        </View>

        {step !== "browse" && (
          <View style={s.dots}>
            {STEP_ORDER.slice(1).map((k) => {
              const cur = STEP_ORDER.indexOf(step);
              const dot = STEP_ORDER.indexOf(k);
              return (
                <View
                  key={k}
                  style={[s.dot, cur === dot && s.dotActive, cur > dot && s.dotDone]}
                />
              );
            })}
          </View>
        )}
      </View>

      {/* ══ STEP: BROWSE ══ */}
      {step === "browse" && (
        <View style={{ flex: 1 }}>
          {/* Bus | UV Express toggle — only on each mode's first stage */}
          {onFirstStage && (
            <View style={s.modeToggle}>
              <TouchableOpacity
                style={[s.modeBtn, draft.mode === "bus" && s.modeBtnActive]}
                onPress={() => switchMode("bus")}
                activeOpacity={0.8}
              >
                <Ionicons name="bus" size={14} color={draft.mode === "bus" ? "#fff" : "#6b7280"} />
                <Text style={[s.modeTxt, draft.mode === "bus" && s.modeTxtActive]}>Bus</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modeBtn, draft.mode === "uv" && s.modeBtnActive]}
                onPress={() => switchMode("uv")}
                activeOpacity={0.8}
              >
                <Ionicons name="car-outline" size={14} color={draft.mode === "uv" ? "#fff" : "#6b7280"} />
                <Text style={[s.modeTxt, draft.mode === "uv" && s.modeTxtActive]}>UV Express</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Bus stage 1: search + pick a route */}
          {draft.mode === "bus" && busStage === "route" && (
            <View style={s.searchBar}>
              <Ionicons name="search-outline" size={16} color="#9ca3af" />
              <TextInput
                style={s.searchInput}
                value={routeSearch}
                onChangeText={handleRouteSearchChange}
                placeholder="Search Bus routes…"
                placeholderTextColor="#9ca3af"
              />
              {routeSearch.length > 0 && (
                <TouchableOpacity onPress={() => { setRouteSearch(""); loadBusRoutes(); }} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={16} color="#9ca3af" />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* UV stage 1: search + pick a route */}
          {draft.mode === "uv" && uvStage === "route" && (
            <View style={s.searchBar}>
              <Ionicons name="search-outline" size={16} color="#9ca3af" />
              <TextInput
                style={s.searchInput}
                value={uvRouteSearch}
                onChangeText={handleUvRouteSearchChange}
                placeholder="Search UV Express routes…"
                placeholderTextColor="#9ca3af"
              />
              {uvRouteSearch.length > 0 && (
                <TouchableOpacity onPress={() => { setUvRouteSearch(""); loadUvRoutes(); }} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={16} color="#9ca3af" />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Bus stage 2: choose travel date */}
          {draft.mode === "bus" && busStage === "date" && (
            <ScrollView contentContainerStyle={s.detailScroll} showsVerticalScrollIndicator={false}>
              <View style={s.card}>
                <Text style={s.cardLabel}>Travel Date</Text>
                <View style={s.dateRow}>
                  <TouchableOpacity style={s.adjBtn} onPress={() => adjustTravelDate(-1)} activeOpacity={0.7} accessibilityLabel="Previous day">
                    <Ionicons name="chevron-back" size={18} color="#1a4a52" />
                  </TouchableOpacity>
                  <View style={s.dateCenter}>
                    <Text style={s.dateVal}>
                      {new Date(travelDate).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}
                    </Text>
                    {travelDate === TODAY && <Text style={s.dateSub}>Today</Text>}
                  </View>
                  <TouchableOpacity style={s.adjBtn} onPress={() => adjustTravelDate(1)} activeOpacity={0.7} accessibilityLabel="Next day">
                    <Ionicons name="chevron-forward" size={18} color="#1a4a52" />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={s.wizardHint}>
                Buses run on fixed schedules — you can book a seat for today or several days ahead, whether or not a bus is at the terminal right now.
              </Text>
              <TouchableOpacity style={s.primaryBtn} onPress={() => setBusStage("trips")} activeOpacity={0.85}>
                <Text style={s.primaryBtnTxt}>See Available Trips</Text>
                <Ionicons name="arrow-forward" size={15} color="#fff" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* Bus stage 1 / stage 3, UV stage 1 / stage 2 — all list-driven screens */}
          {(
            (draft.mode === "bus" && (busStage === "route" || busStage === "trips")) ||
            (draft.mode === "uv"  && (uvStage  === "route" || uvStage  === "book"))
          ) && (
            listLoad ? (
              onFirstStage ? (
                <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
                  {myUpcomingBlock}
                  <View style={[s.centred, { paddingTop: 24 }]}>
                    <ActivityIndicator size="large" color="#1a4a52" />
                    <Text style={s.loadingTxt}>Loading routes…</Text>
                  </View>
                </ScrollView>
              ) : (
                <View style={s.centred}>
                  <ActivityIndicator size="large" color="#1a4a52" />
                  <Text style={s.loadingTxt}>
                    {draft.mode === "bus" ? "Loading trips…" : "Loading schedule…"}
                  </Text>
                </View>
              )
            ) : draft.mode === "bus" && busStage === "route" ? (
              <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
                {myUpcomingBlock}
                <Text style={[mb.heading, { marginTop: 18 }]}>Available Bus Routes</Text>
                {busRoutes.length === 0 ? (
                  <View style={[s.centred, { paddingTop: 8 }]}>
                    <Ionicons name="bus-outline" size={48} color="#d1d5db" />
                    <Text style={s.emptyTitle}>{listErr ?? "No Bus routes found"}</Text>
                  </View>
                ) : (
                  <View style={{ paddingHorizontal: 16 }}>
                    {busRoutes.map((r) => (
                      <RoutePickCard key={r.id} route={r} onSelect={() => selectRoute(r)} />
                    ))}
                  </View>
                )}
              </ScrollView>
            ) : draft.mode === "bus" && busStage === "trips" ? (
              busTrips.length === 0 ? (
                <View style={s.centred}>
                  <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
                  <Text style={s.emptyTitle}>{listErr ?? "No scheduled trips"}</Text>
                  <Text style={s.emptyBody}>Try a different travel date.</Text>
                </View>
              ) : (
                <FlatList
                  data={busTrips}
                  keyExtractor={(t) => String(t.id)}
                  contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                  showsVerticalScrollIndicator={false}
                  ListHeaderComponent={
                    <Text style={s.wizardHint}>Bus bookings must be made at least 24 hours before departure.</Text>
                  }
                  renderItem={({ item }) => (
                    <BusTripCard
                      trip={item}
                      onSelect={() => {
                        update({ mode: "bus", selected: item });
                        setStep("detail");
                      }}
                    />
                  )}
                />
              )
            ) : draft.mode === "uv" && uvStage === "route" ? (
              <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
                {myUpcomingBlock}
                <Text style={[mb.heading, { marginTop: 18 }]}>Available UV Express Routes</Text>
                {uvRoutes.length === 0 ? (
                  <View style={[s.centred, { paddingTop: 8 }]}>
                    <Ionicons name="car-outline" size={48} color="#d1d5db" />
                    <Text style={s.emptyTitle}>{listErr ?? "No UV Express routes found"}</Text>
                  </View>
                ) : (
                  <View style={{ paddingHorizontal: 16 }}>
                    {uvRoutes.map((r) => (
                      <RoutePickCard key={r.id} route={r} onSelect={() => selectUvRoute(r)} />
                    ))}
                  </View>
                )}
              </ScrollView>
            ) : uvSlots.length === 0 && !uvSchedule?.is_bookable ? (
              <View style={s.centred}>
                <Ionicons name="car-outline" size={48} color="#d1d5db" />
                <Text style={s.emptyTitle}>{listErr ?? "No SUV is currently available or scheduled for this route."}</Text>
                <Text style={s.emptyBody}>Vehicles appear here once the operator activates a schedule for this route.</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
                {uvSlots.length > 0 && (
                  <>
                    <Text style={s.wizardHint}>Already-booked departure times for this route — join one, or pick your own time below.</Text>
                    {uvSlots.map((item) => (
                      <UvSlotCard
                        key={item.id}
                        slot={item}
                        onSelect={() => {
                          update({ mode: "uv", selected: item });
                          setStep("detail");
                        }}
                      />
                    ))}
                  </>
                )}

                {uvSchedule?.is_bookable ? (
                  <View style={s.card}>
                    <Text style={s.cardLabel}>Pick Your Own Time</Text>
                    <Text style={s.wizardHint}>
                      This route operates {formatTime12h(uvSchedule.start_time)}–{formatTime12h(uvSchedule.end_time)}
                      {uvSchedule.recurrence_type === "weekly" ? ", specific days only" : ", every day"}.
                      UV Express bookings must be made at least 24 hours before departure.
                    </Text>

                    <Text style={[s.fieldLabel, { marginTop: 10 }]}>Date</Text>
                    <View style={s.dateRow}>
                      <TouchableOpacity style={s.adjBtn} onPress={() => adjustUvBookDate(-1)} activeOpacity={0.7} accessibilityLabel="Previous day">
                        <Ionicons name="chevron-back" size={18} color="#1a4a52" />
                      </TouchableOpacity>
                      <View style={s.dateCenter}>
                        <Text style={s.dateVal}>
                          {new Date(uvBookDate).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}
                        </Text>
                        {uvBookDate === TODAY && <Text style={s.dateSub}>Today</Text>}
                      </View>
                      <TouchableOpacity style={s.adjBtn} onPress={() => adjustUvBookDate(1)} activeOpacity={0.7} accessibilityLabel="Next day">
                        <Ionicons name="chevron-forward" size={18} color="#1a4a52" />
                      </TouchableOpacity>
                    </View>

                    <Text style={[s.fieldLabel, { marginTop: 10 }]}>Time</Text>
                    <View style={s.uvTimeRow}>
                      <View style={s.uvTimeUnit}>
                        <TouchableOpacity onPress={() => adjustUvBookTime("hour", 1)} accessibilityLabel="Increase hour"><Ionicons name="chevron-up" size={16} color="#1a4a52" /></TouchableOpacity>
                        <Text style={s.uvTimeVal}>{uvBookTime.split(":")[0]}</Text>
                        <TouchableOpacity onPress={() => adjustUvBookTime("hour", -1)} accessibilityLabel="Decrease hour"><Ionicons name="chevron-down" size={16} color="#1a4a52" /></TouchableOpacity>
                      </View>
                      <Text style={s.uvTimeSep}>:</Text>
                      <View style={s.uvTimeUnit}>
                        <TouchableOpacity onPress={() => adjustUvBookTime("minute", 15)} accessibilityLabel="Increase minute"><Ionicons name="chevron-up" size={16} color="#1a4a52" /></TouchableOpacity>
                        <Text style={s.uvTimeVal}>{uvBookTime.split(":")[1]}</Text>
                        <TouchableOpacity onPress={() => adjustUvBookTime("minute", -15)} accessibilityLabel="Decrease minute"><Ionicons name="chevron-down" size={16} color="#1a4a52" /></TouchableOpacity>
                      </View>
                    </View>

                    {uvResolveError && (
                      <View style={[s.errBox, { marginTop: 10 }]}>
                        <Text style={s.errText}>{uvResolveError}</Text>
                      </View>
                    )}

                    <TouchableOpacity
                      style={[s.primaryBtn, { marginTop: 14 }, uvResolving && { opacity: 0.6 }]}
                      onPress={handleResolveUvSlot}
                      disabled={uvResolving}
                      activeOpacity={0.85}
                    >
                      {uvResolving ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Text style={s.primaryBtnTxt}>Book This Time</Text>
                          <Ionicons name="arrow-forward" size={15} color="#fff" style={{ marginLeft: 6 }} />
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : uvSlots.length === 0 ? (
                  <Text style={s.sectionEmpty}>No operator is currently running a schedule for this route.</Text>
                ) : null}
              </ScrollView>
            )
          )}
        </View>
      )}

      {/* ══ STEP: DETAIL ══ */}
      {step === "detail" && draft.selected && (
        <ScrollView
          contentContainerStyle={s.detailScroll}
          showsVerticalScrollIndicator={false}
        >
          {draft.mode === "bus" ? (
            <BusDetailCard trip={draft.selected as BusTrip} />
          ) : (
            <UvSlotDetailCard slot={draft.selected as UvSlot} />
          )}

          {draft.mode === "bus" && (
            <View style={s.card}>
              <Text style={s.cardLabel}>Select a Seat</Text>
              {seatsLoading ? (
                <ActivityIndicator color="#1a4a52" style={{ marginVertical: 20 }} />
              ) : seatOptions.length === 0 ? (
                <Text style={s.wizardHint}>No seat map is available for this vehicle yet — contact the operator.</Text>
              ) : (
                <>
                  <View style={sp.legendRow}>
                    <View style={sp.legendItem}><View style={[sp.seatSwatch, sp.seatAvailable]} /><Text style={sp.legendTxt}>Available</Text></View>
                    <View style={sp.legendItem}><View style={[sp.seatSwatch, sp.seatBooked]} /><Text style={sp.legendTxt}>Booked</Text></View>
                    <View style={sp.legendItem}><View style={[sp.seatSwatch, sp.seatSelected]} /><Text style={sp.legendTxt}>Selected</Text></View>
                    <View style={sp.legendItem}><View style={[sp.seatSwatch, sp.seatBlocked]} /><Text style={sp.legendTxt}>Reserved/Saved</Text></View>
                    <View style={sp.legendItem}><View style={[sp.seatSwatch, sp.seatCrew]} /><Text style={sp.legendTxt}>Driver/Conductor</Text></View>
                  </View>
                  {Object.entries(
                    seatOptions.reduce((rows: Record<number, SeatInfo[]>, s) => {
                      (rows[s.seat_row] ??= []).push(s); return rows;
                    }, {})
                  )
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([row, rowSeats]) => (
                      <View key={row} style={sp.gridRow}>
                        {rowSeats.sort((a, b) => a.seat_col - b.seat_col).map((seat) => {
                          // The aisle path itself — not a seat, never shown as one,
                          // never tappable. Commuters can't choose this; it's just
                          // spacing that keeps the layout visually true to the bus.
                          if (seat.state === "blank") {
                            return <View key={seat.seat_label} style={[sp.seatAislePath, { width: seatSize, height: seatSize }]} />;
                          }
                          const isCrew = seat.state === "driver" || seat.state === "conductor";
                          const isSelected = selectedSeat === seat.seat_label;
                          const seatStyle =
                            isCrew ? sp.seatCrew :
                            seat.state === "booked" ? sp.seatBooked :
                            seat.state === "blocked" ? sp.seatBlocked :
                            isSelected ? sp.seatSelected : sp.seatAvailable;
                          const canSelect = seat.state === "available";
                          return (
                            <TouchableOpacity
                              key={seat.seat_label}
                              style={[sp.seat, isCrew && sp.seatCrewWide, seatStyle, { width: isCrew ? Math.round(seatSize * 92 / 44) : seatSize, height: seatSize }]}
                              disabled={!canSelect}
                              onPress={() => canSelect && setSelectedSeat(isSelected ? null : seat.seat_label)}
                              activeOpacity={0.75}
                              accessibilityLabel={isCrew ? `${seat.state === "driver" ? "Driver" : "Conductor"} seat` : `Seat ${seat.seat_label}`}
                            >
                              <Text
                                style={[
                                  isCrew ? sp.crewTxt : sp.seatTxt,
                                  // Crew cells keep their own muted text color
                                  // (light gray bg needs dark text, not the
                                  // white used for booked/blocked/selected).
                                  (isSelected || (!canSelect && !isCrew)) && { color: "#fff" },
                                ]}
                                numberOfLines={1}
                              >
                                {isCrew ? (seat.state === "driver" ? "Driver" : "Conductor") : seat.seat_label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                </>
              )}
            </View>
          )}

          <TouchableOpacity
            style={[s.primaryBtn, draft.mode === "bus" && !selectedSeat && { opacity: 0.5 }]}
            onPress={() => setStep("passenger")}
            activeOpacity={0.85}
            disabled={draft.mode === "bus" && !selectedSeat}
          >
            <Text style={s.primaryBtnTxt}>Reserve This {draft.mode === "bus" ? "Trip" : "Seat"}</Text>
            <Ionicons name="arrow-forward" size={15} color="#fff" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ══ STEP: PASSENGER ══ */}
      {step === "passenger" && (
        <PassengerForm
          passenger={draft.passenger}
          draft={draft}
          selectedSeat={draft.mode === "bus" ? selectedSeat : null}
          commuterProfile={commuterProfile}
          walletBalance={walletBalance}
          onChange={(p) => update({ passenger: p })}
          onSubmit={handleConfirmBooking}
          submitting={submitting}
          error={submitError}
        />
      )}

      {/* ══ STEP: CONFIRM ══ */}
      {step === "confirm" && draft.selected && confirmed && (
        <BookingConfirm
          draft={draft}
          qrCode={confirmed.qrCode}
          reservationId={confirmed.id}
          newBalance={confirmed.newBalance}
          fareAmount={confirmed.fareAmount}
          discountType={confirmed.discountType}
          discountCapped={confirmed.discountCapped}
          queueNumber={confirmed.queueNumber}
          qrActiveAt={confirmed.qrActiveAt}
          seatLabel={confirmed.seatLabel}
          onNewBooking={handleNewBooking}
          onBackHome={handleBackHome}
          onViewBookings={handleViewBookings}
        />
      )}

      {/* ── Booking Details — reachable from "My Upcoming Bookings" (and
          Booking History via the same shared component); shows everything
          a commuter needs before boarding, including the exact QR the
          driver scans, and Cancel/Request Rebook actions when eligible. ── */}
      <BookingDetailsModal booking={viewBooking} onClose={() => setViewBooking(null)} />
    </View>
  );
}

// ─── RoutePickCard (route stage — reused by both Bus and UV wizards) ──────────

function RoutePickCard({ route, onSelect }: { route: Route; onSelect: () => void }) {
  const meta = VEHICLE_META[route.vehicle_type] ?? VEHICLE_META["Bus"];
  return (
    <TouchableOpacity style={rc.card} onPress={onSelect} activeOpacity={0.85}>
      <View style={[rc.colorBar, { backgroundColor: route.color || meta.color }]} />
      <View style={rc.body}>
        <View style={rc.topRow}>
          <Text style={rc.name} numberOfLines={1}>
            {route.name?.trim() || `${route.from_location} → ${route.to_location}`}
          </Text>
        </View>
        <View style={rc.routeRow}>
          <View style={[rc.dot, { backgroundColor: "#1a4a52" }]} />
          <Text style={rc.loc} numberOfLines={1}>{route.from_location}</Text>
        </View>
        <View style={rc.line} />
        <View style={rc.routeRow}>
          <View style={[rc.dot, { backgroundColor: "#a8d832" }]} />
          <Text style={rc.loc} numberOfLines={1}>{route.to_location}</Text>
        </View>
        {/* No fare shown here deliberately — a route's own flat fare (this
            card's data source) can be stale/pre-class for Bus, since the
            real per-class fare only resolves once a specific trip/vehicle
            is picked (Available Trips / Trip Details, sourced from
            get_upcoming_trips.php's fare_matrix-aware query instead). */}
        {route.owner_name && (
          <View style={rc.bottomRow}>
            <Text style={rc.plate} numberOfLines={1}>{route.owner_name}</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color="#9ca3af" style={{ alignSelf: "center", marginRight: 12 }} />
    </TouchableOpacity>
  );
}

// ─── BusTripCard (Bus wizard, stage 3) ────────────────────────────────────────

function BusTripCard({ trip, onSelect }: { trip: BusTrip; onSelect: () => void }) {
  const meta = VEHICLE_META["Bus"];
  const full = (trip.seats_left ?? 0) <= 0;
  const dep  = new Date(trip.departure_time.replace(" ", "T"));
  const timeStr = dep.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

  return (
    <TouchableOpacity
      style={[rc.card, full && rc.cardDisabled]}
      onPress={full ? undefined : onSelect}
      activeOpacity={full ? 1 : 0.85}
      disabled={full}
    >
      <View style={[rc.colorBar, { backgroundColor: trip.color || meta.color }]} />
      <View style={rc.body}>
        <View style={rc.topRow}>
          <Text style={rc.name} numberOfLines={1}>{timeStr}</Text>
          <Text style={rc.timeTxt} numberOfLines={1}>{trip.vehicle_plate} · {trip.driver_name}</Text>
        </View>
        {trip.service_type_name && (
          <View style={rc.classPill}>
            <Text style={rc.classPillText}>{trip.service_type_name}</Text>
          </View>
        )}
        <View style={rc.bottomRow}>
          <Text style={rc.fare}>₱{trip.fare} / person</Text>
          <View style={[rc.seatsPill, full && rc.seatsPillFull]}>
            <Text style={[rc.seatsTxt, full && rc.seatsTxtFull]}>
              {full ? "FULL" : `${trip.seats_left} seats left`}
            </Text>
          </View>
        </View>
      </View>
      {!full && <Ionicons name="chevron-forward" size={18} color="#9ca3af" style={{ alignSelf: "center", marginRight: 12 }} />}
    </TouchableOpacity>
  );
}

// ─── UvSlotCard (UV wizard, stage 2 — operator-scheduled book-ahead slots) ───

function UvSlotCard({ slot, onSelect }: { slot: UvSlot; onSelect: () => void }) {
  const meta = VEHICLE_META["UV Express"];
  // null seats_left = uncapped pooled slot (Core Flow 8b) — never full.
  const full = slot.seats_left !== null && slot.seats_left <= 0;
  const dep  = new Date(slot.departure_time.replace(" ", "T"));
  const timeStr = dep.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

  return (
    <TouchableOpacity
      style={[rc.card, full && rc.cardDisabled]}
      onPress={full ? undefined : onSelect}
      activeOpacity={full ? 1 : 0.85}
      disabled={full}
    >
      <View style={[rc.colorBar, { backgroundColor: slot.color || meta.color }]} />
      <View style={rc.body}>
        <View style={rc.topRow}>
          <Text style={rc.name} numberOfLines={1}>Departs {timeStr}</Text>
        </View>
        <View style={rc.routeRow}>
          <View style={[rc.dot, { backgroundColor: "#1a4a52" }]} />
          <Text style={rc.loc} numberOfLines={1}>{slot.from_location}</Text>
        </View>
        <View style={rc.line} />
        <View style={rc.routeRow}>
          <View style={[rc.dot, { backgroundColor: "#a8d832" }]} />
          <Text style={rc.loc} numberOfLines={1}>{slot.to_location}</Text>
        </View>
        <View style={rc.bottomRow}>
          <Text style={rc.fare}>₱{slot.fare} / person</Text>
          <View style={[rc.seatsPill, full && rc.seatsPillFull]}>
            <Text style={[rc.seatsTxt, full && rc.seatsTxtFull]}>
              {slot.seats_left !== null ? `${slot.seats_left}/${slot.capacity} available` : "Open"}
            </Text>
          </View>
        </View>
        <View style={rc.etdRow}>
          <Ionicons name="qr-code-outline" size={12} color="#9ca3af" />
          <Text style={rc.etdTxt}>QR unlocks 30 min before departure</Text>
        </View>
      </View>
      {!full && <Ionicons name="chevron-forward" size={18} color="#9ca3af" style={{ alignSelf: "center", marginRight: 12 }} />}
    </TouchableOpacity>
  );
}

// Spacing between a card's rows comes from `gap` on `body` alone — every
// row used to also carry its own marginTop/marginBottom on top of that
// gap, which stacked additively (e.g. gap 4 + marginTop 8 = 12px between
// some row pairs but only 4px between others) and read as uneven,
// unbalanced whitespace. One spacing mechanism, applied uniformly, fixes
// that — see the equivalent note on the `s` (detail card) stylesheet below.
const rc = StyleSheet.create({
  card:      { flexDirection: "row", backgroundColor: "#fff", borderRadius: 16, marginBottom: 10, borderWidth: 1.5, borderColor: "#f1f5f9", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2, overflow: "hidden" },
  cardDisabled: { opacity: 0.5 },
  colorBar:  { width: 5, alignSelf: "stretch" },
  body:      { flex: 1, padding: 13, gap: 6 },
  topRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name:      { fontSize: 15, fontWeight: "800", color: "#1a4a52", flex: 1, marginRight: 8 },
  timeTxt:   { fontSize: 12, fontWeight: "700", color: "#6b7280", flexShrink: 1, maxWidth: "58%", textAlign: "right" },
  routeRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  dot:       { width: 8, height: 8, borderRadius: 4 },
  loc:       { fontSize: 13, color: "#374151", fontWeight: "600", flex: 1 },
  line:      { width: 2, height: 8, backgroundColor: "#e5e7eb", marginLeft: 3 },
  // space-between (not a plain gap-only row) so fare always anchors left and
  // the seats pill always anchors right — the same alignment on every card,
  // instead of the two badges just sitting side by side at whatever width
  // their content happened to need.
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  fare:      { fontSize: 14, fontWeight: "900", color: "#1a4a52" },
  plate:     { fontSize: 12, color: "#6b7280", flex: 1 },
  seatsPill: { backgroundColor: "#f0fdf4", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  seatsPillFull: { backgroundColor: "#fef2f2" },
  seatsTxt:  { fontSize: 11, fontWeight: "700", color: "#16a34a" },
  seatsTxtFull: { color: "#ef4444" },
  etdRow:    { flexDirection: "row", alignItems: "center", gap: 5 },
  etdTxt:    { fontSize: 11, color: "#9ca3af", fontWeight: "600" },
  classPill: { alignSelf: "flex-start", backgroundColor: "#f0fdf4", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  classPillText: { fontSize: 11, fontWeight: "700", color: "#166534" },
});

// ─── Detail cards ─────────────────────────────────────────────────────────────

// Info is grouped by what a commuter scans for, in priority order: route ->
// when it departs -> what it costs & how many seats are left (the two
// numbers that actually decide whether to book) -> which vehicle/driver ->
// class. Fare and seats now share one balanced row (mirrors the browse
// card's bottomRow) instead of fare sitting oddly paired with the vehicle
// plate on one row while seats got its own separate row below.
function BusDetailCard({ trip }: { trip: BusTrip }) {
  const dep = new Date(trip.departure_time.replace(" ", "T"));
  const depStr = dep.toLocaleString("en-PH", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
  return (
    <View style={s.routeSummaryCard}>
      <View style={[s.routeColorBar, { backgroundColor: trip.color || "#2563eb" }]} />
      <View style={s.routeSummaryBody}>
        <Text style={s.routeSummaryName}>
          {trip.route_name?.trim() || `${trip.from_location} → ${trip.to_location}`}
        </Text>
        <View style={s.routeSummaryRow}>
          <View style={[s.dot2, { backgroundColor: "#1a4a52" }]} />
          <Text style={s.routeSummaryLoc}>{trip.from_location}</Text>
        </View>
        <View style={s.routeLine2} />
        <View style={s.routeSummaryRow}>
          <View style={[s.dot2, { backgroundColor: "#a8d832" }]} />
          <Text style={s.routeSummaryLoc}>{trip.to_location}</Text>
        </View>

        <View style={s.detailRow}>
          <Ionicons name="calendar-outline" size={14} color="#6b7280" />
          <Text style={s.detailTxt}>{depStr}</Text>
        </View>

        <View style={s.routeSummaryMeta}>
          <Text style={s.fareBadge}>₱{trip.fare} / person</Text>
          <Text style={s.seatsInline}>{trip.seats_left} of {trip.capacity} seats left</Text>
        </View>

        <View style={s.detailRow}>
          <Ionicons name="bus-outline" size={14} color="#6b7280" />
          <Text style={s.detailTxt}>{trip.vehicle_plate} · {trip.driver_name}</Text>
        </View>

        {trip.service_type_name && (
          <View style={s.classBadgeRow}>
            <Ionicons name="ribbon-outline" size={13} color="#166534" />
            <Text style={s.classBadgeText}>{trip.service_type_name}</Text>
          </View>
        )}
        {trip.class_details && (
          <View style={s.classDetailsBox}>
            <Text style={s.classDetailsText}>{trip.class_details}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function UvSlotDetailCard({ slot }: { slot: UvSlot }) {
  const dep = new Date(slot.departure_time.replace(" ", "T"));
  const depStr = dep.toLocaleString("en-PH", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
  return (
    <View style={s.routeSummaryCard}>
      <View style={[s.routeColorBar, { backgroundColor: slot.color || "#9333ea" }]} />
      <View style={s.routeSummaryBody}>
        <Text style={s.routeSummaryName}>
          {slot.route_name?.trim() || `${slot.from_location} → ${slot.to_location}`}
        </Text>
        <View style={s.routeSummaryRow}>
          <View style={[s.dot2, { backgroundColor: "#1a4a52" }]} />
          <Text style={s.routeSummaryLoc}>{slot.from_location}</Text>
        </View>
        <View style={s.routeLine2} />
        <View style={s.routeSummaryRow}>
          <View style={[s.dot2, { backgroundColor: "#a8d832" }]} />
          <Text style={s.routeSummaryLoc}>{slot.to_location}</Text>
        </View>

        <View style={s.detailRow}>
          <Ionicons name="calendar-outline" size={14} color="#6b7280" />
          <Text style={s.detailTxt}>{depStr}</Text>
        </View>

        <View style={s.routeSummaryMeta}>
          <Text style={s.fareBadge}>₱{slot.fare} / person</Text>
          {slot.seats_left !== null && (
            <Text style={s.seatsInline}>{slot.seats_left} of {slot.capacity} seats left</Text>
          )}
        </View>

        <View style={s.detailRow}>
          <Ionicons name="qr-code-outline" size={14} color="#6b7280" />
          <Text style={s.detailTxt}>Your boarding QR unlocks 30 min before departure</Text>
        </View>
      </View>
    </View>
  );
}

// ─── My Bookings card styles ──────────────────────────────────────────────────

const mb = StyleSheet.create({
  section:   { paddingTop: 12 },
  heading:   { fontSize: 12, fontWeight: "800", color: "#1a4a52", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 16, marginBottom: 8 },
  emptyText: { fontSize: 12, color: "#9ca3af", fontWeight: "600", paddingHorizontal: 16, paddingBottom: 4 },
  hScroll:   { paddingHorizontal: 16, gap: 10 },
  card:      { flexDirection: "row", width: 230, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1.5, borderColor: "#f1f5f9", overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  colorBar:  { width: 5, alignSelf: "stretch" },
  body:      { flex: 1, padding: 12, gap: 3 },
  badgeRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  badge:     { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  badgeTxt:  { fontSize: 10, fontWeight: "700" },
  statusTxt: { fontSize: 10, fontWeight: "700", color: "#9ca3af" },
  route:     { fontSize: 13, fontWeight: "800", color: "#1a4a52", marginBottom: 4 },
  locRow:    { flexDirection: "row", alignItems: "center", gap: 6 },
  dot:       { width: 7, height: 7, borderRadius: 4 },
  loc:       { fontSize: 11, color: "#374151", fontWeight: "600", flex: 1 },
  footer:    { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  dep:       { fontSize: 11, color: "#6b7280", flex: 1 },
  fare:      { fontSize: 13, fontWeight: "900", color: "#1a4a52" },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#f9fafb" },

  // Header
  header:      { backgroundColor: "#fff", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  headerRow:   { flexDirection: "row", alignItems: "center" },
  backBtn:     { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, borderRadius: 10, paddingHorizontal: 10, backgroundColor: "#f1f5f9", justifyContent: "center", marginRight: 12 },
  backBtnText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  headerTitle: { fontSize: 21, fontWeight: "900", color: "#1a4a52" },
  headerSub:   { fontSize: 12, color: "#6b7280", marginTop: 2 },
  dots:        { flexDirection: "row", gap: 6, marginTop: 10 },
  dot:         { width: 20, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb" },
  dotActive:   { backgroundColor: "#1a4a52" },
  dotDone:     { backgroundColor: "#a8d832" },

  // Mode toggle
  modeToggle:  { flexDirection: "row", marginHorizontal: 16, marginTop: 12, backgroundColor: "#f1f5f9", borderRadius: 12, padding: 4, gap: 4 },
  modeBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 9 },
  modeBtnActive: { backgroundColor: "#1a4a52" },
  modeTxt:     { fontSize: 13, fontWeight: "700", color: "#6b7280" },
  modeTxtActive: { color: "#fff" },

  // Browse
  searchBar:   { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 12, marginBottom: 4, backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1.5, borderColor: "#e5e7eb" },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },

  // Loading / empty
  centred:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 60 },
  loadingTxt:  { fontSize: 14, color: "#9ca3af", fontWeight: "600", marginTop: 8 },
  emptyTitle:  { fontSize: 16, fontWeight: "800", color: "#9ca3af", textAlign: "center", paddingHorizontal: 24 },
  emptyBody:   { fontSize: 13, color: "#d1d5db", textAlign: "center", paddingHorizontal: 24 },
  sectionEmpty:   { fontSize: 13, color: "#9ca3af", marginBottom: 12 },

  // Bus stage 2: date picker
  card:        { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1.5, borderColor: "#f1f5f9", shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  cardLabel:   { fontSize: 10, fontWeight: "700", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  dateRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  adjBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  dateCenter:  { alignItems: "center" },
  dateVal:     { fontSize: 16, fontWeight: "800", color: "#1a4a52" },
  dateSub:     { fontSize: 11, color: "#9ca3af", fontWeight: "600" },
  wizardHint:  { fontSize: 12, color: "#9ca3af", marginBottom: 16, lineHeight: 18, paddingHorizontal: 4 },
  fieldLabel:  { fontSize: 11, fontWeight: "700", color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  errBox:      { backgroundColor: "#fef2f2", borderRadius: 10, padding: 10 },
  errText:     { fontSize: 12, color: "#ef4444" },

  // UV book-ahead time stepper
  uvTimeRow:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  uvTimeUnit:  { alignItems: "center", gap: 4, backgroundColor: "#f1f5f9", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  uvTimeVal:   { fontSize: 20, fontWeight: "900", color: "#1a4a52" },
  uvTimeSep:   { fontSize: 20, fontWeight: "900", color: "#1a4a52" },

  // Detail — spacing between rows comes from routeSummaryBody's own `gap`
  // alone now (previously every row also carried its own marginTop on top
  // of that gap, stacking additively into uneven whitespace between
  // different row pairs — same fix as the `rc` browse-card styles above).
  detailScroll:       { padding: 16, paddingBottom: 48 },
  routeSummaryCard:   { flexDirection: "row", backgroundColor: "#fff", borderRadius: 16, marginBottom: 14, overflow: "hidden", borderWidth: 1.5, borderColor: "#f1f5f9", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  routeColorBar:      { width: 6, alignSelf: "stretch" },
  routeSummaryBody:   { flex: 1, padding: 15, gap: 9 },
  routeSummaryName:   { fontSize: 16, fontWeight: "900", color: "#1a4a52" },
  routeSummaryRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  routeSummaryLoc:    { fontSize: 13, fontWeight: "600", color: "#374151", flex: 1 },
  dot2:               { width: 9, height: 9, borderRadius: 5 },
  routeLine2:         { width: 2, height: 10, backgroundColor: "#e5e7eb", marginLeft: 3 },
  // Fare (left) + seats-left (right) share one row, mirroring the browse
  // card's bottomRow — the two numbers a commuter actually decides on.
  routeSummaryMeta:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", backgroundColor: "#f8fafc", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  fareBadge:          { fontSize: 15, fontWeight: "900", color: "#1a4a52" },
  seatsInline:        { fontSize: 12, fontWeight: "700", color: "#374151" },
  detailRow:          { flexDirection: "row", alignItems: "center", gap: 8 },
  detailTxt:          { fontSize: 13, color: "#374151", fontWeight: "600" },
  classBadgeRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  classBadgeText:     { fontSize: 12, fontWeight: "800", color: "#166534" },
  classDetailsBox:    { backgroundColor: "#f0fdf4", borderRadius: 10, borderWidth: 1, borderColor: "#bbf7d0", padding: 10 },
  classDetailsText:   { fontSize: 12, color: "#3f6212", lineHeight: 17 },

  // Primary button
  primaryBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 14 },
  primaryBtnTxt:{ fontSize: 15, fontWeight: "800", color: "#fff" },
});

// ─── Seat picker ────────────────────────────────────────────────────────────────

// 5-color seat scheme, consistent across the app: Green=Available,
// Red=Booked, Blue=Selected, Yellow=Reserved/Saved (operator-blocked),
// Gray=Driver/Conductor.
const sp = StyleSheet.create({
  legendRow:  { flexDirection: "row", flexWrap: "wrap", gap: 14, marginBottom: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendTxt:  { fontSize: 11, color: "#6b7280", fontWeight: "600" },
  seatSwatch: { width: 14, height: 14, borderRadius: 4 },
  gridRow:    { flexDirection: "row", gap: 10, marginBottom: 10 },
  seat:       { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#e5e7eb" },
  seatAvailable: { backgroundColor: "#dcfce7", borderColor: "#16a34a" },
  seatSelected:  { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  seatBooked:    { backgroundColor: "#fecaca", borderColor: "#dc2626" },
  seatBlocked:   { backgroundColor: "#fef9c3", borderColor: "#eab308" },
  seatCrew:      { backgroundColor: "#e5e7eb", borderColor: "#6b7280" },
  seatTxt:    { fontSize: 12, fontWeight: "800", color: "#1a4a52" },
  seatAislePath: { width: 44, height: 44 },
  // Driver/Conductor cells widen (height stays equal to a regular seat) so
  // the label fits on one centered line instead of wrapping mid-word.
  seatCrewWide: { width: 92 },
  crewTxt:      { fontSize: 11, fontWeight: "500", color: "#4b5563", textAlign: "center" },
});
