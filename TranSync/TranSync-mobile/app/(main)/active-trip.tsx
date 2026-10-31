import { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Animated,
} from "react-native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import API_BASE from "../../src/config/api";

const AUTO_END_DISTANCE_KM  = 0.3;
const AUTO_END_DELAY_MS     = 30_000;
const DRIVER_CONFIRM_TIMEOUT= 60_000; // 60s before auto-confirm

type LatLng = { latitude: number; longitude: number };

type ActiveRide = {
  ride_id:       number;
  driver_id:     number;
  driver_name:   string;
  driver_lat:    number;
  driver_lng:    number;
  board_lat:     number;
  board_lng:     number;
  board_time:    string;
  distance_km:   number;
  fare_amount:   number;
  discount_type: string;
  status:        string;
};

const BASE_FARE   = 13;
const BASE_KM     = 4;
const PER_KM_RATE = 1.80;

function roundToQuarter(n: number): number {
  return Math.round(n * 4) / 4;
}

function calcFare(distKm: number, discountType: string, isVerified: number): number {
  let fare = BASE_FARE;
  if (distKm > BASE_KM) fare += (distKm - BASE_KM) * PER_KM_RATE;
  if (["student", "disabled", "elderly"].includes(discountType) && isVerified === 1) fare *= 0.80;
  return roundToQuarter(fare);
}

function getDistanceKm(a: LatLng, b: LatLng): number {
  const R    = 6371;
  const dLat = ((b.latitude  - a.latitude)  * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.latitude  * Math.PI) / 180) *
    Math.cos((b.latitude  * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default function ActiveTrip() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ride_id, driver_name } = useLocalSearchParams<{
    ride_id: string; driver_name: string;
  }>();

  const rideId       = parseInt(ride_id ?? "0");
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoEndRef   = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const farAwayStart = useRef<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endingRef    = useRef(false);

  // Proximity "get off" alert — the destination the commuter pinned earlier in the
  // journey planner (same AsyncStorage key map.tsx writes), checked against the
  // jeepney's live position. Purely client-side, no backend changes.
  const destinationTargetRef = useRef<LatLng | null>(null);
  const nearNotifiedRef      = useRef(false);
  const arrivedNotifiedRef   = useRef(false);

  const [user,              setUser]              = useState<any>(null);
  const [ride,              setRide]              = useState<ActiveRide | null>(null);
  const [myLocation,        setMyLocation]        = useState<LatLng | null>(null);
  const [distanceTravelled, setDistanceTravelled] = useState(0);
  const [currentFare,       setCurrentFare]       = useState(BASE_FARE);
  const [ending,            setEnding]            = useState(false);
  const [ended,             setEnded]             = useState(false);
  const [endResult,         setEndResult]         = useState<any>(null);
  const [autoWarning,       setAutoWarning]       = useState(false);
  const [autoCountdown,     setAutoCountdown]     = useState(30);
  const [nearDestBanner,    setNearDestBanner]    = useState(false);
  const [arrivedBanner,     setArrivedBanner]     = useState(false);

  // Drop off request state
  const [dropoffRequested,   setDropoffRequested]   = useState(false);
  const [confirmCountdown,   setConfirmCountdown]   = useState(60);
  const [dropoffLocation,    setDropoffLocation]    = useState<LatLng | null>(null);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (raw) setUser(JSON.parse(raw));
      const destRaw = await AsyncStorage.getItem("destination");
      if (destRaw) {
        try { destinationTargetRef.current = JSON.parse(destRaw); } catch (_) {}
      }
    })();
  }, []);

  const triggerPulse = useCallback(() => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.08, duration: 150, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 150, useNativeDriver: true }),
    ]).start();
  }, [pulseAnim]);

  // ── Poll active ride every 5s ─────────────────────────────────────────
  useEffect(() => {
    if (!user || !rideId) return;

    const tick = async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const myCoords: LatLng = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setMyLocation(myCoords);

        const res  = await fetch(`${API_BASE}/trips/active_ride.php?commuter_id=${user.id}`);
        const data = await res.json();

        // Ride was ended by driver or server
        if (!data.active) {
          if (!endingRef.current) {
            clearInterval(pollRef.current!);
            router.replace("/(main)/home");
          }
          return;
        }

        setRide(data);

        // If driver confirmed drop off → end ride on commuter side
        if (data.status === 'active' && dropoffRequested) {
          // Status went back to active means driver confirmed — end_ride was
          // already called from driver side, ride is now completed
          // Check if it's actually completed (not found in active)
        }

        const boardCoords: LatLng = { latitude: data.board_lat, longitude: data.board_lng };
        const distKm = getDistanceKm(boardCoords, myCoords);
        setDistanceTravelled(distKm);

        const newFare = calcFare(distKm, data.discount_type, user.is_verified ?? 0);
        setCurrentFare(prev => {
          if (prev !== newFare) triggerPulse();
          return newFare;
        });

        // ── Auto-end: too far from driver ───────────────────────────────
        const driverCoords: LatLng = { latitude: data.driver_lat, longitude: data.driver_lng };
        const distFromDriver = getDistanceKm(myCoords, driverCoords);

        if (distFromDriver >= AUTO_END_DISTANCE_KM && !dropoffRequested) {
          if (farAwayStart.current === null) {
            farAwayStart.current = Date.now();
            setAutoWarning(true);
            setAutoCountdown(30);
            let secs = 30;
            countdownRef.current = setInterval(() => {
              secs -= 1;
              setAutoCountdown(secs);
              if (secs <= 0) clearInterval(countdownRef.current!);
            }, 1000);
            autoEndRef.current = setTimeout(() => {
              if (!endingRef.current) handleEndRide("auto", myCoords);
            }, AUTO_END_DELAY_MS);
          }
        } else {
          if (farAwayStart.current !== null) {
            farAwayStart.current = null;
            setAutoWarning(false);
            setAutoCountdown(30);
            if (autoEndRef.current)   clearTimeout(autoEndRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
          }
        }

        // ── Proximity "get off" alert — based on the jeepney's live position ────
        if (destinationTargetRef.current && !dropoffRequested) {
          const distToDestM = getDistanceKm(driverCoords, destinationTargetRef.current) * 1000;
          if (distToDestM <= 100 && !nearNotifiedRef.current) {
            nearNotifiedRef.current = true;
            setNearDestBanner(true);
          }
          if (distToDestM <= 20 && !arrivedNotifiedRef.current) {
            arrivedNotifiedRef.current = true;
            setArrivedBanner(true);
          }
        }

      } catch (_) {}
    };

    tick();
    pollRef.current = setInterval(tick, 5000);

    return () => {
      if (pollRef.current)          clearInterval(pollRef.current);
      if (autoEndRef.current)       clearTimeout(autoEndRef.current);
      if (countdownRef.current)     clearInterval(countdownRef.current);
      if (confirmTimeoutRef.current)  clearTimeout(confirmTimeoutRef.current);
      if (confirmCountdownRef.current)clearInterval(confirmCountdownRef.current);
    };
  }, [user, rideId, dropoffRequested]);

  // ── Request drop off (commuter taps Para) ─────────────────────────────
  const handleRequestDropOff = async () => {
    if (!myLocation) return;

    Alert.alert(
      "Para Po? 🛑",
      `Request drop off here? Fare so far: ₱${currentFare.toFixed(2)}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Para Po!",
          onPress: async () => {
            try {
              const res = await fetch(`${API_BASE}/trips/request_dropoff.php`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ride_id:     rideId,
                  dropoff_lat: myLocation.latitude,
                  dropoff_lng: myLocation.longitude,
                }),
              });
              const data = await res.json();
              if (data.success) {
                setDropoffRequested(true);
                setDropoffLocation(myLocation);
                setConfirmCountdown(60);
                setNearDestBanner(false);
                setArrivedBanner(false);

                // Start 60s countdown — auto-confirm if driver doesn't respond
                let secs = 60;
                confirmCountdownRef.current = setInterval(() => {
                  secs -= 1;
                  setConfirmCountdown(secs);
                  if (secs <= 0) clearInterval(confirmCountdownRef.current!);
                }, 1000);

                // Auto-confirm after 60s
                confirmTimeoutRef.current = setTimeout(() => {
                  if (!endingRef.current) handleEndRide("auto", myLocation);
                }, DRIVER_CONFIRM_TIMEOUT);
              }
            } catch (_) {
              Alert.alert("Error", "Network error. Please try again.");
            }
          },
        },
      ]
    );
  };

  // ── Cancel drop off request ───────────────────────────────────────────
  const handleCancelDropOff = async () => {
    // Reset status back to active on server
    try {
      await fetch(`${API_BASE}/trips/cancel_dropoff.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ride_id: rideId }),
      });
    } catch (_) {}
    setDropoffRequested(false);
    setDropoffLocation(null);
    setConfirmCountdown(60);
    if (confirmTimeoutRef.current)   clearTimeout(confirmTimeoutRef.current);
    if (confirmCountdownRef.current) clearInterval(confirmCountdownRef.current);
  };

  // ── End ride (called by auto-confirm or driver confirmation) ──────────
  const handleEndRide = async (triggeredBy: "commuter" | "auto", coords?: LatLng) => {
    if (endingRef.current) return;
    endingRef.current = true;
    setEnding(true);

    if (autoEndRef.current)          clearTimeout(autoEndRef.current);
    if (countdownRef.current)        clearInterval(countdownRef.current);
    if (pollRef.current)             clearInterval(pollRef.current);
    if (confirmTimeoutRef.current)   clearTimeout(confirmTimeoutRef.current);
    if (confirmCountdownRef.current) clearInterval(confirmCountdownRef.current);

    const location = coords ?? dropoffLocation ?? myLocation;

    try {
      const res  = await fetch(`${API_BASE}/trips/end_ride.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ride_id:      rideId,
          dropoff_lat:  location?.latitude  ?? 0,
          dropoff_lng:  location?.longitude ?? 0,
          triggered_by: triggeredBy,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEndResult(data);
        setEnding(false);
        setEnded(true);
      } else {
        Alert.alert("Error", data.message ?? "Failed to end ride.");
        endingRef.current = false;
        setEnding(false);
      }
    } catch (_) {
      Alert.alert("Error", "Network error. Please try again.");
      endingRef.current = false;
      setEnding(false);
    }
  };

  // ── Receipt screen ────────────────────────────────────────────────────
  if (ended && endResult) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.endedScreen}>
          <Text style={styles.endedIcon}>🎉</Text>
          <Text style={styles.endedTitle}>Trip Complete!</Text>
          <Text style={styles.endedSub}>Thanks for riding with TranSync</Text>
          <View style={styles.receiptBox}>
            <ReceiptRow label="Driver"         value={driver_name ?? "—"} />
            <ReceiptRow label="Distance"       value={`${endResult.distance_km?.toFixed(2)} km`} />
            <ReceiptRow label="Fare Charged"   value={`₱${endResult.fare_charged?.toFixed(2)}`} highlight />
            <ReceiptRow label="Wallet Balance" value={`₱${endResult.wallet_balance?.toFixed(2)}`} />
          </View>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => router.replace("/(main)/home")}
            activeOpacity={0.85}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Active trip screen ────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>🚌 On Trip</Text>
        <Text style={styles.headerSub}>{driver_name}</Text>
      </View>

      {/* Auto-end warning */}
      {autoWarning && !dropoffRequested && (
        <View style={styles.autoWarningBox}>
          <Text style={styles.autoWarningText}>
            ⚠️ You seem to be off the jeepney. Auto drop-off in {autoCountdown}s
          </Text>
          <TouchableOpacity
            style={styles.stayBtn}
            onPress={() => {
              farAwayStart.current = null;
              setAutoWarning(false);
              setAutoCountdown(30);
              if (autoEndRef.current)   clearTimeout(autoEndRef.current);
              if (countdownRef.current) clearInterval(countdownRef.current);
            }}
          >
            <Text style={styles.stayBtnText}>Still on jeep</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Proximity alerts */}
      {arrivedBanner && !dropoffRequested && (
        <View style={styles.arrivedBox}>
          <Text style={styles.arrivedText}>
            🔔 Get off now — you've arrived at your destination!
          </Text>
          <TouchableOpacity onPress={() => setArrivedBanner(false)}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}
      {nearDestBanner && !arrivedBanner && !dropoffRequested && (
        <View style={styles.nearDestBox}>
          <Text style={styles.nearDestText}>
            📍 You're about 100m from your destination — get ready.
          </Text>
          <TouchableOpacity onPress={() => setNearDestBanner(false)}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Waiting for driver confirmation banner */}
      {dropoffRequested && (
        <View style={styles.waitingBox}>
          <View style={styles.waitingRow}>
            <ActivityIndicator color="#d97706" size="small" />
            <Text style={styles.waitingText}>
              Waiting for driver confirmation… {confirmCountdown}s
            </Text>
          </View>
          <Text style={styles.waitingNote}>
            Driver will be auto-confirmed if no response in {confirmCountdown}s
          </Text>
          <TouchableOpacity style={styles.cancelDropOffBtn} onPress={handleCancelDropOff}>
            <Text style={styles.cancelDropOffText}>Cancel Request</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Fare meter */}
      <View style={styles.meterSection}>
        <Text style={styles.meterLabel}>Current Fare</Text>
        <Animated.Text style={[styles.meterFare, { transform: [{ scale: pulseAnim }] }]}>
          ₱{currentFare.toFixed(2)}
        </Animated.Text>
        <Text style={styles.meterDistance}>
          {distanceTravelled.toFixed(2)} km travelled
        </Text>
        <Text style={styles.meterNote}>
          Fare updates as you travel • Rounded to ₱0.25
        </Text>
      </View>

      {/* Trip stats */}
      <View style={styles.statsRow}>
        <StatBox icon="📍" label="Board Point" value="Recorded" />
        <StatBox icon="🚌" label="Driver"      value={driver_name ?? "—"} />
        <StatBox
          icon="⏱️"
          label="Duration"
          value={ride?.board_time
            ? `${Math.round((Date.now() - new Date(ride.board_time).getTime()) / 60000)} min`
            : "—"}
        />
      </View>

      {/* Bottom action */}
      <View style={[styles.dropOffSection, { paddingBottom: 24 + insets.bottom }]}>
        {ending ? (
          <View style={styles.endingBox}>
            <ActivityIndicator color="#1a4a52" size="large" />
            <Text style={styles.endingText}>Processing payment…</Text>
          </View>
        ) : dropoffRequested ? (
          <View style={styles.pendingBox}>
            <Text style={styles.pendingIcon}>🙋</Text>
            <Text style={styles.pendingText}>Para po request sent!</Text>
            <Text style={styles.pendingNote}>
              Driver is confirming your drop off…
            </Text>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.dropOffBtn}
              onPress={handleRequestDropOff}
              activeOpacity={0.85}
            >
              <Text style={styles.dropOffBtnText}>🙋 Para Po!</Text>
            </TouchableOpacity>
            <Text style={styles.dropOffHint}>
              Tap when you want to get off the jeepney
            </Text>
          </>
        )}
      </View>

    </View>
  );
}

function StatBox({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ReceiptRow({ label, value, highlight }: {
  label: string; value: string; highlight?: boolean;
}) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text style={[styles.receiptValue, highlight && { color: "#1a4a52", fontSize: 16 }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#f9fafb" },

  header:     { backgroundColor: "#1a4a52", paddingHorizontal: 20, paddingVertical: 16, paddingBottom: 20 },
  headerTitle:{ fontSize: 20, fontWeight: "900", color: "#fff" },
  headerSub:  { fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 2 },

  autoWarningBox:  { backgroundColor: "#fef2f2", borderBottomWidth: 1, borderBottomColor: "#fecaca", padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  autoWarningText: { flex: 1, fontSize: 13, color: "#dc2626", fontWeight: "700" },
  stayBtn:         { backgroundColor: "#dc2626", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  stayBtnText:     { fontSize: 12, fontWeight: "800", color: "#fff" },

  nearDestBox:  { backgroundColor: "#eff6ff", borderBottomWidth: 1, borderBottomColor: "#bfdbfe", padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  nearDestText: { flex: 1, fontSize: 13, color: "#1d4ed8", fontWeight: "700" },
  arrivedBox:   { backgroundColor: "#f0fdf4", borderBottomWidth: 1, borderBottomColor: "#bbf7d0", padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  arrivedText:  { flex: 1, fontSize: 13, color: "#15803d", fontWeight: "800" },
  dismissText:  { fontSize: 12, fontWeight: "700", color: "#6b7280" },

  waitingBox:       { backgroundColor: "#fffbeb", borderBottomWidth: 1, borderBottomColor: "#fde68a", padding: 14, gap: 6 },
  waitingRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  waitingText:      { fontSize: 13, color: "#92400e", fontWeight: "700" },
  waitingNote:      { fontSize: 11, color: "#b45309" },
  cancelDropOffBtn: { alignSelf: "flex-start", paddingVertical: 4 },
  cancelDropOffText:{ fontSize: 12, color: "#dc2626", fontWeight: "700" },

  meterSection:  { alignItems: "center", paddingVertical: 36, backgroundColor: "#fff", marginHorizontal: 20, marginTop: 20, borderRadius: 20, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  meterLabel:    { fontSize: 13, color: "#9ca3af", fontWeight: "600", marginBottom: 8 },
  meterFare:     { fontSize: 56, fontWeight: "900", color: "#1a4a52", letterSpacing: -1 },
  meterDistance: { fontSize: 16, color: "#374151", fontWeight: "700", marginTop: 8 },
  meterNote:     { fontSize: 11, color: "#9ca3af", marginTop: 6 },

  statsRow: { flexDirection: "row", gap: 12, marginHorizontal: 20, marginTop: 16 },
  statBox:  { flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 14, alignItems: "center", gap: 4, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  statIcon: { fontSize: 20 },
  statValue:{ fontSize: 12, fontWeight: "800", color: "#1a4a52", textAlign: "center" },
  statLabel:{ fontSize: 10, color: "#9ca3af", fontWeight: "600" },

  dropOffSection: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 24, backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 12, elevation: 8 },
  dropOffBtn:     { backgroundColor: "#1a4a52", borderRadius: 16, paddingVertical: 18, alignItems: "center" },
  dropOffBtnText: { fontSize: 18, fontWeight: "900", color: "#fff", letterSpacing: 0.5 },
  dropOffHint:    { fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 10 },

  pendingBox:  { alignItems: "center", gap: 6, paddingVertical: 8 },
  pendingIcon: { fontSize: 32 },
  pendingText: { fontSize: 16, fontWeight: "800", color: "#1a4a52" },
  pendingNote: { fontSize: 12, color: "#6b7280", textAlign: "center" },

  endingBox:  { alignItems: "center", gap: 12, paddingVertical: 8 },
  endingText: { fontSize: 14, color: "#1a4a52", fontWeight: "700" },

  endedScreen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  endedIcon:   { fontSize: 64 },
  endedTitle:  { fontSize: 26, fontWeight: "900", color: "#1a4a52" },
  endedSub:    { fontSize: 14, color: "#6b7280" },

  receiptBox:   { backgroundColor: "#fff", borderRadius: 16, padding: 20, width: "100%", gap: 12, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  receiptRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  receiptLabel: { fontSize: 13, color: "#6b7280", fontWeight: "600" },
  receiptValue: { fontSize: 14, fontWeight: "800", color: "#111827" },

  doneBtn:     { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 56, marginTop: 8, width: "100%", alignItems: "center" },
  doneBtnText: { fontSize: 16, fontWeight: "800", color: "#fff" },
});