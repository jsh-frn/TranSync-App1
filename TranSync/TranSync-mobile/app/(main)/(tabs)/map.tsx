import { Fragment, useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, TextInput, FlatList, Keyboard, Linking, Modal, Alert,
  AppState, useWindowDimensions,
} from "react-native";
import MapView, { Marker, Polyline, Polygon, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../../src/config/api";
import { formatTime12h } from "../../../src/utils/time";

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? "";

type LatLng = { latitude: number; longitude: number };

type TrackedDriver = {
  id: number;
  name: string;
  operator_type?: string;
  operator_name?: string;
  plate_number?: string | null;
  vehicle_number?: string | null;
  capacity?: number | null;
  dispatch_status?: "waiting" | "dispatched" | "completed" | "cancelled" | null;
  route_id?: number | null;
  route_name?: string | null;
  latitude: number;
  longitude: number;
  heading: number;
  is_full: number;
  is_online: number;
  location_updated_at?: string;
};

// Human-readable label for a driver's current dispatch_queue state — "no row
// yet" (dispatch_status is null) reads as simply Online/idle, not an error.
function dispatchStatusLabel(status: TrackedDriver["dispatch_status"]): string {
  switch (status) {
    case "dispatched": return "On a trip";
    case "waiting":     return "Waiting in queue";
    case "completed":   return "Trip completed";
    case "cancelled":   return "Not dispatched";
    default:            return "Online";
  }
}

// "Updated Xs/Xm ago" — location_updated_at is a MySQL DATETIME string in the
// server's own local time, same as every other timestamp this app renders
// client-side; treated as a wall-clock label, not run through a strict UTC
// parse (matching the PHP/MySQL clock-mismatch convention used elsewhere).
function timeAgo(dateStr?: string): string {
  if (!dateStr) return "—";
  const then = new Date(dateStr.replace(" ", "T")).getTime();
  if (isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 5)   return "just now";
  if (diffSec < 60)  return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60)  return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  return `${diffHr}h ago`;
}

type JeepneyHours = { start_time: string; end_time: string };

type RoutePolyline = {
  id: number;
  name: string;
  color: string;
  waypoints: LatLng[];
  direction_type?: "one_way" | "vice_versa";
};

type Stopover = { terminal_id: number; terminal_name: string };

type TerminalRoute = {
  route_id: number;
  route_name: string;
  vehicle_type: string | null;
  color: string;
  description: string | null;
  stopovers: Stopover[];
};

// A terminal can host more than one route (e.g. a shared hub), possibly of different
// vehicle types — vehicle_type here is just the primary badge shown on the map pin.
type Terminal = {
  terminal_id: number;
  terminal_name: string;
  vehicle_type: string | null;
  latitude: number;
  longitude: number;
  routes: TerminalRoute[];
};

type PlacePrediction = {
  place_id: string;
  description: string;
};

type RouteSegment = {
  route_id: number;
  route_name: string;
  board_at: string;
  alight_at: string;
  vehicle_type: string | null;
  color: string;
  est_mins: number | null;
  km: number | null;
  fare: number | null;
  waypoints: LatLng[];
  // The ACTUAL board/alight coordinates for this leg — waypoints[] is always
  // stored low-index-to-high-index regardless of which direction this leg is
  // really ridden, so waypoints[0]/waypoints[last] is NOT reliable for "where
  // does the commuter get off" on a 'vice_versa' route ridden backward. Use
  // these instead for anything that needs the real alight point (transfer
  // markers, proximity checks, the walk line between two legs).
  board_lat: number | null;
  board_lng: number | null;
  alight_lat: number | null;
  alight_lng: number | null;
  terminal_id: number | null;
  terminal_name: string | null;
  // This route's own fixed home/departure terminal — NOT this leg's alight
  // point. Two different things that happen to share a naming pattern; don't
  // use terminal_lat/lng for "where do I get off," use alight_lat/lng.
  terminal_lat: number | null;
  terminal_lng: number | null;
  // Best-effort "which side of the road" boarding hint — see route_planner.php's
  // boardSideHint() for the caveat this is built on (not a guaranteed-precise
  // lane detection, since routes are one shared line per corridor).
  board_side_hint: "cross" | "correct" | null;
  board_side_note: string | null;
  direction_type: "one_way" | "vice_versa" | null;
};

type RouteOption = {
  type: "direct" | "transfer" | "nearest";
  transfers: number;
  total_fare: number | null;
  total_mins: number | null;
  total_km: number | null;
  transfer_point: string | null;
  walk_to_dest_m: number | null;
  has_active_drivers: boolean;
  segments: RouteSegment[];
};

// The real point where a commuter gets off this leg — never terminal_lat/lng
// (this route's own fixed home terminal, a different concept entirely — see
// the RouteSegment type note) and never waypoints[last] (only reliable when
// this leg happens to be ridden in ascending-index order). Falls back to the
// waypoint array only if the backend response predates these explicit fields.
function segAlightPoint(seg: RouteSegment): LatLng | null {
  if (seg.alight_lat != null && seg.alight_lng != null) {
    return { latitude: seg.alight_lat, longitude: seg.alight_lng };
  }
  return seg.waypoints?.[seg.waypoints.length - 1] ?? null;
}
function segBoardPoint(seg: RouteSegment): LatLng | null {
  if (seg.board_lat != null && seg.board_lng != null) {
    return { latitude: seg.board_lat, longitude: seg.board_lng };
  }
  return seg.waypoints?.[0] ?? null;
}

function vehicleIconName(vt: string | null): React.ComponentProps<typeof Ionicons>["name"] {
  if (vt === "UV Express") return "car-outline";
  return "bus-outline";
}

function vehicleColor(vt: string | null): string {
  if (vt === "UV Express") return "#1d4ed8";
  if (vt === "Bus")        return "#ea580c";
  return "#16a34a";
}

// A route-suggestion option counts as "Jeepney" for the operating-hours
// display when every one of its legs is a Jeepney leg — a mixed-type
// transfer option keeps the existing driver-availability badge instead,
// since "operating hours" is a single-route concept. Absence of an assigned/
// online driver is never treated as "outside operating hours" here — those
// are two unrelated signals (Core Flow 8g).
function isAllJeepneyOption(opt: RouteOption): boolean {
  return opt.segments.length > 0 && opt.segments.every(seg => (seg.vehicle_type ?? "Jeepney") === "Jeepney");
}

// Purely a display computation against the device's current local time — no
// booking/dispatch enforcement exists for Jeepney (Core Flow 8g), so this
// never blocks anything, it only informs the commuter.
function describeJeepneyHours(hours: JeepneyHours | null | undefined): { schedule: string; notOperating: boolean } | null {
  if (hours === undefined) return null; // not fetched yet — render nothing rather than a wrong guess
  if (hours === null) return { schedule: "Not set", notOperating: false };
  const is24h = hours.start_time === "00:00" && hours.end_time === "23:59";
  if (is24h) return { schedule: "24 Hours", notOperating: false };

  const schedule = `${formatTime12h(hours.start_time)} – ${formatTime12h(hours.end_time)}`;
  const [sh, sm] = hours.start_time.split(":").map(Number);
  const [eh, em] = hours.end_time.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin   = eh * 60 + em;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Overnight windows (start > end, e.g. 8:00 PM – 2:00 AM) wrap past
  // midnight — the valid set is everything from start to 23:59 PLUS 00:00 to
  // end, mirroring the same wrap convention this app already uses for UV
  // Express operating hours (Do Not Break rule #54a).
  const within = startMin <= endMin
    ? (nowMin >= startMin && nowMin <= endMin)
    : (nowMin >= startMin || nowMin <= endMin);
  return { schedule, notOperating: !within };
}

function getOptionLabel(options: RouteOption[], idx: number): { text: string; bg: string } {
  const opt = options[idx];
  if (opt.type === "nearest") return { text: "Nearest Route", bg: "#b45309" };
  if (idx === 0) return { text: "Recommended", bg: "#1a4a52" };
  const first = options[0];
  if (opt.total_fare !== null && first.total_fare !== null && opt.total_fare < first.total_fare) {
    return { text: "Cheapest", bg: "#15803d" };
  }
  if (opt.transfers < first.transfers) {
    return { text: "Fewer Transfers", bg: "#1d4ed8" };
  }
  return { text: "Alternative", bg: "#6b7280" };
}

// ── Direction arrows ─────────────────────────────────────────────────────────
// react-native-maps' Polyline has no built-in arrowhead support. Earlier attempts
// used a custom Marker (rotated icon) for this, but Markers are billboarded/
// snapshotted separately from ground overlays like Polyline — on a tilted camera
// (the default on mobile Google Maps) a Marker visibly renders offset from its
// true ground coordinate, so the arrow drifted to the side of the actual line.
// Drawing the arrow as a real geographic Polygon (a small triangle defined by
// actual lat/lng points, exactly like the route Polyline itself) goes through the
// same ground-plane rendering path as the line — no anchor/billboard/rotation
// quirks possible, and since it's sized in real meters it naturally shrinks when
// zoomed out instead of cluttering the map.
function haversineKmLL(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function computeBearing(a: LatLng, b: LatLng): number {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Offsets a point by a real-world distance (meters) along a compass bearing.
function destinationPoint(from: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const R = 6371000;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lng1 = (from.longitude * Math.PI) / 180;
  const angDist = distanceM / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
    Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { latitude: (lat2 * 180) / Math.PI, longitude: (lng2 * 180) / Math.PI };
}

// Arrows are spaced at a fixed distance along the route (not a fixed count), so a
// long route reads as a continuous flow guide rather than a few sparse, easy-to-miss
// points — capped so a very long route doesn't spam the map with triangles.
const ARROW_SPACING_KM = 0.35;
const MIN_ARROWS = 3;
const MAX_ARROWS = 20;
// Bumped up from 10/5 (2026-08-10, on request) — the original size read as
// near-invisible specks at normal zoom regardless of color.
const ARROW_LENGTH_M = 16; // real-world size — shrinks naturally when zoomed out
const ARROW_WIDTH_M  = 8;

// White fill + a dark outline (2026-08-10, on request — the original solid
// black was unreadable, especially against a dark route line or dark map
// area) — the same convention real navigation apps use for direction
// chevrons, since it reads clearly against literally any route color or
// basemap.
const ARROW_FILL_COLOR   = "#FFFFFF";
const ARROW_STROKE_COLOR = "#111827";
const ARROW_STROKE_WIDTH = 1.5;

// A bidirectional route's two arrow sets are pushed sideways off the actual
// route line by this many meters, each to its OWN right relative to its own
// direction of travel — which puts the two sets on physically opposite sides
// of the line (own-right of forward = one side, own-right of the reversed
// traversal = the other side), like two parallel lanes, instead of both
// sets sitting on top of each other pointing opposite ways.
const ARROW_SIDE_OFFSET_M = 7;

function computeArrowTriangles(waypoints: LatLng[], sideOffsetM: number = 0): LatLng[][] {
  if (waypoints.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < waypoints.length; i++) {
    cum.push(cum[i - 1] + haversineKmLL(waypoints[i - 1], waypoints[i]));
  }
  const total = cum[cum.length - 1];
  if (total === 0) return [];

  let count = Math.round(total / ARROW_SPACING_KM);
  count = Math.max(MIN_ARROWS, Math.min(MAX_ARROWS, count));

  const fractions: number[] = [];
  for (let i = 1; i <= count; i++) fractions.push(i / (count + 1));

  return fractions.map(f => {
    const target = total * f;
    let idx = cum.findIndex(c => c >= target);
    if (idx <= 0) idx = 1;
    const segStart = waypoints[idx - 1];
    const segEnd   = waypoints[idx];
    const segLen   = cum[idx] - cum[idx - 1];
    const t        = segLen > 0 ? (target - cum[idx - 1]) / segLen : 0;
    const onLine: LatLng = {
      latitude:  segStart.latitude  + (segEnd.latitude  - segStart.latitude)  * t,
      longitude: segStart.longitude + (segEnd.longitude - segStart.longitude) * t,
    };
    const bearing = computeBearing(segStart, segEnd);
    const center  = sideOffsetM !== 0 ? destinationPoint(onLine, bearing + 90, sideOffsetM) : onLine;
    const tip        = destinationPoint(center, bearing, ARROW_LENGTH_M / 2);
    const backCenter = destinationPoint(center, bearing + 180, ARROW_LENGTH_M / 2);
    const backLeft    = destinationPoint(backCenter, bearing - 90, ARROW_WIDTH_M / 2);
    const backRight   = destinationPoint(backCenter, bearing + 90, ARROW_WIDTH_M / 2);
    return [tip, backLeft, backRight];
  });
}

// Returns one small triangle (3 lat/lng points, tip pointing in the direction of
// travel) per arrow position, ready to feed straight into a <Polygon coordinates=.../>.
// A 'vice_versa' route (a literal back-and-forth shuttle, ridden both
// directions — see route_planner.php) gets a second set of arrows pointing the
// opposite way, each pushed to its own side of the line (see
// ARROW_SIDE_OFFSET_M) so the two sets read as parallel lanes instead of
// overlapping on top of each other.
function getDirectionArrows(waypoints: LatLng[], bidirectional: boolean = false): LatLng[][] {
  if (!bidirectional) return computeArrowTriangles(waypoints);
  const forward  = computeArrowTriangles(waypoints, ARROW_SIDE_OFFSET_M);
  const backward = computeArrowTriangles([...waypoints].reverse(), ARROW_SIDE_OFFSET_M);
  return [...forward, ...backward];
}

export default function CommuterMap() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Route Suggestions list height scales with the screen (300dp on tall phones).
  const panelListH = Math.min(300, Math.round(windowHeight * 0.35));
  const mapRef = useRef<MapView>(null);

  const locationPingRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const driverPollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>  | null>(null);

  const myLocationRef  = useRef<LatLng | null>(null);
  const destinationRef = useRef<LatLng | null>(null);
  const pickupPinRef    = useRef<LatLng | null>(null);

  const [myLocation,      setMyLocation]      = useState<LatLng | null>(null);
  const [destination,     setDestination]     = useState<LatLng | null>(null);
  const [destinationName, setDestinationName] = useState<string>("");
  const [drivers,         setDrivers]         = useState<TrackedDriver[]>([]);
  const [routes,          setRoutes]          = useState<RoutePolyline[]>([]);
  const [terminals,       setTerminals]       = useState<Terminal[]>([]);
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<number>>(new Set());
  const [terminalSheetFor, setTerminalSheetFor] = useState<Terminal | null>(null);
  const [driverSheetFor,   setDriverSheetFor]   = useState<TrackedDriver | null>(null);
  const [driverHours,      setDriverHours]      = useState<JeepneyHours | null>(null);
  const [driverHoursLoading, setDriverHoursLoading] = useState(false);
  const [locationError,   setLocError]        = useState("");
  const [loading,         setLoading]         = useState(true);
  // Drives which recovery action(s) the error screen offers — "Open Settings"
  // only makes sense for permission_denied/services_disabled (an OS-level
  // toggle the app can't fix itself), while a plain "error" (GPS timeout, a
  // transient native failure) just needs a retry.
  const [locStatus, setLocStatus] = useState<
    "checking" | "permission_denied" | "services_disabled" | "error" | "ready"
  >("checking");

  // ── Pickup pin (2026-08-10) — lets a commuter plan a ride from somewhere
  // other than their literal current GPS spot (e.g. still at home, planning
  // ahead for after a tricycle ride to the main road). Same concept as the
  // Home tab's journey planner "Pickup point" pin, now also here so it's
  // visible/usable from the live map. null means "use my current location."
  const [pickupPin,     setPickupPin]     = useState<LatLng | null>(null);
  const [pinMode,       setPinMode]       = useState<"destination" | "pickup">("destination");

  const [routeOptions,       setRouteOptions]       = useState<RouteOption[]>([]);
  const [selectedOptionIdx,  setSelectedOptionIdx]  = useState<number | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Route Suggestions' Jeepney Operating Hours — a route_id -> hours lookup,
  // refetched whenever the option list changes (undefined = not fetched yet,
  // null = no hours published). See Core Flow 8g; purely display, never
  // gates anything.
  const [jeepneyHoursCache, setJeepneyHoursCache] = useState<Record<number, JeepneyHours | null>>({});

  useEffect(() => {
    const ids = new Set<number>();
    routeOptions.forEach(opt => {
      if (isAllJeepneyOption(opt) && opt.segments[0]) ids.add(opt.segments[0].route_id);
    });
    if (ids.size === 0) return;
    let cancelled = false;
    ids.forEach(routeId => {
      fetch(`${API_BASE}/routes/get_jeepney_operating_hours.php?route_id=${routeId}`)
        .then(res => res.json())
        .then(data => {
          if (cancelled) return;
          setJeepneyHoursCache(prev => ({ ...prev, [routeId]: data.success ? data.hours : null }));
        })
        .catch(() => { if (!cancelled) setJeepneyHoursCache(prev => ({ ...prev, [routeId]: null })); });
    });
    return () => { cancelled = true; };
  }, [routeOptions]);

  // Transfer-point proximity alert (2026-08-10) — tracks which transfer
  // stops (keyed by segment index within the CURRENTLY selected option)
  // have already fired a "you're near the transfer point" notice, so the
  // 3s-polled location check below doesn't re-alert every tick while the
  // commuter just sits within range. Reset whenever a different option gets
  // selected, since its transfer points (if any) are entirely different.
  const notifiedTransfersRef = useRef<Set<number>>(new Set());

  const [searchQuery,   setSearchQuery]   = useState("");
  const [predictions,   setPredictions]   = useState<PlacePrediction[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  // ── Load routes + terminals on mount ──────────────────────────────────────
  useEffect(() => {
    fetchAllRoutes();
    fetchTerminals();
  }, []);

  const fetchAllRoutes = async () => {
    try {
      const res  = await fetch(`${API_BASE}/routes/get_all_routes.php`);
      const data = await res.json();
      if (data.success && Array.isArray(data.routes)) {
        setRoutes(data.routes.filter((r: RoutePolyline) => r.waypoints?.length > 1));
      }
    } catch (_) {}
  };

  // Terminal pins are always visible on the map (per design: don't show routes by
  // default, only reveal a route when its terminal pin is tapped).
  const fetchTerminals = async () => {
    try {
      const res  = await fetch(`${API_BASE}/routes/get_terminals.php`);
      const data = await res.json();
      if (data.success && Array.isArray(data.terminals)) setTerminals(data.terminals);
    } catch (_) {}
  };

  const toggleRoute = (routeId: number) => {
    setSelectedRouteIds(prev => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  // ── Location acquisition state machine ────────────────────────────────────
  // Single source of truth for the whole checking → requesting → waiting-for-
  // services → retrieving → ready/error flow, so it can be re-run identically
  // from three places: first focus, the "Try Again" button, and an AppState
  // foreground transition (the actual fix for the "map never recovers after
  // enabling location in Settings" bug — see below).
  const checkAndFetchLocation = useCallback(async () => {
    setLocError("");
    setLocStatus("checking");
    setLoading(true);
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setLocStatus("services_disabled");
        setLocError("Location services are turned off. Please enable them to see the map.");
        return;
      }

      let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        // Only prompts the OS dialog when permission hasn't been decided yet —
        // never re-prompts once the user has already granted it.
        const requested = await Location.requestForegroundPermissionsAsync();
        status       = requested.status;
        canAskAgain  = requested.canAskAgain;
      }
      if (status !== "granted") {
        setLocStatus("permission_denied");
        setLocError(
          canAskAgain === false
            ? "Location permission was denied. Please enable it manually from your device Settings."
            : "Location permission is required to show the map."
        );
        return;
      }

      // getCurrentPositionAsync has no built-in timeout in this expo-location
      // version — race it against a manual one so a stalled GPS fix fails
      // fast into a retryable error instead of hanging on the spinner forever.
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 15000)
        ),
      ]);
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setMyLocation(coords);
      myLocationRef.current = coords;
      setLocStatus("ready");
      setLocError("");
      fetchDriverPositions(coords);
    } catch {
      setLocStatus("error");
      setLocError("Could not get your location. Please check your signal and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial GPS — re-runs on focus so returning to this tab retries ───────
  useFocusEffect(
    useCallback(() => {
      if (myLocationRef.current) return;
      checkAndFetchLocation();
    }, [checkAndFetchLocation])
  );

  // ── Re-check on returning from the OS Settings app ─────────────────────────
  // useFocusEffect above only fires on in-app navigation focus changes — it
  // does NOT fire when the user backgrounds the app to flip a system toggle
  // (enable Location Services / grant the permission) and comes back, since
  // this screen never actually loses React Navigation "focus" during that
  // round trip. AppState is the only signal that actually captures it. Only
  // re-checks while not already "ready", so a foreground transition never
  // re-triggers the permission prompt (or a needless refetch) once location
  // is already working.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && !myLocationRef.current) {
        checkAndFetchLocation();
      }
    });
    return () => sub.remove();
  }, [checkAndFetchLocation]);

  // Fires an in-app alert once per transfer point, the first time the
  // commuter's live location comes within TRANSFER_ALERT_RADIUS_M of it —
  // this app has no push-notification setup (no expo-notifications, no
  // background location), so a foreground Alert while the map is open is the
  // realistic notification mechanism, same convention already used
  // elsewhere in this app (e.g. active-trip.tsx's Alert.alert prompts).
  const TRANSFER_ALERT_RADIUS_M = 50;
  const checkTransferProximity = (coords: LatLng) => {
    const option = selectedOptionRef.current;
    if (!option || option.segments.length < 2) return;
    option.segments.slice(0, -1).forEach((seg, i) => {
      if (notifiedTransfersRef.current.has(i)) return;
      const pt = segAlightPoint(seg);
      if (!pt) return;
      const distM = haversineKmLL(coords, pt) * 1000;
      if (distM <= TRANSFER_ALERT_RADIUS_M) {
        notifiedTransfersRef.current.add(i);
        const nextSeg = option.segments[i + 1];
        Alert.alert(
          "Transfer Point Ahead",
          `You're near the transfer point — get off here and ride the ${nextSeg.route_name} ${nextSeg.vehicle_type ?? "jeepney"} to continue.`,
        );
      }
    });
  };

  // ── GPS ping every 3s ─────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      const startPinging = async () => {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const raw = await AsyncStorage.getItem("user");
        if (!raw) return;
        const u = JSON.parse(raw);
        locationPingRef.current = setInterval(async () => {
          try {
            const loc    = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            setMyLocation(coords);
            myLocationRef.current = coords;
            checkTransferProximity(coords);
            await fetch(`${API_BASE}/commuter/update_commuter_location.php`, {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                commuter_id:     u.id,
                latitude:        loc.coords.latitude,
                longitude:       loc.coords.longitude,
                destination_lat: destinationRef.current?.latitude  ?? null,
                destination_lng: destinationRef.current?.longitude ?? null,
                is_looking:      1,
              }),
            });
          } catch (_) {}
        }, 3000);
      };
      startPinging();
      return () => {
        if (locationPingRef.current) clearInterval(locationPingRef.current);
        AsyncStorage.getItem("user").then(raw => {
          if (!raw) return;
          const u = JSON.parse(raw);
          fetch(`${API_BASE}/commuter/update_commuter_location.php`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commuter_id: u.id, latitude: 0, longitude: 0, is_looking: 0 }),
          }).catch(() => {});
        });
      };
    }, [])
  );

  // ── Driver position poll every 3s (for map markers) ───────────────────────
  // Matches the driver app's own 3s GPS push interval (driver-map.tsx) — this
  // is the fastest the underlying data actually changes, so polling any
  // faster would just re-fetch the same rows. The "keeps moving between
  // polls" feel comes from the dead-reckoning coast below, not from polling
  // faster than the data source itself updates.
  const DRIVER_POLL_MS = 3000;
  useEffect(() => {
    driverPollRef.current = setInterval(() => {
      if (myLocationRef.current) fetchDriverPositions(myLocationRef.current);
    }, DRIVER_POLL_MS);
    return () => { if (driverPollRef.current) clearInterval(driverPollRef.current); };
  }, []);

  // Imperative marker refs + each driver's last-known coordinate, so a new
  // poll result smoothly glides the marker to its new position
  // (Marker.animateMarkerToCoordinate) instead of the coordinate prop just
  // snapping to the new lat/lng on re-render. A driver id no longer present
  // in the latest response (offline, or filtered out server-side by the
  // staleness/radius check) is dropped from every one of these maps so it
  // can't leak stale state into a later poll.
  const driverMarkerRefs   = useRef<Record<number, any>>({});
  const lastDriverCoordRef = useRef<Record<number, LatLng>>({});
  const coastTimerRef      = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // ── Dead-reckoning "coast" ──────────────────────────────────────────────
  // A poll only delivers a real fix every DRIVER_POLL_MS — without this, a
  // jeepney that's actually moving would visibly pause for ~3s after each
  // glide, which doesn't read as "live." Instead, once a poll shows a driver
  // has genuinely moved, keep gliding the marker onward at that same
  // implied speed/bearing for the rest of the poll interval, so it never
  // fully stops — then the next real fix corrects/redirects it, repeating.
  // A driver who hasn't actually moved (stopped at a light, idle at a
  // terminal) is deliberately never coasted — only a real position change
  // between two consecutive polls schedules one.
  const MOVING_THRESHOLD_M = 3;     // ignore GPS jitter smaller than this
  const MAX_JUMP_M         = 500;   // a bigger jump than this in one poll is
                                     // a GPS glitch/reconnect, not real
                                     // travel — snap only, never coast it
  const MAX_SPEED_MPS      = 20;    // ~72 km/h clamp against noisy fixes
  const CORRECTION_MS      = 800;   // glide-to-real-fix duration

  const fetchDriverPositions = async (coords: LatLng) => {
    try {
      const res  = await fetch(
        `${API_BASE}/commuter/nearby_drivers.php?lat=${coords.latitude}&lng=${coords.longitude}&limit=20`
      );
      const data = await res.json();
      if (!Array.isArray(data)) return;

      setDrivers(data);

      const seenIds = new Set<number>();
      (data as TrackedDriver[]).forEach(d => {
        seenIds.add(d.id);
        const next = { latitude: d.latitude, longitude: d.longitude };
        const prev = lastDriverCoordRef.current[d.id];
        const ref  = driverMarkerRefs.current[d.id];

        // Any previously-scheduled coast for this driver is now stale —
        // this real fix always takes precedence.
        if (coastTimerRef.current[d.id]) {
          clearTimeout(coastTimerRef.current[d.id]);
          delete coastTimerRef.current[d.id];
        }

        if (ref && prev && (prev.latitude !== next.latitude || prev.longitude !== next.longitude)) {
          ref.animateMarkerToCoordinate(next, CORRECTION_MS);

          const distanceM = haversineKmLL(prev, next) * 1000;
          if (distanceM > MOVING_THRESHOLD_M && distanceM <= MAX_JUMP_M) {
            const bearing   = computeBearing(prev, next);
            const speedMps  = Math.min(distanceM / (DRIVER_POLL_MS / 1000), MAX_SPEED_MPS);
            const coastMs   = DRIVER_POLL_MS - CORRECTION_MS;
            const coastDist = speedMps * (coastMs / 1000);
            const projected = destinationPoint(next, bearing, coastDist);

            coastTimerRef.current[d.id] = setTimeout(() => {
              const liveRef = driverMarkerRefs.current[d.id];
              if (liveRef) liveRef.animateMarkerToCoordinate(projected, coastMs);
              delete coastTimerRef.current[d.id];
            }, CORRECTION_MS);
          }
        }
        lastDriverCoordRef.current[d.id] = next;
      });
      Object.keys(driverMarkerRefs.current).forEach(idStr => {
        const id = Number(idStr);
        if (!seenIds.has(id)) {
          if (coastTimerRef.current[id]) clearTimeout(coastTimerRef.current[id]);
          delete coastTimerRef.current[id];
          delete driverMarkerRefs.current[id];
          delete lastDriverCoordRef.current[id];
        }
      });
    } catch (_) {}
  };

  // Cancel every in-flight coast animation on unmount — a marker mid-coast
  // holds no re-render-driven cleanup otherwise, since it's purely imperative.
  useEffect(() => {
    return () => {
      Object.values(coastTimerRef.current).forEach(clearTimeout);
    };
  }, []);

  // Tapping a jeepney marker shows its route's association-published
  // operating hours, purely informational — see Core Flow 8 (Jeepney
  // Operating Hours). Fetched fresh per tap since drivers/routes can change.
  const openDriverSheet = (driver: TrackedDriver) => {
    setDriverSheetFor(driver);
    setDriverHours(null);
    if (!driver.route_id) return;
    setDriverHoursLoading(true);
    fetch(`${API_BASE}/routes/get_jeepney_operating_hours.php?route_id=${driver.route_id}`)
      .then(res => res.json())
      .then(data => setDriverHours(data.success ? data.hours : null))
      .catch(() => setDriverHours(null))
      .finally(() => setDriverHoursLoading(false));
  };

  // ── Route suggestions ─────────────────────────────────────────────────────
  const fetchRouteSuggestions = async (origin: LatLng, dest: LatLng) => {
    setSuggestionsLoading(true);
    setRouteOptions([]);
    setSelectedOptionIdx(null);
    try {
      const url = `${API_BASE}/routes/route_planner.php`
        + `?orig_lat=${origin.latitude}&orig_lng=${origin.longitude}`
        + `&dest_lat=${dest.latitude}&dest_lng=${dest.longitude}`
        + `&destination=pin`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.success && Array.isArray(data.options) && data.options.length > 0) {
        const opts = data.options.slice(0, 3) as RouteOption[];
        setRouteOptions(opts);
        setSelectedOptionIdx(0);
        fitMapToOption(opts[0], origin, dest);
      }
    } catch (_) {}
    finally { setSuggestionsLoading(false); }
  };

  const fitMapToOption = (option: RouteOption, origin?: LatLng | null, dest?: LatLng | null) => {
    if (!mapRef.current) return;
    const coords: LatLng[] = [];
    if (origin) coords.push(origin);
    if (dest)   coords.push(dest);
    option.segments.forEach(seg => {
      if (seg.waypoints?.length) {
        coords.push(seg.waypoints[0]);
        coords.push(seg.waypoints[seg.waypoints.length - 1]);
      }
    });
    if (coords.length < 2) return;
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 24, bottom: panelListH + 60, left: 24 },
      animated: true,
    });
  };

  // ── Incoming journey suggestion from the Home tab's journey planner ───────
  const params = useLocalSearchParams<{ journeyOption?: string }>();
  useEffect(() => {
    if (!params.journeyOption) return;
    try {
      const opt: RouteOption = JSON.parse(params.journeyOption as string);
      setRouteOptions([opt]);
      setSelectedOptionIdx(0);
      setSelectedRouteIds(new Set(opt.segments.map(s => s.route_id)));
      setTimeout(() => fitMapToOption(opt, myLocationRef.current), 400);
    } catch (_) {}
  }, [params.journeyOption]);

  const handleSelectOption = (idx: number) => {
    setSelectedOptionIdx(idx);
    const option = routeOptions[idx];
    if (!option || !myLocation || !destination) return;
    fitMapToOption(option, myLocation, destination);
  };

  // ── Search ────────────────────────────────────────────────────────────────
  const fetchPredictions = async (text: string) => {
    if (text.length < 3) { setPredictions([]); return; }
    setSearchLoading(true);
    try {
      const location = myLocationRef.current
        ? `${myLocationRef.current.latitude},${myLocationRef.current.longitude}`
        : "15.15,120.59";
      const url =
        `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
        `?input=${encodeURIComponent(text)}&location=${location}&radius=30000&key=${GOOGLE_API_KEY}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.predictions) {
        setPredictions(data.predictions.map((p: any) => ({
          place_id: p.place_id, description: p.description,
        })));
      }
    } catch (_) {}
    finally { setSearchLoading(false); }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => fetchPredictions(text), 350);
  };

  const handleSelectPrediction = async (prediction: PlacePrediction) => {
    Keyboard.dismiss();
    setSearchQuery(prediction.description);
    setPredictions([]);
    setSearchFocused(false);
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${prediction.place_id}&fields=geometry&key=${GOOGLE_API_KEY}`;
      const res  = await fetch(url);
      const data = await res.json();
      const loc  = data.result?.geometry?.location;
      if (!loc) return;
      pinDestination({ latitude: loc.lat, longitude: loc.lng }, prediction.description);
    } catch (_) {}
  };

  // Wherever route planning should measure "from" — the manually-pinned
  // pickup point if one is set, otherwise the device's live GPS location.
  const getEffectiveOrigin = (): LatLng | null => pickupPinRef.current ?? myLocationRef.current;

  const pinDestination = (coords: LatLng, label?: string) => {
    setDestination(coords);
    destinationRef.current = coords;
    if (label !== undefined) setDestinationName(label);
    setRouteOptions([]);
    setSelectedOptionIdx(null);
    AsyncStorage.setItem("destination", JSON.stringify(coords));

    const origin = getEffectiveOrigin();
    if (origin) {
      fetchAllRoutes();
      fetchRouteSuggestions(origin, coords);
    }
  };

  const clearDestination = () => {
    setDestination(null);
    destinationRef.current = null;
    setDestinationName("");
    setSearchQuery("");
    setRouteOptions([]);
    setSelectedOptionIdx(null);
    AsyncStorage.removeItem("destination");
  };

  // Sets (or clears) the pickup pin and, if a destination is already picked,
  // immediately re-plans the trip from the new pickup point.
  const pinPickup = (coords: LatLng | null) => {
    setPickupPin(coords);
    pickupPinRef.current = coords;
    setPinMode("destination");
    if (destinationRef.current) {
      const origin = coords ?? myLocationRef.current;
      if (origin) fetchRouteSuggestions(origin, destinationRef.current);
    }
  };

  const handleMapPress = (e: any) => {
    if (searchFocused) {
      Keyboard.dismiss();
      setPredictions([]);
      setSearchFocused(false);
      return;
    }
    if (pinMode === "pickup") {
      pinPickup(e.nativeEvent.coordinate as LatLng);
      return;
    }
    pinDestination(e.nativeEvent.coordinate as LatLng, "");
  };

  const centerOnMe = () => {
    if (!myLocation || !mapRef.current) return;
    mapRef.current.animateToRegion({ ...myLocation, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
  };

  // Tapping a terminal should focus on just that terminal — any routes left
  // drawn from a previously-tapped terminal's "Show on map" toggles must not
  // linger (selectedRouteIds was purely additive across terminals before this),
  // and the map should zoom to the tapped terminal so it's unambiguous which
  // one is in focus. The sheet's own per-route "Show on map" toggle still
  // works exactly as before once it's open — this only clears the slate and
  // centers the map on tap, it doesn't auto-select any route.
  const handleTerminalPress = (t: Terminal) => {
    setSelectedRouteIds(new Set());
    setTerminalSheetFor(t);
    mapRef.current?.animateToRegion(
      { latitude: t.latitude, longitude: t.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      400
    );
  };

  // ── Derived display values ────────────────────────────────────────────────
  const selectedOption = selectedOptionIdx !== null ? routeOptions[selectedOptionIdx] : null;
  const optionRouteIds = new Set(selectedOption?.segments.map(s => s.route_id) ?? []);

  // Mirrors selectedOption into a ref (same reason myLocationRef/destinationRef
  // exist — the 3s location-poll interval below is set up once and would
  // otherwise only ever see whatever option was selected at that moment) and
  // clears the "already notified" set for a freshly selected option, since
  // its transfer points are unrelated to whichever option was picked before.
  const selectedOptionRef = useRef<RouteOption | null>(null);
  useEffect(() => {
    selectedOptionRef.current = selectedOption;
    notifiedTransfersRef.current = new Set();
  }, [selectedOption]);

  const destBadgeText = () => {
    const name = destinationName || "Destination pinned";
    if (selectedOption) {
      const parts = [];
      if (selectedOption.total_km)   parts.push(`${selectedOption.total_km} km`);
      if (selectedOption.total_mins) parts.push(`~${selectedOption.total_mins} min`);
      return `${name}  ·  ${parts.join(" · ")}`;
    }
    return name;
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    const checkingMsg =
      locStatus === "services_disabled" ? "Waiting for location services…"
      : "Checking location and getting your position…";
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color="#1a4a52" size="large" />
        <Text style={styles.loadingText}>{checkingMsg}</Text>
      </View>
    );
  }
  if (locationError) {
    return (
      <View style={styles.loadingWrap}>
        <Ionicons name="location-outline" size={40} color="#dc2626" />
        <Text style={styles.errorText}>{locationError}</Text>
        <View style={styles.errorActionsRow}>
          <TouchableOpacity style={styles.settingsBtn} onPress={checkAndFetchLocation}>
            <Text style={styles.settingsBtnText}>Try Again</Text>
          </TouchableOpacity>
          {(locStatus === "permission_denied" || locStatus === "services_disabled") && (
            <TouchableOpacity
              style={[styles.settingsBtn, styles.settingsBtnOutline]}
              onPress={() => Linking.openSettings()}
            >
              <Text style={[styles.settingsBtnText, styles.settingsBtnOutlineText]}>Open Settings</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>

      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={{
          latitude:      myLocation?.latitude  ?? 15.1450,
          longitude:     myLocation?.longitude ?? 120.5960,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        showsUserLocation
        showsMyLocationButton={false}
        onPress={handleMapPress}
      >
        {/* Routes are hidden by default — only shown once toggled on from a terminal's
            detail sheet, or automatically for a journey suggestion's segments (drawn
            as full/static lines below, not truncated at the alight point). */}
        {routes.map(route => {
          if (optionRouteIds.has(route.id)) return null; // drawn as a full route below
          if (!selectedRouteIds.has(route.id)) return null;
          return (
            <Fragment key={`route-${route.id}`}>
              <Polyline
                coordinates={route.waypoints}
                strokeColor={route.color}
                strokeWidth={4}
              />
              {getDirectionArrows(route.waypoints, route.direction_type === "vice_versa").map((triangle, i) => (
                <Polygon
                  key={`arrow-${route.id}-${i}`}
                  coordinates={triangle}
                  fillColor={ARROW_FILL_COLOR}
                  strokeColor={ARROW_STROKE_COLOR}
                  strokeWidth={ARROW_STROKE_WIDTH}
                  zIndex={4}
                />
              ))}
            </Fragment>
          );
        })}

        {/* Terminal pins — always visible; tap opens a detail sheet listing every
            route at that terminal (a terminal can host more than one). */}
        {terminals.map(t => {
          const isActive = t.routes.some(r => selectedRouteIds.has(r.route_id) || optionRouteIds.has(r.route_id));
          return (
            <Marker
              key={`terminal-${t.terminal_id}`}
              coordinate={{ latitude: t.latitude, longitude: t.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              onPress={() => handleTerminalPress(t)}
              title={t.terminal_name}
              description={t.routes.map(r => r.route_name).join(", ")}
            >
              <View style={[styles.terminalMarker, isActive && { backgroundColor: t.routes[0]?.color ?? "#1a4a52" }]}>
                <Ionicons name="flag" size={13} color="#fff" />
              </View>
            </Marker>
          );
        })}

        {/* Selected option: full/static route lines (not truncated at the alight
            point — the actual "get off" moment is handled by a live proximity alert
            during the ride instead, not by where the planning line stops). */}
        {selectedOption?.segments.map((seg, i) => {
          const fullRoute = routes.find(r => r.id === seg.route_id);
          const coords = (fullRoute?.waypoints?.length ?? 0) > 1 ? fullRoute!.waypoints : seg.waypoints;
          if (!(coords?.length > 1)) return null;
          return (
            <Fragment key={`sel-seg-${i}`}>
              <Polyline
                coordinates={coords}
                strokeColor={seg.color}
                strokeWidth={6}
                zIndex={5}
              />
              {getDirectionArrows(coords, seg.direction_type === "vice_versa").map((triangle, ai) => (
                <Polygon
                  key={`sel-arrow-${i}-${ai}`}
                  coordinates={triangle}
                  fillColor={ARROW_FILL_COLOR}
                  strokeColor={ARROW_STROKE_COLOR}
                  strokeWidth={ARROW_STROKE_WIDTH}
                  zIndex={6}
                />
              ))}
            </Fragment>
          );
        })}

        {/* Transfer walk dashed lines between segments */}
        {selectedOption && selectedOption.segments.length > 1 &&
          selectedOption.segments.slice(0, -1).map((seg, i) => {
            const alightPt = segAlightPoint(seg);
            const boardPt  = segBoardPoint(selectedOption.segments[i + 1]);
            if (!alightPt || !boardPt) return null;
            return (
              <Polyline
                key={`walk-${i}`}
                coordinates={[alightPt, boardPt]}
                strokeColor="#f59e0b"
                strokeWidth={2}
                lineDashPattern={[4, 4]}
                zIndex={6}
              />
            );
          })
        }

        {/* Destination pin */}
        {destination && (
          <Marker
            coordinate={destination}
            draggable
            onDragEnd={(e) => pinDestination(e.nativeEvent.coordinate, "")}
            title={destinationName || "Destination"}
            pinColor="#1a4a52"
          />
        )}

        {/* Pickup pin — distinct color/icon from the destination pin so the
            two are never confused at a glance. */}
        {pickupPin && (
          <Marker
            coordinate={pickupPin}
            draggable
            onDragEnd={(e) => pinPickup(e.nativeEvent.coordinate)}
            title="Pickup Point"
            description="Where you'll catch a jeepney from"
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.pickupMarker}>
              <Ionicons name="walk" size={14} color="#fff" />
            </View>
          </Marker>
        )}

        {/* Transfer point markers — where the commuter needs to get off and
            switch jeepneys for the currently selected multi-leg option. */}
        {selectedOption && selectedOption.segments.length > 1 &&
          selectedOption.segments.slice(0, -1).map((seg, i) => {
            const alightPt = segAlightPoint(seg);
            if (!alightPt) return null;
            const nextSeg = selectedOption.segments[i + 1];
            return (
              <Marker
                key={`transfer-${i}`}
                coordinate={alightPt}
                anchor={{ x: 0.5, y: 1 }}
                title={`Transfer here`}
                description={`Get off and ride the ${nextSeg.route_name} ${nextSeg.vehicle_type ?? "jeepney"}`}
                zIndex={7}
              >
                <View style={styles.transferMarker}>
                  <Ionicons name="swap-horizontal" size={14} color="#fff" />
                </View>
              </Marker>
            );
          })
        }

        {/* Driver position markers — tap to see the driver's route + its
            association-published operating hours (informational only). */}
        {drivers.filter(driver => driver.latitude != null && driver.longitude != null).map(driver => (
          <Marker
            key={driver.id}
            ref={(r) => { if (r) driverMarkerRefs.current[driver.id] = r; }}
            coordinate={{ latitude: driver.latitude, longitude: driver.longitude }}
            onPress={() => openDriverSheet(driver)}
          >
            <View style={[
              styles.driverMarker,
              driver.is_full ? styles.driverMarkerFull : null,
              driver.dispatch_status === "dispatched" && styles.driverMarkerDispatched,
            ]}>
              <Ionicons
                name="bus"
                size={16}
                color={driver.is_full ? "#dc2626" : driver.dispatch_status === "dispatched" ? "#1d4ed8" : "#16a34a"}
              />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* ── SEARCH BAR ──────────────────────────────────────────────────── */}
      <View style={[styles.searchContainer, { top: insets.top + 12 }]}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color="#9ca3af" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search destination…"
            placeholderTextColor="#9ca3af"
            value={searchQuery}
            onChangeText={handleSearchChange}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            returnKeyType="search"
          />
          {searchLoading && (
            <ActivityIndicator size="small" color="#1a4a52" style={{ marginRight: 8 }} />
          )}
          {(searchQuery.length > 0 || destination) && !searchLoading && (
            <TouchableOpacity onPress={clearDestination} style={styles.clearBtn} accessibilityLabel="Clear search">
              <Ionicons name="close" size={16} color="#9ca3af" />
            </TouchableOpacity>
          )}
        </View>

        {destination && !searchFocused && (
          <View style={styles.destBadge}>
            <Ionicons name="location" size={12} color="#a8d832" />
            <Text style={styles.destBadgeText} numberOfLines={2}>{destBadgeText()}</Text>
          </View>
        )}

        {pinMode === "pickup" ? (
          <View style={[styles.tipBox, styles.tipBoxActive]}>
            <Ionicons name="walk-outline" size={13} color="#1a4a52" />
            <Text style={[styles.tipText, { color: "#1a4a52", fontWeight: "700" }]}>
              Tap the map to place your pickup point
            </Text>
          </View>
        ) : !destination && !searchFocused && (
          <View style={styles.tipBox}>
            <Ionicons name="information-circle-outline" size={13} color="#6b7280" />
            <Text style={styles.tipText}>Search or tap map to set destination</Text>
          </View>
        )}

        {searchFocused && predictions.length > 0 && (
          <View style={styles.predictionsBox}>
            <FlatList
              data={predictions}
              keyExtractor={item => item.place_id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  style={[
                    styles.predictionItem,
                    index < predictions.length - 1 && styles.predictionItemBorder,
                  ]}
                  onPress={() => handleSelectPrediction(item)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="location-outline" size={14} color="#9ca3af" />
                  <Text style={styles.predictionText} numberOfLines={2}>{item.description}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </View>

      {/* ── FABs ────────────────────────────────────────────────────────── */}
      <View style={[styles.fabCol, { bottom: panelListH + 20 }]}>
        <TouchableOpacity style={styles.fabLocate} onPress={centerOnMe} activeOpacity={0.85}>
          <Ionicons name="locate" size={18} color="#1a4a52" />
          <Text style={styles.fabLocateText}>My Location</Text>
        </TouchableOpacity>
        {/* Pickup pin — lets a commuter plan a trip from somewhere other than
            their live GPS spot (e.g. still at home, before a tricycle ride to
            the main road). Three states: not set (tap arms pickup mode, then
            tap the map) -> armed (highlighted, waiting for a map tap) -> set
            (tap to clear and fall back to GPS). */}
        <TouchableOpacity
          style={[
            styles.fabLocate,
            pinMode === "pickup" && styles.fabPickupArmed,
            pickupPin && styles.fabPickupSet,
          ]}
          onPress={() => {
            if (pickupPin) { pinPickup(null); return; }
            setPinMode(m => (m === "pickup" ? "destination" : "pickup"));
          }}
          activeOpacity={0.85}
        >
          <Ionicons
            name={pickupPin ? "close-circle" : "walk-outline"}
            size={18}
            color={pickupPin ? "#dc2626" : pinMode === "pickup" ? "#fff" : "#1a4a52"}
          />
          <Text style={[styles.fabLocateText, pinMode === "pickup" && { color: "#fff" }, pickupPin && { color: "#dc2626" }]}>
            {pickupPin ? "Clear Pickup" : pinMode === "pickup" ? "Tap Map to Pin" : "Pin Pickup"}
          </Text>
        </TouchableOpacity>
        {selectedRouteIds.size > 0 && (
          <TouchableOpacity
            style={[styles.fab, styles.fabActive]}
            onPress={() => setSelectedRouteIds(new Set())}
            activeOpacity={0.85}
            accessibilityLabel="Clear route filter"
          >
            <Ionicons name="map" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* ── ROUTE SUGGESTIONS PANEL ─────────────────────────────────────── */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.bottomPanelHeader}>
          <View style={styles.bottomPanelTitleRow}>
            <Ionicons name="navigate-circle-outline" size={16} color="#1a4a52" />
            <Text style={styles.bottomPanelTitle}>Route Suggestions</Text>
          </View>
          {suggestionsLoading
            ? <ActivityIndicator size="small" color="#1a4a52" />
            : routeOptions.length > 0
              ? <Text style={styles.bottomPanelSub}>{routeOptions.length} option{routeOptions.length > 1 ? "s" : ""}</Text>
              : null
          }
        </View>

        {!destination && routeOptions.length === 0 ? (
          <Text style={styles.emptyText}>Search or tap the map to set your destination</Text>
        ) : suggestionsLoading ? (
          <Text style={styles.emptyText}>Finding best routes…</Text>
        ) : routeOptions.length === 0 ? (
          <Text style={styles.emptyText}>No registered routes found for this destination</Text>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: panelListH }}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 4 }}
          >
            {routeOptions.map((opt, idx) => {
              const label    = getOptionLabel(routeOptions, idx);
              const isActive = idx === selectedOptionIdx;
              return (
                <TouchableOpacity
                  key={idx}
                  style={[styles.optionCard, isActive && styles.optionCardActive]}
                  onPress={() => handleSelectOption(idx)}
                  activeOpacity={0.85}
                >
                  <View style={{ flexDirection: "row" }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      {/* Card header */}
                      <View style={styles.optionCardHeader}>
                        <View style={[styles.optionBadge, { backgroundColor: label.bg }]}>
                          <Text style={styles.optionBadgeText}>{label.text}</Text>
                        </View>
                        <View style={styles.optionMetaRow}>
                          {opt.total_mins != null && (
                            <Text style={styles.optionMetaTime}>~{opt.total_mins} min</Text>
                          )}
                          {opt.total_fare != null && (
                            <Text style={styles.optionMetaFare}>₱{opt.total_fare.toFixed(2)}</Text>
                          )}
                        </View>
                        {/* Jeepney options show operating hours instead of driver
                            availability — commuters never see driver-status info
                            for Jeepney (Core Flow 8g). Bus/UV options are unaffected. */}
                        {!isAllJeepneyOption(opt) && !opt.has_active_drivers && (
                          <View style={styles.noDriversBadge}>
                            <Ionicons name="warning-outline" size={10} color="#b45309" />
                            <Text style={styles.noDriversBadgeText}>No drivers</Text>
                          </View>
                        )}
                      </View>

                      {/* Segments */}
                      {opt.segments.map((seg, si) => (
                        <View key={si}>
                          <View style={styles.segRow}>
                            <View style={[styles.segIcon, { backgroundColor: vehicleColor(seg.vehicle_type) + "20" }]}>
                              <Ionicons
                                name={vehicleIconName(seg.vehicle_type)}
                                size={13}
                                color={vehicleColor(seg.vehicle_type)}
                              />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[styles.segVehicle, { color: vehicleColor(seg.vehicle_type) }]}>
                                {seg.vehicle_type ?? "Jeepney"}
                              </Text>
                              <Text style={styles.segRoute} numberOfLines={1}>
                                {seg.board_at} → {seg.alight_at}
                              </Text>
                            </View>
                            {seg.km != null && (
                              <Text style={styles.segKm}>{seg.km} km</Text>
                            )}
                          </View>

                          {seg.board_side_hint === "cross" && (
                            <View style={styles.transferRow}>
                              <Ionicons name="walk-outline" size={11} color="#b45309" />
                              <Text style={[styles.transferText, { color: "#b45309", fontWeight: "700" }]}>
                                {seg.board_side_note || "Cross to the other side of the road to board this jeepney."}
                              </Text>
                            </View>
                          )}
                          {si < opt.segments.length - 1 && (
                            <View style={styles.transferRow}>
                              <Ionicons name="walk-outline" size={11} color="#9ca3af" />
                              <Text style={styles.transferText}>
                                {/* This segment's own alight point IS the transfer location —
                                    not opt.transfer_point, which only ever holds the FIRST
                                    transfer and is wrong for a 2+-transfer journey. */}
                                Transfer at {seg.alight_at || "stop"}
                              </Text>
                            </View>
                          )}
                        </View>
                      ))}

                      {/* Walk-to-destination notice — shown for any option type, since a
                          "direct"/"transfer" match can still land up to ~1.5km from the
                          actual destination, not just the 'nearest' fallback. */}
                      {opt.walk_to_dest_m != null && opt.walk_to_dest_m > 50 && (
                        <View style={styles.walkNotice}>
                          <Ionicons name="walk" size={12} color="#92400e" />
                          <Text style={styles.walkNoticeText}>
                            Walk ~{opt.walk_to_dest_m >= 1000
                              ? `${(opt.walk_to_dest_m / 1000).toFixed(1)} km`
                              : `${opt.walk_to_dest_m} m`} from the {opt.type === "nearest" ? "nearest stop" : "drop-off point"} to your destination
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Jeepney Operating Hours — right column, purely
                        informational (Core Flow 8g). Never derived from
                        driver presence/has_active_drivers. */}
                    {isAllJeepneyOption(opt) && (() => {
                      const info = describeJeepneyHours(jeepneyHoursCache[opt.segments[0].route_id]);
                      if (!info) return null;
                      return (
                        <View style={styles.jeepneyHoursCol}>
                          {info.notOperating && (
                            <View style={styles.notOperatingPill}>
                              <Text style={styles.notOperatingPillText}>Currently not operating</Text>
                            </View>
                          )}
                          <View style={styles.jeepneyHoursIconRow}>
                            <View style={styles.jeepneyHoursIconWrap}>
                              <Ionicons name="time-outline" size={12} color="#16a34a" />
                            </View>
                            <Text style={styles.jeepneyHoursLabel}>Operating Hours</Text>
                          </View>
                          <Text style={styles.jeepneyHoursSchedule}>{info.schedule}</Text>
                        </View>
                      );
                    })()}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* ── TERMINAL DETAIL SHEET ─────────────────────────────────────────── */}
      <Modal
        visible={!!terminalSheetFor}
        transparent
        animationType="slide"
        onRequestClose={() => setTerminalSheetFor(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            {terminalSheetFor && (
              <>
                <View style={styles.terminalSheetHeader}>
                  <View style={styles.terminalSheetIcon}>
                    <Ionicons name="flag" size={16} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.terminalSheetTitle}>{terminalSheetFor.terminal_name}</Text>
                    {!!terminalSheetFor.vehicle_type && (
                      <Text style={styles.terminalSheetSub}>{terminalSheetFor.vehicle_type} terminal</Text>
                    )}
                  </View>
                </View>

                <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                  {terminalSheetFor.routes.map(r => {
                    const shown = selectedRouteIds.has(r.route_id) || optionRouteIds.has(r.route_id);
                    return (
                      <View key={r.route_id} style={styles.terminalRouteCard}>
                        <View style={styles.terminalRouteHeader}>
                          <View style={[styles.routeColorDot, { backgroundColor: r.color }]} />
                          <Text style={styles.terminalRouteName} numberOfLines={1}>{r.route_name}</Text>
                          {!!r.vehicle_type && (
                            <View style={[styles.vtBadge, { backgroundColor: vehicleColor(r.vehicle_type) + "20" }]}>
                              <Text style={[styles.vtBadgeText, { color: vehicleColor(r.vehicle_type) }]}>{r.vehicle_type}</Text>
                            </View>
                          )}
                        </View>
                        {!!r.description && (
                          <Text style={styles.terminalRouteDesc}>{r.description}</Text>
                        )}
                        {r.stopovers.length > 0 && (
                          <View style={styles.stopoverRow}>
                            <Ionicons name="git-branch-outline" size={11} color="#9ca3af" />
                            <Text style={styles.stopoverText}>
                              Stops via: {r.stopovers.map(s => s.terminal_name).join(", ")}
                            </Text>
                          </View>
                        )}
                        <TouchableOpacity
                          style={[styles.showToggle, shown && styles.showToggleActive]}
                          onPress={() => toggleRoute(r.route_id)}
                        >
                          <Ionicons name={shown ? "eye" : "eye-outline"} size={14} color={shown ? "#fff" : "#1a4a52"} />
                          <Text style={[styles.showToggleText, shown && { color: "#fff" }]}>
                            {shown ? "Showing on map" : "Show on map"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>

                <TouchableOpacity style={styles.modalCancel} onPress={() => setTerminalSheetFor(null)}>
                  <Text style={styles.modalCancelText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── JEEPNEY DRIVER DETAIL SHEET ──────────────────────────────────────
          Purely informational — route + its association-published operating
          hours, if any. Nothing here affects boarding (Jeepney fares stay
          cash, off-app). */}
      <Modal
        visible={!!driverSheetFor}
        transparent
        animationType="slide"
        onRequestClose={() => setDriverSheetFor(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHandle} />
            {driverSheetFor && (
              <>
                <View style={styles.terminalSheetHeader}>
                  <View style={[styles.terminalSheetIcon, { backgroundColor: "#16a34a" }]}>
                    <Ionicons name="bus" size={16} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.terminalSheetTitle}>{driverSheetFor.name}</Text>
                    <Text style={styles.terminalSheetSub}>
                      {driverSheetFor.operator_name ? `${driverSheetFor.operator_name} · ` : ""}
                      {driverSheetFor.route_name ?? "No route assigned yet"}
                    </Text>
                  </View>
                </View>

                {/* Vehicle info — plate/vehicle number, capacity, current trip
                    status, last GPS update. Never shows driver phone/email or
                    any passenger-identifying data, only fleet/dispatch facts
                    already visible elsewhere in the app (Do Not Break: no
                    unnecessary personal info exposed here). */}
                <View style={styles.terminalRouteCard}>
                  <View style={styles.terminalRouteHeader}>
                    <Ionicons name="bus-outline" size={14} color="#1a4a52" />
                    <Text style={styles.terminalRouteName}>Vehicle Info</Text>
                  </View>
                  <View style={styles.vehicleInfoGrid}>
                    <View style={styles.vehicleInfoItem}>
                      <Text style={styles.vehicleInfoLabel}>Plate Number</Text>
                      <Text style={styles.vehicleInfoValue}>{driverSheetFor.plate_number || "—"}</Text>
                    </View>
                    <View style={styles.vehicleInfoItem}>
                      <Text style={styles.vehicleInfoLabel}>Vehicle No.</Text>
                      <Text style={styles.vehicleInfoValue}>{driverSheetFor.vehicle_number || "—"}</Text>
                    </View>
                    <View style={styles.vehicleInfoItem}>
                      <Text style={styles.vehicleInfoLabel}>Capacity</Text>
                      <Text style={styles.vehicleInfoValue}>{driverSheetFor.capacity ?? "—"}</Text>
                    </View>
                    <View style={styles.vehicleInfoItem}>
                      <Text style={styles.vehicleInfoLabel}>Trip Status</Text>
                      <Text style={styles.vehicleInfoValue}>{dispatchStatusLabel(driverSheetFor.dispatch_status)}</Text>
                    </View>
                  </View>
                  <View style={styles.lastUpdatedRow}>
                    <Ionicons name="refresh-outline" size={11} color="#9ca3af" />
                    <Text style={styles.lastUpdatedText}>
                      Last updated {timeAgo(driverSheetFor.location_updated_at)}
                    </Text>
                  </View>
                </View>

                <View style={styles.terminalRouteCard}>
                  <View style={styles.terminalRouteHeader}>
                    <Ionicons name="time-outline" size={14} color="#16a34a" />
                    <Text style={styles.terminalRouteName}>Operating Hours</Text>
                  </View>
                  {!driverSheetFor.route_id ? (
                    <Text style={styles.terminalRouteDesc}>This jeepney has no assigned route yet.</Text>
                  ) : driverHoursLoading ? (
                    <ActivityIndicator size="small" color="#16a34a" style={{ marginTop: 10 }} />
                  ) : driverHours ? (
                    <Text style={[styles.terminalRouteDesc, { fontSize: 14, fontWeight: "800", color: "#1a4a52", marginTop: 8 }]}>
                      {formatTime12h(driverHours.start_time)} – {formatTime12h(driverHours.end_time)}
                      {driverHours.end_time < driverHours.start_time ? " (+1 day)" : ""}
                    </Text>
                  ) : (
                    <Text style={styles.terminalRouteDesc}>No operating hours published for this route yet.</Text>
                  )}
                </View>

                <TouchableOpacity style={styles.modalCancel} onPress={() => setDriverSheetFor(null)}>
                  <Text style={styles.modalCancelText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f9fafb" },
  loadingText: { fontSize: 14, color: "#6b7280" },
  errorText:   { fontSize: 14, color: "#dc2626", textAlign: "center", paddingHorizontal: 32 },
  errorActionsRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  settingsBtn: { backgroundColor: "#1a4a52", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  settingsBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" as const },
  settingsBtnOutline: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#1a4a52" },
  settingsBtnOutlineText: { color: "#1a4a52" },
  map:         { ...StyleSheet.absoluteFillObject },

  searchContainer: { position: "absolute", left: 16, right: 16, zIndex: 15 },
  searchBar: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: "#000", shadowOpacity: 0.10, shadowRadius: 8, elevation: 5,
  },
  searchInput:     { flex: 1, fontSize: 14, color: "#111827", padding: 0 },
  clearBtn:        { paddingHorizontal: 6, paddingVertical: 2 },
  destBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(26,74,82,0.9)", borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6, marginTop: 6,
    alignSelf: "center", maxWidth: "100%",
  },
  destBadgeText:  { fontSize: 12, color: "#fff", fontWeight: "600", flexShrink: 1 },
  tipBox: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 7, marginTop: 6, alignSelf: "center",
  },
  tipText:         { fontSize: 12, color: "#374151", fontWeight: "600" },
  tipBoxActive:    { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#1a4a52" },
  predictionsBox: {
    backgroundColor: "#fff", borderRadius: 14, marginTop: 6, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.10, shadowRadius: 10, elevation: 6, maxHeight: 260,
  },
  predictionItem:       { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  predictionItemBorder: { borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  predictionText:       { flex: 1, fontSize: 13, color: "#374151" },

  fabCol: { position: "absolute", right: 16, bottom: 320, gap: 10, alignItems: "flex-end" },
  fab: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  fabLocate: {
    flexDirection: "row", alignItems: "center", gap: 6, minHeight: 46, borderRadius: 23,
    paddingHorizontal: 16, backgroundColor: "#fff", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  fabLocateText: { fontSize: 13, fontWeight: "800", color: "#1a4a52" },
  fabActive: { backgroundColor: "#1a4a52" },
  fabPickupArmed: { backgroundColor: "#1a4a52" },
  fabPickupSet:   { borderWidth: 1.5, borderColor: "#dc2626" },

  driverMarker: {
    backgroundColor: "#fff", borderRadius: 18, padding: 5,
    borderWidth: 2, borderColor: "#16a34a",
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  driverMarkerFull: { borderColor: "#dc2626" },
  driverMarkerDispatched: { borderColor: "#1d4ed8" },

  vehicleInfoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  vehicleInfoItem: { minWidth: "40%" },
  vehicleInfoLabel: { fontSize: 11, color: "#9ca3af", fontWeight: "600" as const, marginBottom: 2 },
  vehicleInfoValue: { fontSize: 14, color: "#1a4a52", fontWeight: "800" as const },
  lastUpdatedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12 },
  lastUpdatedText: { fontSize: 11, color: "#9ca3af" },

  terminalMarker: {
    backgroundColor: "#1a4a52", borderRadius: 16, padding: 6,
    borderWidth: 2, borderColor: "#fff",
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
  },

  pickupMarker: {
    backgroundColor: "#2563eb", borderRadius: 16, padding: 6,
    borderWidth: 2, borderColor: "#fff",
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
  },
  transferMarker: {
    backgroundColor: "#f59e0b", borderRadius: 16, padding: 6,
    borderWidth: 2, borderColor: "#fff",
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
  },

  bottomPanel: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 16,
    shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 12, elevation: 8, zIndex: 5,
  },
  bottomPanelHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, marginBottom: 10,
  },
  bottomPanelTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  bottomPanelTitle:    { fontSize: 15, fontWeight: "800", color: "#1a4a52" },
  bottomPanelSub:      { fontSize: 12, color: "#6b7280" },
  emptyText:           { fontSize: 13, color: "#9ca3af", textAlign: "center", paddingVertical: 14, paddingBottom: 20 },

  optionCard: {
    backgroundColor: "#f9fafb", borderRadius: 14, padding: 12,
    borderWidth: 1.5, borderColor: "#e5e7eb",
  },
  optionCardActive: { borderColor: "#1a4a52", backgroundColor: "#f0fdfa" },

  optionCardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  optionBadge: {
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
  },
  optionBadgeText:  { fontSize: 10, fontWeight: "800", color: "#fff" },
  optionMetaRow:    { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  optionMetaTime:   { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  optionMetaFare:   { fontSize: 13, color: "#1a4a52", fontWeight: "800" },
  noDriversBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#fffbeb", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: "#fde68a",
  },
  noDriversBadgeText: { fontSize: 10, color: "#b45309", fontWeight: "600" },

  // Route Suggestions' Jeepney Operating Hours column — top-right of the
  // card, replacing the driver-availability badge for all-Jeepney options
  // (Core Flow 8g).
  jeepneyHoursCol: { minWidth: 100, maxWidth: "38%", marginLeft: 8, alignItems: "flex-end", flexShrink: 0 },
  jeepneyHoursIconRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 },
  jeepneyHoursIconWrap: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: "#dcfce7",
    alignItems: "center", justifyContent: "center",
  },
  jeepneyHoursLabel:    { fontSize: 11, fontWeight: "800", color: "#16a34a" },
  jeepneyHoursSchedule: { fontSize: 12, fontWeight: "800", color: "#1a4a52", textAlign: "right" },
  notOperatingPill: {
    backgroundColor: "#fffbeb", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: "#fde68a", marginBottom: 4,
  },
  notOperatingPillText: { fontSize: 9, fontWeight: "800", color: "#b45309" },

  segRow:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  segIcon:   { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segVehicle: { fontSize: 10, fontWeight: "800", marginBottom: 1 },
  segRoute:   { fontSize: 12, color: "#374151", fontWeight: "600" },
  segKm:      { fontSize: 11, color: "#9ca3af", fontWeight: "600" },

  transferRow: { flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 36, marginBottom: 6 },
  transferText: { fontSize: 11, color: "#9ca3af", fontStyle: "italic" },

  walkNotice: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
    backgroundColor: "#fffbeb", borderRadius: 8, padding: 8, marginTop: 6,
    borderWidth: 1, borderColor: "#fde68a",
  },
  walkNoticeText: { flex: 1, fontSize: 11, color: "#92400e", fontWeight: "600", lineHeight: 16 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHandle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 16 },
  modalCancel:  { paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center", marginTop: 12 },
  modalCancelText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },

  terminalSheetHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  terminalSheetIcon:   { width: 34, height: 34, borderRadius: 17, backgroundColor: "#1a4a52", alignItems: "center", justifyContent: "center" },
  terminalSheetTitle:  { fontSize: 17, fontWeight: "900", color: "#1a4a52" },
  terminalSheetSub:    { fontSize: 12, color: "#6b7280", marginTop: 1 },

  terminalRouteCard:   { backgroundColor: "#f9fafb", borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: "#e5e7eb" },
  terminalRouteHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeColorDot:       { width: 10, height: 10, borderRadius: 5 },
  terminalRouteName:   { flex: 1, fontSize: 13, fontWeight: "800", color: "#1a4a52" },
  vtBadge:             { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  vtBadgeText:         { fontSize: 10, fontWeight: "800" },
  terminalRouteDesc:   { fontSize: 12, color: "#6b7280", marginTop: 6, lineHeight: 17 },
  stopoverRow:         { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  stopoverText:        { fontSize: 11, color: "#9ca3af", fontStyle: "italic", flex: 1 },
  showToggle: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 10, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: "#1a4a52",
  },
  showToggleActive: { backgroundColor: "#1a4a52" },
  showToggleText:   { fontSize: 12, fontWeight: "700", color: "#1a4a52" },
});
