import { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Switch, Animated, Modal,
  Alert, ScrollView, Platform, AppState, Linking,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

type LatLng = { latitude: number; longitude: number };

type AssignedRoute = {
  id:        number;
  name:      string;
  color:     string;
  waypoints: LatLng[];
};

type NearbyCommuter = {
  id: number;
  name: string;
  category: "default" | "student" | "disabled" | "elderly";
  latitude: number;
  longitude: number;
  destination_lat: number | null;
  destination_lng: number | null;
  distance_km: number;
};

type DropoffRequest = {
  ride_id:       number;
  commuter_id:   number;
  commuter_name: string;
  category:      string;
  dropoff_lat:   number;
  dropoff_lng:   number;
  fare_amount:   number;
  distance_km:   number;
  discount_type: string;
};

type User = {
  id: number;
  name: string;
  operator_name: string;
  operator_type: string;
  is_full: number;
  is_online: number;
};

type RideNotif = {
  ride_id: number;
  commuter_name: string;
  category: string;
  is_verified: number;
};

const CATEGORY_ICON: Record<string, IoniconsName> = {
  default:  "person-outline",
  student:  "school-outline",
  disabled: "accessibility-outline",
  elderly:  "person",
};

const BASE_FARE   = 13;
const BASE_KM     = 4;
const PER_KM_RATE = 1.80;

function roundToQuarter(n: number): number { return Math.round(n * 4) / 4; }

function calcFare(distKm: number, discountType: string): number {
  let fare = BASE_FARE;
  if (distKm > BASE_KM) fare += (distKm - BASE_KM) * PER_KM_RATE;
  if (["student", "disabled", "elderly"].includes(discountType)) fare *= 0.80;
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

export default function DriverMap({ assignedRoute: propRoute }: { assignedRoute?: AssignedRoute | null }) {
  const insets          = useSafeAreaInsets();
  const mapRef          = useRef<MapView>(null);
  const locationPingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ridePollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropoffPollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const sheetAnim       = useRef(new Animated.Value(0)).current;
  const lastRideIdRef   = useRef<number>(0);

  const [user,             setUser]             = useState<User | null>(null);
  const [myLocation,       setMyLocation]       = useState<LatLng | null>(null);
  const [commuters,        setCommuters]        = useState<NearbyCommuter[]>([]);
  const [selected,         setSelected]         = useState<NearbyCommuter | null>(null);
  const [isFull,           setIsFull]           = useState(false);
  const [locationError,    setLocError]         = useState("");
  const [loading,          setLoading]          = useState(true);
  const [locStatus, setLocStatus] = useState<
    "checking" | "permission_denied" | "services_disabled" | "error" | "ready"
  >("checking");
  const myLocationRef = useRef<LatLng | null>(null);
  const [showEmergency,    setShowEmergency]    = useState(false);
  const [emergencySent,    setEmergencySent]    = useState(false);
  const [emergencyError,   setEmergencyError]   = useState("");
  const [emergencyNoLoc,   setEmergencyNoLoc]   = useState(false);
  const [sending,          setSending]          = useState(false);
  const [rideNotif,        setRideNotif]        = useState<RideNotif | null>(null);
  const [showRideNotif,    setShowRideNotif]    = useState(false);
  const [assignedRoute,    setAssignedRoute]    = useState<AssignedRoute | null>(propRoute ?? null);

  // Keep local state in sync when the prop updates (e.g. after association assigns)
  useEffect(() => {
    if (propRoute !== undefined) setAssignedRoute(propRoute);
  }, [propRoute]);

  const [dropoffRequests,   setDropoffRequests]   = useState<DropoffRequest[]>([]);
  const [confirmingDropoff, setConfirmingDropoff] = useState<DropoffRequest | null>(null);
  const [confirmingRide,    setConfirmingRide]    = useState(false);

  // ── Load user ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (raw) {
        const u = JSON.parse(raw);
        setUser(u);
        setIsFull(u.is_full === 1);
        fetchAssignedRoute(u.id);
      }
    })();
  }, []);

  const fetchAssignedRoute = useCallback(async (driverId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/drivers/get_driver_route.php?driver_id=${driverId}`);
      const data = await res.json();
      if (data.success && data.assigned && data.route?.waypoints?.length > 1) {
        setAssignedRoute(data.route);
      } else {
        setAssignedRoute(null);
      }
    } catch (_) {}
  }, []);

  // Same state machine as the commuter map (app/(main)/map.tsx) — checks
  // services-enabled and permission separately, times out a stalled GPS fix
  // instead of hanging forever, and is re-runnable from the "Try Again"
  // button and an AppState foreground listener below. Previously this was a
  // plain mount-only effect with no try/catch at all around
  // getCurrentPositionAsync — a thrown error (services disabled, timeout,
  // any native failure) left the screen stuck on the loading spinner forever
  // (setLoading(false) on the next line never ran), and there was no way to
  // recover without a full app restart.
  const checkAndFetchLocation = useCallback(async () => {
    setLocError("");
    setLocStatus("checking");
    setLoading(true);
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setLocStatus("services_disabled");
        setLocError("Location services are turned off. Please enable them to continue.");
        return;
      }

      let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        const requested = await Location.requestForegroundPermissionsAsync();
        status      = requested.status;
        canAskAgain = requested.canAskAgain;
      }
      if (status !== "granted") {
        setLocStatus("permission_denied");
        setLocError(
          canAskAgain === false
            ? "Location permission was denied. Please enable it manually from your device Settings."
            : "Location permission is required to use the map."
        );
        return;
      }

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
    } catch {
      setLocStatus("error");
      setLocError("Could not get your location. Please check your signal and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAndFetchLocation();
  }, [checkAndFetchLocation]);

  // Re-check on returning from the OS Settings app — see the identical
  // comment in app/(main)/map.tsx for why a plain useFocusEffect can't catch
  // this transition (it only fires on in-app navigation, not on the app
  // being backgrounded/foregrounded around a Settings visit).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && !myLocationRef.current) {
        checkAndFetchLocation();
      }
    });
    return () => sub.remove();
  }, [checkAndFetchLocation]);

  useFocusEffect(
    useCallback(() => {
      const start = async () => {
        const raw = await AsyncStorage.getItem("user");
        if (!raw) return;
        const u = JSON.parse(raw);

        // Refresh the assigned route every time the map tab comes into focus
        fetchAssignedRoute(u.id);

        locationPingRef.current = setInterval(async () => {
          try {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            setMyLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            await fetch(`${API_BASE}/drivers/update_driver_location.php`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                driver_id: u.id, latitude: loc.coords.latitude,
                longitude: loc.coords.longitude, heading: loc.coords.heading ?? 0, is_online: 1,
              }),
            });
            fetchNearbyCommuters(u.id, loc.coords.latitude, loc.coords.longitude);
          } catch (_) {}
        }, 3000);
      };
      start();
      return () => {
        if (locationPingRef.current) clearInterval(locationPingRef.current);
        AsyncStorage.getItem("user").then(raw => {
          if (!raw) return;
          const u = JSON.parse(raw);
          fetch(`${API_BASE}/drivers/update_driver_location.php`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ driver_id: u.id, latitude: 0, longitude: 0, is_online: 0 }),
          }).catch(() => {});
        });
      };
    }, [fetchAssignedRoute])
  );

  useFocusEffect(
    useCallback(() => {
      const poll = async () => {
        const raw = await AsyncStorage.getItem("user");
        if (!raw) return;
        const u = JSON.parse(raw);
        ridePollRef.current = setInterval(async () => {
          try {
            const res  = await fetch(`${API_BASE}/trips/latest_ride.php?driver_id=${u.id}&after_id=${lastRideIdRef.current}`);
            const data = await res.json();
            if (data.found && data.ride_id > lastRideIdRef.current) {
              lastRideIdRef.current = data.ride_id;
              setRideNotif(data);
              setShowRideNotif(true);
            }
          } catch (_) {}
        }, 5000);
      };
      poll();
      return () => { if (ridePollRef.current) clearInterval(ridePollRef.current); };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      const pollDropoffs = async () => {
        const raw = await AsyncStorage.getItem("user");
        if (!raw) return;
        const u = JSON.parse(raw);
        dropoffPollRef.current = setInterval(async () => {
          try {
            const res  = await fetch(`${API_BASE}/trips/active_ride.php?driver_id=${u.id}`);
            const data = await res.json();
            if (data.dropoff_requests && data.dropoff_requests.length > 0) {
              setDropoffRequests(data.dropoff_requests);
              if (!confirmingDropoff) setConfirmingDropoff(data.dropoff_requests[0]);
            } else {
              setDropoffRequests([]);
            }
          } catch (_) {}
        }, 3000);
      };
      pollDropoffs();
      return () => { if (dropoffPollRef.current) clearInterval(dropoffPollRef.current); };
    }, [confirmingDropoff])
  );

  const fetchNearbyCommuters = async (driverId: number, lat: number, lng: number) => {
    try {
      const res  = await fetch(`${API_BASE}/commuter/nearby_commuters.php?driver_id=${driverId}&lat=${lat}&lng=${lng}`);
      const data = await res.json();
      if (data.commuters && Array.isArray(data.commuters)) setCommuters(data.commuters);
    } catch (_) {}
  };

  const handleConfirmDropoff = async (request: DropoffRequest) => {
    setConfirmingRide(true);
    try {
      const res  = await fetch(`${API_BASE}/trips/end_ride.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ride_id:      request.ride_id,
          dropoff_lat:  request.dropoff_lat,
          dropoff_lng:  request.dropoff_lng,
          triggered_by: "driver",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfirmingDropoff(null);
        setDropoffRequests(prev => prev.filter(r => r.ride_id !== request.ride_id));
        Alert.alert(
          "Drop Off Confirmed",
          `${request.commuter_name} has been dropped off.\n₱${data.fare_charged?.toFixed(2)} credited to your wallet.`
        );
      } else {
        Alert.alert("Error", data.message ?? "Failed to confirm drop off.");
      }
    } catch (_) {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setConfirmingRide(false);
    }
  };

  const handleToggleFull = async (value: boolean) => {
    setIsFull(value);
    if (!user || !myLocation) return;
    try {
      await fetch(`${API_BASE}/drivers/update_driver_location.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driver_id: user.id, latitude: myLocation.latitude,
          longitude: myLocation.longitude, is_online: 1, is_full: value ? 1 : 0,
        }),
      });
    } catch (_) {}
  };

  const closeEmergency = () => {
    setShowEmergency(false);
    setEmergencySent(false);
    setEmergencyError("");
    setEmergencyNoLoc(false);
  };

  // Actually records the alert (drivers/send_emergency.php) so the driver's
  // operator and the admin can see it. This used to just wait 1.5s and show
  // "Alert Sent!" without sending anything. "Sent" is only ever shown once the
  // server confirms it saved the alert — a failure shows an honest error so a
  // driver never believes help was notified when it wasn't.
  const handleSendEmergency = async () => {
    if (!user) { setEmergencyError("Couldn't identify your account. Please log in again."); return; }
    setSending(true);
    setEmergencyError("");
    try {
      const loc = myLocationRef.current ?? myLocation;
      const res = await fetch(`${API_BASE}/drivers/send_emergency.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver_id: user.id, latitude: loc?.latitude, longitude: loc?.longitude }),
      });
      const data = await res.json();
      if (data.success) {
        setEmergencyNoLoc(!data.has_location);
        setEmergencySent(true);
      } else {
        setEmergencyError(data.message ?? "The alert could not be sent.");
      }
    } catch {
      setEmergencyError("No connection — the alert was NOT sent. Call 911 or your operator directly.");
    } finally {
      setSending(false);
    }
  };

  const handleSelectCommuter = (commuter: NearbyCommuter) => {
    setSelected(commuter);
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setSelected(null));
  };

  const sheetTranslate = sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [250, 0] });

  const centerOnMe = () => {
    if (!myLocation || !mapRef.current) return;
    mapRef.current.animateToRegion({ ...myLocation, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
  };

  if (loading) return (
    <View style={styles.loadingWrap}>
      <ActivityIndicator color="#1a4a52" size="large" />
      <Text style={styles.loadingText}>
        {locStatus === "services_disabled" ? "Waiting for location services…" : "Getting your location…"}
      </Text>
    </View>
  );
  if (locationError) return (
    <View style={styles.loadingWrap}>
      <Ionicons name="location-outline" size={36} color="#dc2626" />
      <Text style={styles.errorText}>{locationError}</Text>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
        <TouchableOpacity style={styles.retryBtn} onPress={checkAndFetchLocation}>
          <Text style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
        {(locStatus === "permission_denied" || locStatus === "services_disabled") && (
          <TouchableOpacity style={[styles.retryBtn, styles.retryBtnOutline]} onPress={() => Linking.openSettings()}>
            <Text style={[styles.retryBtnText, styles.retryBtnOutlineText]}>Open Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.root}>

      <MapView
        ref={mapRef} style={styles.map} provider={PROVIDER_GOOGLE}
        initialRegion={{ latitude: myLocation?.latitude ?? 15.1450, longitude: myLocation?.longitude ?? 120.5960, latitudeDelta: 0.015, longitudeDelta: 0.015 }}
        showsUserLocation showsMyLocationButton={false}
      >
        {assignedRoute && assignedRoute.waypoints.length > 1 && (
          <>
            <Polyline coordinates={assignedRoute.waypoints} strokeColor={assignedRoute.color} strokeWidth={5} lineCap="round" lineJoin="round" />
            <Marker coordinate={assignedRoute.waypoints[0]} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.routeEndpoint, { backgroundColor: assignedRoute.color }]}><Text style={styles.routeEndpointText}>A</Text></View>
            </Marker>
            <Marker coordinate={assignedRoute.waypoints[assignedRoute.waypoints.length - 1]} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.routeEndpoint, { backgroundColor: assignedRoute.color }]}><Text style={styles.routeEndpointText}>B</Text></View>
            </Marker>
          </>
        )}

        {commuters.map(commuter => (
          <Marker
            key={commuter.id}
            coordinate={{ latitude: commuter.latitude, longitude: commuter.longitude }}
            onPress={() => handleSelectCommuter(commuter)}
          >
            <View style={styles.commuterMarker}>
              <Ionicons name={CATEGORY_ICON[commuter.category] ?? "person-outline"} size={18} color="#1a4a52" />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Route banner */}
      {assignedRoute && (
        <View style={[styles.routeBanner, { top: insets.top + 12 }]}>
          <View style={[styles.routeBannerDot, { backgroundColor: assignedRoute.color }]} />
          <Text style={styles.routeBannerText} numberOfLines={1}>{assignedRoute.name}</Text>
        </View>
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <View style={[styles.fullToggleBox, isFull && styles.fullToggleBoxFull]}>
          <View style={styles.fullToggleLabelRow}>
            <View style={[styles.fullToggleDot, { backgroundColor: isFull ? "#dc2626" : "#16a34a" }]} />
            <Text style={[styles.fullToggleLabel, isFull && { color: "#dc2626" }]}>
              {isFull ? "Full" : "Available"}
            </Text>
          </View>
          <Switch
            value={isFull}
            onValueChange={handleToggleFull}
            trackColor={{ false: "#a7f3d0", true: "#fca5a5" }}
            thumbColor={isFull ? "#dc2626" : "#16a34a"}
          />
        </View>
        <View style={styles.commuterCountBadge}>
          <Ionicons name="people" size={16} color="#1a4a52" />
          <Text style={styles.commuterCountText}>{commuters.length} waiting</Text>
        </View>
      </View>

      {/* Drop off request badge */}
      {dropoffRequests.length > 0 && !confirmingDropoff && (
        <TouchableOpacity
          style={[styles.dropoffBadge, { top: insets.top + 70 }]}
          onPress={() => setConfirmingDropoff(dropoffRequests[0])}
          activeOpacity={0.85}
        >
          <Ionicons name="hand-left" size={14} color="#92400e" />
          <Text style={styles.dropoffBadgeText}>
            {dropoffRequests.length} Para Po Request{dropoffRequests.length > 1 ? "s" : ""}
          </Text>
        </TouchableOpacity>
      )}

      {/* FABs */}
      <View style={[styles.fabCol, { bottom: selected ? 280 : 120 }]}>
        <TouchableOpacity style={styles.fab} onPress={centerOnMe} activeOpacity={0.85}>
          <Ionicons name="locate" size={18} color="#1a4a52" />
          <Text style={styles.fabText}>My Location</Text>
        </TouchableOpacity>
      </View>

      {/* Emergency FAB */}
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", left: 0, right: 0, alignItems: "center", bottom: selected ? 280 : 32 }}
      >
        <TouchableOpacity
          style={styles.emergencyFab}
          onPress={() => setShowEmergency(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="warning" size={18} color="#fff" />
          <Text style={styles.emergencyFabText}>EMERGENCY</Text>
        </TouchableOpacity>
      </View>

      {/* ── Drop Off Confirmation Modal ── */}
      <Modal visible={!!confirmingDropoff} transparent animationType="slide" onRequestClose={() => setConfirmingDropoff(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.dropoffModal}>
            <View style={styles.dropoffModalIconWrap}>
              <Ionicons name="hand-left" size={36} color="#1a4a52" />
            </View>
            <Text style={styles.dropoffModalTitle}>Para Po!</Text>
            {confirmingDropoff && (
              <>
                <Text style={styles.dropoffModalName}>{confirmingDropoff.commuter_name}</Text>
                <View style={styles.dropoffModalCategoryRow}>
                  <Ionicons name={CATEGORY_ICON[confirmingDropoff.category] ?? "person-outline"} size={14} color="#6b7280" />
                  <Text style={styles.dropoffModalCategory}>{confirmingDropoff.category}</Text>
                </View>
                <View style={styles.dropoffFareBox}>
                  <View style={styles.dropoffFareRow}>
                    <Text style={styles.dropoffFareLabel}>Distance</Text>
                    <Text style={styles.dropoffFareVal}>{confirmingDropoff.distance_km.toFixed(2)} km</Text>
                  </View>
                  <View style={styles.dropoffFareRow}>
                    <Text style={styles.dropoffFareLabel}>Fare to Credit</Text>
                    <Text style={[styles.dropoffFareVal, { color: "#1a4a52", fontSize: 20, fontWeight: "900" }]}>
                      ₱{calcFare(confirmingDropoff.distance_km, confirmingDropoff.discount_type).toFixed(2)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.dropoffModalNote}>
                  Confirm to drop off this passenger and credit the fare to your wallet.
                </Text>
                <TouchableOpacity
                  style={[styles.dropoffConfirmBtn, confirmingRide && { opacity: 0.6 }]}
                  onPress={() => handleConfirmDropoff(confirmingDropoff)}
                  disabled={confirmingRide}
                  activeOpacity={0.85}
                >
                  {confirmingRide
                    ? <ActivityIndicator color="#fff" />
                    : (
                      <View style={styles.btnInner}>
                        <Ionicons name="checkmark-circle" size={16} color="#fff" />
                        <Text style={styles.dropoffConfirmBtnText}>Confirm Drop Off</Text>
                      </View>
                    )
                  }
                </TouchableOpacity>
                {dropoffRequests.length > 1 && (
                  <TouchableOpacity
                    style={styles.dropoffNextBtn}
                    onPress={() => {
                      const next = dropoffRequests.find(r => r.ride_id !== confirmingDropoff.ride_id);
                      if (next) setConfirmingDropoff(next);
                    }}
                  >
                    <Text style={styles.dropoffNextBtnText}>Next Request ({dropoffRequests.length - 1} more)</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.dropoffDismissBtn} onPress={() => setConfirmingDropoff(null)}>
                  <Text style={styles.dropoffDismissText}>Dismiss (will auto-confirm in 60s)</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Ride Notification Modal ── */}
      <Modal visible={showRideNotif} transparent animationType="slide" onRequestClose={() => setShowRideNotif(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.rideModal}>
            <View style={styles.rideIconWrap}>
              <Ionicons name="person-add" size={32} color="#1a4a52" />
            </View>
            <Text style={styles.rideTitle}>New Passenger!</Text>
            {rideNotif && (
              <>
                <Text style={styles.rideName}>{rideNotif.commuter_name}</Text>
                <View style={[
                  styles.verifyBadge,
                  rideNotif.is_verified === 1
                    ? { backgroundColor: "#f0fdf4", borderColor: "#86efac" }
                    : { backgroundColor: "#f9fafb", borderColor: "#e5e7eb" },
                ]}>
                  <Ionicons
                    name={rideNotif.is_verified === 1 ? "checkmark-circle" : "warning-outline"}
                    size={14}
                    color={rideNotif.is_verified === 1 ? "#15803d" : "#6b7280"}
                  />
                  <Text style={[styles.verifyBadgeText, { color: rideNotif.is_verified === 1 ? "#15803d" : "#6b7280" }]}>
                    {rideNotif.category !== "default"
                      ? rideNotif.is_verified === 1
                        ? `Verified ${rideNotif.category}`
                        : `Unverified ${rideNotif.category}`
                      : "Regular commuter"}
                  </Text>
                </View>
                <View style={styles.freeBoardingBox}>
                  <Ionicons name="ticket" size={14} color="#15803d" />
                  <Text style={styles.freeBoardingText}>Boarding Recorded — Fare meter started</Text>
                </View>
              </>
            )}
            <TouchableOpacity style={styles.rideCloseBtn} onPress={() => setShowRideNotif(false)} activeOpacity={0.85}>
              <Text style={styles.rideCloseBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Emergency Modal ── */}
      <Modal visible={showEmergency} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.emergencyModal}>
            {!emergencySent ? (
              <>
                <View style={styles.emergencyIconWrap}>
                  <Ionicons name="warning" size={40} color="#dc2626" />
                </View>
                <Text style={styles.emergencyTitle}>Send Emergency Alert?</Text>
                <Text style={styles.emergencySub}>
                  This will immediately notify your operator and admin of your location.
                </Text>
                {!!emergencyError && (
                  <Text style={[styles.emergencySub, { color: "#dc2626", fontWeight: "700" }]}>{emergencyError}</Text>
                )}
                <TouchableOpacity
                  style={[styles.emergencyConfirmBtn, sending && { opacity: 0.6 }]}
                  onPress={handleSendEmergency} disabled={sending} activeOpacity={0.85}
                >
                  {sending
                    ? <ActivityIndicator color="#fff" />
                    : (
                      <View style={styles.btnInner}>
                        <Ionicons name="warning" size={16} color="#fff" />
                        <Text style={styles.emergencyConfirmText}>{emergencyError ? "Try Again" : "Send Alert Now"}</Text>
                      </View>
                    )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.emergencyCancelBtn} onPress={closeEmergency}>
                  <Text style={styles.emergencyCancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.emergencyIconWrap}>
                  <Ionicons name="checkmark-circle" size={40} color="#16a34a" />
                </View>
                <Text style={styles.emergencyTitle}>Alert Sent</Text>
                <Text style={styles.emergencySub}>
                  Your operator and admin can now see your alert
                  {emergencyNoLoc ? ", but your location wasn't available — tell them where you are" : " and your location"}.
                  {"\n\n"}If you're in immediate danger, call 911.
                </Text>
                <TouchableOpacity
                  style={styles.emergencyConfirmBtn}
                  onPress={closeEmergency}
                >
                  <Text style={styles.emergencyConfirmText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Commuter Sheet ── */}
      {selected && (
        <Animated.View style={[
          styles.sheet,
          { paddingBottom: insets.bottom + 16 },
          { transform: [{ translateY: sheetTranslate }] },
        ]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetAvatar}>
              <Ionicons name={CATEGORY_ICON[selected.category] ?? "person-outline"} size={26} color="#1a4a52" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetName}>{selected.name}</Text>
              <Text style={styles.sheetCategory}>
                {selected.category.charAt(0).toUpperCase() + selected.category.slice(1)} commuter
                {selected.category !== "default" ? " · discountable" : ""}
              </Text>
            </View>
            <Text style={styles.sheetDistance}>{selected.distance_km.toFixed(2)} km</Text>
          </View>
          {selected.destination_lat && selected.destination_lng ? (
            <View style={styles.destBox}>
              <Ionicons name="location" size={20} color="#1a4a52" />
              <View>
                <Text style={styles.destBoxLabel}>Destination set</Text>
                <Text style={styles.destBoxCoords}>
                  {selected.destination_lat.toFixed(5)}, {selected.destination_lng.toFixed(5)}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.destBox}>
              <Ionicons name="help-circle-outline" size={20} color="#9ca3af" />
              <Text style={styles.destBoxLabel}>No destination set yet</Text>
            </View>
          )}
          <TouchableOpacity style={styles.sheetCloseBtn} onPress={closeSheet}>
            <Text style={styles.sheetCloseBtnText}>Close</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f9fafb" },
  loadingText: { fontSize: 14, color: "#6b7280" },
  errorText:   { fontSize: 14, color: "#dc2626", textAlign: "center", paddingHorizontal: 32 },
  retryBtn: { backgroundColor: "#1a4a52", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" as const },
  retryBtnOutline: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#1a4a52" },
  retryBtnOutlineText: { color: "#1a4a52" },
  map:         { ...StyleSheet.absoluteFillObject },

  topBar:             { position: "absolute", left: 16, right: 16, flexDirection: "row", gap: 10, alignItems: "center" },
  fullToggleBox:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, elevation: 3, borderWidth: 1.5, borderColor: "#a7f3d0" },
  fullToggleBoxFull:  { borderColor: "#fca5a5" },
  fullToggleLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  fullToggleDot:      { width: 8, height: 8, borderRadius: 4 },
  fullToggleLabel:    { fontSize: 13, fontWeight: "800", color: "#16a34a" },
  commuterCountBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  commuterCountText:  { fontSize: 13, fontWeight: "800", color: "#1a4a52" },

  dropoffBadge:     { position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#fef9c3", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1.5, borderColor: "#fde68a", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 6, elevation: 4 },
  dropoffBadgeText: { fontSize: 13, fontWeight: "800", color: "#92400e" },

  commuterMarker: { backgroundColor: "#fff", borderRadius: 20, padding: 8, borderWidth: 2, borderColor: "#1a4a52", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 3 },

  fabCol:  { position: "absolute", right: 16, alignItems: "flex-end", gap: 10 },
  fab:     { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 46, borderRadius: 23, paddingHorizontal: 16, backgroundColor: "#fff", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, elevation: 4 },
  fabText: { fontSize: 13, fontWeight: "800", color: "#1a4a52" },

  emergencyFab:     { backgroundColor: "#dc2626", borderRadius: 50, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 14, shadowColor: "#dc2626", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 12, elevation: 8 },
  emergencyFabText: { fontSize: 13, fontWeight: "900", color: "#fff", letterSpacing: 1.2 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },

  dropoffModal:            { backgroundColor: "#fff", borderRadius: 24, padding: 28, margin: 28, alignItems: "center", gap: 10, width: "88%" },
  dropoffModalIconWrap:    { width: 72, height: 72, borderRadius: 36, backgroundColor: "#f0fdf4", alignItems: "center", justifyContent: "center" },
  dropoffModalTitle:       { fontSize: 22, fontWeight: "900", color: "#1a4a52" },
  dropoffModalName:        { fontSize: 16, fontWeight: "700", color: "#374151" },
  dropoffModalCategoryRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  dropoffModalCategory:    { fontSize: 13, color: "#6b7280" },
  dropoffFareBox:          { backgroundColor: "#f9fafb", borderRadius: 14, padding: 16, width: "100%", gap: 10, borderWidth: 1, borderColor: "#e5e7eb" },
  dropoffFareRow:          { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dropoffFareLabel:        { fontSize: 13, color: "#6b7280", fontWeight: "600" },
  dropoffFareVal:          { fontSize: 14, fontWeight: "800", color: "#111827" },
  dropoffModalNote:        { fontSize: 12, color: "#6b7280", textAlign: "center", lineHeight: 18 },
  dropoffConfirmBtn:       { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 14, width: "100%", alignItems: "center" },
  dropoffConfirmBtnText:   { fontSize: 15, fontWeight: "800", color: "#fff" },
  dropoffNextBtn:          { paddingVertical: 8 },
  dropoffNextBtnText:      { fontSize: 13, color: "#1a4a52", fontWeight: "700" },
  dropoffDismissBtn:       { paddingVertical: 6 },
  dropoffDismissText:      { fontSize: 11, color: "#9ca3af" },

  rideModal:        { backgroundColor: "#fff", borderRadius: 24, padding: 28, margin: 28, alignItems: "center", gap: 12, width: "88%" },
  rideIconWrap:     { width: 72, height: 72, borderRadius: 36, backgroundColor: "#f0fdf4", alignItems: "center", justifyContent: "center" },
  rideTitle:        { fontSize: 20, fontWeight: "900", color: "#1a4a52" },
  rideName:         { fontSize: 15, fontWeight: "700", color: "#374151" },
  verifyBadge:      { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, padding: 10, borderWidth: 1, width: "100%", justifyContent: "center" },
  verifyBadgeText:  { fontSize: 12, fontWeight: "700", textAlign: "center" },
  freeBoardingBox:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0fdf4", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 20, borderWidth: 1.5, borderColor: "#86efac" },
  freeBoardingText: { fontSize: 13, fontWeight: "800", color: "#15803d" },
  rideCloseBtn:     { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 13, paddingHorizontal: 48, marginTop: 4 },
  rideCloseBtnText: { fontSize: 15, fontWeight: "800", color: "#fff" },

  emergencyModal:      { backgroundColor: "#fff", borderRadius: 24, padding: 28, margin: 28, alignItems: "center", gap: 10, width: "88%" },
  emergencyIconWrap:   { width: 80, height: 80, borderRadius: 40, backgroundColor: "#fef2f2", alignItems: "center", justifyContent: "center" },
  emergencyTitle:      { fontSize: 20, fontWeight: "900", color: "#1a4a52" },
  emergencySub:        { fontSize: 13, color: "#6b7280", textAlign: "center", lineHeight: 20 },
  emergencyConfirmBtn: { backgroundColor: "#dc2626", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, alignItems: "center", width: "100%", marginTop: 6 },
  emergencyConfirmText:{ fontSize: 15, fontWeight: "800", color: "#fff" },
  emergencyCancelBtn:  { paddingVertical: 10 },
  emergencyCancelText: { fontSize: 14, color: "#9ca3af", fontWeight: "600" },

  btnInner: { flexDirection: "row", alignItems: "center", gap: 6 },

  sheet:         { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, elevation: 12 },
  sheetHandle:   { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },
  sheetHeader:   { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  sheetAvatar:   { width: 52, height: 52, borderRadius: 26, backgroundColor: "#f0f9ff", alignItems: "center", justifyContent: "center" },
  sheetName:     { fontSize: 17, fontWeight: "900", color: "#1a4a52" },
  sheetCategory: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  sheetDistance: { fontSize: 13, fontWeight: "800", color: "#1a4a52" },
  destBox:       { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#f9fafb", borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "#e5e7eb" },
  destBoxLabel:  { fontSize: 13, fontWeight: "700", color: "#374151" },
  destBoxCoords: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  sheetCloseBtn:    { alignItems: "center", paddingVertical: 8 },
  sheetCloseBtnText:{ fontSize: 14, color: "#9ca3af", fontWeight: "600" },

  routeBanner:    { position: "absolute", left: 16, right: 100, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 6, elevation: 3 },
  routeBannerDot: { width: 10, height: 10, borderRadius: 5 },
  routeBannerText:{ fontSize: 13, fontWeight: "800", color: "#1a4a52", flex: 1 },
  routeEndpoint:     { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  routeEndpointText: { fontSize: 11, fontWeight: "900", color: "#fff" },
});