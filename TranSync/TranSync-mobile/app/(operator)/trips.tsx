import { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, FlatList, useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import type { BusTrip, UvSlot } from "../../src/types/booking";
import { BOARDING_STATUS_LABEL } from "../../src/types/booking";
import {
  fetchOperatorTrips, fetchPendingTrips, assignTrip, reassignTrip, updateTripStatus, fetchTripBookings,
  fetchOperatorSlots, updateSlotStatus, fetchSlotBookings,
  reviewRebookRequest, fetchRebookRequests,
  type TripBooking, type RebookRequestSummary,
} from "../../src/services/bookingService";
import { formatTime12h } from "../../src/utils/time";
import { groupApprovedByAssociation, resolveActiveAssociation, type AssocApplication } from "../../src/utils/activeAssociation";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

// Local-calendar-date formatting, never via toISOString() — toISOString()
// converts to UTC, which silently shifts the date backward by a day in any
// timezone ahead of UTC (e.g. Philippines, UTC+8: local midnight becomes
// 16:00 the *previous* UTC day). That bug previously made addDays(date, 1)
// return the SAME date it was given (the +1 day got cancelled out by the
// -1 day UTC shift), which is exactly why the "next" date button looked
// like it did nothing — the date state was being set to its own current
// value. Formatting from the Date object's own local getters avoids the
// UTC round-trip entirely.
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const TODAY = formatLocalDate(new Date());
// Mirrors config/policy.php's BUS_TRIP_GENERATION_WINDOW_DAYS — used only to
// cap how far forward the Pending Assignment date picker lets an operator
// navigate, since nothing is ever generated past that horizon anyway.
const PENDING_WINDOW_DAYS = 60;
function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return formatLocalDate(d);
}
// Every date the Pending Assignment horizontal strip can jump straight to —
// computed once, matches the server's own generation horizon exactly.
const PENDING_DATE_OPTIONS = Array.from({ length: PENDING_WINDOW_DAYS }, (_, i) => addDays(TODAY, i));

type OpRoute = {
  id: number; from_location: string; to_location: string;
  fare: number | null; vehicle_type: string | null; status: string; color: string;
};

type OpVehicle = {
  id: number; type: string; plate_number: string; seat_config: string | null;
  status: string; driver_id: number | null; driver_name: string | null;
  service_type_id: number | null; capacity: number | null;
  association_id: number | null;
};

type AssocSchedule = {
  id: number; route_id: number; route_name: string | null;
  from_location: string; to_location: string;
  service_type_id: number; service_type_name: string;
  boarding_time: string; departure_time: string;
  recurrence_type: "daily" | "weekly";
  weekdays: number[] | null;
  status: "active" | "inactive";
};

// Class name/description are association-owned; `details` is the operator's
// own overlay (operator_class_details) — see operators/set_class_details.php.
type ServiceTypeInfo = { id: number; name: string; description: string; details: string | null };

// One `dispatch_queue` "dispatched" row per (operator, route) is already the
// active vehicle for that route (route-scoped FIFO) — this just surfaces it
// plus the waiting line, and lets the operator manually advance it.
type UvQueueStatus = {
  dispatched: { driver_id: number; driver_name: string; plate_number: string | null } | null;
  waiting: { driver_id: number; driver_name: string; plate_number: string | null }[];
};

// Association-published UV Express schedule (Core Flow 8b) merged with this
// operator's own activate/deactivate status for it — replaces the old
// operator-manual "Schedule UV Slot" flow. Activating makes it bookable by
// commuters for this operator's fleet; no vehicle/driver is committed (UV
// stays queue-based).
type UvScheduleRow = {
  id: number; route_id: number; route_name: string | null;
  from_location: string; to_location: string;
  start_time: string; end_time: string;
  recurrence_type: "daily" | "weekly"; weekdays: number[] | null;
  schedule_status: "active" | "inactive";
  activation_status: "active" | "inactive" | null;
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "Ready/Open for Booking" (the user-facing name for this workflow's second
// stage) is displayed as the label here, but the underlying value is still
// literally 'scheduled' — unchanged from before this redesign, so nothing
// else that reads trip.status needs to change.
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_assignment: { label: "Pending Assignment", color: "#b45309", bg: "#fffbeb" },
  scheduled: { label: "Ready/Open", color: "#2563eb", bg: "#eff6ff" },
  boarding:  { label: "Boarding",  color: "#d97706", bg: "#fffbeb" },
  departed:  { label: "Departed",  color: "#059669", bg: "#ecfdf5" },
  completed: { label: "Completed", color: "#6b7280", bg: "#f9fafb" },
  cancelled: { label: "Cancelled", color: "#ef4444", bg: "#fef2f2" },
};

// Bus trip list status filter — each key maps to exactly one real trip
// status now (previously "boarding" absorbed "departed" too; split apart so
// every tab shows only trips of that specific status, never overlapping
// with another tab, and a trip moves tabs automatically the instant its
// status changes since every tab just re-filters the same fetched list).
type BusStatusFilter = "all" | "pending" | "scheduled" | "boarding" | "departed" | "completed" | "cancelled";
const BUS_STATUS_FILTERS: { key: BusStatusFilter; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "pending",   label: "Pending Assignment" },
  { key: "scheduled", label: "Ready/Open" },
  { key: "boarding",  label: "Boarding" },
  { key: "departed",  label: "Departed" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];
function matchesBusStatusFilter(trip: BusTrip, filter: BusStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return trip.status === "pending_assignment";
  return trip.status === filter;
}

// Status order used both for sorting within a date group (non-"all" tabs)
// and as the section order for the "All" tab's dashboard grouping.
const STATUS_ORDER: Record<string, number> = {
  pending_assignment: 0, scheduled: 1, boarding: 2, departed: 3, completed: 4, cancelled: 5,
};
// "All" tab never includes pending_assignment trips as individual cards
// (those stay date-scoped under the Pending Assignment tab — see the
// dashboard summary banner instead) — only the five post-generation statuses.
const ALL_TAB_STATUS_SECTIONS: BusTrip["status"][] = ["scheduled", "boarding", "departed", "completed", "cancelled"];

// Groups already-chronologically-sorted trips by calendar date (soonest
// date first, matching the server's own ORDER BY departure_time ASC), then
// orders each date's own trips by STATUS_ORDER — "grouped by date, sorted
// chronologically, organized by status, upcoming first." Used by every
// single-status tab (a trivial single-status sort, since every trip in the
// list already shares one status) — NOT used by "All" anymore, which groups
// the other way around (see groupTripsByStatus below).
function groupTripsByDate(trips: BusTrip[]): { date: string; trips: BusTrip[] }[] {
  const byDate = new Map<string, BusTrip[]>();
  for (const t of trips) {
    const date = t.departure_time.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(t);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayTrips]) => ({
      date,
      trips: [...dayTrips].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)),
    }));
}

// "All" tab dashboard grouping — primary axis is status (Ready/Open →
// Boarding → Departed → Completed → Cancelled), each section's own trips
// sorted chronologically by departure time. Empty sections are omitted.
// Pending Assignment is deliberately excluded here (see the dashboard
// summary banner in the render instead) — including it would mean loading
// every pending trip across the whole generation window again, exactly the
// scale problem the date-scoped Pending Assignment tab was built to avoid.
function groupTripsByStatus(trips: BusTrip[]): { status: string; label: string; trips: BusTrip[] }[] {
  return ALL_TAB_STATUS_SECTIONS
    .map((status) => ({
      status,
      label: STATUS_META[status].label,
      trips: trips.filter((t) => t.status === status).sort((a, b) => a.departure_time.localeCompare(b.departure_time)),
    }))
    .filter((g) => g.trips.length > 0);
}

export default function TripsScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [user,      setUser]      = useState<any>(null);
  const [trips,     setTrips]     = useState<BusTrip[]>([]);
  const [uvSlots,   setUvSlots]   = useState<UvSlot[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState("");

  // The page always shows a fixed Bus / UV Express tab bar (Jeepney has no
  // scheduled-trip concept — it uses the live dispatch queue instead, see
  // below). approvedTypes gates which tab's content is unlocked, independent
  // of which tab is currently selected — an operator can tap into a tab they
  // aren't approved for yet and see a locked state rather than the tab
  // being hidden.
  const [approvedTypes, setApprovedTypes] = useState<("Jeepney" | "UV Express" | "Bus")[]>([]);
  const [approvalReady, setApprovalReady] = useState(false);
  const [activeTab,     setActiveTab]     = useState<"Bus" | "UV Express">("Bus");
  // The active association's own id — an operator can hold Bus (or UV
  // Express) approved at several associations at once, so every lookup that
  // used to derive "the operator's Bus/UV association" on its own must
  // instead use this specific id.
  const [activeAssociationId, setActiveAssociationId] = useState<number | null>(null);

  const isUvOp        = activeTab === "UV Express";
  const hasBusOrUv    = approvedTypes.includes("Bus") || approvedTypes.includes("UV Express");
  const isBusApproved = approvedTypes.includes("Bus");
  const isUvApproved  = approvedTypes.includes("UV Express");

  // Assign Trip modal (Bus only — UV Express activates an association
  // schedule instead, see Core Flow 8b). Replaces the old "Add Trip" flow:
  // the trip already exists (auto-generated, pending_assignment) — this just
  // scopes the picker to ONE already-generated trip's own route/class/date,
  // so there's no schedule picker and no next-occurrence preview to compute.
  const [assignTarget,  setAssignTarget]  = useState<BusTrip | null>(null);
  // Reassign is the same modal in a different mode — an already-'scheduled'
  // trip's vehicle/driver/conductor can be swapped (e.g. vehicle breaks
  // down) without creating a duplicate pending assignment. departure_time
  // is never editable here either way (Do Not Break rule #58).
  const [reassignMode,  setReassignMode]  = useState(false);
  const [vehicles,      setVehicles]      = useState<OpVehicle[]>([]);
  const [loadingPick,   setLoadingPick]   = useState(false);
  const [selectedVeh,   setSelectedVeh]   = useState<number | null>(null);
  // Driver is derived from the vehicle's own assignment (set in the Vehicles
  // tab, see vehicles.php PUT action=assign) — not picked separately here.
  const [conductorName,  setConductorName]  = useState("");
  const [conductorPhone, setConductorPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError,  setFormError]  = useState("");

  // Operator's own details/amenities overlay per Bus class (see Core Flow 13)
  // — reachable for every class the operator is approved for, independent of
  // whether a schedule exists for that class yet (a class can exist with no
  // published schedule, e.g. a newly added association class).
  const [classInfoList,     setClassInfoList]     = useState<ServiceTypeInfo[]>([]);
  const [classDetailsTarget,setClassDetailsTarget] = useState<ServiceTypeInfo | null>(null);
  const [showClassDetails,  setShowClassDetails]  = useState(false);
  const [classDetailsDraft, setClassDetailsDraft] = useState("");
  const [savingClassDetails,setSavingClassDetails] = useState(false);

  // Operator-facing Bus trip lifecycle controls (mirrors the driver dashboard's
  // Start Boarding/Depart buttons; "Mark Arrived" reuses the existing
  // `complete` transition, which already resolves stragglers via the 30-min
  // grace sweep and frees the vehicle/driver — see Do Not Break rule #17)
  const [tripActionBusy, setTripActionBusy] = useState<number | null>(null);

  // Bus trip list status filter — client-side only for every status except
  // "pending" (trips are already loaded in full via loadSchedule for those,
  // updates the visible list immediately on tap). "pending" is date-scoped
  // and fetched separately — see pendingDate/pendingTrips below — since a
  // schedule's rolling 30-day window across every schedule could mean
  // dozens of still-unassigned trips, too many to usefully show at once.
  const [busStatusFilter, setBusStatusFilter] = useState<BusStatusFilter>("all");
  const [pendingDate,    setPendingDate]    = useState(TODAY);
  const [pendingTrips,   setPendingTrips]   = useState<BusTrip[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);

  // UV Express: operator-facing "advance to next vehicle" layered on the
  // existing route-scoped dispatch_queue (does not replace driver self-service)
  const [uvRoutes,       setUvRoutes]       = useState<OpRoute[]>([]);
  const [queueStatuses,  setQueueStatuses]  = useState<Record<number, UvQueueStatus>>({});
  const [advancingRoute, setAdvancingRoute] = useState<number | null>(null);

  // UV Express: association-published schedules (route + operating hours +
  // recurrence) merged with this operator's own activate/deactivate status
  // for each — replaces the old operator-manual slot creation (Core Flow 8b).
  const [uvSchedules,     setUvSchedules]     = useState<UvScheduleRow[]>([]);
  const [togglingSchedule,setTogglingSchedule]= useState<number | null>(null);

  // manifest modal (shared shape for both Bus trips and UV slots)
  const [showManifest,   setShowManifest]   = useState<{ label: string; routeId: number; currentId: number; kind: "bus" | "uv" } | null>(null);
  const [manifest,        setManifest]       = useState<TripBooking[]>([]);
  const [loadingManifest, setLoadingManifest] = useState(false);

  // Cross-trip "Rebooking Requests" — every pending rebook request across
  // this operator's own fleet, independent of which trip's manifest happens
  // to be open. Fetched alongside the rest of the schedule on focus and
  // refreshed after Accept/Reject.
  const [rebookRequests,     setRebookRequests]     = useState<RebookRequestSummary[]>([]);
  const [showRebookRequests, setShowRebookRequests] = useState(false);
  const [acceptingRequestId, setAcceptingRequestId]  = useState<number | null>(null);

  // The operator's role is now approve/reject only — the commuter picks
  // their own new trip/seat themselves once approved (complete_rebook.php,
  // reached from their own Booking Details screen). No trip/seat-picker
  // state needed here anymore.
  const [rebookBusy,   setRebookBusy]   = useState(false);
  const [rejectTarget, setRejectTarget] = useState<number | null>(null); // reservation_id
  const [rejectReason, setRejectReason] = useState("");

  // cancel/close confirm
  const [showCancel, setShowCancel] = useState<{ kind: "bus" | "uv"; id: number } | null>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) return;
      const u = JSON.parse(raw);
      setUser(u);
      refreshRebookRequests(u.id);

      // Scoped to the operator's currently *active* association (Profile →
      // My Associations → Switch) — for an operator with only one
      // association this is identical to every approved type, so nothing
      // changes for them.
      const statusRes = await fetch(`${API_BASE}/operators/association_status.php?operator_id=${u.id}`).then(r => r.json()).catch(() => null);
      const apps: AssocApplication[] = statusRes?.success ? (statusRes.applications ?? []) : [];
      const groups = groupApprovedByAssociation(apps);
      const activeAssoc = await resolveActiveAssociation(groups);
      const approved: ("Jeepney" | "UV Express" | "Bus")[] = activeAssoc?.vehicle_types ?? [];
      setApprovedTypes(approved);
      setActiveAssociationId(activeAssoc?.association_id ?? null);
      setApprovalReady(true);

      const busOrUv = approved.includes("Bus") || approved.includes("UV Express");
      if (!busOrUv) { setLoading(false); return; }
      const k: "Bus" | "UV Express" = approved.includes("Bus") ? "Bus" : "UV Express";
      setActiveTab(k);
      loadSchedule(u.id, k === "UV Express", activeAssoc?.association_id ?? null);
    })();
  }, []));

  // associationId defaults to the component's current activeAssociationId
  // state — only the very first call (inside the useFocusEffect above) needs
  // to pass it explicitly, since that call happens before the freshly
  // resolved association has made it into state yet.
  const loadSchedule = async (operatorId: number, uv: boolean, associationId: number | null = activeAssociationId) => {
    setLoading(true);
    if (uv) {
      setUvSlots(await fetchOperatorSlots(operatorId));
      await loadUvQueue(operatorId);
      await loadUvSchedules(operatorId, associationId);
    } else {
      setTrips(await fetchOperatorTrips(operatorId));
      // "Your Classes" amenities editor — independent of any specific trip/
      // schedule (a class can exist with no schedule published for it yet,
      // see Do Not Break rule #47), so it loads alongside the trip list
      // itself rather than inside the (now per-trip) Assign Trip modal.
      const classInfoRes = await fetch(`${API_BASE}/operators/get_association_service_types.php?operator_id=${operatorId}&association_id=${associationId ?? ""}`)
        .then(r => r.json()).catch(() => null);
      setClassInfoList(classInfoRes?.success ? classInfoRes.service_types : []);
    }
    setLoading(false);
  };

  const refreshRebookRequests = async (operatorId: number) => {
    setRebookRequests(await fetchRebookRequests(operatorId));
  };

  // ── Pending Assignment — date-scoped, fetched independently of loadSchedule
  // above (see the state comment near pendingDate) ────────────────────────
  const loadPendingTrips = async (operatorId: number, date: string) => {
    setPendingLoading(true);
    setPendingTrips(await fetchPendingTrips(operatorId, date));
    setPendingLoading(false);
  };

  useEffect(() => {
    if (!user || activeTab !== "Bus") return;
    if (busStatusFilter === "pending") {
      loadPendingTrips(user.id, pendingDate);
    } else if (busStatusFilter === "all") {
      // The "All" dashboard's Pending Assignment summary banner always
      // reflects TODAY specifically (the actionable, immediate number),
      // independent of whatever date the Pending Assignment tab itself has
      // navigated to — switching tabs must never bulk-load the whole window.
      loadPendingTrips(user.id, TODAY);
    }
  }, [user, activeTab, busStatusFilter, pendingDate]);

  function adjustPendingDate(delta: number) {
    const next = addDays(pendingDate, delta);
    if (next < TODAY) return; // operators only ever manage today's and future trips
    if (next > addDays(TODAY, PENDING_WINDOW_DAYS - 1)) return; // nothing generated past the window
    setPendingDate(next);
  }

  // ── UV Express: association-published schedules + this operator's own
  // activate/deactivate status for each (Core Flow 8b) — scoped to the
  // active association, since an operator can be UV-approved at several
  // associations at once now. ─────────────────────────────────────────────
  const loadUvSchedules = async (operatorId: number, associationId: number | null) => {
    const qs = associationId ? `&association_id=${associationId}` : "";
    const res = await fetch(`${API_BASE}/operators/uv_schedule_activation.php?operator_id=${operatorId}${qs}`)
      .then(r => r.json()).catch(() => null);
    setUvSchedules(Array.isArray(res?.schedules) ? res.schedules : []);
  };

  const handleToggleUvSchedule = async (schedule: UvScheduleRow) => {
    if (!user) return;
    const next = schedule.activation_status === "active" ? "inactive" : "active";
    setTogglingSchedule(schedule.id);
    try {
      const res = await fetch(`${API_BASE}/operators/uv_schedule_activation.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: user.id, uv_operating_hours_id: schedule.id, status: next }),
      }).then(r => r.json());
      if (res.success) {
        setUvSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, activation_status: next } : s));
        showToast(next === "active" ? "Schedule activated — bookable by commuters." : "Schedule deactivated.");
      } else {
        showToast(res.message ?? "Failed to update schedule.");
      }
    } catch {
      showToast("Cannot connect to server.");
    } finally {
      setTogglingSchedule(null);
    }
  };

  // ── UV Express: route queue status + operator-triggered advance ────────────
  const loadUvQueue = async (operatorId: number) => {
    // Routes are association-owned now — get_routes.php returns the ones
    // actually in use by this operator's own fleet (assigned to one of their
    // drivers), not a plain operator-ownership query (see routes/get_routes.php).
    const routesRes = await fetch(`${API_BASE}/routes/get_routes.php?operator_id=${operatorId}`).then(r => r.json()).catch(() => null);
    const active: OpRoute[] = Array.isArray(routesRes?.routes)
      ? routesRes.routes.filter((r: OpRoute) => r.vehicle_type === "UV Express" && r.status === "active")
      : [];
    setUvRoutes(active);
    const statuses: Record<number, UvQueueStatus> = {};
    await Promise.all(active.map(async (r) => {
      const res = await fetch(`${API_BASE}/operators/get_uv_queue_status.php?operator_id=${operatorId}&route_id=${r.id}`)
        .then(res2 => res2.json()).catch(() => null);
      if (res?.success) statuses[r.id] = { dispatched: res.dispatched, waiting: res.waiting };
    }));
    setQueueStatuses(statuses);
  };

  const handleAdvanceQueue = async (routeId: number) => {
    if (!user) return;
    setAdvancingRoute(routeId);
    try {
      const res = await fetch(`${API_BASE}/operators/advance_uv_queue.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: user.id, route_id: routeId }),
      }).then(r => r.json());
      if (res.success) {
        await loadUvQueue(user.id);
        showToast("Queue advanced.");
      } else {
        showToast(res.message ?? "Failed to advance queue.");
      }
    } catch {
      showToast("Cannot connect to server.");
    } finally {
      setAdvancingRoute(null);
    }
  };

  // ── Bus: operator-facing lifecycle controls ─────────────────────────────────
  const handleTripAction = async (tripId: number, action: "start_boarding" | "depart" | "complete") => {
    if (!user) return;
    setTripActionBusy(tripId);
    try {
      const result = await updateTripStatus(tripId, action, { operatorId: user.id });
      if (result.success) {
        loadSchedule(user.id, false);
        showToast(
          action === "start_boarding" ? "Boarding started." :
          action === "depart" ? "Trip departed." : "Trip marked arrived."
        );
      } else {
        showToast(result.message ?? "Failed to update trip.");
      }
    } finally {
      setTripActionBusy(null);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // ── Assign Trip modal bootstrap — the trip already exists (auto-generated,
  // status='pending_assignment'); this just loads candidate vehicles for
  // ITS OWN class + association (not necessarily the currently-active one,
  // since an operator can be Bus-approved at several associations at once —
  // see trip.association_id, derived server-side from the trip's own
  // schedule). No schedule picker, no next-occurrence preview: the date is
  // already fixed by which trip card the operator tapped. ──────────────────
  const openAssign = async (trip: BusTrip, reassign = false) => {
    setAssignTarget(trip);
    setReassignMode(reassign);
    setConductorName(reassign ? (trip.conductor_name ?? "") : "");
    setConductorPhone(reassign ? (trip.conductor_phone ?? "") : "");
    setFormError("");
    setLoadingPick(true);
    try {
      const vehiclesRes = await fetch(`${API_BASE}/vehicles/vehicles.php?operator_id=${user.id}`).then(r => r.json());
      // A vehicle needs a built seat layout (capacity set), an already-
      // assigned driver (Vehicles tab), the trip's own class, and the trip's
      // own association — never assumed to be whichever is "active" right now.
      const candidates: OpVehicle[] = Array.isArray(vehiclesRes)
        ? vehiclesRes.filter((v: OpVehicle) =>
            v.type === "Bus" && v.status === "active" && v.capacity && v.driver_id &&
            v.service_type_id === trip.service_type_id &&
            v.association_id === trip.association_id)
        : [];
      setVehicles(candidates);
      // Reassign pre-selects the trip's own currently-assigned vehicle (BusTrip
      // only carries vehicle_plate, not a raw vehicle_id, so match on plate —
      // unique within one operator's fleet) so the operator sees the current
      // pick and can leave it as-is to only change the conductor, say.
      setSelectedVeh(reassign ? (candidates.find(v => v.plate_number === trip.vehicle_plate)?.id ?? null) : null);
    } catch {
      setVehicles([]);
      setSelectedVeh(null);
    } finally {
      setLoadingPick(false);
    }
  };

  const selectVehicleForAssign = (vehId: number) => {
    setSelectedVeh(prev => (prev === vehId ? null : vehId));
    setFormError("");
  };

  const openClassDetailsEditor = (classInfo: ServiceTypeInfo) => {
    setClassDetailsTarget(classInfo);
    setClassDetailsDraft(classInfo.details ?? "");
    setShowClassDetails(true);
  };

  const handleSaveClassDetails = async () => {
    if (!classDetailsTarget || !user) return;
    setSavingClassDetails(true);
    try {
      const res = await fetch(`${API_BASE}/operators/set_class_details.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: user.id, service_type_id: classDetailsTarget.id, details: classDetailsDraft }),
      }).then(r => r.json());
      if (res.success) {
        setClassInfoList(prev => prev.map(st => st.id === classDetailsTarget.id ? { ...st, details: classDetailsDraft } : st));
        setShowClassDetails(false);
        showToast("Class details saved.");
      } else {
        showToast(res.message ?? "Failed to save details.");
      }
    } catch {
      showToast("Cannot connect to server.");
    } finally {
      setSavingClassDetails(false);
    }
  };

  const closeAssignModal = () => {
    setAssignTarget(null);
    setReassignMode(false);
  };

  const handleAssignTrip = async () => {
    setFormError("");

    if (!assignTarget) return;
    if (!selectedVeh) { setFormError("Please select a vehicle matching this trip's class."); return; }
    const vehicle = vehicles.find(v => v.id === selectedVeh);
    if (!vehicle?.driver_id) { setFormError("Selected vehicle has no driver assigned."); return; }
    setSubmitting(true);
    try {
      const payload = {
        operator_id: user.id,
        trip_id:     assignTarget.id,
        vehicle_id:  selectedVeh,
        driver_id:   vehicle.driver_id,
        conductor_name:  conductorName.trim()  || undefined,
        conductor_phone: conductorPhone.trim() || undefined,
      };
      const result = reassignMode ? await reassignTrip(payload) : await assignTrip(payload);
      if (result.success) {
        closeAssignModal();
        loadSchedule(user.id, false);
        if (busStatusFilter === "pending") loadPendingTrips(user.id, pendingDate);
        else if (busStatusFilter === "all") loadPendingTrips(user.id, TODAY);
        showToast(reassignMode ? "Trip reassigned." : "Trip assigned — now Ready/Open for Booking.");
      } else {
        setFormError(result.message ?? (reassignMode ? "Failed to reassign trip." : "Failed to assign trip."));
      }
    } catch {
      setFormError("Cannot connect to server.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Manifest ─────────────────────────────────────────────────────────────────
  const openBusManifest = async (trip: BusTrip) => {
    setShowManifest({ label: `${trip.from_location} → ${trip.to_location}`, routeId: trip.route_id, currentId: trip.id, kind: "bus" });
    setLoadingManifest(true);
    setManifest(await fetchTripBookings(trip.id));
    setLoadingManifest(false);
  };

  const openSlotManifest = async (slot: UvSlot) => {
    setShowManifest({ label: `${slot.from_location} → ${slot.to_location}`, routeId: slot.route_id, currentId: slot.id, kind: "uv" });
    setLoadingManifest(true);
    setManifest(await fetchSlotBookings(slot.id));
    setLoadingManifest(false);
  };

  // ── Operator's role is approve/reject only — no trip/seat picking here
  // anymore. Approving just grants permission; the commuter picks their own
  // new trip/seat from their own Booking Details screen (complete_rebook.php).
  const handleApproveRebook = async (reservationId: number) => {
    if (!user || rebookBusy) return;
    setRebookBusy(true);
    try {
      const result = await reviewRebookRequest(user.id, reservationId, "approve");
      if (!result.success) {
        showToast(result.message ?? "Failed to approve the rebooking request.");
        return;
      }
      showToast("Rebooking approved — the commuter can now pick a new trip.");
      if (showManifest) {
        setManifest(showManifest.kind === "bus"
          ? await fetchTripBookings(showManifest.currentId)
          : await fetchSlotBookings(showManifest.currentId));
      }
      refreshRebookRequests(user.id);
    } finally {
      setRebookBusy(false);
    }
  };

  const openRejectRebook = (reservationId: number) => {
    setRejectReason("");
    setRejectTarget(reservationId);
  };

  const confirmRejectRebook = async () => {
    if (!user || rejectTarget == null || rebookBusy) return;
    if (rejectReason.trim() === "") return;
    setRebookBusy(true);
    try {
      const result = await reviewRebookRequest(user.id, rejectTarget, "reject", rejectReason.trim());
      if (!result.success) {
        showToast(result.message ?? "Failed to reject the rebooking request.");
        return;
      }
      showToast("Rebooking request declined.");
      setRejectTarget(null);
      if (showManifest) {
        setManifest(showManifest.kind === "bus"
          ? await fetchTripBookings(showManifest.currentId)
          : await fetchSlotBookings(showManifest.currentId));
      }
      refreshRebookRequests(user.id);
    } finally {
      setRebookBusy(false);
    }
  };

  // ── Rebooking Requests (cross-trip, "Operator Dashboard -> Trips" section) ──
  const handleAcceptRebookRequest = async (req: RebookRequestSummary) => {
    if (!user) return;
    setAcceptingRequestId(req.reservation_id);
    try {
      const result = await reviewRebookRequest(user.id, req.reservation_id, "approve");
      if (!result.success) {
        showToast(result.message ?? "Failed to approve the rebooking request.");
        return;
      }
      showToast("Rebooking approved — the commuter can now pick a new trip.");
      setRebookRequests((prev) => prev.filter((r) => r.reservation_id !== req.reservation_id));
    } finally {
      setAcceptingRequestId(null);
    }
  };

  const handleRejectRebookRequest = (req: RebookRequestSummary) => {
    setShowRebookRequests(false);
    openRejectRebook(req.reservation_id);
  };

  // ── Cancel / close ───────────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!showCancel || !user) return;
    const wasBus = showCancel.kind === "bus";
    const result = showCancel.kind === "uv"
      ? await updateSlotStatus(showCancel.id, "cancel", user.id)
      : await updateTripStatus(showCancel.id, "cancel", { operatorId: user.id });
    setShowCancel(null);
    if (result.success) {
      loadSchedule(user.id, showCancel.kind === "uv");
      // A Bus trip cancelled before boarding returns to Pending Assignment
      // rather than a terminal state (see bus_trips/update_trip_status.php) —
      // refresh whichever pending view is currently showing so it reappears
      // immediately without a manual refresh.
      if (wasBus && result.status === "pending_assignment") {
        if (busStatusFilter === "pending") loadPendingTrips(user.id, pendingDate);
        else if (busStatusFilter === "all") loadPendingTrips(user.id, TODAY);
        showToast("Trip cancelled — returned to Pending Assignment for reassignment.");
      } else {
        showToast(showCancel.kind === "uv" ? "Slot cancelled." : "Trip cancelled.");
      }
    } else {
      showToast(result.message ?? "Failed to cancel.");
    }
  };

  const scheduleCount = isUvOp ? uvSlots.length : trips.length;

  const busStatusCounts: Record<BusStatusFilter, number> = {
    all:       trips.length,
    // Date-scoped now (see pendingTrips) — this count reflects whichever
    // date is currently selected, not a fixed running total like the others.
    pending:   pendingTrips.length,
    scheduled: trips.filter(t => matchesBusStatusFilter(t, "scheduled")).length,
    boarding:  trips.filter(t => matchesBusStatusFilter(t, "boarding")).length,
    departed:  trips.filter(t => matchesBusStatusFilter(t, "departed")).length,
    completed: trips.filter(t => matchesBusStatusFilter(t, "completed")).length,
    cancelled: trips.filter(t => matchesBusStatusFilter(t, "cancelled")).length,
  };
  const filteredTrips = trips.filter(t => matchesBusStatusFilter(t, busStatusFilter));
  const groupedTrips = groupTripsByDate(filteredTrips);
  const statusSections = groupTripsByStatus(trips);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {toast !== "" && (
        <View style={[styles.toast, { top: insets.top + 56 }]}>
          <Ionicons name="checkmark-circle" size={14} color="#a8d832" />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* ── ASSIGN TRIP MODAL — scoped to one already-generated trip; no
          schedule picker, no date preview (both already fixed by which
          trip card the operator tapped) ── */}
      <Modal visible={!!assignTarget} transparent animationType="slide" onRequestClose={closeAssignModal}>
        <View style={styles.modalOverlay}>
          <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{reassignMode ? "Reassign Trip" : "Assign Trip"}</Text>
              {assignTarget && (
                <Text style={styles.modalSub}>
                  {(assignTarget.route_name?.trim() || `${assignTarget.from_location} → ${assignTarget.to_location}`)}
                  {"  ·  "}
                  {new Date(assignTarget.departure_time.replace(" ", "T")).toLocaleString("en-PH", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
                  {assignTarget.service_type_name ? `  ·  ${assignTarget.service_type_name}` : ""}
                </Text>
              )}

              {formError ? (
                <View style={styles.errorBox}>
                  <Ionicons name="warning" size={14} color="#dc2626" />
                  <Text style={styles.errorText}>{formError}</Text>
                </View>
              ) : null}

              {loadingPick ? (
                <View style={{ alignItems: "center", paddingVertical: 24 }}>
                  <ActivityIndicator color="#1a4a52" />
                </View>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Vehicle{assignTarget?.service_type_name ? ` (${assignTarget.service_type_name})` : ""}</Text>
                  {vehicles.length === 0 ? (
                    <View style={styles.noPickBox}>
                      <Ionicons name="warning" size={18} color="#d97706" />
                      <Text style={styles.noPickText}>
                        No active Bus vehicle of this class has both a seat layout and a driver assigned yet.
                      </Text>
                    </View>
                  ) : (
                    <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled showsVerticalScrollIndicator={true}>
                      {vehicles.map((v) => {
                        const isSelected = selectedVeh === v.id;
                        return (
                          <TouchableOpacity
                            key={v.id}
                            style={[styles.pickerItem, isSelected && styles.pickerItemActive]}
                            onPress={() => selectVehicleForAssign(v.id)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.pickerIcon}>
                              <Ionicons name="bus" size={16} color={isSelected ? "#1a4a52" : "#9ca3af"} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.pickerName, isSelected && { color: "#1a4a52" }]}>{v.plate_number}</Text>
                              <Text style={styles.pickerSub}>{v.capacity} seats · Driver: {v.driver_name}</Text>
                            </View>
                            {isSelected && <Ionicons name="checkmark-circle" size={18} color="#16a34a" />}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  )}

                  <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Conductor (optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Conductor name"
                    placeholderTextColor="#9ca3af"
                    value={conductorName}
                    onChangeText={setConductorName}
                  />
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    placeholder="Conductor phone"
                    placeholderTextColor="#9ca3af"
                    value={conductorPhone}
                    onChangeText={setConductorPhone}
                    keyboardType="phone-pad"
                  />
                </>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={closeAssignModal}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirm, (submitting || !selectedVeh) && { opacity: 0.5 }]}
                  onPress={handleAssignTrip}
                  disabled={submitting || !selectedVeh}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.modalConfirmText}>{reassignMode ? "Save Changes" : "Assign Trip"}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareForm>
        </View>
      </Modal>

      {/* ── CLASS DETAILS MODAL (operator's own amenities overlay on an association class) ── */}
      <Modal visible={showClassDetails} transparent animationType="slide" onRequestClose={() => setShowClassDetails(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{classDetailsTarget?.name} Details</Text>
            <Text style={styles.modalSub}>
              Shown to commuters booking this class, e.g. "180-degree fully reclining bunk seats, privacy curtains,
              individual USB/Type-C charging ports, free Wi-Fi, onboard restroom, comfort kit with snacks, water, and a blanket."
            </Text>
            <TextInput
              style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]}
              placeholder="Describe this class's amenities..."
              placeholderTextColor="#9ca3af"
              multiline
              value={classDetailsDraft}
              onChangeText={setClassDetailsDraft}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowClassDetails(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, savingClassDetails && { opacity: 0.6 }]}
                onPress={handleSaveClassDetails}
                disabled={savingClassDetails}
              >
                {savingClassDetails
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalConfirmText}>Save Details</Text>}
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ── MANIFEST MODAL ── */}
      <Modal visible={!!showManifest} transparent animationType="slide" onRequestClose={() => setShowManifest(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: "80%", paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Passenger Manifest</Text>
            {showManifest && <Text style={styles.modalSub}>{showManifest.label}</Text>}
            {loadingManifest ? (
              <ActivityIndicator color="#1a4a52" style={{ marginVertical: 24 }} />
            ) : manifest.length === 0 ? (
              <Text style={{ color: "#9ca3af", textAlign: "center", paddingVertical: 24 }}>No bookings yet.</Text>
            ) : (
              <FlatList
                data={manifest}
                keyExtractor={b => String(b.id)}
                style={{ maxHeight: Math.round(windowHeight * 0.45) }}
                renderItem={({ item: b }) => {
                  const badgeColor = b.boarding_status === "boarded" ? "#059669"
                    : b.boarding_status === "no_show" ? "#dc2626" : "#2563eb";
                  const badgeBg = b.boarding_status === "boarded" ? "#ecfdf5"
                    : b.boarding_status === "no_show" ? "#fef2f2" : "#eff6ff";
                  return (
                    <View style={styles.manifestRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.manifestName}>{b.passenger_name}</Text>
                        <Text style={styles.manifestPhone}>{b.passenger_phone}</Text>
                        {b.rebook_requested && (
                          <>
                            <View style={styles.rebookRequestedBadge}>
                              <Ionicons name="alert-circle" size={12} color="#b45309" />
                              <Text style={styles.rebookRequestedText}>Commuter requested a rebook</Text>
                            </View>
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                              <TouchableOpacity
                                style={styles.rebookBtn}
                                onPress={() => handleApproveRebook(b.id)}
                                disabled={rebookBusy}
                                activeOpacity={0.8}
                              >
                                <Ionicons name="checkmark-circle-outline" size={12} color="#1a4a52" />
                                <Text style={styles.rebookBtnText}>Approve</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.rejectRebookBtn}
                                onPress={() => openRejectRebook(b.id)}
                                disabled={rebookBusy}
                                activeOpacity={0.8}
                              >
                                <Ionicons name="close-circle-outline" size={12} color="#dc2626" />
                                <Text style={styles.rejectRebookBtnText}>Reject</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        )}
                      </View>
                      <Text style={styles.manifestFare}>₱{b.fare_amount}</Text>
                      <View style={[styles.manifestBadge, { backgroundColor: badgeBg }]}>
                        <Text style={[styles.manifestBadgeText, { color: badgeColor }]}>
                          {BOARDING_STATUS_LABEL[b.boarding_status] ?? b.boarding_status}
                        </Text>
                      </View>
                    </View>
                  );
                }}
              />
            )}
            <TouchableOpacity style={[styles.modalCancel, styles.modalCancelStandalone, { marginTop: 16 }]} onPress={() => setShowManifest(null)}>
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── REJECT REBOOK REQUEST (reason required) ── */}
      <Modal visible={rejectTarget != null} transparent animationType="slide" onRequestClose={() => setRejectTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Reject Rebooking Request</Text>
            <Text style={styles.modalSub}>Let the commuter know why — this is shown on their Booking Details screen.</Text>
            <TextInput
              style={[styles.input, { minHeight: 80, textAlignVertical: "top", marginTop: 12 }]}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="e.g. No availability on requested route."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setRejectTarget(null)} disabled={rebookBusy}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, { backgroundColor: "#dc2626" }, (rebookBusy || rejectReason.trim() === "") && { opacity: 0.6 }]}
                onPress={confirmRejectRebook}
                disabled={rebookBusy || rejectReason.trim() === ""}
              >
                {rebookBusy
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalConfirmText}>Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── CANCEL CONFIRM ── */}
      <Modal visible={!!showCancel} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.confirmBox}>
            <View style={styles.confirmIconWrap}>
              <Ionicons name="close-circle" size={28} color="#dc2626" />
            </View>
            <Text style={styles.confirmTitle}>{showCancel?.kind === "uv" ? "Cancel Slot?" : "Cancel Trip?"}</Text>
            <Text style={styles.confirmSub}>
              {showCancel?.kind === "uv"
                ? "All reserved passengers on this slot will be refunded."
                : "All reserved passengers will be refunded, and this trip will return to Pending Assignment for a new vehicle/driver."}
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowCancel(null)}>
                <Text style={styles.modalCancelText}>Keep</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalConfirm, { backgroundColor: "#dc2626" }]} onPress={handleCancel}>
                <Text style={styles.modalConfirmText}>{showCancel?.kind === "uv" ? "Cancel Slot" : "Cancel Trip"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── REBOOKING REQUESTS (cross-trip) ── */}
      <Modal visible={showRebookRequests} transparent animationType="slide" onRequestClose={() => setShowRebookRequests(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: "80%", paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Rebooking Requests</Text>
            <Text style={styles.modalSub}>
              Commuters asking permission to rebook — either before their trip or shortly after missing it. Approving
              lets the commuter pick their own new trip and pay the rebooking fee; rejecting requires a reason and
              doesn't touch the original booking.
            </Text>

            {rebookRequests.length === 0 ? (
              <Text style={{ color: "#9ca3af", textAlign: "center", paddingVertical: 24 }}>No pending rebooking requests.</Text>
            ) : (
              <ScrollView style={{ maxHeight: Math.round(windowHeight * 0.45) }}>
                {rebookRequests.map((req) => {
                  const dep = new Date(req.departure_time.replace(" ", "T"));
                  const busy = acceptingRequestId === req.reservation_id;
                  return (
                    <View key={req.reservation_id} style={styles.rebookRequestRow}>
                      <Text style={styles.rebookRequestName}>{req.passenger_name}</Text>
                      <Text style={styles.rebookRequestSub}>
                        {req.route_name?.trim() || `${req.from_location} → ${req.to_location}`} · {req.vehicle_category}
                      </Text>
                      <Text style={styles.rebookRequestSub}>
                        Missed: {dep.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} ·{" "}
                        {dep.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} · ₱{req.fare_amount}
                      </Text>
                      <View style={styles.modalActions}>
                        <TouchableOpacity
                          style={[styles.modalCancel, { flex: 1 }]}
                          onPress={() => handleRejectRebookRequest(req)}
                          disabled={busy}
                        >
                          <Text style={[styles.modalCancelText, { color: "#dc2626" }]}>Reject</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.modalConfirm, { flex: 1 }, busy && { opacity: 0.6 }]}
                          onPress={() => handleAcceptRebookRequest(req)}
                          disabled={busy}
                        >
                          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalConfirmText}>Approve</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity style={[styles.modalCancel, styles.modalCancelStandalone, { marginTop: 16 }]} onPress={() => setShowRebookRequests(false)}>
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="calendar" size={22} color="#1a4a52" />
          <View>
            <Text style={styles.headerTitle}>{activeTab === "Bus" ? "Bus Trips" : "UV Express"}</Text>
            {((activeTab === "Bus" && isBusApproved) || (activeTab === "UV Express" && isUvApproved)) && (
              <Text style={styles.headerSub}>
                {scheduleCount} scheduled {isUvOp ? "slot" : "trip"}{scheduleCount !== 1 ? "s" : ""}
              </Text>
            )}
          </View>
        </View>
      </View>

      {approvalReady && hasBusOrUv && (
        <View style={styles.kindRow}>
          {(["Bus", "UV Express"] as const).map(k => {
            const active = activeTab === k;
            return (
              <TouchableOpacity
                key={k}
                style={[styles.kindChip, active && styles.kindChipActive]}
                onPress={() => { setActiveTab(k); if (user) loadSchedule(user.id, k === "UV Express"); }}
                activeOpacity={0.8}
              >
                <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>{k}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {rebookRequests.length > 0 && (
        <TouchableOpacity style={styles.rebookRequestsBanner} onPress={() => setShowRebookRequests(true)} activeOpacity={0.85}>
          <Ionicons name="alert-circle" size={18} color="#b45309" />
          <Text style={styles.rebookRequestsBannerText}>
            {rebookRequests.length} rebooking request{rebookRequests.length !== 1 ? "s" : ""} awaiting your review
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#b45309" />
        </TouchableOpacity>
      )}

      {!approvalReady ? (
        <View style={styles.loadingWrap}><ActivityIndicator color="#1a4a52" size="large" /></View>
      ) : !hasBusOrUv ? (
        <View style={styles.empty}>
          <Ionicons name="information-circle-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyText}>Not applicable for Jeepney</Text>
          <Text style={styles.emptySub}>Jeepney uses the live dispatch queue instead of scheduled trips.</Text>
        </View>
      ) : activeTab === "Bus" && !isBusApproved ? (
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyText}>Not approved for Bus yet</Text>
          <Text style={styles.emptySub}>Apply from Profile → My Associations to unlock Bus trip scheduling.</Text>
        </View>
      ) : activeTab === "UV Express" && !isUvApproved ? (
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyText}>Not approved for UV Express yet</Text>
          <Text style={styles.emptySub}>Apply from Profile → My Associations to unlock UV Express schedules.</Text>
        </View>
      ) : loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color="#1a4a52" size="large" /></View>
      ) : isUvOp ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ gap: 10 }}>
            <Text style={styles.sectionLabel}>Your UV Schedules</Text>
            <Text style={styles.helperNote}>
              Your association sets the route, operating hours, and recurrence — activate a schedule to make it
              bookable by commuters for your fleet. No vehicle to pick; UV Express stays queue-based.
            </Text>
            {uvSchedules.length === 0 ? (
              <View style={styles.noPickBox}>
                <Ionicons name="information-circle-outline" size={18} color="#6b7280" />
                <Text style={styles.noPickText}>Your association hasn't published any UV Express schedules yet.</Text>
              </View>
            ) : (
              uvSchedules.map((sc) => {
                const isActive = sc.activation_status === "active";
                const paused = sc.schedule_status !== "active";
                return (
                  <View key={sc.id} style={styles.queueCard}>
                    <Text style={styles.queueRouteName}>
                      {sc.route_name?.trim() || `${sc.from_location} → ${sc.to_location}`}
                    </Text>
                    <Text style={styles.tripMeta}>
                      {formatTime12h(sc.start_time)} – {formatTime12h(sc.end_time)} ·{" "}
                      {sc.recurrence_type === "daily" ? "Every day" : sc.weekdays?.map(d => WEEKDAY_SHORT[d]).join(", ")}
                    </Text>
                    {paused ? (
                      <Text style={styles.queueEmptyText}>Paused by association — can't be activated right now.</Text>
                    ) : (
                      <TouchableOpacity
                        style={[
                          styles.queueAdvanceBtn,
                          isActive ? { backgroundColor: "#dc2626" } : {},
                          togglingSchedule === sc.id && { opacity: 0.6 },
                        ]}
                        onPress={() => handleToggleUvSchedule(sc)}
                        disabled={togglingSchedule === sc.id}
                      >
                        {togglingSchedule === sc.id
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={styles.queueAdvanceText}>{isActive ? "Deactivate" : "Activate"}</Text>}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>

          {uvRoutes.length > 0 && (
            <View style={{ gap: 10 }}>
              <Text style={styles.sectionLabel}>Route Queue</Text>
              {uvRoutes.map((r) => {
                const qs = queueStatuses[r.id];
                const canAdvance = !!qs && (!!qs.dispatched || qs.waiting.length > 0);
                return (
                  <View key={r.id} style={styles.queueCard}>
                    <Text style={styles.queueRouteName}>{r.from_location} → {r.to_location}</Text>
                    {qs?.dispatched ? (
                      <Text style={styles.queueActiveText}>
                        Active: {qs.dispatched.driver_name}{qs.dispatched.plate_number ? ` (${qs.dispatched.plate_number})` : ""}
                      </Text>
                    ) : (
                      <Text style={styles.queueEmptyText}>No vehicle currently boarding.</Text>
                    )}
                    <Text style={styles.queueWaitingText}>
                      {qs?.waiting.length ?? 0} waiting{qs && qs.waiting.length > 0 ? `: ${qs.waiting.map(w => w.driver_name).join(", ")}` : ""}
                    </Text>
                    <TouchableOpacity
                      style={[styles.queueAdvanceBtn, (advancingRoute === r.id || !canAdvance) && { opacity: 0.5 }]}
                      onPress={() => handleAdvanceQueue(r.id)}
                      disabled={advancingRoute === r.id || !canAdvance}
                    >
                      {advancingRoute === r.id
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={styles.queueAdvanceText}>Advance to Next Vehicle</Text>}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
          {uvSlots.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyText}>No upcoming bookings yet</Text>
              <Text style={styles.emptySub}>Once a schedule is active, commuter bookings will appear here.</Text>
            </View>
          ) : (
            uvSlots.map((slot) => {
              const meta = STATUS_META[slot.status];
              const dep  = new Date(slot.departure_time.replace(" ", "T"));
              const depStr = dep.toLocaleString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true });
              return (
                <View key={slot.id} style={styles.tripCard}>
                  <View style={styles.tripHeader}>
                    <Text style={styles.tripRoute} numberOfLines={1}>
                      {slot.route_name?.trim() || `${slot.from_location} → ${slot.to_location}`}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                      <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.tripMeta}>Departs {depStr}</Text>
                  <Text style={styles.tripMeta}>
                    {slot.capacity !== null ? `${slot.seats_booked} / ${slot.capacity} seats booked` : `${slot.seats_booked} booked`} · ₱{slot.fare}/person
                  </Text>
                  <View style={styles.tripActions}>
                    <TouchableOpacity style={styles.tripActionBtn} onPress={() => openSlotManifest(slot)}>
                      <Ionicons name="people-outline" size={14} color="#1a4a52" />
                      <Text style={styles.tripActionText}>Manifest</Text>
                    </TouchableOpacity>
                    {slot.status === "scheduled" && (
                      <TouchableOpacity style={[styles.tripActionBtn, { borderColor: "#dc2626" }]} onPress={() => setShowCancel({ kind: "uv", id: slot.id })}>
                        <Ionicons name="close-circle-outline" size={14} color="#dc2626" />
                        <Text style={[styles.tripActionText, { color: "#dc2626" }]}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.statusFilterRow}
            contentContainerStyle={styles.statusFilterRowContent}
          >
            {BUS_STATUS_FILTERS.map(({ key, label }) => {
              const active = busStatusFilter === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.statusFilterChip, active && styles.statusFilterChipActive]}
                  onPress={() => setBusStatusFilter(key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.statusFilterChipText, active && styles.statusFilterChipTextActive]}>
                    {label} ({busStatusCounts[key]})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <ScrollView
            style={styles.list}
            contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
          >
          {classInfoList.length > 0 && (
            <View style={{ marginBottom: 4 }}>
              <Text style={styles.fieldLabel}>Your Classes</Text>
              <Text style={styles.helperNote}>
                Add amenities/details for any class your association has defined — reachable even before a schedule exists for it.
              </Text>
              {classInfoList.map((ci) => (
                <View key={ci.id} style={[styles.classDetailsCard, { marginTop: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.classDetailsTitle}>{ci.name}</Text>
                    <Text style={styles.classDetailsBody} numberOfLines={2}>
                      {ci.details || "No amenities/details added yet."}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.classDetailsEditBtn} onPress={() => openClassDetailsEditor(ci)} activeOpacity={0.8}>
                    <Ionicons name="create-outline" size={14} color="#1a4a52" />
                    <Text style={styles.classDetailsEditText}>{ci.details ? "Edit" : "Add"}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {busStatusFilter === "pending" ? (
            <>
              <View style={styles.pendingDateNav}>
                <TouchableOpacity style={styles.adjBtn} onPress={() => adjustPendingDate(-1)} disabled={pendingDate <= TODAY} activeOpacity={0.7} accessibilityLabel="Previous day">
                  <Ionicons name="chevron-back" size={18} color={pendingDate <= TODAY ? "#d1d5db" : "#1a4a52"} />
                </TouchableOpacity>
                <View style={styles.pendingDateCenter}>
                  <Text style={styles.pendingDateVal}>
                    {new Date(`${pendingDate}T00:00:00`).toLocaleDateString("en-PH", { weekday: "long", month: "short", day: "numeric" })}
                  </Text>
                  {pendingDate === TODAY && <Text style={styles.pendingDateSub}>Today</Text>}
                  {pendingDate === addDays(TODAY, 1) && <Text style={styles.pendingDateSub}>Tomorrow</Text>}
                </View>
                <TouchableOpacity style={styles.adjBtn} onPress={() => adjustPendingDate(1)} disabled={pendingDate >= addDays(TODAY, PENDING_WINDOW_DAYS - 1)} activeOpacity={0.7} accessibilityLabel="Next day">
                  <Ionicons name="chevron-forward" size={18} color={pendingDate >= addDays(TODAY, PENDING_WINDOW_DAYS - 1) ? "#d1d5db" : "#1a4a52"} />
                </TouchableOpacity>
              </View>

              {/* Horizontal date strip — the actual "quickly switch to any
                  future date" mechanism; the arrows above are for fine
                  one-day adjustment, this is for jumping straight to a date
                  anywhere in the 30-day window without N taps. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.pendingStripRow}
                contentContainerStyle={styles.pendingStripContent}
              >
                {PENDING_DATE_OPTIONS.map((d, i) => {
                  const active = d === pendingDate;
                  const dObj = new Date(`${d}T00:00:00`);
                  const topLabel = i === 0 ? "TODAY" : i === 1 ? "TMRW" : dObj.toLocaleDateString("en-PH", { weekday: "short" }).toUpperCase();
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[styles.pendingDateChip, active && styles.pendingDateChipActive]}
                      onPress={() => setPendingDate(d)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.pendingDateChipTop, active && styles.pendingDateChipTopActive]}>{topLabel}</Text>
                      <Text style={[styles.pendingDateChipNum, active && styles.pendingDateChipNumActive]}>{dObj.getDate()}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {pendingLoading ? (
                <View style={{ alignItems: "center", paddingVertical: 24 }}>
                  <ActivityIndicator color="#1a4a52" />
                </View>
              ) : pendingTrips.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="checkmark-done-circle-outline" size={48} color="#d1d5db" />
                  <Text style={styles.emptyText}>No pending trips for this date</Text>
                  <Text style={styles.emptySub}>Every trip generated for this date already has a vehicle and driver — or none was generated (check your association's schedules)</Text>
                </View>
              ) : (
                pendingTrips.map((trip) => (
                  <TripCard
                    key={trip.id}
                    trip={trip}
                    busy={false}
                    onManifest={() => {}}
                    onStartBoarding={() => {}}
                    onDepart={() => {}}
                    onComplete={() => {}}
                    onCancel={() => {}}
                    onAssign={() => openAssign(trip)}
                    onReassign={() => {}}
                  />
                ))
              )}
            </>
          ) : busStatusFilter === "all" ? (
            <>
              {/* Pending Assignment summary — deliberately a count/link, not
                  the individual trip cards, so viewing "All" never bulk-loads
                  the whole generation window (see Core Flow 12a). */}
              <TouchableOpacity style={styles.dashboardBanner} onPress={() => setBusStatusFilter("pending")} activeOpacity={0.85}>
                <View style={[styles.dashboardBannerIcon, { backgroundColor: STATUS_META.pending_assignment.bg }]}>
                  <Ionicons name="time-outline" size={18} color={STATUS_META.pending_assignment.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dashboardBannerTitle}>Pending Assignment</Text>
                  <Text style={styles.dashboardBannerSub}>
                    {pendingLoading ? "Loading…" : `${pendingTrips.length} trip${pendingTrips.length !== 1 ? "s" : ""} awaiting vehicle & driver today`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
              </TouchableOpacity>

              {statusSections.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
                  <Text style={styles.emptyText}>No trips scheduled</Text>
                  <Text style={styles.emptySub}>Trips are generated automatically from your association's Active schedules — check back or ask them to publish one</Text>
                </View>
              ) : (
                statusSections.map(({ status, label, trips: sectionTrips }) => (
                  <View key={status}>
                    <Text style={styles.statusSectionHeader}>{label} ({sectionTrips.length})</Text>
                    {sectionTrips.map((trip) => (
                      <TripCard
                        key={trip.id}
                        trip={trip}
                        busy={tripActionBusy === trip.id}
                        onManifest={() => openBusManifest(trip)}
                        onStartBoarding={() => handleTripAction(trip.id, "start_boarding")}
                        onDepart={() => handleTripAction(trip.id, "depart")}
                        onComplete={() => handleTripAction(trip.id, "complete")}
                        onCancel={() => setShowCancel({ kind: "bus", id: trip.id })}
                        onAssign={() => {}}
                        onReassign={() => openAssign(trip, true)}
                      />
                    ))}
                  </View>
                ))
              )}
            </>
          ) : filteredTrips.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyText}>
                No {BUS_STATUS_FILTERS.find(f => f.key === busStatusFilter)?.label} trips
              </Text>
              <Text style={styles.emptySub}>Try a different filter</Text>
            </View>
          ) : (
            groupedTrips.map(({ date, trips: dayTrips }) => (
              <View key={date}>
                <Text style={styles.dateGroupHeader}>
                  {new Date(`${date}T00:00:00`).toLocaleDateString("en-PH", { weekday: "long", month: "short", day: "numeric" })}
                </Text>
                {dayTrips.map((trip) => (
                  <TripCard
                    key={trip.id}
                    trip={trip}
                    busy={tripActionBusy === trip.id}
                    onManifest={() => openBusManifest(trip)}
                    onStartBoarding={() => handleTripAction(trip.id, "start_boarding")}
                    onDepart={() => handleTripAction(trip.id, "depart")}
                    onComplete={() => handleTripAction(trip.id, "complete")}
                    onCancel={() => setShowCancel({ kind: "bus", id: trip.id })}
                    onAssign={() => {}}
                    onReassign={() => openAssign(trip, true)}
                  />
                ))}
              </View>
            ))
          )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

// ── Shared Bus trip card — used by both the date-scoped Pending Assignment
// list and every status-tab list (grouped-by-date or the "All" dashboard's
// grouped-by-status sections), so all three render identically instead of
// three slightly-drifting copies of the same card. Action buttons are
// gated strictly by trip.status, matching the trip lifecycle exactly:
// Pending Assignment → Assign Trip only. Ready/Open → Manifest, Reassign,
// Start Boarding, Cancel. Boarding → Manifest, Depart. Departed → Manifest,
// Mark Arrived. Completed/Cancelled → Manifest only (read-only). Reassign
// (swap vehicle/driver/conductor without a duplicate pending assignment) is
// deliberately Ready/Open-only — once boarding starts, the assigned vehicle
// is already the one passengers are lining up for. ───────────────────────
function TripCard({ trip, busy, onManifest, onStartBoarding, onDepart, onComplete, onCancel, onAssign, onReassign }: {
  trip: BusTrip;
  busy: boolean;
  onManifest: () => void;
  onStartBoarding: () => void;
  onDepart: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onAssign: () => void;
  onReassign: () => void;
}) {
  const meta = STATUS_META[trip.status];
  const isPending = trip.status === "pending_assignment";
  const dep = new Date(trip.departure_time.replace(" ", "T"));
  const depStr = dep.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true });
  const boardStr = trip.boarding_time
    ? new Date(trip.boarding_time.replace(" ", "T")).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })
    : null;

  return (
    <View style={styles.tripCard}>
      <View style={styles.tripHeader}>
        <Text style={styles.tripRoute} numberOfLines={1}>
          {trip.route_name?.trim() || `${trip.from_location} → ${trip.to_location}`}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
          <Text style={[styles.statusText, { color: meta.color }]} numberOfLines={1}>{meta.label}</Text>
        </View>
      </View>

      <View style={styles.tripInfoRow}>
        <Ionicons name="time-outline" size={13} color="#9ca3af" style={styles.tripInfoIcon} />
        <Text style={styles.tripInfoText} numberOfLines={1}>
          {boardStr ? `Board ${boardStr} · ` : ""}Depart {depStr}
        </Text>
      </View>

      {isPending ? (
        <View style={styles.tripInfoRow}>
          <Ionicons name="pricetag-outline" size={13} color="#9ca3af" style={styles.tripInfoIcon} />
          <Text style={styles.tripInfoText} numberOfLines={1}>
            {trip.service_type_name ?? "—"} · Awaiting vehicle &amp; driver
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.tripInfoRow}>
            <Ionicons name="bus-outline" size={13} color="#9ca3af" style={styles.tripInfoIcon} />
            <Text style={styles.tripInfoText} numberOfLines={1}>
              {trip.vehicle_plate} · {trip.driver_name}
              {trip.conductor_name ? ` · Cond: ${trip.conductor_name}` : ""}
            </Text>
          </View>
          <View style={styles.tripInfoRow}>
            <Ionicons name="people-outline" size={13} color="#9ca3af" style={styles.tripInfoIcon} />
            <Text style={styles.tripInfoText} numberOfLines={1}>
              {trip.seats_booked} / {trip.capacity ?? "—"} seats · ₱{trip.fare}/person
            </Text>
          </View>
        </>
      )}

      <View style={styles.tripActions}>
        {isPending && (
          <TouchableOpacity style={styles.tripActionBtnAlt} onPress={onAssign} activeOpacity={0.85}>
            <Ionicons name="checkmark-circle-outline" size={14} color="#fff" />
            <Text style={styles.tripActionAltText}>Assign Trip</Text>
          </TouchableOpacity>
        )}
        {!isPending && (
          <TouchableOpacity style={styles.tripActionBtn} onPress={onManifest} activeOpacity={0.85}>
            <Ionicons name="people-outline" size={14} color="#1a4a52" />
            <Text style={styles.tripActionText}>Manifest</Text>
          </TouchableOpacity>
        )}
        {trip.status === "scheduled" && (
          <TouchableOpacity
            style={[styles.tripActionBtn, busy && { opacity: 0.6 }]}
            onPress={onReassign}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Ionicons name="swap-horizontal" size={14} color="#1a4a52" />
            <Text style={styles.tripActionText}>Reassign</Text>
          </TouchableOpacity>
        )}
        {trip.status === "scheduled" && (
          <TouchableOpacity
            style={[styles.tripActionBtn, busy && { opacity: 0.6 }]}
            onPress={onStartBoarding}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Ionicons name="people" size={14} color="#1a4a52" />
            <Text style={styles.tripActionText}>Start Boarding</Text>
          </TouchableOpacity>
        )}
        {trip.status === "boarding" && (
          <TouchableOpacity
            style={[styles.tripActionBtnAlt, busy && { opacity: 0.6 }]}
            onPress={onDepart}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-redo" size={14} color="#fff" />
            <Text style={styles.tripActionAltText}>Depart</Text>
          </TouchableOpacity>
        )}
        {trip.status === "departed" && (
          <TouchableOpacity
            style={[styles.tripActionBtnAlt, { backgroundColor: "#059669" }, busy && { opacity: 0.6 }]}
            onPress={onComplete}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-done" size={14} color="#fff" />
            <Text style={styles.tripActionAltText}>Mark Arrived</Text>
          </TouchableOpacity>
        )}
        {trip.status === "scheduled" && (
          <TouchableOpacity style={[styles.tripActionBtn, { borderColor: "#dc2626" }]} onPress={onCancel} activeOpacity={0.85}>
            <Ionicons name="close-circle-outline" size={14} color="#dc2626" />
            <Text style={[styles.tripActionText, { color: "#dc2626" }]}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f9fafb" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  toast:       { position: "absolute", top: 60, left: 20, right: 20, zIndex: 99, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, padding: 12 },
  toastText:   { color: "#fff", fontSize: 13, fontWeight: "700", flex: 1 },

  header:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  kindRow:  { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 16 },
  kindChip: { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, minHeight: 34, alignItems: "center", justifyContent: "center" },
  kindChipActive: { borderColor: "#1a4a52", backgroundColor: "#f0faf4" },
  kindChipText: { fontSize: 12, fontWeight: "700", color: "#9ca3af" },
  kindChipTextActive: { color: "#1a4a52" },
  statusFilterRow: { flexGrow: 0, paddingBottom: 16 },
  statusFilterRowContent: { flexDirection: "row", gap: 8, paddingHorizontal: 20 },
  statusFilterChip: { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, minHeight: 34, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  statusFilterChipActive: { borderColor: "#1a4a52", backgroundColor: "#1a4a52" },
  statusFilterChipText: { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  statusFilterChipTextActive: { color: "#fff" },
  headerTitle:    { fontSize: 22, fontWeight: "900", color: "#1a4a52" },
  headerSub:      { fontSize: 12, color: "#6b7280", marginTop: 2 },
  addBtn:         { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#1a4a52", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  addBtnText:     { color: "#fff", fontSize: 13, fontWeight: "800" },

  list:      { flex: 1 },
  dateGroupHeader: { fontSize: 12, fontWeight: "800", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10, marginBottom: 6 },

  pendingDateNav:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: "#f1f5f9" },
  adjBtn:            { width: 36, height: 36, borderRadius: 18, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  pendingDateCenter: { alignItems: "center", minWidth: 140 },
  pendingDateVal:    { fontSize: 16, fontWeight: "900", color: "#1a4a52" },
  pendingDateSub:    { fontSize: 11, fontWeight: "700", color: "#16a34a", marginTop: 2 },
  pendingStripRow:     { flexGrow: 0, marginTop: 10 },
  pendingStripContent: { flexDirection: "row", gap: 8, paddingBottom: 2 },
  pendingDateChip:        { alignItems: "center", justifyContent: "center", width: 52, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", backgroundColor: "#fff" },
  pendingDateChipActive:  { borderColor: "#1a4a52", backgroundColor: "#1a4a52" },
  pendingDateChipTop:        { fontSize: 10, fontWeight: "800", color: "#9ca3af", letterSpacing: 0.3 },
  pendingDateChipTopActive:  { color: "#a8d832" },
  pendingDateChipNum:        { fontSize: 16, fontWeight: "900", color: "#1a4a52", marginTop: 2 },
  pendingDateChipNumActive:  { color: "#fff" },
  empty:     { alignItems: "center", paddingTop: 60, gap: 8, paddingHorizontal: 32 },
  emptyText: { fontSize: 16, fontWeight: "800", color: "#374151" },
  emptySub:  { fontSize: 12, color: "#9ca3af", textAlign: "center" },

  // marginBottom is the actual overlap-bug fix — cards nested inside a
  // date/status group wrapper (no gap of their own) used to render flush
  // against the next one with zero spacing; this guarantees a consistent
  // gap after every single card everywhere it's used (flat list, date
  // groups, and status-grouped sections), regardless of nesting depth.
  // No fixed height anywhere on this card — it always sizes to its content,
  // so wrapped action buttons grow the card automatically.
  tripCard:    { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, gap: 6 },
  tripHeader:  { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  tripRoute:   { fontSize: 16, fontWeight: "800", color: "#1a4a52", flex: 1 },
  tripMeta:    { fontSize: 12, color: "#6b7280" },
  tripInfoRow:  { flexDirection: "row", alignItems: "center", gap: 6 },
  tripInfoIcon: { marginTop: 1 },
  tripInfoText: { fontSize: 12, color: "#6b7280", flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, flexShrink: 0 },
  statusText:  { fontSize: 11, fontWeight: "800" },
  // flexWrap is the other half of the overlap-bug fix — without it, a row
  // of 3-4 buttons on a narrow screen overflowed past the card's right edge
  // instead of dropping to a second line.
  tripActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  tripActionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderWidth: 1.5, borderColor: "#1a4a52", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, minHeight: 34 },
  tripActionText: { fontSize: 12, fontWeight: "700", color: "#1a4a52" },
  tripActionBtnAlt:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#1a4a52", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, minHeight: 34 },
  tripActionAltText: { fontSize: 12, fontWeight: "700", color: "#fff" },

  dashboardBanner:     { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 4, borderWidth: 1.5, borderColor: "#fde68a", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  dashboardBannerIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dashboardBannerTitle:{ fontSize: 13, fontWeight: "800", color: "#1a4a52" },
  dashboardBannerSub:  { fontSize: 11, color: "#6b7280", marginTop: 1 },
  statusSectionHeader: { fontSize: 13, fontWeight: "800", color: "#1a4a52", marginTop: 10, marginBottom: 8 },

  classDetailsCard:    { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#f0fdf4", borderRadius: 12, borderWidth: 1, borderColor: "#bbf7d0", padding: 12, marginTop: 10 },
  classDetailsTitle:   { fontSize: 13, fontWeight: "800", color: "#166534" },
  classDetailsBody:    { fontSize: 11, color: "#3f6212", marginTop: 2 },
  classDetailsEditBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: "#1a4a52", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  classDetailsEditText:{ fontSize: 11, fontWeight: "700", color: "#1a4a52" },

  sectionLabel:     { fontSize: 12, fontWeight: "800", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 },
  queueCard:        { backgroundColor: "#fff", borderRadius: 16, padding: 14, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, gap: 4 },
  queueRouteName:   { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  queueActiveText:  { fontSize: 12, color: "#059669", fontWeight: "700" },
  queueEmptyText:   { fontSize: 12, color: "#9ca3af" },
  queueWaitingText: { fontSize: 12, color: "#6b7280" },
  queueAdvanceBtn:  { marginTop: 6, backgroundColor: "#1a4a52", borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  queueAdvanceText: { fontSize: 12, fontWeight: "800", color: "#fff" },

  manifestRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  manifestName: { fontSize: 13, fontWeight: "700", color: "#374151" },
  manifestPhone:{ fontSize: 11, color: "#9ca3af" },
  manifestFare: { fontSize: 13, fontWeight: "800", color: "#1a4a52" },
  manifestBadge:{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  manifestBadgeText: { fontSize: 10, fontWeight: "700", textTransform: "capitalize" },

  rebookBtn:     { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4, alignSelf: "flex-start" },
  rebookBtnText: { fontSize: 11, fontWeight: "700", color: "#1a4a52", textDecorationLine: "underline" },
  rejectRebookBtn:     { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4, alignSelf: "flex-start" },
  rejectRebookBtnText: { fontSize: 11, fontWeight: "700", color: "#dc2626", textDecorationLine: "underline" },
  rebookRequestsBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a", borderRadius: 12, marginHorizontal: 20, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rebookRequestsBannerText: { flex: 1, fontSize: 13, fontWeight: "700", color: "#92400e" },
  rebookRequestRow:  { borderBottomWidth: 1, borderBottomColor: "#f3f4f6", paddingVertical: 12, gap: 2 },
  rebookRequestName: { fontSize: 14, fontWeight: "800", color: "#111827" },
  rebookRequestSub:  { fontSize: 12, color: "#6b7280" },
  rebookRequestedBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4, alignSelf: "flex-start", backgroundColor: "#fffbeb", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  rebookRequestedText:  { fontSize: 10, fontWeight: "700", color: "#b45309" },
  rebookOption:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  rebookOptionText: { fontSize: 14, fontWeight: "700", color: "#1a4a52" },
  rebookOptionSub:  { fontSize: 12, color: "#6b7280" },
  rebookConfirmBox: { backgroundColor: "#f9fafb", borderRadius: 12, padding: 14, marginVertical: 8, borderWidth: 1, borderColor: "#e5e7eb" },
  rebookConfirmText:{ fontSize: 13, color: "#374151", lineHeight: 20 },
  seatGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  seatItem:      { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  seatAvailable: { backgroundColor: "#f0faf4", borderColor: "#16a34a" },
  seatTaken:     { backgroundColor: "#9ca3af", borderColor: "#9ca3af" },
  seatItemText:  { fontSize: 12, fontWeight: "800", color: "#1a4a52" },

  noPickBox:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fffbeb", borderRadius: 10, borderWidth: 1, borderColor: "#fde68a", padding: 12, marginTop: 8 },
  noPickText: { fontSize: 12, color: "#92400e", flex: 1 },
  previewBox:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f0fdf4", borderRadius: 10, borderWidth: 1, borderColor: "#bbf7d0", padding: 12, marginTop: 14 },
  previewText:     { fontSize: 12, color: "#166534", fontWeight: "700", flex: 1 },
  previewErrorText:{ fontSize: 12, color: "#dc2626", fontWeight: "600", flex: 1 },
  pickerItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", marginBottom: 8, backgroundColor: "#f9fafb" },
  pickerItemActive: { borderColor: "#16a34a", backgroundColor: "#f0fdf4" },
  pickerIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  pickerName: { fontSize: 13, fontWeight: "700", color: "#374151" },
  pickerSub:  { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  routeColorDot: { width: 10, height: 32, borderRadius: 5 },

  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: "#f9fafb", borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", paddingVertical: 10 },
  stepBtn:    { padding: 6 },
  stepVal:    { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  timeUnit:   { alignItems: "center", gap: 2 },
  timeVal:    { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  timeSep:    { fontSize: 18, fontWeight: "900", color: "#1a4a52" },

  modalOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:       { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHandle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },
  modalTitle:       { fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  modalSub:         { fontSize: 13, color: "#6b7280", marginBottom: 16 },
  errorBox:         { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca", borderRadius: 12, padding: 12, marginBottom: 14 },
  errorText:        { flex: 1, color: "#dc2626", fontSize: 13 },
  fieldLabel:       { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  helperNote:       { fontSize: 11, color: "#6b7280", marginTop: 4 },
  input:            { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#f9fafb" },
  modalActions:     { flexDirection: "row", gap: 10, marginTop: 16 },
  modalCancel:      { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  modalCancelText:  { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  // modalCancel's `flex: 1` is meant for `modalActions` (flexDirection:"row"),
  // where it splits width evenly against modalConfirm's own flex:1. Reused
  // standalone (no row, no sibling) directly inside a plain column modal
  // sheet, `flex: 1` sets flexBasis:0% on the *vertical* axis with no free
  // space to grow into — the button's content box collapses and its Text
  // child renders at zero height (invisible), even though the border/padding
  // still paint a visible outlined box. Override back to content-based
  // sizing for every standalone usage.
  modalCancelStandalone: { flex: 0, flexBasis: "auto" },
  modalConfirm:     { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: "#1a4a52", alignItems: "center" },
  modalConfirmText: { fontSize: 14, fontWeight: "800", color: "#fff" },
  confirmBox:       { backgroundColor: "#fff", borderRadius: 20, margin: 32, padding: 24, alignItems: "center", gap: 8 },
  confirmIconWrap:  { width: 64, height: 64, borderRadius: 32, backgroundColor: "#fef2f2", alignItems: "center", justifyContent: "center" },
  confirmTitle:     { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  confirmSub:       { fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 8 },
});
