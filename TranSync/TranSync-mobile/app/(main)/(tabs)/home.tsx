import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
  Image, Platform, Modal, TextInput,
} from "react-native";
import MapView, { Marker, MapPressEvent } from "react-native-maps";
import * as Location from "expo-location";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../../src/config/api";
import { useBookings } from "../../../src/context/BookingsContext";
import { useUser } from "../../../src/context/UserContext";
import { confirmRemoveExpiredDiscount } from "../../../src/utils/removeExpiredDiscount";
import { VEHICLE_META, type BookingActivityEntry } from "../../../src/types/booking";
import KeyboardAwareForm from "../../../src/components/common/KeyboardAwareForm";
import {
  getNotifyBookingConfirmed, getNotifyBoardingTrip, getNotifyCancelRefund,
} from "../../../src/state/settingsPrefs";

// Light poll while Home is focused, on top of the focus-triggered refetch —
// catches a status change triggered elsewhere (driver boards, trip
// completes, no-show sweep) without the commuter switching tabs. Slower
// than this app's usual 5s poll (book.tsx's live-status/UV-availability
// polls) since these events aren't second-sensitive.
const ACTIVITY_POLL_MS = 18000;

const HOURS_COOLDOWN    = 24;
const GOOGLE_PLACES_KEY = "AIzaSyC5M8jDBgCE6L3tCC1JploVMqZisOjDk-0"; // ← replace with your key

type Route = {
  id:            number;
  name:          string;
  from_location: string;
  to_location:   string;
  fare:          number | null;
  vehicle_type:  string | null;
  color:         string;
  driver_count:  number;
  owner_name:    string | null;
};

type Segment = {
  route_id:     number;
  route_name:   string;
  from:         string;
  to:           string;
  board_at:     string;
  alight_at:    string;
  dist_to_dest: number | null;
  fare:         number | null;
  vehicle_type: string | null;
  color:        string;
  est_mins:     number | null;
  km:           number | null;
  terminal_id:   number | null;
  terminal_name: string | null;
  terminal_lat:  number | null;
  terminal_lng:  number | null;
  // Best-effort "which side of the road" boarding hint (2026-08-08) — 'cross'
  // means the commuter is likely on the wrong side for this jeepney's
  // direction of travel, 'correct' means they're already on the right side,
  // null means not confident either way (too close to or far from the route
  // line to judge). Not a guaranteed-precise lane detection — see
  // route_planner.php's boardSideHint() for the caveat this is built on.
  board_side_hint: "cross" | "correct" | null;
  board_side_note: string | null;
};

type JourneyOption = {
  type:            "direct" | "transfer" | "nearest";
  transfers:       number;
  total_fare:      number | null;
  total_mins:      number | null;
  total_km:        number | null;
  transfer_point:  string | null;
  segments:        Segment[];
};

type FilterMode = "all" | "fastest" | "cheapest" | "direct";

type PlaceSuggestion = {
  place_id:       string;
  description:    string;
  main_text:      string;
  secondary_text: string;
};

const VEHICLE_COLORS: Record<string, string> = {
  "Jeepney":    "#16a34a",
  "UV Express": "#9333ea",
  "Bus":        "#2563eb",
};

const VEHICLE_ICONS: Record<string, IoniconsName> = {
  "Jeepney":    "bus-outline",
  "UV Express": "car-outline",
  "Bus":        "bus",
};

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

const CATEGORY_META: Record<string, { icon: IoniconsName; label: string }> = {
  student:  { icon: "school",          label: "Student Discount"        },
  disabled: { icon: "accessibility",   label: "PWD Discount"            },
  elderly:  { icon: "person",          label: "Senior Citizen Discount" },
  default:  { icon: "person-outline",  label: "Standard Fare"           },
};

// "Book Ride" already lands on (main)/book defaulting to Bus mode with a
// Bus/UV Express toggle right at the top — a separate "Bus & UV Routes"
// card here used to push the exact same path with no params, making it a
// literal duplicate of this card, so it was removed. "My Wallet" was
// removed too — the Wallet Balance card just above this section (plus its
// own "Top up" button) already links to the identical /(main)/wallet
// screen, on this same screen, so a third shortcut card added nothing.
const quickActions = [
  { icon: "map"    as IoniconsName, label: "Nearby\nTerminals", path: "/(main)/map",  color: "#e0f2fe", accent: "#0284c7" },
  { icon: "ticket" as IoniconsName, label: "Book\nRide",        path: "/(main)/book", color: "#f0fdf4", accent: "#16a34a" },
];

export default function Home() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { renewed } = useLocalSearchParams<{ renewed?: string }>();
  const { activity, refreshHistory } = useBookings();
  const { user, refreshUser, verificationStatusAlert, dismissVerificationStatusAlert } = useUser();

  const [wallet,        setWallet]        = useState<number | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [hoursLeft,     setHoursLeft]     = useState(0);
  const [canResubmit,   setCanResubmit]   = useState(false);
  const [notifyBookingConfirmed, setNotifyBookingConfirmedState] = useState(true);
  const [notifyBoardingTrip,     setNotifyBoardingTripState]     = useState(true);
  const [notifyCancelRefund,     setNotifyCancelRefundState]     = useState(true);

  const [browseRoutes,   setBrowseRoutes]   = useState<Route[]>([]);
  const [loadingBrowse,  setLoadingBrowse]  = useState(true);
  const [journeyOptions, setJourneyOptions] = useState<JourneyOption[]>([]);
  const [loadingJourney, setLoadingJourney] = useState(false);
  const [destination,    setDestination]    = useState("");
  const [origin,         setOrigin]         = useState("");
  const [origCoords,     setOrigCoords]     = useState<{ lat: number; lng: number } | null>(null);
  const [destDisplay,    setDestDisplay]    = useState<string | null>(null);
  const [filterMode,     setFilterMode]     = useState<FilterMode>("all");
  const [locating,       setLocating]       = useState(false);
  const [showMapPicker,  setShowMapPicker]  = useState(false);
  const [pinCoords,      setPinCoords]      = useState<{ latitude: number; longitude: number } | null>(null);
  const [pinLoading,     setPinLoading]     = useState(false);
  const [mapPickerTarget,   setMapPickerTarget]   = useState<"origin" | "dest">("origin");
  const [destCoords,        setDestCoords]        = useState<{ lat: number; lng: number } | null>(null);
  const [originSuggestions, setOriginSuggestions] = useState<PlaceSuggestion[]>([]);
  const [destSuggestions,   setDestSuggestions]   = useState<PlaceSuggestion[]>([]);

  const [refreshing,    setRefreshing]    = useState(false);

  const [showResubmit,  setShowResubmit]  = useState(false);
  const [docPreview,    setDocPreview]    = useState<string | null>(null);
  const [docFile,       setDocFile]       = useState<File | null>(null);
  const [docUri,        setDocUri]        = useState<string | null>(null);
  const [submitting,    setSubmitting]    = useState(false);
  const [submitMsg,     setSubmitMsg]     = useState("");
  const [submitError,   setSubmitError]   = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Landed here from student-verification.tsx's renewal flow (?mode=renew) —
  // re-sync the freshly-restored is_verified/category from the server
  // rather than trusting the stale AsyncStorage snapshot, and show the same
  // success-banner pattern the resubmit flow already uses.
  useEffect(() => {
    if (renewed === "1") {
      setSubmitMsg("Your Student verification has been renewed.");
      refreshUser();
    }
  }, [renewed]);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem("user");
        if (!raw) { router.replace("/(auth)/login"); return; }
        const u = JSON.parse(raw);

        if (u.rejected_at && u.status === "inactive") {
          const rejectedAt   = new Date(u.rejected_at).getTime();
          const now          = Date.now();
          const hoursElapsed = (now - rejectedAt) / (1000 * 60 * 60);
          const left         = Math.ceil(HOURS_COOLDOWN - hoursElapsed);
          if (left > 0) {
            setHoursLeft(left);
            setCanResubmit(false);
          } else {
            setHoursLeft(0);
            setCanResubmit(true);
          }
        }

        const res  = await fetch(`${API_BASE}/wallet/wallet.php?commuter_id=${u.id}`);
        const data = await res.json();
        setWallet(data.balance ?? 0);
      } catch {
        setWallet(0);
      } finally {
        setLoading(false);
      }
    };
    load();
    fetchBrowseRoutes();
  }, []);

  // Recent Activity comes from BookingsContext, shared with book.tsx's
  // "My Upcoming Bookings" and the Booking History screen — refetch on
  // focus (same pattern wallet.tsx uses) plus a light poll while this tab
  // stays open, so a booking made/resolved anywhere shows up here without
  // a manual refresh or app restart. refreshUser() rides along the same
  // cadence so an admin verifying/rejecting this commuter mid-session shows
  // up here (and everywhere else reading UserContext) without a re-login.
  useFocusEffect(useCallback(() => {
    refreshHistory();
    refreshUser();
    getNotifyBookingConfirmed().then(setNotifyBookingConfirmedState);
    getNotifyBoardingTrip().then(setNotifyBoardingTripState);
    getNotifyCancelRefund().then(setNotifyCancelRefundState);
    const interval = setInterval(() => { refreshHistory(); refreshUser(); }, ACTIVITY_POLL_MS);
    return () => clearInterval(interval);
  }, [refreshHistory, refreshUser]));

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBrowseRoutes = async () => {
    setLoadingBrowse(true);
    try {
      const res  = await fetch(`${API_BASE}/routes/get_commuter_routes.php`);
      const data = await res.json();
      if (data.success) setBrowseRoutes(data.routes ?? []);
    } catch { setBrowseRoutes([]); }
    finally  { setLoadingBrowse(false); }
  };

  const planJourney = async (
    dest: string,
    orig: string,
    origCoordsParam: { lat: number; lng: number } | null,
    destCoordsParam?: { lat: number; lng: number } | null,
  ) => {
    setLoadingJourney(true);
    setDestDisplay(null);
    try {
      const params = new URLSearchParams({ destination: dest });
      if (destCoordsParam) {
        params.append("dest_lat", String(destCoordsParam.lat));
        params.append("dest_lng", String(destCoordsParam.lng));
      }
      if (origCoordsParam) {
        params.append("orig_lat", String(origCoordsParam.lat));
        params.append("orig_lng", String(origCoordsParam.lng));
      } else if (orig.trim().length >= 2) {
        params.append("origin", orig.trim());
      }
      const res  = await fetch(`${API_BASE}/routes/route_planner.php?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setJourneyOptions(data.options ?? []);
        setDestDisplay(data.dest_display ?? null);
      } else {
        setJourneyOptions([]);
      }
    } catch { setJourneyOptions([]); }
    finally  { setLoadingJourney(false); }
  };

  // Fresh coords can be passed directly so state doesn't lag behind
  const triggerSearch = (
    dest: string,
    orig: string,
    origCoordsParam?: { lat: number; lng: number } | null,
    destCoordsParam?: { lat: number; lng: number } | null,
  ) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (dest.trim().length < 2) { setJourneyOptions([]); setDestDisplay(null); return; }
    const resolvedOrig = origCoordsParam !== undefined ? origCoordsParam : origCoords;
    const resolvedDest = destCoordsParam !== undefined ? destCoordsParam : destCoords;
    searchTimeout.current = setTimeout(
      () => planJourney(dest.trim(), orig, resolvedOrig, resolvedDest), 350,
    );
  };

  const handleDestinationChange = (text: string) => {
    setDestination(text);
    setDestCoords(null);
    setFilterMode("all");
    setDestSuggestions([]);
    triggerSearch(text, origin, undefined, null);
    fetchSuggestions(text, "dest");
  };

  const handleOriginChange = (text: string) => {
    setOrigin(text);
    setOrigCoords(null);
    setOriginSuggestions([]);
    triggerSearch(destination, text, null);
    fetchSuggestions(text, "origin");
  };

  // ── GPS: use device current location ──────────────────────────────────────
  const handleUseCurrentLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc  = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      const coords = { lat: latitude, lng: longitude };
      setOrigCoords(coords);

      // Reverse-geocode to get a readable label
      try {
        const res  = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
          { headers: { "User-Agent": "TranSync-App/1.0" } },
        );
        const data = await res.json();
        const label =
          data.address?.suburb       ??
          data.address?.city_district ??
          data.address?.road          ??
          data.address?.city          ??
          "Current location";
        setOrigin(label);
      } catch { setOrigin("Current location"); }

      triggerSearch(destination, "", coords);
    } finally { setLocating(false); }
  };

  // ── Map pin: tap on map ────────────────────────────────────────────────────
  const handleMapPress = (e: MapPressEvent) => {
    setPinCoords(e.nativeEvent.coordinate);
  };

  const handleConfirmPin = async () => {
    if (!pinCoords) return;
    setPinLoading(true);
    const coords = { lat: pinCoords.latitude, lng: pinCoords.longitude };
    let label = mapPickerTarget === "origin" ? "Pinned pickup point" : "Pinned destination";
    try {
      const res  = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${pinCoords.latitude}&lon=${pinCoords.longitude}&format=json`,
        { headers: { "User-Agent": "TranSync-App/1.0" } },
      );
      const data = await res.json();
      label =
        data.address?.suburb        ??
        data.address?.city_district ??
        data.address?.road          ??
        data.address?.city          ??
        label;
    } catch {}
    setShowMapPicker(false);
    setPinCoords(null);
    setPinLoading(false);
    if (mapPickerTarget === "origin") {
      setOrigin(label);
      setOrigCoords(coords);
      triggerSearch(destination, "", coords);
    } else {
      setDestination(label);
      setDestCoords(coords);
      setFilterMode("all");
      triggerSearch(label, origin, undefined, coords);
    }
  };

  // ── Google Places autocomplete ─────────────────────────────────────────────
  const fetchSuggestions = async (text: string, field: "origin" | "dest") => {
    if (text.trim().length < 2) {
      field === "origin" ? setOriginSuggestions([]) : setDestSuggestions([]);
      return;
    }
    try {
      const url  = `https://maps.googleapis.com/maps/api/place/autocomplete/json`
                 + `?input=${encodeURIComponent(text)}`
                 + `&key=${GOOGLE_PLACES_KEY}`
                 + `&components=country:ph`
                 + `&location=15.15,120.59&radius=50000`
                 + `&language=en`;
      const res  = await fetch(url);
      const data = await res.json();
      const list: PlaceSuggestion[] = (data.predictions ?? []).slice(0, 5).map((p: any) => ({
        place_id:       p.place_id,
        description:    p.description,
        main_text:      p.structured_formatting?.main_text      ?? p.description,
        secondary_text: p.structured_formatting?.secondary_text ?? "",
      }));
      field === "origin" ? setOriginSuggestions(list) : setDestSuggestions(list);
    } catch {
      field === "origin" ? setOriginSuggestions([]) : setDestSuggestions([]);
    }
  };

  const selectSuggestion = async (s: PlaceSuggestion, field: "origin" | "dest") => {
    if (field === "origin") {
      setOrigin(s.main_text);
      setOriginSuggestions([]);
    } else {
      setDestination(s.main_text);
      setDestSuggestions([]);
      setFilterMode("all");
    }
    try {
      const url  = `https://maps.googleapis.com/maps/api/place/details/json`
                 + `?place_id=${s.place_id}&fields=geometry&key=${GOOGLE_PLACES_KEY}`;
      const res  = await fetch(url);
      const data = await res.json();
      const loc  = data.result?.geometry?.location;
      if (loc) {
        const coords = { lat: loc.lat as number, lng: loc.lng as number };
        if (field === "origin") {
          setOrigCoords(coords);
          triggerSearch(destination, s.main_text, coords);
        } else {
          setDestCoords(coords);
          triggerSearch(s.main_text, origin, undefined, coords);
        }
        return;
      }
    } catch {}
    // Place Details failed — fall back to text-based search
    if (field === "origin") triggerSearch(destination, s.main_text, null);
    else                    triggerSearch(s.main_text, origin, undefined, null);
  };

  const displayedOptions = useMemo(() => {
    if (filterMode === "direct")   return journeyOptions.filter(o => o.transfers === 0);
    if (filterMode === "fastest")  return [...journeyOptions].sort((a, b) => (a.total_mins ?? 9999) - (b.total_mins ?? 9999));
    if (filterMode === "cheapest") return [...journeyOptions].sort((a, b) => (a.total_fare ?? 9999) - (b.total_fare ?? 9999));
    return journeyOptions;
  }, [journeyOptions, filterMode]);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  };

  const handlePickDoc = async () => {
    if (Platform.OS === "web") {
      fileInputRef.current?.click();
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
      });
      if (!result.canceled) {
        setDocPreview(result.assets[0].uri);
        setDocUri(result.assets[0].uri);
      }
    }
  };

  const handleWebFile = (e: any) => {
    const file = e.target.files?.[0];
    if (file) {
      setDocFile(file);
      setDocPreview(URL.createObjectURL(file));
    }
  };

  const handleResubmit = async () => {
    setSubmitError("");
    if (!user) return;
    const hasDoc = Platform.OS === "web" ? !!docFile : !!docUri;
    if (!hasDoc) {
      setSubmitError("Please attach your document first.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("id",   String(user.id));
      formData.append("type", "commuter");

      if (Platform.OS === "web") {
        formData.append("id_photo", docFile!, docFile!.name);
      } else {
        formData.append("id_photo", {
          uri:  docUri!,
          name: "id_photo.jpg",
          type: "image/jpeg",
        } as any);
      }

      const res  = await fetch(`${API_BASE}/auth/resubmit.php`, {
        method: "POST",
        body:   formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.message || "Resubmission failed.");
      } else {
        // Re-fetch from the server rather than guessing the new state
        // client-side — resubmit.php is the source of truth for what it
        // actually reset (Core Flow 2 point 6).
        await refreshUser();
        setSubmitMsg("✅ Resubmitted! Your account is now pending review.");
        setShowResubmit(false);
        setDocPreview(null);
        setDocFile(null);
        setDocUri(null);
      }
    } catch {
      setSubmitError("Cannot connect to server.");
    } finally {
      setSubmitting(false);
    }
  };

  // Pull-to-refresh — re-fetches everything this screen shows: wallet
  // balance, the browse-routes list (or the in-progress journey search, if
  // one's active), and Recent Activity (shared via BookingsContext with
  // book.tsx/booking-history.tsx, same as the focus-poll above).
  async function onRefresh() {
    setRefreshing(true);
    try {
      const tasks: Promise<any>[] = [fetchBrowseRoutes(), refreshHistory(), refreshUser()];
      if (user?.id) {
        tasks.push(
          fetch(`${API_BASE}/wallet/wallet.php?commuter_id=${user.id}`)
            .then((r) => r.json())
            .then((d) => { if (d?.success) setWallet(d.balance ?? 0); })
            .catch(() => {})
        );
      }
      if (destination.trim().length >= 2) {
        tasks.push(planJourney(destination.trim(), origin, origCoords, destCoords));
      }
      await Promise.all(tasks);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#1a4a52" />
      </View>
    );
  }

  const isVerified = user?.is_verified == 1;
  const isRejected = user?.status === "inactive" && user?.rejected_at;
  const isExpiredStudent = !!user?.student_verification_expired;
  const category   = user?.category ?? "default";
  // A "default" (no discount) commuter is never actually pending anything.
  // Note: `category` alone can no longer be used to detect a genuine pending
  // Student/PWD/Senior submission — commuters.category now stays 'default'
  // (full Regular access) for the entire time such a submission is awaiting
  // admin review (see commuter_register_student.php et al. and
  // commuter_switch_category.php — "instant Regular access, upgrade once
  // approved"), so a plain Regular commuter and a genuinely-pending one are
  // otherwise indistinguishable. `has_pending_discount_verification` (from
  // commuter/get_profile.php / login_mobile.php) is the real signal —
  // derived from a live commuter_id_verifications row, not this column.
  const isPending  = !isVerified && !isRejected && !isExpiredStudent && !!user?.has_pending_discount_verification;
  const firstName  = user?.name?.split(" ")[0] ?? "Commuter";
  const catMeta    = CATEGORY_META[category] ?? CATEGORY_META.default;

  // Settings → Notifications: each kind of Recent Activity entry is
  // independently show/hideable (Core Flow 2b) — "confirmed" maps to
  // Booking Confirmation, "completed" to Boarding/Trip reminders (the
  // closest existing activity kind to a trip-lifecycle event, since this
  // app's activity feed has no separate boarding-reminder entry type), and
  // "cancelled" to Booking Cancellation & Refund Updates (already covers
  // refund/late-cancel/no-show alike, see deriveBookingActivity()).
  const visibleActivity = activity.filter((entry) => {
    if (entry.kind === "confirmed") return notifyBookingConfirmed;
    if (entry.kind === "completed") return notifyBoardingTrip;
    if (entry.kind === "cancelled") return notifyCancelRefund;
    return true;
  });

  return (
    <KeyboardAwareForm
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a4a52" colors={["#1a4a52"]} />
      }
    >
      {/* Hidden web file input — untouched */}
      {Platform.OS === "web" && (
        <input ref={fileInputRef} type="file" accept="image/*"
          style={{ display: "none" }} onChange={handleWebFile} />
      )}

      {/* ── RESUBMIT MODAL ── */}
      <Modal visible={showResubmit} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Resubmit Document</Text>
            <Text style={styles.modalSubtitle}>
              Upload a new valid ID or document for verification.
            </Text>

            {submitError ? (
              <View style={styles.errorBox}>
                <Ionicons name="warning" size={14} color="#dc2626" />
                <Text style={styles.errorText}>{submitError}</Text>
              </View>
            ) : null}

            <TouchableOpacity style={styles.uploadBtn} onPress={handlePickDoc} activeOpacity={0.8}>
              {docPreview ? (
                <Image source={{ uri: docPreview }} style={styles.docPreview} resizeMode="cover" />
              ) : (
                <View style={styles.uploadPlaceholder}>
                  <Ionicons name="attach" size={28} color="#9ca3af" />
                  <Text style={styles.uploadText}>Tap to attach document</Text>
                  <Text style={styles.uploadHint}>JPG, PNG accepted</Text>
                </View>
              )}
            </TouchableOpacity>

            {docPreview && (
              <TouchableOpacity
                onPress={() => { setDocPreview(null); setDocFile(null); setDocUri(null); }}
                style={styles.removeBtn}
              >
                <Ionicons name="close-circle" size={14} color="#ef4444" />
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => { setShowResubmit(false); setSubmitError(""); }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmit, submitting && { opacity: 0.6 }]}
                onPress={handleResubmit}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalSubmitText}>Submit</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MAP PICKER MODAL ── */}
      <Modal visible={showMapPicker} animationType="slide">
        <View style={styles.mapPickerContainer}>
          <View style={styles.mapPickerHeader}>
            <TouchableOpacity onPress={() => { setShowMapPicker(false); setPinCoords(null); }} style={styles.mapPickerCloseBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={18} color="#1a4a52" />
              <Text style={styles.mapPickerCloseText}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.mapPickerTitle}>
              {mapPickerTarget === "origin" ? "Pin Your Pickup Point" : "Pin Your Destination"}
            </Text>
            <View style={{ width: 22 }} />
          </View>
          <Text style={styles.mapPickerSub}>
            {mapPickerTarget === "origin"
              // The pickup point is where the commuter will actually catch a
              // jeepney from — not necessarily their literal current spot.
              // e.g. still at home, planning to take a tricycle to the main
              // highway first, since tricycles aren't part of this app.
              ? "Tap where you'll catch a jeepney from — this can be different from where you are right now (e.g. after riding a tricycle to the main road)."
              : "Tap where you want to go"}
          </Text>
          <MapView
            style={{ flex: 1 }}
            onPress={handleMapPress}
            initialRegion={{
              latitude:      15.15,
              longitude:     120.59,
              latitudeDelta:  0.15,
              longitudeDelta: 0.15,
            }}
          >
            {pinCoords && <Marker coordinate={pinCoords} />}
          </MapView>
          <View style={styles.mapPickerFooter}>
            {pinCoords ? (
              <TouchableOpacity
                style={[styles.mapPickerConfirm, pinLoading && { opacity: 0.6 }]}
                onPress={handleConfirmPin}
                disabled={pinLoading}
              >
                {pinLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.mapPickerConfirmText}>
                      {mapPickerTarget === "origin" ? "Use as Pickup Point" : "Use as Destination"}
                    </Text>
                }
              </TouchableOpacity>
            ) : (
              <View style={styles.mapPickerHint}>
                <Ionicons name="finger-print-outline" size={16} color="#9ca3af" />
                <Text style={styles.mapPickerHintText}>Tap the map to drop a pin</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── SUCCESS MSG ── */}
      {submitMsg !== "" && (
        <View style={styles.successBanner}>
          <Ionicons name="checkmark-circle" size={16} color="#15803d" />
          <Text style={styles.successText}>{submitMsg}</Text>
        </View>
      )}

      {/* ── REJECTED BANNER ── */}
      {isRejected && (
        <View style={styles.rejectedBanner}>
          <View style={styles.rejectedTop}>
            <Ionicons name="close-circle" size={22} color="#dc2626" />
            <View style={{ flex: 1 }}>
              <Text style={styles.rejectedTitle}>Verification Rejected</Text>
              <Text style={styles.rejectedSubtitle}>
                {user?.rejection_reason || "Your document was not accepted by the admin."}
              </Text>
            </View>
          </View>
          {canResubmit ? (
            <TouchableOpacity style={styles.resubmitBtn} onPress={() => setShowResubmit(true)} activeOpacity={0.85}>
              <Ionicons name="attach" size={15} color="#fff" />
              <Text style={styles.resubmitBtnText}>Resubmit Document</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.cooldownWrap}>
              <Ionicons name="time" size={14} color="#991b1b" />
              <Text style={styles.cooldownText}>
                You can resubmit in <Text style={styles.cooldownHours}>{hoursLeft}h</Text>
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── EXPIRED STUDENT VERIFICATION BANNER ── */}
      {isExpiredStudent && (
        <View style={styles.rejectedBanner}>
          <View style={styles.rejectedTop}>
            <Ionicons name="refresh-circle" size={22} color="#b45309" />
            <View style={{ flex: 1 }}>
              <Text style={styles.rejectedTitle}>Student Verification Expired</Text>
              <Text style={styles.rejectedSubtitle}>
                Your student verification has expired. Please upload a new Student ID or Enrollment Form to continue receiving student discounts.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.resubmitBtn}
            onPress={() => router.push({ pathname: "/(auth)/student-verification", params: { mode: "renew" } })}
            activeOpacity={0.85}
          >
            <Ionicons name="camera" size={15} color="#fff" />
            <Text style={styles.resubmitBtnText}>Renew Verification</Text>
          </TouchableOpacity>
          {/* Can't or won't renew: drop the expired discount so this banner goes
              away. Always asks for confirmation first. */}
          <TouchableOpacity
            style={styles.removeExpiredBtn}
            onPress={() => confirmRemoveExpiredDiscount({
              commuterId: user.id,
              categoryLabel: "Student",
              onRemoved: refreshUser,
            })}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={15} color="#b91c1c" />
            <Text style={styles.removeExpiredText}>Remove Discount</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── PENDING BANNER ── */}
      {isPending && (
        <View style={styles.pendingBanner}>
          <Ionicons name="time" size={24} color="#b45309" />
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingTitle}>Verification Pending</Text>
            <Text style={styles.pendingSubtitle}>
              Your account is under review. Discounts apply once verified.
            </Text>
          </View>
        </View>
      )}

      {/* ── VERIFICATION STATUS ALERT ── (Settings → Notifications, one-time
          dismissible — Core Flow 2b, honest in-app equivalent of a push
          notification, since this app has none) */}
      {verificationStatusAlert && (
        <View style={styles.statusAlertBanner}>
          <Ionicons name="shield-checkmark-outline" size={20} color="#1a4a52" />
          <Text style={styles.statusAlertText}>{verificationStatusAlert}</Text>
          <TouchableOpacity
            onPress={dismissVerificationStatusAlert}
            style={styles.statusAlertCloseBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={16} color="#1a4a52" />
          </TouchableOpacity>
        </View>
      )}

      {/* ── GREETING ── */}
      <View style={styles.greetingRow}>
        <View>
          <Text style={styles.greeting}>{getGreeting()},</Text>
          <Text style={styles.name}>{firstName} 👋</Text>
        </View>
        {/* Navigates to Profile (this app has no notification inbox) — icon
            and label changed together to match the real destination, not a
            bell promising notifications that don't exist. */}
        <TouchableOpacity style={styles.notifBtn} onPress={() => router.push("/(main)/profile")} activeOpacity={0.8}>
          <Ionicons name="person-circle-outline" size={18} color="#1a4a52" />
          <Text style={styles.notifBtnText}>Profile</Text>
        </TouchableOpacity>
      </View>

      {/* ── WALLET CARD ── */}
      <TouchableOpacity style={styles.walletCard} onPress={() => router.push("/(main)/wallet")} activeOpacity={0.9}>
        <View style={styles.walletTop}>
          <Text style={styles.walletLabel}>Wallet Balance</Text>
          <View style={styles.walletBadge}>
            {isVerified
              ? <Ionicons name="checkmark-circle" size={11} color="#a8d832" />
              : isRejected
              ? <Ionicons name="close-circle"     size={11} color="#ef4444" />
              : isPending
              ? <Ionicons name="time"             size={11} color="#f59e0b" />
              : <Ionicons name="information-circle" size={11} color="#9ca3af" />
            }
            <Text style={styles.walletBadgeText}>
              {isVerified ? "Verified" : isRejected ? "Rejected" : isPending ? "Pending" : "Standard"}
            </Text>
          </View>
        </View>
        <Text style={styles.walletAmount}>
          ₱{wallet !== null ? Number(wallet).toFixed(2) : "0.00"}
        </Text>
        <View style={styles.walletActions}>
          <TouchableOpacity style={styles.walletBtn} onPress={() => router.push("/(main)/wallet")}>
            <Ionicons name="add" size={16} color="#1a2a10" />
            <Text style={styles.walletBtnText}>Top up</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.walletCircle1} />
        <View style={styles.walletCircle2} />
      </TouchableOpacity>

      {/* ── QUICK ACTIONS ── */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.quickGrid}>
        {quickActions.map((a) => (
          <TouchableOpacity
            key={a.label}
            style={[styles.quickCard, { backgroundColor: a.color }]}
            onPress={() => router.push(a.path as any)}
            activeOpacity={0.8}
          >
            <Ionicons name={a.icon} size={28} color={a.accent} />
            <Text style={[styles.quickLabel, { color: a.accent }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── GET AROUND ── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Get Around</Text>
        {destination.length === 0 && browseRoutes.length > 4 && (
          <TouchableOpacity onPress={() => router.push("/(main)/book")} activeOpacity={0.7}>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search inputs */}
      <View style={styles.searchCard}>
        {/* From (optional) */}
        <View style={styles.searchRow}>
          <View style={styles.searchDot} />
          <TextInput
            style={styles.searchInput}
            placeholder="Pickup point (optional — e.g. Mabalacat)"
            placeholderTextColor="#9ca3af"
            value={origin}
            onChangeText={handleOriginChange}
            returnKeyType="next"
          />
          {origin.length > 0 && (
            <TouchableOpacity onPress={() => { setOrigin(""); setOrigCoords(null); triggerSearch(destination, "", null); }} style={{ paddingRight: 4 }} accessibilityLabel="Clear origin">
              <Ionicons name="close-circle" size={15} color="#d1d5db" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.locationBtn, { marginRight: 4 }]} onPress={handleUseCurrentLocation} disabled={locating} activeOpacity={0.8}>
            {locating
              ? <ActivityIndicator size={12} color="#1a4a52" />
              : <>
                  <Ionicons name="locate" size={13} color="#1a4a52" />
                  <Text style={styles.locationBtnText}>GPS</Text>
                </>
            }
          </TouchableOpacity>
          <TouchableOpacity style={[styles.locationBtn, { marginRight: 10 }]} onPress={() => { setMapPickerTarget("origin"); setShowMapPicker(true); }} activeOpacity={0.8}>
            <Ionicons name="map-outline" size={13} color="#1a4a52" />
            <Text style={styles.locationBtnText}>Map</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchDivider} />

        {/* To (destination) */}
        <View style={styles.searchRow}>
          <Ionicons name="location" size={14} color="#1a4a52" style={{ marginLeft: 10 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Where are you going?"
            placeholderTextColor="#9ca3af"
            value={destination}
            onChangeText={handleDestinationChange}
            returnKeyType="search"
            autoFocus={false}
          />
          {destination.length > 0 && (
            <TouchableOpacity
              onPress={() => { setDestination(""); setOrigin(""); setOrigCoords(null); setDestCoords(null); setJourneyOptions([]); setDestDisplay(null); setFilterMode("all"); setDestSuggestions([]); setOriginSuggestions([]); }}
              style={{ paddingRight: 4 }}
              accessibilityLabel="Clear destination"
            >
              <Ionicons name="close-circle" size={15} color="#d1d5db" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.locationBtn, { marginRight: 10 }]} onPress={() => { setMapPickerTarget("dest"); setShowMapPicker(true); }} activeOpacity={0.8}>
            <Ionicons name="map-outline" size={13} color="#1a4a52" />
            <Text style={styles.locationBtnText}>Map</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Origin suggestions */}
      {originSuggestions.length > 0 && (
        <View style={styles.suggestionList}>
          {originSuggestions.map((s) => (
            <TouchableOpacity key={s.place_id} style={styles.suggestionItem} onPress={() => selectSuggestion(s, "origin")} activeOpacity={0.7}>
              <Ionicons name="location-outline" size={14} color="#6b7280" style={{ marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestionMain} numberOfLines={1}>{s.main_text}</Text>
                {s.secondary_text ? <Text style={styles.suggestionSub} numberOfLines={1}>{s.secondary_text}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Destination suggestions */}
      {destSuggestions.length > 0 && (
        <View style={styles.suggestionList}>
          {destSuggestions.map((s) => (
            <TouchableOpacity key={s.place_id} style={styles.suggestionItem} onPress={() => selectSuggestion(s, "dest")} activeOpacity={0.7}>
              <Ionicons name="location-outline" size={14} color="#1a4a52" style={{ marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestionMain} numberOfLines={1}>{s.main_text}</Text>
                {s.secondary_text ? <Text style={styles.suggestionSub} numberOfLines={1}>{s.secondary_text}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Geocoded destination confirmation */}
      {destDisplay && destination.trim().length >= 2 && (
        <View style={styles.geocodedBanner}>
          <Ionicons name="checkmark-circle" size={13} color="#16a34a" />
          <Text style={styles.geocodedText} numberOfLines={1}>{destDisplay}</Text>
        </View>
      )}

      {destination.trim().length >= 2 ? (
        /* ── JOURNEY PLANNER MODE ── */
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={styles.filterRow} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
            {(["all", "fastest", "cheapest", "direct"] as FilterMode[]).map((f) => {
              const labels: Record<FilterMode, string> = {
                all: "All Options", fastest: "Fastest", cheapest: "Cheapest", direct: "Direct Only",
              };
              const active = filterMode === f;
              return (
                <TouchableOpacity key={f}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setFilterMode(f)} activeOpacity={0.8}>
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                    {labels[f]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {loadingJourney ? (
            <View style={styles.routesLoading}>
              <ActivityIndicator color="#1a4a52" />
              <Text style={styles.routesLoadingText}>Finding routes…</Text>
            </View>
          ) : displayedOptions.length === 0 ? (
            <View style={styles.routesEmpty}>
              <Ionicons name="map-outline" size={36} color="#d1d5db" />
              <Text style={styles.routesEmptyTitle}>No routes found</Text>
              <Text style={styles.routesEmptyText}>
                No routes go to "{destination}".{"\n"}Try a nearby landmark or terminal.
              </Text>
            </View>
          ) : (
            <View style={styles.routesList}>
              {displayedOptions.map((opt, idx) => (
                <JourneyCard key={idx} option={opt} onPress={() => router.push({
                  pathname: "/(main)/map",
                  params: { journeyOption: JSON.stringify(opt) },
                })} />
              ))}
            </View>
          )}
        </>
      ) : (
        /* ── BROWSE MODE ── */
        <>
          {loadingBrowse ? (
            <View style={styles.routesLoading}>
              <ActivityIndicator color="#1a4a52" />
            </View>
          ) : browseRoutes.length === 0 ? (
            <View style={styles.routesEmpty}>
              <Ionicons name="map-outline" size={32} color="#d1d5db" />
              <Text style={styles.routesEmptyTitle}>No active routes</Text>
              <Text style={styles.routesEmptyText}>Routes will appear here once they are set up.</Text>
            </View>
          ) : (
            <View style={styles.routesList}>
              {browseRoutes.slice(0, 4).map((route) => {
                const vtColor = route.vehicle_type ? (VEHICLE_COLORS[route.vehicle_type] ?? "#6b7280") : "#6b7280";
                return (
                  <TouchableOpacity key={route.id} style={styles.browseCard}
                    onPress={() => router.push("/(main)/book")} activeOpacity={0.8}>
                    <View style={[styles.routeAccent, { backgroundColor: route.color }]} />
                    <View style={styles.routeBody}>
                      <View style={styles.routeTopRow}>
                        <Text style={styles.routeName} numberOfLines={1}>{route.name}</Text>
                        {route.fare !== null && (
                          <Text style={styles.routeFare}>₱{route.fare.toFixed(2)}</Text>
                        )}
                      </View>
                      <View style={styles.routeLocRow}>
                        <Ionicons name="radio-button-on" size={10} color="#9ca3af" />
                        <Text style={styles.routeLoc} numberOfLines={1}>{route.from_location || "—"}</Text>
                        <Ionicons name="arrow-forward" size={10} color="#d1d5db" />
                        <Ionicons name="location" size={10} color="#1a4a52" />
                        <Text style={styles.routeLoc} numberOfLines={1}>{route.to_location || "—"}</Text>
                      </View>
                      <View style={styles.routeBottomRow}>
                        {route.vehicle_type && (
                          <View style={[styles.vtChip, { backgroundColor: vtColor + "18" }]}>
                            <Text style={[styles.vtChipText, { color: vtColor }]}>{route.vehicle_type}</Text>
                          </View>
                        )}
                        <View style={styles.driverChip}>
                          <Ionicons name="person" size={10} color={route.driver_count > 0 ? "#16a34a" : "#9ca3af"} />
                          <Text style={[styles.driverChipText, { color: route.driver_count > 0 ? "#16a34a" : "#9ca3af" }]}>
                            {route.driver_count > 0 ? `${route.driver_count} driver${route.driver_count > 1 ? "s" : ""}` : "No drivers"}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#d1d5db" style={{ marginRight: 12 }} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      )}

      <View style={{ height: 8 }} />

      {/* ── DISCOUNT STATUS ── */}
      <Text style={styles.sectionTitle}>Discount Status</Text>
      <View style={styles.discountCard}>
        <View style={styles.discountLeft}>
          <View style={styles.discountIconWrap}>
            <Ionicons name={catMeta.icon} size={28} color="#1a4a52" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.discountType}>{catMeta.label}</Text>
            <View style={styles.discountStatusRow}>
              {isVerified
                ? <Ionicons name="checkmark-circle" size={12} color="#16a34a" />
                : isRejected
                ? <Ionicons name="close-circle"     size={12} color="#dc2626" />
                : isPending
                ? <Ionicons name="time"             size={12} color="#b45309" />
                : <Ionicons name="information-circle" size={12} color="#6b7280" />
              }
              <Text style={styles.discountStatus}>
                {isVerified   ? "Active — discount applied on rides"
               : isRejected   ? "Rejected — resubmit to activate discount"
               : isPending    ? "Awaiting admin verification"
               : category === "default" ? "No discount category selected"
               : "Awaiting admin verification"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── RECENT ACTIVITY ── (Settings → Notifications, filtered per-kind) */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {visibleActivity.length > 0 && (
          <TouchableOpacity onPress={() => router.push("/(main)/booking-history")} activeOpacity={0.7}>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        )}
      </View>
      {visibleActivity.length === 0 ? (
        <View style={styles.emptyActivity}>
          <Ionicons name="ticket-outline" size={36} color="#d1d5db" style={{ marginBottom: 4 }} />
          <Text style={styles.emptyText}>No recent activity.</Text>
          <Text style={styles.emptySubtext}>Book your first ride to get started!</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push("/(main)/book")} activeOpacity={0.85}>
            <Text style={styles.emptyBtnText}>Book a Ride</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.activityList}>
          {visibleActivity.slice(0, 10).map((entry) => (
            <ActivityRow key={entry.key} entry={entry} />
          ))}
        </View>
      )}

      <View style={{ height: 32 }} />
    </KeyboardAwareForm>
  );
}

const ACTIVITY_LABEL_COLOR: Record<BookingActivityEntry["kind"], string> = {
  confirmed: "#1a4a52",
  completed: "#16a34a",
  cancelled: "#dc2626",
};

function ActivityRow({ entry }: { entry: BookingActivityEntry }) {
  const meta = VEHICLE_META[entry.vehicleCategory] ?? VEHICLE_META["UV Express"];
  const ts   = new Date(entry.timestamp.replace(" ", "T"));
  const dateStr = ts.toLocaleDateString("en-PH", { month: "short", day: "numeric" })
    + " · " + ts.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityIcon, { backgroundColor: meta.bg }]}>
        <Ionicons name={meta.icon as IoniconsName} size={16} color={meta.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.activityRoute} numberOfLines={1}>{entry.routeName ?? meta.label}</Text>
        <Text style={styles.activityMeta} numberOfLines={1}>{meta.label} · {dateStr}</Text>
        <Text style={styles.activityRef} numberOfLines={1}>Ref: {entry.qrCode}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.activityLabel, { color: ACTIVITY_LABEL_COLOR[entry.kind] }]}>{entry.label}</Text>
    </View>
  );
}

function JourneyCard({ option, onPress }: { option: JourneyOption; onPress: () => void }) {
  const typeLabel = option.type === "direct"   ? "Direct"
                  : option.type === "transfer" ? `${option.transfers} Transfer${option.transfers > 1 ? "s" : ""}`
                  : "Also nearby";
  const typeBg    = option.type === "direct"   ? "#f0fdf4"
                  : option.type === "transfer" ? "#eff6ff"
                  : "#fef9c3";
  const typeColor = option.type === "direct"   ? "#16a34a"
                  : option.type === "transfer" ? "#2563eb"
                  : "#92400e";

  return (
    <TouchableOpacity style={styles.journeyCard} onPress={onPress} activeOpacity={0.8}>

      {/* Header row: type badge + time/km/fare */}
      <View style={styles.journeyHeader}>
        <View style={[styles.journeyTypeBadge, { backgroundColor: typeBg }]}>
          <Text style={[styles.journeyTypeText, { color: typeColor }]}>{typeLabel}</Text>
        </View>
        <View style={styles.journeyMeta}>
          {option.total_mins !== null && (
            <View style={styles.journeyMetaItem}>
              <Ionicons name="time-outline" size={12} color="#6b7280" />
              <Text style={styles.journeyMetaText}>~{option.total_mins} min</Text>
            </View>
          )}
          {option.total_km !== null && (
            <View style={styles.journeyMetaItem}>
              <Ionicons name="navigate-outline" size={12} color="#6b7280" />
              <Text style={styles.journeyMetaText}>{option.total_km} km</Text>
            </View>
          )}
          {option.total_fare !== null && (
            <Text style={styles.journeyFare}>₱{option.total_fare.toFixed(2)}</Text>
          )}
        </View>
      </View>

      {/* Segments */}
      {option.segments.map((seg, i) => {
        const vtColor = seg.vehicle_type ? (VEHICLE_COLORS[seg.vehicle_type] ?? "#6b7280") : "#6b7280";
        const icon    = VEHICLE_ICONS[seg.vehicle_type ?? ""] ?? ("bus-outline" as IoniconsName);
        return (
          <View key={i}>
            {i > 0 && (
              <View style={styles.transferDivider}>
                <View style={styles.transferLine} />
                <View style={styles.transferPill}>
                  <Ionicons name="swap-vertical" size={10} color="#6b7280" />
                  {/* Each transfer's own location, not the option-level transfer_point
                      (which only ever holds the FIRST transfer — wrong for a 2+-transfer
                      journey) — the previous segment's alight_at IS where this transfer
                      happens. */}
                  <Text style={styles.transferText}>
                    Transfer at {option.segments[i - 1].alight_at || option.segments[i - 1].to}
                  </Text>
                  <Text style={styles.transferWait}>+5 min</Text>
                </View>
                <View style={styles.transferLine} />
              </View>
            )}
            {seg.board_side_hint === "cross" && (
              <View style={styles.sideHintBox}>
                <Ionicons name="walk-outline" size={12} color="#b45309" />
                <Text style={styles.sideHintText}>
                  {seg.board_side_note || "Cross to the other side of the road to board this jeepney."}
                </Text>
              </View>
            )}
            <View style={styles.segmentRow}>
              {option.segments.length > 1 && (
                <View style={styles.stepBubble}>
                  <Text style={styles.stepNum}>{i + 1}</Text>
                </View>
              )}
              <View style={[styles.segIcon, { backgroundColor: vtColor + "18" }]}>
                <Ionicons name={icon} size={14} color={vtColor} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.segTopRow}>
                  {seg.vehicle_type && (
                    <Text style={[styles.segVehicle, { color: vtColor }]}>{seg.vehicle_type}</Text>
                  )}
                  <Text style={styles.segRouteName} numberOfLines={1}>{seg.route_name}</Text>
                </View>
                <View style={styles.segLocRow}>
                  <View style={[styles.segDot, { backgroundColor: "#9ca3af" }]} />
                  <Text style={styles.segLoc} numberOfLines={1}>{seg.board_at || seg.from || "—"}</Text>
                  <Ionicons name="arrow-forward" size={9} color="#d1d5db" />
                  <View style={[styles.segDot, { backgroundColor: vtColor }]} />
                  <Text style={[styles.segLoc, { fontWeight: "700", color: "#374151" }]} numberOfLines={1}>
                    {seg.alight_at || seg.to || "—"}
                  </Text>
                </View>
                {seg.dist_to_dest !== null && seg.dist_to_dest > 0 && (
                  <View style={[styles.distNote, seg.dist_to_dest > 500 && styles.distNoteWarning]}>
                    <Ionicons name="walk-outline" size={10} color={seg.dist_to_dest > 500 ? "#b45309" : "#9ca3af"} />
                    <Text style={[styles.distNoteText, seg.dist_to_dest > 500 && styles.distNoteTextWarning]}>
                      {seg.dist_to_dest >= 1000
                        ? `~${(seg.dist_to_dest / 1000).toFixed(1)}km walk to destination`
                        : `~${seg.dist_to_dest}m walk to destination`}
                    </Text>
                  </View>
                )}
                {(seg.fare !== null || seg.est_mins !== null) && (
                  <View style={styles.segFooter}>
                    {seg.fare     !== null && <Text style={styles.segFare}>₱{seg.fare.toFixed(2)}</Text>}
                    {seg.est_mins !== null && <Text style={styles.segTime}>~{seg.est_mins} min</Text>}
                    {seg.km       !== null && <Text style={styles.segTime}>{seg.km} km</Text>}
                  </View>
                )}
              </View>
            </View>
          </View>
        );
      })}

      {/* Plain-language instruction */}
      <View style={styles.journeyInstruction}>
        <Ionicons name="information-circle-outline" size={13} color="#9ca3af" />
        <Text style={styles.journeyInstructionText}>
          {(() => {
            const vehicleWord = (vt: string | null) => (vt ? vt.toLowerCase() : "vehicle");
            const segs = option.segments;
            const first = segs[0];
            if (segs.length === 1) {
              return `Ride the ${vehicleWord(first.vehicle_type)} from ${first.board_at || first.from} going to ${first.alight_at || first.to}.`;
            }
            // Generalized for any number of transfers — a "purple then orange"
            // 2-transfer journey reads as one continuous sentence rather than
            // only ever describing the first hop.
            let text = `You need to ride ${segs.length} vehicles — from ${first.board_at || first.from} to ${first.alight_at || first.to}`;
            for (let i = 1; i < segs.length; i++) {
              const seg = segs[i];
              const isLast = i === segs.length - 1;
              text += `, then transfer to the ${seg.route_name} ${vehicleWord(seg.vehicle_type)}`;
              text += isLast ? ` to reach ${seg.alight_at || seg.to}` : ` to ${seg.alight_at || seg.to}`;
            }
            return text + ".";
          })()}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f9fafb" },
  content:     { paddingHorizontal: 20, paddingBottom: 20 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f9fafb" },

  successBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f0fdf4", borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "#bbf7d0" },
  successText:   { fontSize: 13, fontWeight: "700", color: "#15803d" },

  rejectedBanner:   { backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca", borderRadius: 14, padding: 14, marginBottom: 16, gap: 12 },
  rejectedTop:      { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  rejectedTitle:    { fontSize: 13, fontWeight: "800", color: "#991b1b" },
  rejectedSubtitle: { fontSize: 11, color: "#b91c1c", marginTop: 2 },
  resubmitBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#dc2626", borderRadius: 10, paddingVertical: 10 },
  resubmitBtnText:  { fontSize: 13, fontWeight: "800", color: "#fff" },
  removeExpiredBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, marginTop: 8, borderRadius: 10, borderWidth: 1.5, borderColor: "#fecaca", backgroundColor: "#fff" },
  removeExpiredText: { fontSize: 13, fontWeight: "800", color: "#b91c1c" },
  cooldownWrap:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fee2e2", borderRadius: 10, padding: 10 },
  cooldownText:     { fontSize: 12, color: "#991b1b", fontWeight: "600" },
  cooldownHours:    { fontWeight: "900", color: "#dc2626" },

  pendingBanner:   { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a", borderRadius: 14, padding: 14, marginBottom: 20 },
  pendingTitle:    { fontSize: 13, fontWeight: "800", color: "#92400e" },
  pendingSubtitle: { fontSize: 11, color: "#b45309", marginTop: 2 },

  statusAlertBanner:  { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#f0fdfa", borderWidth: 1, borderColor: "#99f6e4", borderRadius: 14, padding: 14, marginBottom: 16 },
  statusAlertText:    { flex: 1, fontSize: 12, fontWeight: "700", color: "#1a4a52", lineHeight: 17 },
  statusAlertCloseBtn:{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#e0f2fe" },

  greetingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  greeting:    { fontSize: 14, color: "#6b7280", fontWeight: "500" },
  name:        { fontSize: 24, fontWeight: "900", color: "#1a4a52" },
  notifBtn:    { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 38, borderRadius: 19, paddingHorizontal: 14, backgroundColor: "#fff", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, elevation: 4 },
  notifBtnText: { fontSize: 12.5, fontWeight: "800", color: "#1a4a52" },

  walletCard:       { backgroundColor: "#1a4a52", borderRadius: 20, padding: 22, marginBottom: 28, overflow: "hidden", shadowColor: "#1a4a52", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 10 },
  walletTop:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  walletLabel:      { fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: "600" },
  walletBadge:      { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(168,216,50,0.2)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  walletBadgeText:  { fontSize: 11, color: "#a8d832", fontWeight: "700" },
  walletAmount:     { fontSize: 38, fontWeight: "900", color: "#fff", marginBottom: 20, letterSpacing: -1 },
  walletActions:    { flexDirection: "row", gap: 10 },
  walletBtn:        { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#a8d832", borderRadius: 12, paddingVertical: 10 },
  walletBtnOutline: { backgroundColor: "rgba(255,255,255,0.15)" },
  walletBtnText:    { fontSize: 13, fontWeight: "800", color: "#1a2a10" },
  walletCircle1:    { position: "absolute", width: 140, height: 140, borderRadius: 70, backgroundColor: "rgba(255,255,255,0.04)", top: -40, right: -30 },
  walletCircle2:    { position: "absolute", width: 90, height: 90, borderRadius: 45, backgroundColor: "rgba(168,216,50,0.08)", bottom: -20, right: 60 },

  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#1a4a52", marginBottom: 12 },

  // 3 equal-width columns in a single row (was a 2-column wrapping grid sized
  // for 4 cards — with only 3 now, flex:1 splits the row evenly instead of
  // leaving a lonely 3rd card wrapped onto its own half-empty row).
  quickGrid:  { flexDirection: "row", gap: 12, marginBottom: 28 },
  quickCard:  { flex: 1, borderRadius: 16, padding: 14, gap: 8, alignItems: "center" },
  quickLabel: { fontSize: 13, fontWeight: "800", lineHeight: 18, textAlign: "center" },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  seeAll:        { fontSize: 13, fontWeight: "700", color: "#0284c7" },

  searchWrap:    { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", marginBottom: 12, gap: 8 },
  searchCard:    { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1.5, borderColor: "#e5e7eb", marginBottom: 8, overflow: "hidden" },
  searchRow:     { flexDirection: "row", alignItems: "center", gap: 6 },
  searchDot:     { width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: "#9ca3af", marginLeft: 12 },
  searchDivider: { height: 1, backgroundColor: "#f3f4f6", marginLeft: 36 },
  searchInput:   { flex: 1, fontSize: 13, color: "#111827", paddingVertical: 11, paddingHorizontal: 4 },
  geocodedBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0fdf4", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 10 },
  geocodedText:   { flex: 1, fontSize: 11, color: "#15803d", fontWeight: "600" },

  // ── filter chips ────────────────────────────────────────────────────────────
  filterRow:            { marginBottom: 12 },
  filterChip:           { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: "#f3f4f6", borderWidth: 1.5, borderColor: "#e5e7eb" },
  filterChipActive:     { backgroundColor: "#1a4a52", borderColor: "#1a4a52" },
  filterChipText:       { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  filterChipTextActive: { color: "#fff" },

  // ── loading / empty states ───────────────────────────────────────────────────
  routesLoading:    { paddingVertical: 28, alignItems: "center", gap: 8 },
  routesLoadingText:{ fontSize: 12, color: "#9ca3af" },
  routesEmpty:      { backgroundColor: "#fff", borderRadius: 14, padding: 28, alignItems: "center", gap: 6, marginBottom: 20 },
  routesEmptyTitle: { fontSize: 14, fontWeight: "800", color: "#374151" },
  routesEmptyText:  { fontSize: 12, color: "#9ca3af", textAlign: "center", lineHeight: 18 },

  // ── route lists ──────────────────────────────────────────────────────────────
  routesList:   { gap: 10, marginBottom: 20 },
  browseCard:   { backgroundColor: "#fff", borderRadius: 14, flexDirection: "row", alignItems: "center", overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  routeAccent:  { width: 5, alignSelf: "stretch" },
  routeBody:    { flex: 1, paddingVertical: 12, paddingHorizontal: 12, gap: 5 },
  routeTopRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  routeName:    { fontSize: 14, fontWeight: "800", color: "#111827", flex: 1, marginRight: 8 },
  routeFare:    { fontSize: 14, fontWeight: "900", color: "#1a4a52" },
  routeLocRow:  { flexDirection: "row", alignItems: "center", gap: 4 },
  routeLoc:     { fontSize: 11, color: "#6b7280", flex: 1 },
  routeBottomRow:  { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 2 },
  vtChip:       { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  vtChipText:   { fontSize: 10, fontWeight: "700" },
  driverChip:   { flexDirection: "row", alignItems: "center", gap: 3 },
  driverChipText: { fontSize: 10, fontWeight: "600" },

  // ── journey card ─────────────────────────────────────────────────────────────
  journeyCard:         { backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 0, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, gap: 10 },
  journeyHeader:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  journeyTypeBadge:    { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  journeyTypeText:     { fontSize: 11, fontWeight: "800" },
  journeyMeta:         { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  journeyMetaItem:     { flexDirection: "row", alignItems: "center", gap: 3 },
  journeyMetaText:     { fontSize: 11, color: "#6b7280" },
  journeyFare:         { fontSize: 14, fontWeight: "900", color: "#1a4a52" },
  transferDivider:     { flexDirection: "row", alignItems: "center", gap: 6, marginVertical: 4 },
  transferLine:        { flex: 1, height: 1, backgroundColor: "#f3f4f6" },
  transferPill:        { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f8fafc", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "#e2e8f0" },
  transferText:        { fontSize: 10, color: "#6b7280", fontWeight: "600" },
  transferWait:        { fontSize: 10, color: "#94a3b8" },
  segmentRow:          { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  stepBubble:          { width: 18, height: 18, borderRadius: 9, backgroundColor: "#1a4a52", alignItems: "center", justifyContent: "center", marginTop: 2 },
  stepNum:             { fontSize: 9, fontWeight: "900", color: "#fff" },
  segIcon:             { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 1 },
  segTopRow:           { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  segVehicle:          { fontSize: 10, fontWeight: "800" },
  segRouteName:        { fontSize: 12, fontWeight: "700", color: "#374151", flex: 1 },
  segLocRow:           { flexDirection: "row", alignItems: "center", gap: 4 },
  segDot:              { width: 6, height: 6, borderRadius: 3 },
  segLoc:              { fontSize: 11, color: "#6b7280", flex: 1 },
  distNote:            { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  distNoteText:        { fontSize: 10, color: "#9ca3af" },
  distNoteWarning:     { },
  distNoteTextWarning: { color: "#b45309", fontWeight: "700" },
  sideHintBox:         { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#fffbeb", borderRadius: 8, borderWidth: 1, borderColor: "#fde68a", paddingHorizontal: 8, paddingVertical: 5, marginTop: 4, marginBottom: 2 },
  sideHintText:        { fontSize: 10, color: "#92400e", fontWeight: "700", flex: 1 },
  segFooter:           { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 },
  segFare:             { fontSize: 11, fontWeight: "700", color: "#1a4a52" },
  segTime:             { fontSize: 11, color: "#9ca3af" },
  journeyInstruction:  { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#f8fafc", borderRadius: 8, padding: 8 },
  journeyInstructionText: { fontSize: 11, color: "#6b7280", flex: 1, lineHeight: 16 },

  discountCard:      { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 28, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  discountLeft:      { flexDirection: "row", alignItems: "center", gap: 14 },
  discountIconWrap:  { width: 48, height: 48, borderRadius: 24, backgroundColor: "#f0fdf4", alignItems: "center", justifyContent: "center" },
  discountType:      { fontSize: 14, fontWeight: "800", color: "#1a4a52", marginBottom: 4 },
  discountStatusRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  discountStatus:    { fontSize: 12, color: "#6b7280" },

  emptyActivity: { backgroundColor: "#fff", borderRadius: 16, padding: 28, alignItems: "center", gap: 6, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  emptyText:     { fontSize: 15, fontWeight: "800", color: "#374151" },
  emptySubtext:  { fontSize: 12, color: "#9ca3af", textAlign: "center" },
  emptyBtn:      { marginTop: 12, backgroundColor: "#1a4a52", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10 },
  emptyBtnText:  { fontSize: 13, fontWeight: "800", color: "#fff" },

  activityList:   { backgroundColor: "#fff", borderRadius: 16, paddingHorizontal: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  activityRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  activityIcon:   { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  activityRoute:  { fontSize: 13, fontWeight: "800", color: "#111827" },
  activityMeta:   { fontSize: 11, color: "#6b7280", fontWeight: "600", marginTop: 1 },
  activityRef:    { fontSize: 10, color: "#9ca3af", marginTop: 1 },
  activityLabel:  { fontSize: 11, fontWeight: "800", textAlign: "right", maxWidth: 90, flexShrink: 1 },

  modalOverlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:        { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHandle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },
  modalTitle:        { fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 6 },
  modalSubtitle:     { fontSize: 13, color: "#6b7280", marginBottom: 20 },
  errorBox:          { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca", borderRadius: 12, padding: 12, marginBottom: 16 },
  errorText:         { color: "#dc2626", fontSize: 13, flex: 1 },
  uploadBtn:         { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, borderStyle: "dashed", overflow: "hidden", backgroundColor: "#f9fafb", marginBottom: 8 },
  uploadPlaceholder: { alignItems: "center", paddingVertical: 28, gap: 4 },
  uploadText:        { fontSize: 13, fontWeight: "700", color: "#374151" },
  uploadHint:        { fontSize: 11, color: "#9ca3af" },
  docPreview:        { width: "100%", height: 160 },
  removeBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 6, marginBottom: 16 },
  removeBtnText:     { fontSize: 12, color: "#ef4444", fontWeight: "600" },
  modalActions:      { flexDirection: "row", gap: 10, marginTop: 16 },
  modalCancel:       { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  modalCancelText:   { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  modalSubmit:       { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: "#1a4a52", alignItems: "center" },
  modalSubmitText:   { fontSize: 14, fontWeight: "800", color: "#fff" },

  // ── location buttons (GPS + map pin) ────────────────────────────────────────
  locationBtn: { flexDirection: "row", alignItems: "center", gap: 3, height: 30, borderRadius: 15, paddingHorizontal: 8, backgroundColor: "#f0fdf4", justifyContent: "center", borderWidth: 1, borderColor: "#bbf7d0" },
  locationBtnText: { fontSize: 10.5, fontWeight: "800", color: "#1a4a52" },

  // ── map picker modal ─────────────────────────────────────────────────────────
  mapPickerContainer:   { flex: 1, backgroundColor: "#fff" },
  mapPickerHeader:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  mapPickerTitle:       { fontSize: 16, fontWeight: "800", color: "#1a4a52" },
  mapPickerCloseBtn:    { flexDirection: "row", alignItems: "center", gap: 3 },
  mapPickerCloseText:   { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  mapPickerSub:         { fontSize: 12, color: "#9ca3af", paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 },
  mapPickerFooter:      { padding: 20, paddingBottom: 36, backgroundColor: "#fff" },
  mapPickerConfirm:     { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  mapPickerConfirmText: { fontSize: 15, fontWeight: "800", color: "#fff" },
  mapPickerHint:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, backgroundColor: "#f9fafb", borderRadius: 14 },
  mapPickerHintText:    { fontSize: 13, color: "#9ca3af" },

  // ── place suggestion dropdown ────────────────────────────────────────────────
  suggestionList: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e5e7eb", marginTop: -4, marginBottom: 8, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, elevation: 5 },
  suggestionItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  suggestionMain: { fontSize: 13, fontWeight: "700", color: "#111827" },
  suggestionSub:  { fontSize: 11, color: "#9ca3af", marginTop: 1 },
});