import { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Animated, Modal, TextInput, Alert, AppState,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import DriverMap from "./driver-map";
import API_BASE, { FILE_BASE } from "../../src/config/api";
import { authFetch } from "../../src/config/session";
import {
  fetchDriverTrips, fetchTripBookings,
  fetchSlotPassengers, updateTripStatus, updateSlotStatus,
  type TripBooking, type SlotPassenger,
} from "../../src/services/bookingService";
import { BOARDING_STATUS_LABEL } from "../../src/types/booking";
import type { BusTrip } from "../../src/types/booking";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";
import { formatTime12h } from "../../src/utils/time";
import AvatarPicker, { buildAvatarFormData } from "../../src/components/common/AvatarPicker";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

type User = {
  id: number;
  name: string;
  email: string;
  phone: string;
  license_number: string;
  status: "active" | "inactive";
  operator_id: number;
  operator_name: string;
  operator_type: "Jeepney Op" | "UV Op" | "Bus Op";
  // Populated by drivers/get_profile.php once the Settings tab is opened
  // (not returned by login) — Driver Profile & Settings.
  association_id?: number | null;
  association_name?: string | null;
  vehicle_number?: string | null;
  plate_number?: string | null;
  avatar_url?: string | null;
};

type Tab = "dispatch" | "map" | "wallet" | "settings";
type WalletTxn = {
  type: "credit" | "debit";
  amount: number;
  reference_type: string;
  balance_after: number;
  note: string;
  created_at: string;
};
type DriverQuota = {
  id: number; amount: number; frequency: "daily" | "weekly"; operator_name: string;
  period_label: string; period_total: number; period_remaining: number; period_met: boolean;
};
type QuotaSub   = { id: number; amount: number; period_type: "daily" | "weekly"; status: "pending" | "confirmed" | "rejected"; note: string | null; submitted_at: string; reviewed_at: string | null };
type Withdrawal = {
  id:             number;
  amount:         number;
  status:         "pending" | "paid" | "rejected";
  requested_at:   string;
  resolved_at:    string | null;
  association_id: number | null;
};
type SubscriptionStatus = {
  // subscription_rates.frequency supports all three (Core Flow 15) — this
  // type was missing "daily", which happened not to break the ".toUpperCase()"
  // display (JS doesn't enforce the TS type at runtime) but was still wrong.
  rate: { frequency: "daily" | "weekly" | "monthly"; amount: number } | null;
  last_paid_at: string | null;
  next_due_at:  string | null;
  is_overdue:   boolean;
};
type QueueStatus = "idle" | "queued" | "on_trip" | "ended";

type AssignedRoute = {
  id:        number;
  name:      string;
  color:     string;
  waypoints: { latitude: number; longitude: number }[];
};

type DailySummary = {
  trip_count:     number;
  total_earnings: number;
};

const VEHICLE_ICON: Record<string, IoniconsName> = {
  "Jeepney Op": "bus",
  "UV Op":      "car",
  "Bus Op":     "bus-outline",
};
const VEHICLE_LABEL: Record<string, string> = {
  "Jeepney Op": "Jeepney", "UV Op": "UV Express", "Bus Op": "Bus",
};

export default function DriverDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [user,         setUser]         = useState<User | null>(null);
  const [tab,          setTab]          = useState<Tab>("dispatch");
  const [loading,      setLoading]      = useState(true);
  const [queueStatus,  setQueueStatus]  = useState<QueueStatus>("idle");
  const [queuePos,     setQueuePos]     = useState<number | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [summary,      setSummary]      = useState<DailySummary>({
    trip_count: 0, total_earnings: 0,
  });
  const [assignedRoute, setAssignedRoute] = useState<AssignedRoute | null>(null);

  // Wallet tab state
  const [walletBalance,    setWalletBalance]    = useState(0);
  const [walletTxns,       setWalletTxns]       = useState<WalletTxn[]>([]);
  const [driverQuota,      setDriverQuota]      = useState<DriverQuota | null>(null);
  const [quotaSubmissions, setQuotaSubmissions] = useState<QuotaSub[]>([]);
  const [subStatus,        setSubStatus]        = useState<SubscriptionStatus | null>(null);
  const [withdrawals,      setWithdrawals]      = useState<Withdrawal[]>([]);

  const loadWallet = async (driverId: number) => {
    try {
      const [wRes, qRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/drivers/driver_wallet.php?driver_id=${driverId}`),
        fetch(`${API_BASE}/quota/get_driver_quota.php?driver_id=${driverId}`),
        fetch(`${API_BASE}/drivers/subscription_status.php?driver_id=${driverId}`),
      ]);
      const w = await wRes.json();
      const q = await qRes.json();
      const s = await sRes.json();
      if (w.success) { setWalletBalance(w.balance); setWalletTxns(w.transactions ?? []); setWithdrawals(w.withdrawals ?? []); }
      if (q.success) { setDriverQuota(q.quota); setQuotaSubmissions(q.submissions ?? []); }
      if (s.success) setSubStatus(s);
    } catch {}
  };

  // Driver Profile & Settings — live re-sync so a status/association/vehicle
  // change made by the operator shows up without a re-login, same pattern
  // as the other three roles' get_profile.php. Not returned by login, so
  // AsyncStorage only has these fields once this has run at least once.
  const loadDriverProfile = async (driverId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/drivers/get_profile.php?driver_id=${driverId}`);
      const data = await res.json();
      if (data?.success && data.driver) {
        setUser((prev) => {
          if (!prev) return prev;
          const merged = { ...prev, ...data.driver };
          AsyncStorage.setItem("user", JSON.stringify(merged));
          return merged;
        });
      }
    } catch {
      // Cached value stays shown.
    }
  };

  const positionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (raw) {
        const u = JSON.parse(raw);
        setUser(u);
        fetchAssignedRoute(u.id);
      }
      setLoading(false);
    })();
  }, []);

  const fetchAssignedRoute = async (driverId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/drivers/get_driver_route.php?driver_id=${driverId}`);
      const data = await res.json();
      if (data.success && data.assigned && data.route?.waypoints?.length > 1) {
        setAssignedRoute(data.route);
      } else {
        setAssignedRoute(null);
      }
    } catch (_) {}
  };

  const fetchPosition = useCallback(async (u: User) => {
    try {
      const res  = await fetch(
        `${API_BASE}/queue/queue_position.php?driver_id=${u.id}&operator_id=${u.operator_id}`
      );
      const data = await res.json();
      if (data.success && data.in_queue) {
        setQueuePos(data.queue_position);
      } else if (data.in_queue === false) {
        setQueueStatus("idle");
        setQueuePos(null);
      }
    } catch (_) {}
  }, []);

  const stopPolling = useCallback(() => {
    if (positionPollRef.current) {
      clearInterval(positionPollRef.current);
      positionPollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (queueStatus === "queued" && user) {
      fetchPosition(user);
      positionPollRef.current = setInterval(() => fetchPosition(user), 2000);
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [queueStatus, user]);

  const fetchSummary = useCallback(async (uid: number) => {
    try {
      const res  = await fetch(`${API_BASE}/drivers/driver_summary.php?driver_id=${uid}`);
      const data = await res.json();
      if (data.success) setSummary({
        trip_count:     data.trip_count,
        total_earnings: data.total_earnings,
      });
    } catch (_) {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        fetchSummary(user.id);
        fetchAssignedRoute(user.id);
        // Previously a separate `useEffect(..., [tab])` below — that only
        // re-fired on the TRANSITION into the wallet tab, not on every focus
        // regain. A driver already sitting on the wallet tab (or just
        // backgrounding/foregrounding the app without switching tabs away
        // and back) never saw an admin's updated quota rate or an operator's
        // updated remittance target until they left and re-entered the tab —
        // folded in here so it refreshes on every focus, same as the other
        // two fetches above.
        if (tab === "wallet") loadWallet(user.id);
      }
    }, [user, tab])
  );

  // useFocusEffect only fires on in-app navigation focus, NOT when the app
  // returns from the background — so a driver who leaves the phone on the
  // Wallet tab never saw an admin's rate change (or a new operator target)
  // until they tapped to another tab and back. Refresh on app foreground too.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && user && tab === "wallet") loadWallet(user.id);
    });
    return () => sub.remove();
  }, [user, tab]);

  useEffect(() => {
    if (queueStatus === "ended" && user) fetchSummary(user.id);
  }, [queueStatus, user]);

  useEffect(() => {
    if (tab === "settings" && user) loadDriverProfile(user.id);
  }, [tab]);

  if (loading) return (
    <View style={styles.loadingWrap}><ActivityIndicator color="#1a4a52" size="large" /></View>
  );
  if (!user) return (
    <View style={styles.loadingWrap}>
      <Text style={{ color: "#6b7280" }}>Session expired. Please log in again.</Text>
    </View>
  );

  const isUVorBus = user.operator_type === "UV Op" || user.operator_type === "Bus Op";

  const topBarStatusLabel = () => {
    if (queueStatus === "idle")    return "Off Queue";
    if (queueStatus === "queued")  return queuePos != null ? `Queue #${queuePos}` : "In Queue";
    if (queueStatus === "on_trip") return "On Trip";
    if (queueStatus === "ended")   return "Trip Ended";
    return "";
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>

      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <View style={styles.vehicleBadge}>
            <Ionicons name={VEHICLE_ICON[user.operator_type]} size={22} color="#fff" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.driverName} numberOfLines={1}>{user.name}</Text>
            <Text style={styles.driverSub} numberOfLines={1}>{VEHICLE_LABEL[user.operator_type]} · {user.operator_name}</Text>
          </View>
        </View>
        <View style={[
          styles.statusPill,
          queueStatus === "idle"    && { backgroundColor: "#f3f4f6" },
          queueStatus === "queued"  && { backgroundColor: "#fef9c3" },
          queueStatus === "on_trip" && { backgroundColor: "#f0fdf4" },
          queueStatus === "ended"   && { backgroundColor: "#eff6ff" },
        ]}>
          <View style={[
            styles.statusDot,
            queueStatus === "idle"    && { backgroundColor: "#9ca3af" },
            queueStatus === "queued"  && { backgroundColor: "#d97706" },
            queueStatus === "on_trip" && { backgroundColor: "#16a34a" },
            queueStatus === "ended"   && { backgroundColor: "#3b82f6" },
          ]} />
          <Text style={[
            styles.statusText,
            queueStatus === "idle"    && { color: "#9ca3af" },
            queueStatus === "queued"  && { color: "#d97706" },
            queueStatus === "on_trip" && { color: "#16a34a" },
            queueStatus === "ended"   && { color: "#3b82f6" },
          ]}>
            {topBarStatusLabel()}
          </Text>
        </View>
      </View>

      {tab === "dispatch" && (
        <View style={styles.content}>
          <DispatchScreen
            user={user}
            isUVorBus={isUVorBus}
            queueStatus={queueStatus}
            queuePos={queuePos}
            queueLoading={queueLoading}
            summary={summary}
            assignedRoute={assignedRoute}
            setQueueStatus={setQueueStatus}
            setQueuePos={setQueuePos}
            setQueueLoading={setQueueLoading}
          />
        </View>
      )}
      {tab === "map"      && <View style={styles.mapContent}><DriverMap assignedRoute={assignedRoute} /></View>}
      {tab === "settings" && (
        <View style={styles.content}>
          <SettingsScreen user={user} setUser={setUser} isUVorBus={isUVorBus} router={router} summary={summary} />
        </View>
      )}
      {tab === "wallet" && (
        <View style={styles.content}>
          <WalletSection
            driverId={user.id}
            balance={walletBalance}
            transactions={walletTxns}
            quota={driverQuota}
            submissions={quotaSubmissions}
            subStatus={subStatus}
            withdrawals={withdrawals}
            isJeepney={user?.operator_type === "Jeepney Op"}
            onUpdate={() => loadWallet(user.id)}
            setBalance={setWalletBalance}
          />
        </View>
      )}

      <View style={[styles.bottomNav, { paddingBottom: insets.bottom + 8 }]}>
        <NavTab icon="document-text" label="Dispatch" active={tab === "dispatch"} onPress={() => setTab("dispatch")} />
        <NavTab icon="map"           label="Map"       active={tab === "map"}      onPress={() => setTab("map")} />
        <NavTab icon="wallet"        label="Wallet"    active={tab === "wallet"}   onPress={() => setTab("wallet")} />
        <NavTab icon="settings"      label="Settings"  active={tab === "settings"} onPress={() => setTab("settings")} />
      </View>
    </View>
  );
}

function NavTab({ icon, label, active, onPress }: {
  icon: IoniconsName; label: string; active: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.navTab} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={active ? icon : `${icon}-outline` as IoniconsName} size={22} color={active ? "#1a4a52" : "#9ca3af"} />
      <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
      {active && <View style={styles.navActiveDot} />}
    </TouchableOpacity>
  );
}

function DispatchScreen({
  user, isUVorBus, summary,
  queueStatus, queuePos, queueLoading,
  assignedRoute,
  setQueueStatus, setQueuePos, setQueueLoading,
}: {
  user: User; isUVorBus: boolean; summary: DailySummary;
  queueStatus: QueueStatus; queuePos: number | null; queueLoading: boolean;
  assignedRoute: AssignedRoute | null;
  setQueueStatus: (s: QueueStatus) => void;
  setQueuePos:    (n: number | null) => void;
  setQueueLoading:(b: boolean) => void;
}) {
  const pulseAnim    = useRef(new Animated.Value(1)).current;
  const isNext       = queuePos === 1;
  const router       = useRouter();

  const isBusDriver     = user.operator_type === "Bus Op";
  const isUvDriver      = user.operator_type === "UV Op";
  const isJeepneyDriver = user.operator_type === "Jeepney Op";

  // Route Operating Hours — purely informational, association-published
  // (see Core Flow 8's Jeepney Operating Hours). Fetched whenever the
  // assigned route changes; nothing here gates dispatch/boarding.
  const [routeHours,        setRouteHours]        = useState<{ start_time: string; end_time: string } | null>(null);
  const [routeHoursLoading, setRouteHoursLoading]  = useState(false);

  useEffect(() => {
    if (!isJeepneyDriver || !assignedRoute?.id) { setRouteHours(null); return; }
    setRouteHoursLoading(true);
    fetch(`${API_BASE}/routes/get_jeepney_operating_hours.php?route_id=${assignedRoute.id}`)
      .then(res => res.json())
      .then(data => setRouteHours(data.success ? data.hours : null))
      .catch(() => setRouteHours(null))
      .finally(() => setRouteHoursLoading(false));
  }, [isJeepneyDriver, assignedRoute?.id]);

  // Bus: driver's own scheduled trips + manifest of the nearest one
  const [busTrips,     setBusTrips]     = useState<BusTrip[]>([]);
  const [tripBookings, setTripBookings] = useState<TripBooking[]>([]);
  const [busLoad,      setBusLoad]      = useState(false);
  const currentTrip = busTrips[0] ?? null;

  const loadBusTrips = useCallback(async () => {
    setBusLoad(true);
    const trips = await fetchDriverTrips(user.id);
    setBusTrips(trips);
    if (trips[0]) setTripBookings(await fetchTripBookings(trips[0].id));
    setBusLoad(false);
  }, [user.id]);

  useEffect(() => {
    if (isBusDriver) loadBusTrips();
  }, [isBusDriver, loadBusTrips]);

  // Boarding/departure controls (Bus trip + UV slot alike)
  const [tripActionBusy, setTripActionBusy] = useState(false);

  const handleTripAction = async (action: "start_boarding" | "depart" | "complete") => {
    if (!currentTrip) return;
    setTripActionBusy(true);
    const result = await updateTripStatus(currentTrip.id, action, { driverId: user.id });
    setTripActionBusy(false);
    if (result.success) loadBusTrips();
    else Alert.alert("Couldn't update trip", result.message ?? "Please try again.");
  };

  // UV: operator-scheduled slot passengers — visible whenever this driver is
  // the currently-dispatched one for their route (see Join Queue below).
  // Booking availability is entirely operator/association-controlled (route
  // Active/Not Active + published operating hours) — the driver has no
  // separate "go online" toggle; their role starts once passengers arrive.
  const [slotDispatched, setSlotDispatched] = useState(false);
  const [slotPassengers, setSlotPassengers] = useState<SlotPassenger[]>([]);
  const slotPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSlotPassengers = useCallback(async () => {
    const { dispatched, passengers } = await fetchSlotPassengers(user.id);
    setSlotDispatched(dispatched);
    setSlotPassengers(passengers);
  }, [user.id]);

  useEffect(() => {
    if (!isUvDriver) return;
    loadSlotPassengers();
    slotPollRef.current = setInterval(loadSlotPassengers, 5000);
    return () => { if (slotPollRef.current) clearInterval(slotPollRef.current); };
  }, [isUvDriver, loadSlotPassengers]);

  const currentSlotId = slotPassengers[0]?.uv_slot_id ?? null;

  const handleSlotAction = async (action: "start_boarding" | "depart") => {
    if (!currentSlotId) return;
    setTripActionBusy(true);
    const result = await updateSlotStatus(currentSlotId, action, { driverId: user.id });
    setTripActionBusy(false);
    if (result.success) loadSlotPassengers();
    else Alert.alert("Couldn't update slot", result.message ?? "Please try again.");
  };

  useEffect(() => {
    if (queueStatus === "queued" && isNext) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [queueStatus, isNext]);

  const handleStartQueue = async () => {
    if (queueLoading) return;
    setQueueLoading(true);
    try {
      // UV Express queues per-route (an operator may run several routes);
      // Jeepney omits route_id, keeping its existing unscoped queue behavior.
      const res  = await fetch(`${API_BASE}/queue/join_queue.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driver_id: user.id, operator_id: user.operator_id,
          route_id: isUvDriver ? assignedRoute?.id : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setQueuePos(data.queue_position ?? null);
        setQueueStatus("queued");
      } else {
        // e.g. an overdue Jeepney platform quota (queue/join_queue.php's
        // subscription_overdue rejection, Core Flow 15) — no dispatch_queue
        // row was created, so the UI must not claim the driver is queued.
        Alert.alert("Couldn't join queue", data.message ?? "Please try again.");
      }
    } catch (_) {
      Alert.alert("Connection error", "Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setQueueLoading(false);
    }
  };

  const handleStartTrip = async () => {
    if (queueLoading) return;
    setQueueLoading(true);
    try {
      await fetch(`${API_BASE}/trips/start_trip.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver_id: user.id }),
      });
      setQueueStatus("on_trip");
      setQueuePos(null);
    } catch (_) {
      setQueueStatus("on_trip");
      setQueuePos(null);
    } finally {
      setQueueLoading(false);
    }
  };

  const handleEndTrip = async () => {
    if (queueLoading) return;
    setQueueLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/trips/end_trip.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver_id: user.id }),
      });
      const data = await res.json();
      if (data.success) {
        setQueueStatus("ended");
        setQueuePos(null);
      } else {
        Alert.alert("Couldn't end trip", data.message ?? "Please try again.");
      }
    } catch (_) {
      Alert.alert("Connection error", "Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setQueueLoading(false);
    }
  };

  const handleCancelQueue = async () => {
    if (queueLoading) return;
    setQueueLoading(true);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res  = await fetch(`${API_BASE}/queue/leave_queue.php`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ driver_id: user.id }),
        });
        const data = await res.json();
        if (data.rows_affected > 0) break;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 300));
    }
    setQueueStatus("idle");
    setQueuePos(null);
    setQueueLoading(false);
  };

  const handleReset = () => { setQueueStatus("idle"); setQueuePos(null); };

  const posLabel = () => {
    if (queuePos === null) return "In Queue";
    if (queuePos === 1)    return "Queue #1 — You're next!";
    return `Queue #${queuePos}`;
  };

  const statusIcon: Record<QueueStatus, IoniconsName> = {
    idle:    "alert-circle-outline",
    queued:  "time-outline",
    on_trip: "bus",
    ended:   "checkmark-circle",
  };

  return (
    <ScrollView contentContainerStyle={styles.screenPad} showsVerticalScrollIndicator={false}>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Dispatch Status</Text>

        <View style={styles.dispatchStatusRow}>
          <View style={[
            styles.dispatchStatusBadge,
            queueStatus === "idle"    && { backgroundColor: "#f3f4f6" },
            queueStatus === "queued"  && { backgroundColor: "#fef9c3" },
            queueStatus === "on_trip" && { backgroundColor: "#f0fdf4" },
            queueStatus === "ended"   && { backgroundColor: "#eff6ff" },
          ]}>
            <Ionicons
              name={statusIcon[queueStatus]}
              size={18}
              color={
                queueStatus === "idle"    ? "#6b7280" :
                queueStatus === "queued"  ? "#92400e" :
                queueStatus === "on_trip" ? "#15803d" : "#1d4ed8"
              }
            />
            <Text style={[
              styles.dispatchStatusText,
              queueStatus === "idle"    && { color: "#6b7280" },
              queueStatus === "queued"  && { color: "#92400e" },
              queueStatus === "on_trip" && { color: "#15803d" },
              queueStatus === "ended"   && { color: "#1d4ed8" },
            ]}>
              {queueStatus === "idle"    ? "Not in Queue" :
               queueStatus === "queued"  ? posLabel()     :
               queueStatus === "on_trip" ? "On Trip"      : "Trip Completed"}
            </Text>
          </View>
        </View>

        <View style={styles.stepRow}>
          <StepDot step={1} label="Queue" active={queueStatus !== "idle"}                               current={queueStatus === "queued"} />
          <View style={[styles.stepLine, (queueStatus === "on_trip" || queueStatus === "ended") && styles.stepLineDone]} />
          <StepDot step={2} label="Trip"  active={queueStatus === "on_trip" || queueStatus === "ended"} current={queueStatus === "on_trip"} />
          <View style={[styles.stepLine, queueStatus === "ended" && styles.stepLineDone]} />
          <StepDot step={3} label="Done"  active={queueStatus === "ended"}                              current={queueStatus === "ended"} />
        </View>

        {/* IDLE */}
        {queueStatus === "idle" && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnQueue, queueLoading && { opacity: 0.6 }]}
            onPress={handleStartQueue} disabled={queueLoading} activeOpacity={0.85}
          >
            {queueLoading
              ? <ActivityIndicator color="#fff" />
              : <View style={styles.actionBtnInner}>
                  <Ionicons name="list" size={18} color="#fff" />
                  <Text style={styles.actionBtnText}>Start Queue</Text>
                </View>}
          </TouchableOpacity>
        )}

        {/* QUEUED */}
        {queueStatus === "queued" && (
          <>
            {isNext ? (
              /* Queue #1 — show Start Trip */
              <>
                <View style={styles.nextUpBanner}>
                  <Ionicons name="checkmark-circle" size={16} color="#15803d" />
                  <Text style={styles.nextUpText}>You're next! Tap Start Trip when ready.</Text>
                </View>
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnTrip, queueLoading && { opacity: 0.6 }]}
                    onPress={handleStartTrip} disabled={queueLoading} activeOpacity={0.85}
                  >
                    {queueLoading
                      ? <ActivityIndicator color="#fff" />
                      : <View style={styles.actionBtnInner}>
                          <Ionicons name="bus" size={18} color="#fff" />
                          <Text style={styles.actionBtnText}>Start Trip</Text>
                        </View>}
                  </TouchableOpacity>
                </Animated.View>
              </>
            ) : (
              /* Queue #2+ — show waiting box instead */
              <View style={styles.waitingBox}>
                <Ionicons name="time" size={32} color="#d97706" />
                <Text style={styles.waitingTitle}>Please Wait</Text>
                <Text style={styles.waitingText}>
                  {queuePos != null && queuePos > 1
                    ? `${queuePos - 1} driver${queuePos - 1 > 1 ? "s" : ""} ahead of you.`
                    : "Waiting for your turn…"}
                </Text>
                <Text style={styles.waitingHint}>Start Trip will appear when you reach Queue #1.</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.actionBtnSecondary, queueLoading && { opacity: 0.6 }]}
              onPress={handleCancelQueue} disabled={queueLoading} activeOpacity={0.85}
            >
              <View style={styles.actionBtnInner}>
                <Ionicons name="close" size={16} color="#dc2626" />
                <Text style={styles.actionBtnSecondaryText}>Cancel Queue</Text>
              </View>
            </TouchableOpacity>
          </>
        )}

        {/* ON TRIP */}
        {queueStatus === "on_trip" && (
          <>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnEnd, queueLoading && { opacity: 0.6 }]}
              onPress={handleEndTrip} disabled={queueLoading} activeOpacity={0.85}
            >
              {queueLoading
                ? <ActivityIndicator color="#15803d" />
                : <View style={styles.actionBtnInner}>
                    <Ionicons name="flag" size={18} color="#15803d" />
                    <Text style={[styles.actionBtnText, { color: "#15803d" }]}>End Trip</Text>
                  </View>}
            </TouchableOpacity>
            <Text style={[styles.dispatchHint, { color: "#15803d" }]}>
              Tap End Trip when you arrive at the terminal.
            </Text>
          </>
        )}

        {/* ENDED */}
        {queueStatus === "ended" && (
          <>
            <View style={styles.tripEndedBox}>
              <Ionicons name="checkmark-circle" size={18} color="#1d4ed8" />
              <Text style={styles.tripEndedText}>Trip completed successfully!</Text>
            </View>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnQueue]}
              onPress={handleReset} activeOpacity={0.85}
            >
              <View style={styles.actionBtnInner}>
                <Ionicons name="list" size={18} color="#fff" />
                <Text style={styles.actionBtnText}>Start New Queue</Text>
              </View>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── ASSIGNED ROUTE CARD ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="map" size={16} color="#1a4a52" />
          <Text style={styles.sectionTitle}>Assigned Route</Text>
        </View>
        {assignedRoute ? (
          <View style={styles.routeCard}>
            <View style={[styles.routeColorBar, { backgroundColor: assignedRoute.color }]} />
            <View style={styles.routeCardBody}>
              <Text style={styles.routeCardName}>{assignedRoute.name}</Text>
              <View style={styles.routeCardMeta}>
                <Ionicons name="navigate-outline" size={12} color="#9ca3af" />
                <Text style={styles.routeCardMetaText}>
                  {assignedRoute.waypoints.length} waypoints
                </Text>
              </View>
            </View>
            <View style={[styles.routeActiveBadge]}>
              <View style={styles.routeActiveDot} />
              <Text style={styles.routeActiveText}>Active</Text>
            </View>
          </View>
        ) : (
          <View style={styles.noRouteBox}>
            <Ionicons name="map-outline" size={28} color="#d1d5db" />
            <Text style={styles.noRouteText}>No route assigned yet</Text>
            <Text style={styles.noRouteSub}>Your association will assign you a route once approved.</Text>
          </View>
        )}
      </View>

      {isJeepneyDriver && assignedRoute && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="time-outline" size={16} color="#1a4a52" />
            <Text style={styles.sectionTitle}>Route Operating Hours</Text>
          </View>
          {routeHoursLoading ? (
            <ActivityIndicator size="small" color="#1a4a52" style={{ marginVertical: 12 }} />
          ) : routeHours ? (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Operations Start</Text>
                <Text style={styles.infoValue}>{formatTime12h(routeHours.start_time)}</Text>
              </View>
              <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.infoLabel}>Operations End</Text>
                <Text style={styles.infoValue}>
                  {formatTime12h(routeHours.end_time)}
                  {routeHours.end_time < routeHours.start_time ? " (+1 day)" : ""}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.noRouteBox}>
              <Ionicons name="time-outline" size={28} color="#d1d5db" />
              <Text style={styles.noRouteText}>No operating hours published yet</Text>
              <Text style={styles.noRouteSub}>Your association hasn't set operating hours for this route.</Text>
            </View>
          )}
        </View>
      )}

      {isUvDriver && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="calendar-outline" size={16} color="#1a4a52" />
            <Text style={styles.sectionTitle}>UV Express Passengers</Text>
          </View>
          {!slotDispatched ? (
            <View style={bk.empty}>
              <Ionicons name="hourglass-outline" size={28} color="#d1d5db" />
              <Text style={bk.emptyText}>
                Join the queue and reach the front to board commuters booked for your route. Booking availability
                is controlled by your operator and association — you don't need to go online.
              </Text>
            </View>
          ) : slotPassengers.length === 0 ? (
            <View style={bk.empty}>
              <Ionicons name="receipt-outline" size={28} color="#d1d5db" />
              <Text style={bk.emptyText}>No scheduled slot passengers waiting.</Text>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                <TouchableOpacity
                  style={[bk.tripActionBtn, tripActionBusy && { opacity: 0.6 }]}
                  onPress={() => handleSlotAction("start_boarding")}
                  disabled={tripActionBusy}
                >
                  <Ionicons name="people" size={14} color="#1a4a52" />
                  <Text style={bk.tripActionBtnText}>Start Boarding</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[bk.tripActionBtnAlt, tripActionBusy && { opacity: 0.6 }]}
                  onPress={() => handleSlotAction("depart")}
                  disabled={tripActionBusy}
                >
                  <Ionicons name="arrow-redo" size={14} color="#fff" />
                  <Text style={bk.tripActionBtnAltText}>Depart</Text>
                </TouchableOpacity>
              </View>
              {slotPassengers.map((p) => {
                const depStr = new Date(p.departure_time.replace(" ", "T")).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
                const opensStr = new Date(p.qr_active_at.replace(" ", "T")).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
                return (
                  <View key={p.id} style={bk.row}>
                    <View style={bk.iconWrap}>
                      <Ionicons name="person" size={14} color="#1a4a52" />
                    </View>
                    <View style={bk.mid}>
                      <Text style={bk.name}>{p.passenger_name}</Text>
                      <Text style={bk.route}>{depStr} departure · {p.passenger_phone}</Text>
                    </View>
                    <View style={bk.right}>
                      <Text style={bk.fare}>₱{p.fare_amount.toFixed(2)}</Text>
                      <Text style={[bk.pax, p.qr_active ? { color: "#16a34a", fontWeight: "800" } : { color: "#d97706" }]}>
                        {p.qr_active ? "QR Ready" : `Opens ${opensStr}`}
                      </Text>
                    </View>
                  </View>
                );
              })}
              <TouchableOpacity
                style={styles.scanBtn}
                onPress={() => router.push("/(driver)/scan-ticket")}
                activeOpacity={0.85}
              >
                <Ionicons name="qr-code-outline" size={16} color="#fff" />
                <Text style={styles.scanBtnText}>Scan to Board</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {isBusDriver && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="calendar" size={16} color="#1a4a52" />
            <Text style={styles.sectionTitle}>Upcoming Bus Trip</Text>
          </View>
          {busLoad ? (
            <ActivityIndicator color="#1a4a52" style={{ paddingVertical: 16 }} />
          ) : !currentTrip ? (
            <View style={bk.empty}>
              <Ionicons name="calendar-outline" size={28} color="#d1d5db" />
              <Text style={bk.emptyText}>No upcoming trips scheduled</Text>
            </View>
          ) : (
            <>
              <Text style={bk.uvStatusText}>
                {currentTrip.from_location} → {currentTrip.to_location}
              </Text>
              <Text style={bk.route}>
                {new Date(currentTrip.departure_time.replace(" ", "T")).toLocaleString("en-PH", {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })} · {currentTrip.seats_booked} / {currentTrip.capacity} seats booked
              </Text>

              {currentTrip.status === "departed" ? (
                <>
                  <View style={bk.statusBadge}>
                    <Ionicons name="checkmark-done" size={13} color="#1a4a52" />
                    <Text style={bk.statusBadgeText}>Departed — passengers can still board during the grace period</Text>
                  </View>
                  <TouchableOpacity
                    style={[bk.tripActionBtnAlt, { marginTop: 8 }, tripActionBusy && { opacity: 0.6 }]}
                    onPress={() => handleTripAction("complete")}
                    disabled={tripActionBusy}
                  >
                    <Ionicons name="flag" size={14} color="#fff" />
                    <Text style={bk.tripActionBtnAltText}>Mark Arrived</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {(() => {
                    // Time-aware hint only — both buttons stay manually usable
                    // regardless (the driver can always act early/late; this
                    // just highlights which action is next, based on the
                    // schedule's boarding/departure time).
                    const now = Date.now();
                    const boardingAt  = currentTrip.boarding_time ? new Date(currentTrip.boarding_time.replace(" ", "T")).getTime() : null;
                    const departureAt = new Date(currentTrip.departure_time.replace(" ", "T")).getTime();
                    let hint = "";
                    if (boardingAt && now < boardingAt) {
                      hint = `Boarding opens at ${new Date(boardingAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;
                    } else if (now < departureAt) {
                      hint = `Departs at ${new Date(departureAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;
                    } else {
                      hint = "Departure time has passed — tap Depart when ready";
                    }
                    return <Text style={bk.timeHint}>{hint}</Text>;
                  })()}
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                    {currentTrip.status === "scheduled" && (
                      <TouchableOpacity
                        style={[bk.tripActionBtn, tripActionBusy && { opacity: 0.6 }]}
                        onPress={() => handleTripAction("start_boarding")}
                        disabled={tripActionBusy}
                      >
                        <Ionicons name="people" size={14} color="#1a4a52" />
                        <Text style={bk.tripActionBtnText}>Start Boarding</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[bk.tripActionBtnAlt, tripActionBusy && { opacity: 0.6 }]}
                      onPress={() => handleTripAction("depart")}
                      disabled={tripActionBusy}
                    >
                      <Ionicons name="arrow-redo" size={14} color="#fff" />
                      <Text style={bk.tripActionBtnAltText}>Depart</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {tripBookings.length === 0 ? (
                <View style={bk.empty}>
                  <Ionicons name="receipt-outline" size={28} color="#d1d5db" />
                  <Text style={bk.emptyText}>No bookings yet</Text>
                </View>
              ) : (
                tripBookings.map((b) => (
                  <View key={b.id} style={bk.row}>
                    <View style={bk.iconWrap}>
                      <Ionicons name="person" size={14} color="#1a4a52" />
                    </View>
                    <View style={bk.mid}>
                      <Text style={bk.name}>{b.passenger_name}</Text>
                      <Text style={bk.route}>{b.passenger_phone}</Text>
                    </View>
                    <View style={bk.right}>
                      <Text style={bk.fare}>₱{b.fare_amount.toFixed(2)}</Text>
                      <Text style={[bk.pax, b.boarding_status === "boarded" && { color: "#16a34a", fontWeight: "800" }]}>
                        {BOARDING_STATUS_LABEL[b.boarding_status] ?? b.boarding_status}
                      </Text>
                    </View>
                  </View>
                ))
              )}
              {(currentTrip.status === "boarding" || currentTrip.status === "departed") && (
                <TouchableOpacity
                  style={styles.scanBtn}
                  onPress={() => router.push("/(driver)/scan-ticket")}
                  activeOpacity={0.85}
                >
                  <Ionicons name="qr-code-outline" size={16} color="#fff" />
                  <Text style={styles.scanBtnText}>Scan to Board</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Today's Summary</Text>
        <View style={styles.statsRow}>
          <StatBox label="Trips"    value={String(summary.trip_count)}                              icon="refresh-circle" />
          {isUVorBus && <StatBox label="Earnings" value={`₱${summary.total_earnings.toFixed(2)}`} icon="cash" />}
        </View>
        <Text style={styles.summaryNote}>Updates after each completed trip.</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Driver Info</Text>
        <InfoRow label="License No." value={user.license_number} />
        <InfoRow label="Operator"    value={user.operator_name} />
        <InfoRow label="Vehicle"     value={VEHICLE_LABEL[user.operator_type]} />
      </View>

    </ScrollView>
  );
}


function StepDot({ step, label, active, current }: {
  step: number; label: string; active: boolean; current: boolean;
}) {
  return (
    <View style={styles.stepDotWrap}>
      <View style={[styles.stepDot, active && styles.stepDotActive, current && styles.stepDotCurrent]}>
        <Text style={[styles.stepDotText, active && { color: "#fff" }]}>{step}</Text>
      </View>
      <Text style={[styles.stepLabel, active && { color: "#1a4a52" }]}>{label}</Text>
    </View>
  );
}

const DRIVER_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: "Active",   color: "#16a34a", bg: "#f0fdf4" },
  inactive: { label: "Inactive", color: "#dc2626", bg: "#fef2f2" },
};

function SettingsScreen({ user, setUser, isUVorBus, router, summary }: {
  user: User; setUser: React.Dispatch<React.SetStateAction<User | null>>; isUVorBus: boolean; router: any; summary: DailySummary;
}) {
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(["user", "role"]);
    router.replace("/(auth)/login");
  };

  const handleAvatarChange = async (localUri: string | null) => {
    setUploadingAvatar(true);
    try {
      const fd  = buildAvatarFormData("driver_id", user.id, localUri);
      const res = await fetch(`${API_BASE}/drivers/update_avatar.php`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        const merged = { ...user, avatar_url: data.avatar_url };
        setUser(merged);
        await AsyncStorage.setItem("user", JSON.stringify(merged));
      } else {
        Alert.alert("Error", data.message || "Failed to update photo.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const initials = user.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "DR";
  const statusMeta = DRIVER_STATUS_META[user.status] ?? DRIVER_STATUS_META.inactive;
  const assignedVehicleLabel = user.vehicle_number || user.plate_number
    ? `${VEHICLE_LABEL[user.operator_type]} #${user.vehicle_number ?? user.plate_number}`
    : "Not yet assigned";

  return (
    <ScrollView contentContainerStyle={styles.screenPad} showsVerticalScrollIndicator={false}>
      {/* Driver Profile — avatar/initials + status pill (this is the closest
          thing this app has to a dedicated Driver Profile screen; the tab
          stays labeled "Settings" since renaming it would change existing
          navigation) */}
      <View style={styles.profileAvatarWrap}>
        <AvatarPicker
          uri={user.avatar_url ? FILE_BASE + user.avatar_url : null}
          fallbackText={initials}
          size={72}
          uploading={uploadingAvatar}
          onChange={handleAvatarChange}
        />
        <Text style={styles.driverNameLg}>{user.name}</Text>
        <View style={[styles.profileStatusPill, { backgroundColor: statusMeta.bg }]}>
          <View style={[styles.profileStatusDot, { backgroundColor: statusMeta.color }]} />
          <Text style={[styles.profileStatusText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Profile Info</Text>
        <InfoRow label="Driver ID" value={`#${user.id}`} />
        <InfoRow label="Name"    value={user.name} />
        <InfoRow label="Email"   value={user.email} />
        <InfoRow label="Phone"   value={user.phone} />
        <InfoRow label="License" value={user.license_number} />
      </View>

      {isUVorBus && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="cash" size={16} color="#1a4a52" />
            <Text style={styles.sectionTitle}>Earnings</Text>
          </View>
          <View style={styles.statsRow}>
            <StatBox label="Today" value={`₱${summary.total_earnings.toFixed(2)}`} icon="calendar" />
            <StatBox label="Trips" value={String(summary.trip_count)}              icon="refresh-circle" />
          </View>
          <Text style={styles.sectionSub}>Earnings calculated after each completed trip.</Text>
          <TouchableOpacity
            style={styles.earningsHistoryBtn}
            onPress={() => router.push("/(driver)/earnings-history")}
            activeOpacity={0.85}
          >
            <Ionicons name="time-outline" size={15} color="#1a4a52" />
            <Text style={styles.earningsHistoryBtnText}>View Earnings History</Text>
            <Ionicons name="chevron-forward" size={14} color="#1a4a52" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Operator Info</Text>
        <InfoRow label="Operator" value={user.operator_name} />
        <InfoRow label="Type"     value={VEHICLE_LABEL[user.operator_type]} />
        <InfoRow label="Association" value={user.association_name ?? "—"} />
        <InfoRow label="Assigned Vehicle" value={assignedVehicleLabel} />
      </View>

      <View style={styles.sectionCard}>
        <ActionRow
          icon="shield-checkmark-outline"
          label="Driver Verification"
          onPress={() => router.push("/(driver)/driver-verification")}
        />
        <ActionRow
          icon="settings-outline"
          label="Account Settings"
          onPress={() => router.push("/(driver)/settings")}
          last
        />
      </View>

      <TouchableOpacity style={styles.logoutBtn} activeOpacity={0.85} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={18} color="#dc2626" />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function ActionRow({
  icon, label, onPress, last = false,
}: { icon: IoniconsName; label: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.actionRow, !last && styles.actionRowBorder]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={16} color="#1a4a52" />
      <Text style={styles.actionLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
    </TouchableOpacity>
  );
}

function StatBox({ label, value, icon }: { label: string; value: string; icon: IoniconsName }) {
  return (
    <View style={styles.statBox}>
      <Ionicons name={icon} size={20} color="#1a4a52" />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// ─── Wallet Section ───────────────────────────────────────────────────────────

const TOPUP_AMOUNTS = [100, 200, 500, 1000];

function WalletSection({ driverId, balance, transactions, quota, submissions, subStatus, withdrawals, isJeepney, onUpdate, setBalance }: {
  driverId:     number;
  balance:      number;
  transactions: WalletTxn[];
  quota:        DriverQuota | null;
  submissions:  QuotaSub[];
  subStatus:    SubscriptionStatus | null;
  withdrawals:  Withdrawal[];
  isJeepney:    boolean;
  onUpdate:     () => void;
  setBalance:   (b: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [topupVisible,    setTopupVisible]    = useState(false);
  // Real PayMongo GCash (Demo) checkout — same flow and same
  // endpoints as the commuter wallet (wallet.tsx), just with driver_id
  // instead of commuter_id. Replaces the old instant/no-gateway top-up
  // (driver_wallet.php's POST handler is left in place, dormant, per this
  // codebase's deprecate-in-place convention — no current screen calls it).
  const [topupSelected,   setTopupSelected]   = useState<number | null>(null);
  const [topupCustom,     setTopupCustom]     = useState("");
  const [topupProcessing, setTopupProcessing] = useState(false);
  const [topupVerifying,  setTopupVerifying]  = useState(false);
  const [topupError,      setTopupError]      = useState("");
  const [pendingTopupSource, setPendingTopupSource] = useState<{ id: string; amount: number } | null>(null);
  const [submitVisible,   setSubmitVisible]   = useState(false);
  const [submitAmount,    setSubmitAmount]    = useState("");
  const [submitNote,      setSubmitNote]      = useState("");
  const [submitBusy,      setSubmitBusy]      = useState(false);
  const [payingSub,       setPayingSub]       = useState(false);
  const [withdrawVisible, setWithdrawVisible] = useState(false);
  const [withdrawAmount,  setWithdrawAmount]  = useState("");
  const [withdrawBusy,    setWithdrawBusy]    = useState(false);
  const [toast,           setToast]           = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // "Pay Now" used to fire the actual debit on a single tap with no
  // confirmation, and success was only a 3s toast easy to miss for a real
  // money-out action — now gated behind a confirm dialog, and success gets
  // its own dedicated alert (in addition to the toast, not instead of it).
  const handlePaySubscription = () => {
    const amount = subStatus?.rate?.amount;
    if (!amount) return;
    Alert.alert(
      "Pay Platform Quota",
      `Pay ₱${amount.toFixed(2)} now from your wallet balance?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Pay Now", onPress: doPaySubscription },
      ]
    );
  };

  const doPaySubscription = async () => {
    const amount = subStatus?.rate?.amount ?? 0;
    setPayingSub(true);
    try {
      const res  = await fetch(`${API_BASE}/drivers/pay_subscription.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver_id: driverId }),
      });
      const data = await res.json();
      if (data.success) {
        setBalance(data.new_balance);
        showToast("Quota paid!");
        Alert.alert(
          "Payment Successful",
          `₱${amount.toFixed(2)} was paid from your wallet.${data.next_due_at ? ` Next due: ${data.next_due_at}.` : ""}`
        );
        onUpdate();
      } else {
        Alert.alert("Payment Failed", data.message ?? "Please try again.");
      }
    } catch { Alert.alert("Connection Error", "Cannot connect to server. Please try again."); }
    finally { setPayingSub(false); }
  };

  const verifyTopup = async (source_id: string) => {
    setTopupVerifying(true);
    try {
      const res  = await authFetch(`${API_BASE}/wallet/verify_payment.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver_id: driverId, source_id }),
      });
      const data = await res.json();
      if (data.success) {
        setBalance(data.new_balance);
        showToast(`₱${Number(data.amount).toFixed(2)} added via GCash (Demo)!`);
        setTopupSelected(null);
        setTopupCustom("");
        setPendingTopupSource(null);
        setTopupVisible(false);
        setTopupError("");
        onUpdate();
      } else {
        setTopupError(data.message ?? "Payment verification failed.");
      }
    } catch {
      setTopupError("Verification failed. Please try again.");
    } finally {
      setTopupVerifying(false);
    }
  };

  const handlePayTopup = async (method: "gcash") => {
    const amount = topupSelected ?? (topupCustom ? parseFloat(topupCustom) : 0);
    if (!amount || amount <= 0) { setTopupError("Please enter an amount."); return; }

    setTopupProcessing(true);
    setTopupError("");
    try {
      const res  = await authFetch(`${API_BASE}/wallet/create_source.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver_id: driverId, amount, method }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setTopupError(data.message ?? "Could not start payment. Please try again.");
        return;
      }

      setPendingTopupSource({ id: data.source_id, amount });
      setTopupProcessing(false);

      // Same PayMongo checkout + deep-link-return pattern as the commuter
      // wallet — waits for the sandbox checkout to redirect back to
      // transyncmobile://, then always tries to verify regardless of how
      // the browser closed (paid, cancelled, or dismissed).
      await WebBrowser.openAuthSessionAsync(data.checkout_url, "transyncmobile://");
      await verifyTopup(data.source_id);
    } catch {
      setTopupError("Network error. Please check your connection.");
    } finally {
      setTopupProcessing(false);
    }
  };

  const retryVerifyTopup = () => {
    if (pendingTopupSource) verifyTopup(pendingTopupSource.id);
  };

  const openSubmit = () => {
    if (!quota) { Alert.alert("No Quota", "Your operator has not assigned a quota yet."); return; }
    setSubmitAmount(String(quota.amount));
    setSubmitNote("");
    setSubmitVisible(true);
  };

  // Submitting debits the driver's wallet immediately (refunded only if the
  // operator rejects it), so it must never fire on a single tap — validate,
  // then ask for confirmation, then send.
  const handleSubmit = () => {
    const parsed = parseFloat(submitAmount);
    if (isNaN(parsed) || parsed <= 0) { showToast("Enter a valid amount."); return; }
    Alert.alert(
      "Submit Quota",
      `Submit ₱${parsed.toFixed(2)} to ${quota?.operator_name ?? "your operator"}?\n\nThis is taken from your wallet now. If your operator rejects it, it's refunded.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Submit", onPress: () => doSubmit(parsed) },
      ]
    );
  };

  const doSubmit = async (parsed: number) => {
    setSubmitBusy(true);
    try {
      const res  = await fetch(`${API_BASE}/quota/submit_quota.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver_id: driverId, amount: parsed, note: submitNote }),
      });
      const data = await res.json();
      if (data.success) {
        setBalance(data.new_balance);
        setSubmitVisible(false);
        showToast("Quota submitted!");
        Alert.alert(
          "Quota Submitted",
          `₱${parsed.toFixed(2)} was sent to ${quota?.operator_name ?? "your operator"} and is waiting for their confirmation.`
        );
        onUpdate();
      } else {
        Alert.alert("Submission Failed", data.message ?? "Please try again.");
      }
    } catch { Alert.alert("Connection Error", "Cannot connect to server. Please try again."); }
    finally { setSubmitBusy(false); }
  };

  const handleWithdraw = async () => {
    const parsed = parseFloat(withdrawAmount);
    if (isNaN(parsed) || parsed <= 0) { showToast("Enter a valid amount."); return; }
    if (parsed > balance) { showToast("Amount exceeds your available balance."); return; }
    setWithdrawBusy(true);
    try {
      const res  = await authFetch(`${API_BASE}/drivers/driver_withdraw.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver_id: driverId, amount: parsed }),
      });
      const data = await res.json();
      if (data.success) { setBalance(data.new_balance); setWithdrawVisible(false); setWithdrawAmount(""); showToast("Withdrawal request submitted."); onUpdate(); }
      else showToast(data.message ?? "Withdrawal failed.");
    } catch { showToast("Network error."); }
    finally { setWithdrawBusy(false); }
  };

  const refLabel = (r: string) => ({ jeepney_ride: "Fare earned", topup: "Top-up", quota_submission: "Quota remittance", quota_refund: "Quota refund", withdrawal: "Withdrawal" } as Record<string,string>)[r] ?? r.replace(/_/g, " ");
  const statusColor = (s: string) => s === "confirmed" ? "#16a34a" : s === "rejected" ? "#dc2626" : "#f59e0b";
  const withdrawalStatusLabel = (s: Withdrawal["status"]) => s === "paid" ? "Completed" : s === "rejected" ? "Rejected" : "Pending";
  const withdrawalStatusColor = (s: Withdrawal["status"]) => statusColor(s === "paid" ? "confirmed" : s);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <ScrollView contentContainerStyle={styles.screenPad} showsVerticalScrollIndicator={false}>
      {toast !== "" && (
        <View style={wt.toast}><Ionicons name="checkmark-circle" size={14} color="#a8d832" /><Text style={wt.toastText}>{toast}</Text></View>
      )}

      {/* Balance card */}
      <View style={wt.balCard}>
        <Text style={wt.balLabel}>WALLET BALANCE</Text>
        <Text style={wt.balAmount}>₱{balance.toFixed(2)}</Text>
        <View style={wt.balActions}>
          <TouchableOpacity style={wt.topupBtn} onPress={() => setTopupVisible(true)} activeOpacity={0.85}>
            <Ionicons name="add-circle-outline" size={16} color="#fff" />
            <Text style={wt.topupBtnText}>Top Up</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[wt.withdrawBtn, balance <= 0 && { opacity: 0.4 }]}
            onPress={() => setWithdrawVisible(true)}
            disabled={balance <= 0}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-down-circle-outline" size={16} color="#1a4a52" />
            <Text style={wt.withdrawBtnText}>Withdraw</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Quota */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name="receipt-outline" size={16} color="#1a4a52" />
          <Text style={styles.sectionTitle}>Quota</Text>
        </View>
        {quota ? (
          <>
            <View style={wt.quotaRow}>
              <View>
                <Text style={wt.quotaFreq}>{quota.frequency.toUpperCase()} QUOTA</Text>
                <Text style={wt.quotaAmt}>₱{quota.amount.toFixed(2)}</Text>
                <Text style={wt.quotaOp}>from {quota.operator_name}</Text>
              </View>
              <TouchableOpacity style={wt.submitBtn} onPress={openSubmit} activeOpacity={0.85}>
                <Ionicons name="send-outline" size={14} color="#fff" />
                <Text style={wt.submitBtnText}>Submit</Text>
              </TouchableOpacity>
            </View>

            <View style={[wt.progressChip, { backgroundColor: quota.period_met ? "#f0fdf4" : "#fef2f2" }]}>
              <Ionicons
                name={quota.period_met ? "checkmark-circle-outline" : "time-outline"}
                size={14}
                color={quota.period_met ? "#16a34a" : "#dc2626"}
              />
              <Text style={[wt.progressText, { color: quota.period_met ? "#16a34a" : "#dc2626" }]}>
                {quota.period_label}: ₱{quota.period_total.toFixed(2)} / ₱{quota.amount.toFixed(2)}
                {quota.period_met ? " — Quota met!" : ` — ₱${quota.period_remaining.toFixed(2)} remaining`}
              </Text>
            </View>

            {balance < quota.amount && (
              <View style={wt.warning}>
                <Ionicons name="warning-outline" size={13} color="#d97706" />
                <Text style={wt.warningText}>Balance below quota target. Earn more rides or top up first.</Text>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.sectionSub}>No quota assigned yet by your operator.</Text>
        )}
      </View>

      {/* Platform quota — Jeepney drivers only, separate from the operator's driver-quota cut */}
      {isJeepney && subStatus?.rate && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="card-outline" size={16} color="#1a4a52" />
            <Text style={styles.sectionTitle}>Platform Quota</Text>
          </View>
          <View style={wt.quotaRow}>
            <View>
              <Text style={wt.quotaFreq}>{subStatus.rate.frequency.toUpperCase()}</Text>
              <Text style={wt.quotaAmt}>₱{subStatus.rate.amount.toFixed(2)}</Text>
              <Text style={wt.quotaOp}>
                {subStatus.is_overdue ? "Due now" : `Next due ${subStatus.next_due_at}`}
              </Text>
            </View>
            <TouchableOpacity
              style={[wt.submitBtn, payingSub && { opacity: 0.6 }]}
              onPress={handlePaySubscription}
              disabled={payingSub}
              activeOpacity={0.85}
            >
              {payingSub
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="cash-outline" size={14} color="#fff" /><Text style={wt.submitBtnText}>Pay Now</Text></>}
            </TouchableOpacity>
          </View>
          {subStatus.is_overdue && (
            <View style={wt.warning}>
              <Ionicons name="warning-outline" size={13} color="#d97706" />
              <Text style={wt.warningText}>Your platform quota payment is due.</Text>
            </View>
          )}
        </View>
      )}

      {/* Recent submissions */}
      {submissions.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Recent Submissions</Text>
          {submissions.map(sub => (
            <View key={sub.id} style={wt.subRow}>
              <View>
                <Text style={wt.subAmt}>₱{sub.amount.toFixed(2)}</Text>
                <Text style={wt.subDate}>{fmtDate(sub.submitted_at)} · {sub.period_type}</Text>
              </View>
              <View style={[wt.badge, { backgroundColor: statusColor(sub.status) + "18" }]}>
                <Text style={[wt.badgeText, { color: statusColor(sub.status) }]}>{sub.status}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Withdrawal requests */}
      {withdrawals.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Withdrawal Requests</Text>
          {withdrawals.map(w => (
            <View key={w.id} style={wt.subRow}>
              <View>
                <Text style={wt.subAmt}>₱{w.amount.toFixed(2)}</Text>
                <Text style={wt.subDate}>Requested {fmtDate(w.requested_at)}</Text>
              </View>
              <View style={[wt.badge, { backgroundColor: withdrawalStatusColor(w.status) + "18" }]}>
                <Text style={[wt.badgeText, { color: withdrawalStatusColor(w.status) }]}>{withdrawalStatusLabel(w.status)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Transaction history */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Transaction History</Text>
        {transactions.length === 0
          ? <Text style={styles.sectionSub}>No transactions yet.</Text>
          : transactions.map((txn, i) => (
            <View key={i} style={wt.txnRow}>
              <View style={[wt.txnIcon, { backgroundColor: txn.type === "credit" ? "#f0fdf4" : "#fef2f2" }]}>
                <Ionicons name={txn.type === "credit" ? "arrow-down-outline" : "arrow-up-outline"} size={15} color={txn.type === "credit" ? "#16a34a" : "#dc2626"} />
              </View>
              <View style={wt.txnMid}>
                <Text style={wt.txnLabel}>{refLabel(txn.reference_type)}</Text>
                <Text style={wt.txnDate}>{fmtDate(txn.created_at)}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[wt.txnAmt, { color: txn.type === "credit" ? "#16a34a" : "#dc2626" }]}>{txn.type === "credit" ? "+" : "−"}₱{txn.amount.toFixed(2)}</Text>
                <Text style={wt.txnBal}>bal ₱{txn.balance_after.toFixed(2)}</Text>
              </View>
            </View>
          ))
        }
      </View>

      {/* Top-up modal — real PayMongo GCash (Demo) checkout,
          same flow as the commuter wallet (wallet.tsx) */}
      <Modal
        visible={topupVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { setTopupVisible(false); setTopupError(""); }}
      >
        <View style={wt.overlay}><View style={[wt.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
          <KeyboardAwareForm keyboardShouldPersistTaps="handled">
          <View style={wt.handle} />
          <Text style={wt.sheetTitle}>Top Up Wallet</Text>
          <Text style={wt.sheetSub}>Current balance: ₱{balance.toFixed(2)}</Text>

          <Text style={wt.fieldLabel}>Amount (₱)</Text>
          <View style={wt.amountsGrid}>
            {TOPUP_AMOUNTS.map((a) => (
              <TouchableOpacity
                key={a}
                style={[wt.amountBtn, topupSelected === a && wt.amountBtnActive]}
                onPress={() => { setTopupSelected(a); setTopupCustom(""); }}
                activeOpacity={0.8}
              >
                <Text style={[wt.amountText, topupSelected === a && wt.amountTextActive]}>₱{a}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[wt.input, wt.inputLg]}
            placeholder="Custom amount"
            placeholderTextColor="#9ca3af"
            value={topupCustom}
            onChangeText={(v) => { setTopupCustom(v); setTopupSelected(null); }}
            keyboardType="decimal-pad"
          />

          {!!topupError && <Text style={wt.errorText}>{topupError}</Text>}

          <Text style={wt.demoNote}>Demo payment methods — sandbox transactions for testing, not real charges.</Text>
          <View style={wt.methodRow}>
            {(() => {
              const amount = topupSelected ?? (topupCustom ? parseFloat(topupCustom) : 0);
              const amountValid = amount > 0;
              const busy = topupProcessing || topupVerifying;
              return (
                <>
                  <TouchableOpacity
                    style={[wt.methodBtn, wt.methodGcash, (!amountValid || busy) && wt.methodBtnDisabled]}
                    onPress={() => handlePayTopup("gcash")}
                    disabled={!amountValid || busy}
                    activeOpacity={0.8}
                  >
                    {topupProcessing ? <ActivityIndicator color="#fff" size="small" /> : (
                      <Text style={wt.methodBtnText}>{topupVerifying ? "Verifying…" : "GCash (Demo)"}</Text>
                    )}
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>

          {pendingTopupSource && !topupVerifying && !!topupError && (
            <TouchableOpacity style={wt.retryBtn} onPress={retryVerifyTopup} activeOpacity={0.8}>
              <Ionicons name="refresh" size={14} color="#1a4a52" />
              <Text style={wt.retryText}>Retry verification</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={wt.closeBtn} onPress={() => { setTopupVisible(false); setTopupError(""); }}>
            <Text style={wt.cancelText}>Close</Text>
          </TouchableOpacity>
          </KeyboardAwareForm>
        </View></View>
      </Modal>

      {/* Withdraw modal */}
      <Modal visible={withdrawVisible} transparent animationType="slide" onRequestClose={() => setWithdrawVisible(false)}>
        <View style={wt.overlay}><View style={[wt.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
          <KeyboardAwareForm keyboardShouldPersistTaps="handled">
          <View style={wt.handle} />
          <Text style={wt.sheetTitle}>Withdraw</Text>
          <Text style={wt.sheetSub}>Available balance: ₱{balance.toFixed(2)}</Text>
          <Text style={wt.fieldLabel}>Amount (₱)</Text>
          <TextInput style={[wt.input, wt.inputLg]} placeholder="e.g. 500.00" placeholderTextColor="#9ca3af" value={withdrawAmount} onChangeText={setWithdrawAmount} keyboardType="decimal-pad" autoFocus />
          <Text style={wt.hint}>Funds are debited now; your request stays Pending until an admin releases it.</Text>
          <View style={wt.actions}>
            <TouchableOpacity style={wt.cancelBtn} onPress={() => setWithdrawVisible(false)}><Text style={wt.cancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[wt.confirmBtn, withdrawBusy && { opacity: 0.6 }]} onPress={handleWithdraw} disabled={withdrawBusy}>
              {withdrawBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={wt.confirmText}>Withdraw</Text>}
            </TouchableOpacity>
          </View>
          </KeyboardAwareForm>
        </View></View>
      </Modal>

      {/* Submit quota modal */}
      <Modal visible={submitVisible} transparent animationType="slide" onRequestClose={() => setSubmitVisible(false)}>
        <View style={wt.overlay}><View style={[wt.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
          <KeyboardAwareForm keyboardShouldPersistTaps="handled">
          <View style={wt.handle} />
          <Text style={wt.sheetTitle}>Submit Quota</Text>
          <Text style={wt.sheetSub}>{quota ? `${quota.frequency} target: ₱${quota.amount.toFixed(2)}` : ""}  ·  Balance: ₱{balance.toFixed(2)}</Text>
          <Text style={wt.fieldLabel}>Amount (₱)</Text>
          <TextInput style={[wt.input, wt.inputLg]} placeholder="e.g. 500.00" placeholderTextColor="#9ca3af" value={submitAmount} onChangeText={setSubmitAmount} keyboardType="decimal-pad" />
          <Text style={wt.fieldLabel}>Note (optional)</Text>
          <TextInput style={wt.input} placeholder="e.g. Day 3 remittance" placeholderTextColor="#9ca3af" value={submitNote} onChangeText={setSubmitNote} />
          <Text style={wt.hint}>Amount is deducted from your wallet. Operator must confirm receipt.</Text>
          <View style={wt.actions}>
            <TouchableOpacity style={wt.cancelBtn} onPress={() => setSubmitVisible(false)}><Text style={wt.cancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[wt.confirmBtn, submitBusy && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitBusy}>
              {submitBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={wt.confirmText}>Submit</Text>}
            </TouchableOpacity>
          </View>
          </KeyboardAwareForm>
        </View></View>
      </Modal>
    </ScrollView>
  );
}

const wt = StyleSheet.create({
  toast:        { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, padding: 12, marginBottom: 4 },
  toastText:    { flex: 1, color: "#fff", fontSize: 13, fontWeight: "700" },
  balCard:      { backgroundColor: "#1a4a52", borderRadius: 20, padding: 24, alignItems: "center", gap: 8, shadowColor: "#1a4a52", shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  balLabel:     { fontSize: 11, fontWeight: "800", color: "#a8d832", letterSpacing: 1.2 },
  balAmount:    { fontSize: 42, fontWeight: "900", color: "#fff" },
  // Both buttons share the row equally (flex:1) instead of each being as wide as
  // its padding + label — together they were too wide for the card on a 320px
  // phone and left almost no padding on the right.
  balActions:   { flexDirection: "row", gap: 10, marginTop: 4, alignSelf: "stretch" },
  topupBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#a8d832", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  topupBtnText: { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  withdrawBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  withdrawBtnText: { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  quotaRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  quotaFreq:    { fontSize: 9, fontWeight: "800", color: "#6b7280", letterSpacing: 0.8 },
  quotaAmt:     { fontSize: 28, fontWeight: "900", color: "#1a4a52", marginTop: 2 },
  quotaOp:      { fontSize: 11, color: "#9ca3af", fontWeight: "600", marginTop: 2 },
  submitBtn:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1a4a52", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  submitBtnText:{ fontSize: 13, fontWeight: "800", color: "#fff" },
  warning:      { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#fffbeb", borderRadius: 10, padding: 10, marginTop: 12, borderWidth: 1, borderColor: "#fcd34d" },
  warningText:  { flex: 1, fontSize: 11, color: "#92400e", fontWeight: "600", lineHeight: 16 },
  subRow:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  subAmt:       { fontSize: 16, fontWeight: "900", color: "#1a4a52" },
  subDate:      { fontSize: 11, color: "#9ca3af" },
  progressChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
  progressText: { fontSize: 12, fontWeight: "700", flex: 1 },
  badge:        { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText:    { fontSize: 11, fontWeight: "800" },
  txnRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  txnIcon:      { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  txnMid:       { flex: 1 },
  txnLabel:     { fontSize: 13, fontWeight: "700", color: "#111827" },
  txnDate:      { fontSize: 10, color: "#9ca3af" },
  txnAmt:       { fontSize: 14, fontWeight: "900" },
  txnBal:       { fontSize: 10, color: "#9ca3af" },
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },
  sheetTitle:   { fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  sheetSub:     { fontSize: 12, color: "#6b7280", fontWeight: "600", marginBottom: 18 },
  fieldLabel:   { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  input:        { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#f9fafb", marginBottom: 14 },
  inputLg:      { fontSize: 22, fontWeight: "800", color: "#1a4a52" },
  hint:         { fontSize: 11, color: "#9ca3af", marginBottom: 20 },
  actions:      { flexDirection: "row", gap: 10 },
  cancelBtn:    { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  cancelText:   { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  confirmBtn:   { flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: "#1a4a52", alignItems: "center" },
  confirmText:  { fontSize: 14, fontWeight: "800", color: "#fff" },

  closeBtn:     { paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center", marginTop: 12 },

  amountsGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  amountBtn:        { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: "#e5e7eb", backgroundColor: "#fff" },
  amountBtnActive:  { backgroundColor: "#1a4a52", borderColor: "#1a4a52" },
  amountText:       { fontSize: 13, fontWeight: "700", color: "#374151" },
  amountTextActive: { color: "#fff" },

  demoNote:  { fontSize: 11, color: "#9ca3af", marginTop: 4, marginBottom: 10 },
  errorText: { fontSize: 12, color: "#dc2626", fontWeight: "600", marginBottom: 8 },

  methodRow: { flexDirection: "row", gap: 10 },
  methodBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 12 },
  methodGcash: { backgroundColor: "#0071bc" },
  methodBtnDisabled: { opacity: 0.45 },
  methodBtnText: { fontSize: 13, fontWeight: "800", color: "#fff" },

  retryBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, marginTop: 10, borderWidth: 1.5, borderColor: "#1a4a52", borderRadius: 10 },
  retryText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
});

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#f9fafb" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  content:     { flex: 1 },
  mapContent:  { flex: 1 },

  topBar:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, backgroundColor: "#1a4a52" },
  // flex:1 + minWidth:0 so a long driver name shrinks/truncates instead of
  // running under the queue-status pill on narrow phones.
  topBarLeft:   { flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0, marginRight: 10 },
  vehicleBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  driverName:   { fontSize: 15, fontWeight: "800", color: "#fff" },
  driverSub:    { fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 1 },
  statusPill:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, flexShrink: 0 },
  statusDot:    { width: 7, height: 7, borderRadius: 4 },
  statusText:   { fontSize: 12, fontWeight: "700" },

  bottomNav:      { flexDirection: "row", backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#f3f4f6", paddingTop: 10 },
  navTab:         { flex: 1, alignItems: "center", gap: 4 },
  navLabel:       { fontSize: 11, fontWeight: "600", color: "#9ca3af" },
  navLabelActive: { color: "#1a4a52" },
  navActiveDot:   { width: 5, height: 5, borderRadius: 3, backgroundColor: "#1a4a52" },

  screenPad:       { padding: 20, gap: 16, paddingBottom: 32 },
  sectionCard:     { backgroundColor: "#fff", borderRadius: 16, padding: 18, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 },
  sectionTitle:    { fontSize: 15, fontWeight: "800", color: "#1a4a52", marginBottom: 14 },
  sectionSub:      { fontSize: 12, color: "#9ca3af", marginTop: 10 },
  summaryNote:     { fontSize: 11, color: "#9ca3af", marginTop: 10, textAlign: "center" },

  earningsHistoryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 14, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: "#1a4a52",
  },
  earningsHistoryBtnText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },

  dispatchStatusRow:   { marginBottom: 16 },
  dispatchStatusBadge: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  dispatchStatusText:  { fontSize: 14, fontWeight: "800" },
  dispatchHint:        { fontSize: 12, color: "#92400e", marginTop: 12, textAlign: "center" },

  stepRow:        { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  stepDotWrap:    { alignItems: "center", gap: 4 },
  stepDot:        { width: 32, height: 32, borderRadius: 16, backgroundColor: "#e5e7eb", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#e5e7eb" },
  stepDotActive:  { backgroundColor: "#1a4a52", borderColor: "#1a4a52" },
  stepDotCurrent: { backgroundColor: "#1a4a52", borderColor: "#4ade80", borderWidth: 3 },
  stepDotText:    { fontSize: 13, fontWeight: "800", color: "#9ca3af" },
  stepLabel:      { fontSize: 10, fontWeight: "700", color: "#9ca3af" },
  stepLine:       { flex: 1, height: 2, backgroundColor: "#e5e7eb", marginBottom: 14 },
  stepLineDone:   { backgroundColor: "#1a4a52" },

  actionBtn:              { borderRadius: 14, paddingVertical: 16, alignItems: "center", marginBottom: 8 },
  actionBtnQueue:         { backgroundColor: "#1a4a52" },
  actionBtnTrip:          { backgroundColor: "#0369a1" },
  actionBtnEnd:           { backgroundColor: "#f0fdf4", borderWidth: 1.5, borderColor: "#86efac" },
  actionBtnInner:         { flexDirection: "row", alignItems: "center", gap: 8 },
  actionBtnText:          { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: 0.3 },
  actionBtnSecondary:     { borderRadius: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1.5, borderColor: "#fecaca", backgroundColor: "#fef2f2", marginBottom: 8 },
  actionBtnSecondaryText: { fontSize: 14, fontWeight: "700", color: "#dc2626" },

  waitingBox:   { alignItems: "center", gap: 6, backgroundColor: "#fffbeb", borderRadius: 14, padding: 20, borderWidth: 1.5, borderColor: "#fde68a", marginBottom: 12 },
  waitingTitle: { fontSize: 16, fontWeight: "900", color: "#92400e" },
  waitingText:  { fontSize: 13, fontWeight: "700", color: "#b45309", textAlign: "center" },
  waitingHint:  { fontSize: 11, color: "#d97706", textAlign: "center" },

  nextUpBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f0fdf4", borderRadius: 12, padding: 12, borderWidth: 1.5, borderColor: "#86efac", marginBottom: 10, justifyContent: "center" },
  nextUpText:   { fontSize: 13, fontWeight: "700", color: "#15803d" },

  tripEndedBox:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#eff6ff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#bfdbfe", marginBottom: 12 },
  tripEndedText: { fontSize: 13, fontWeight: "700", color: "#1d4ed8" },

  statsRow:  { flexDirection: "row", gap: 10 },
  statBox:   { flex: 1, backgroundColor: "#f9fafb", borderRadius: 12, padding: 14, alignItems: "center", gap: 4 },
  statValue: { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  statLabel: { fontSize: 11, color: "#9ca3af", fontWeight: "600" },

  infoRow:   { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  infoLabel: { fontSize: 13, color: "#6b7280", fontWeight: "600" },
  infoValue: { fontSize: 13, color: "#111827", fontWeight: "700", flexShrink: 1, textAlign: "right", maxWidth: "60%" },

  routeCard:        { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#f9fafb", borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#e5e7eb" },
  routeColorBar:    { width: 5, alignSelf: "stretch" },
  routeCardBody:    { flex: 1, paddingVertical: 14, gap: 4 },
  routeCardName:    { fontSize: 15, fontWeight: "800", color: "#1a4a52" },
  routeCardMeta:    { flexDirection: "row", alignItems: "center", gap: 4 },
  routeCardMetaText:{ fontSize: 12, color: "#9ca3af" },
  routeActiveBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#f0fdf4", paddingHorizontal: 12, paddingVertical: 6, marginRight: 12, borderRadius: 20 },
  routeActiveDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: "#16a34a" },
  routeActiveText:  { fontSize: 11, fontWeight: "800", color: "#16a34a" },
  noRouteBox:       { alignItems: "center", paddingVertical: 20, gap: 6 },
  noRouteText:      { fontSize: 14, fontWeight: "800", color: "#374151" },
  noRouteSub:       { fontSize: 12, color: "#9ca3af", textAlign: "center", lineHeight: 18 },

  logoutBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fef2f2", borderRadius: 14, paddingVertical: 15, borderWidth: 1, borderColor: "#fecaca" },
  logoutText: { fontSize: 15, fontWeight: "800", color: "#dc2626" },

  profileAvatarWrap: { alignItems: "center", gap: 8, marginBottom: 4 },
  driverNameLg: { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  profileStatusPill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  profileStatusDot: { width: 7, height: 7, borderRadius: 4 },
  profileStatusText: { fontSize: 12, fontWeight: "700" },

  actionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  actionRowBorder: { borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  actionLabel: { flex: 1, fontSize: 14, fontWeight: "700", color: "#374151" },

  scanBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, paddingVertical: 13, marginTop: 12 },
  scanBtnText: { fontSize: 14, fontWeight: "800", color: "#fff" },
});

const bk = StyleSheet.create({
  empty:     { alignItems: "center", paddingVertical: 16, gap: 6 },
  emptyText: { fontSize: 13, color: "#9ca3af", fontWeight: "600" },
  row:       { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  iconWrap:  { width: 32, height: 32, borderRadius: 16, backgroundColor: "#f0fdf4", alignItems: "center", justifyContent: "center" },
  mid:       { flex: 1, gap: 2 },
  name:      { fontSize: 13, fontWeight: "800", color: "#111827" },
  route:     { fontSize: 11, color: "#6b7280", fontWeight: "600" },
  time:      { fontSize: 11, color: "#9ca3af" },
  right:     { alignItems: "flex-end", gap: 2 },
  fare:      { fontSize: 14, fontWeight: "900", color: "#1a4a52" },
  pax:       { fontSize: 11, color: "#6b7280", fontWeight: "600", textTransform: "capitalize" },

  uvStatusText: { fontSize: 14, fontWeight: "800", color: "#1a4a52" },

  statusBadge:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0faf4", borderRadius: 10, padding: 10, marginBottom: 8 },
  statusBadgeText: { flex: 1, fontSize: 12, fontWeight: "700", color: "#1a4a52" },
  tripActionBtn:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#f0faf4", borderRadius: 10, paddingVertical: 11, borderWidth: 1, borderColor: "#1a4a52" },
  tripActionBtnText:  { fontSize: 13, fontWeight: "800", color: "#1a4a52" },
  tripActionBtnAlt:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#1a4a52", borderRadius: 10, paddingVertical: 11 },
  tripActionBtnAltText:  { fontSize: 13, fontWeight: "800", color: "#fff" },
  timeHint:              { fontSize: 12, color: "#9ca3af", fontWeight: "600", marginBottom: 8 },
});