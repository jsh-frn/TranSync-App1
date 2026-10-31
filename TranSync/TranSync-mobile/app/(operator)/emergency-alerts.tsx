import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Linking,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";

// Emergency (SOS) alerts raised by THIS operator's own drivers — sent from the
// driver map's EMERGENCY button (drivers/send_emergency.php). Not a tab: pushed
// from the red banner on the Home dashboard. Refreshes on focus and every 15s
// while open, since an operator watching this screen needs a new alert to
// appear without pulling to refresh.

type EmergencyAlert = {
  id:             number;
  driver_id:      number;
  message:        string | null;
  latitude:       number | null;
  longitude:      number | null;
  status:         "active" | "resolved";
  created_at:     string;
  driver_name:    string;
  driver_phone:   string | null;
  plate_number:   string | null;
  vehicle_number: string | null;
  vehicle_type:   string | null;
};

const POLL_MS = 15000;

function fmtTime(s: string) {
  return new Date(s.replace(" ", "T")).toLocaleString("en-PH", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function EmergencyAlertsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [operatorId, setOperatorId] = useState<number | null>(null);
  const [alerts,     setAlerts]     = useState<EmergencyAlert[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState("");
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [toast,      setToast]      = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // `silent` = background poll: a failed poll keeps whatever's already shown
  // instead of replacing a working list with an error screen.
  const load = useCallback(async (opId: number, silent = false) => {
    try {
      const res  = await fetch(`${API_BASE}/operators/get_emergency_alerts.php?operator_id=${opId}`);
      const data = await res.json();
      if (data.success) { setAlerts(data.alerts ?? []); setError(""); }
      else if (!silent) setError(data.message ?? "Couldn't load alerts.");
    } catch {
      if (!silent) setError("Can't connect to the server. Check your connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;
      let cancelled = false;
      (async () => {
        const raw = await AsyncStorage.getItem("user");
        const id  = raw ? JSON.parse(raw)?.id : null;
        if (cancelled) return;
        if (!id) { setLoading(false); setError("Couldn't identify your account. Please log in again."); return; }
        setOperatorId(id);
        load(id);
        timer = setInterval(() => load(id, true), POLL_MS);
      })();
      return () => { cancelled = true; if (timer) clearInterval(timer); };
    }, [load])
  );

  const onRefresh = () => {
    if (!operatorId) return;
    setRefreshing(true);
    load(operatorId);
  };

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => showToast("Couldn't open that on this device."));
  };

  const confirmResolve = (a: EmergencyAlert) => {
    Alert.alert(
      "Mark as resolved?",
      `Only do this once ${a.driver_name} is safe and the situation is handled.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Mark Resolved", onPress: () => doResolve(a) },
      ]
    );
  };

  const doResolve = async (a: EmergencyAlert) => {
    if (!operatorId) return;
    setResolvingId(a.id);
    try {
      const res  = await fetch(`${API_BASE}/operators/resolve_emergency_alert.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operator_id: operatorId, alert_id: a.id }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Alert marked as resolved.");
        await load(operatorId, true);
      } else {
        Alert.alert("Couldn't resolve", data.message ?? "Please try again.");
      }
    } catch {
      Alert.alert("Connection error", "Couldn't reach the server. Please try again.");
    } finally {
      setResolvingId(null);
    }
  };

  const active   = alerts.filter((a) => a.status === "active");
  const resolved = alerts.filter((a) => a.status === "resolved");

  const renderCard = (a: EmergencyAlert) => {
    const isActive = a.status === "active";
    const hasLoc   = a.latitude !== null && a.longitude !== null;
    const vehicle  = [a.plate_number, a.vehicle_number, a.vehicle_type].filter(Boolean).join(" · ");
    return (
      <View key={a.id} style={[s.card, isActive ? s.cardActive : s.cardResolved]}>
        <View style={s.cardTop}>
          <View style={[s.iconWrap, { backgroundColor: isActive ? "#fee2e2" : "#f3f4f6" }]}>
            <Ionicons name={isActive ? "warning" : "checkmark-circle"} size={20} color={isActive ? "#dc2626" : "#6b7280"} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.driverName} numberOfLines={1}>{a.driver_name}</Text>
            <Text style={s.meta} numberOfLines={1}>{vehicle || "No vehicle assigned"}</Text>
            <Text style={s.meta}>{fmtTime(a.created_at)}</Text>
          </View>
          <View style={[s.pill, { backgroundColor: isActive ? "#dc2626" : "#e5e7eb" }]}>
            <Text style={[s.pillText, { color: isActive ? "#fff" : "#6b7280" }]}>{isActive ? "ACTIVE" : "RESOLVED"}</Text>
          </View>
        </View>

        {!!a.message && <Text style={s.message}>{a.message}</Text>}

        {!hasLoc && (
          <Text style={s.noLoc}>Location unavailable — call the driver to find out where they are.</Text>
        )}

        <View style={s.actions}>
          {!!a.driver_phone && (
            <TouchableOpacity style={s.actionBtn} onPress={() => openUrl(`tel:${a.driver_phone}`)} activeOpacity={0.8}>
              <Ionicons name="call" size={15} color="#1a4a52" />
              <Text style={s.actionText}>Call Driver</Text>
            </TouchableOpacity>
          )}
          {hasLoc && (
            <TouchableOpacity
              style={s.actionBtn}
              onPress={() => openUrl(`https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`)}
              activeOpacity={0.8}
            >
              <Ionicons name="location" size={15} color="#1a4a52" />
              <Text style={s.actionText}>Open in Maps</Text>
            </TouchableOpacity>
          )}
          {isActive && (
            <TouchableOpacity
              style={[s.actionBtn, s.resolveBtn, resolvingId === a.id && { opacity: 0.6 }]}
              onPress={() => confirmResolve(a)}
              disabled={resolvingId === a.id}
              activeOpacity={0.85}
            >
              {resolvingId === a.id
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="checkmark" size={15} color="#fff" /><Text style={[s.actionText, { color: "#fff" }]}>Mark Resolved</Text></>}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {!!toast && (
        <View style={[s.toast, { top: insets.top + 56 }]}>
          <Ionicons name="checkmark-circle" size={16} color="#a8d832" />
          <Text style={s.toastText}>{toast}</Text>
        </View>
      )}

      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>Emergency Alerts</Text>
        <View style={{ width: 64 }} />
      </View>

      {loading ? (
        <View style={s.centered}><ActivityIndicator color="#1a4a52" size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a4a52" />}
        >
          {!!error && (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#dc2626" />
              <Text style={s.errorText}>{error}</Text>
              <TouchableOpacity onPress={onRefresh} activeOpacity={0.8}><Text style={s.retry}>Retry</Text></TouchableOpacity>
            </View>
          )}

          {!error && alerts.length === 0 && (
            <View style={s.empty}>
              <Ionicons name="shield-checkmark-outline" size={44} color="#d1d5db" />
              <Text style={s.emptyTitle}>No emergency alerts.</Text>
              <Text style={s.emptySub}>You'll see an alert here the moment one of your drivers sends one.</Text>
            </View>
          )}

          {active.length > 0 && (
            <>
              <Text style={[s.sectionLabel, { color: "#dc2626" }]}>Active ({active.length})</Text>
              {active.map(renderCard)}
            </>
          )}
          {resolved.length > 0 && (
            <>
              <Text style={[s.sectionLabel, { marginTop: active.length ? 18 : 0 }]}>Recently resolved</Text>
              {resolved.map(renderCard)}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: "#f9fafb" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  backBtn:     { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, paddingHorizontal: 8, width: 64 },
  backBtnText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "900", color: "#1a4a52" },

  toast:     { position: "absolute", left: 20, right: 20, zIndex: 99, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, padding: 12 },
  toastText: { color: "#fff", fontSize: 13, fontWeight: "700", flex: 1 },

  sectionLabel: { fontSize: 12, fontWeight: "800", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },

  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1.5 },
  cardActive:   { borderColor: "#fca5a5" },
  cardResolved: { borderColor: "#f1f5f9", opacity: 0.85 },
  cardTop:      { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap:     { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  driverName:   { fontSize: 15, fontWeight: "900", color: "#1a4a52" },
  meta:         { fontSize: 12, color: "#6b7280", fontWeight: "600", marginTop: 1 },
  pill:         { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 0 },
  pillText:     { fontSize: 10, fontWeight: "900", letterSpacing: 0.4 },
  message:      { fontSize: 13, color: "#374151", marginTop: 10, lineHeight: 18 },
  noLoc:        { fontSize: 12, color: "#92400e", backgroundColor: "#fffbeb", borderRadius: 8, padding: 8, marginTop: 10, fontWeight: "600" },

  actions:    { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  actionBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, borderColor: "#d1d5db", backgroundColor: "#fff" },
  actionText: { fontSize: 13, fontWeight: "800", color: "#1a4a52" },
  resolveBtn: { backgroundColor: "#16a34a", borderColor: "#16a34a" },

  errorBox:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca", borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { flex: 1, fontSize: 13, color: "#991b1b", fontWeight: "600" },
  retry:     { fontSize: 13, fontWeight: "900", color: "#dc2626", paddingHorizontal: 6 },

  empty:      { alignItems: "center", paddingVertical: 48, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: "#6b7280" },
  emptySub:   { fontSize: 12, color: "#9ca3af", textAlign: "center", paddingHorizontal: 24 },
});
