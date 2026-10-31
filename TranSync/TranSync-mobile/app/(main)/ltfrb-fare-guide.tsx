import { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import API_BASE, { FILE_BASE } from "../../src/config/api";
import { VEHICLE_META } from "../../src/types/booking";

// Read-only official LTFRB fare reference documents — pushed from
// Profile → "LTFRB Fare Guide" (previously nothing here). Fetches every
// guide from reference/ltfrb_fare_guides.php (no owner, no upload/edit/
// delete endpoint anywhere in this app — these are seeded once directly
// into the database) and groups them by vehicle type. Opened in the
// device's own in-app browser (expo-web-browser, already installed for
// this app) rather than a custom-embedded PDF viewer — gets real pinch-
// zoom/scroll/page navigation from the OS's own PDF renderer with zero new
// native dependencies.

type VehicleType = "Jeepney" | "UV Express" | "Bus";
const VEHICLE_ORDER: VehicleType[] = ["Jeepney", "UV Express", "Bus"];

interface FareGuide {
  id: number;
  vehicle_type: VehicleType;
  label: string;
  url: string;
  sort_order: number;
}

export default function LtfrbFareGuideScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [guides, setGuides]         = useState<FareGuide[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [openingId, setOpeningId]   = useState<number | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${API_BASE}/reference/ltfrb_fare_guides.php`);
      const data = await res.json();
      if (data.success) setGuides(data.guides ?? []);
      else setError(data.message ?? "Couldn't load the fare guide list.");
    } catch {
      setError("Cannot connect to server.");
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openGuide(guide: FareGuide) {
    setOpeningId(guide.id);
    try {
      await WebBrowser.openBrowserAsync(FILE_BASE + guide.url);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>LTFRB Fare Guide</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.centred}>
          <ActivityIndicator size="large" color="#1a4a52" />
        </View>
      ) : error ? (
        <View style={s.centred}>
          <Ionicons name="cloud-offline-outline" size={44} color="#d1d5db" />
          <Text style={s.errorTitle}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => load()} activeOpacity={0.85}>
            <Text style={s.retryBtnTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#1a4a52" />}
        >
          <Text style={s.intro}>
            Official fare guides published by the Land Transportation Franchising and
            Regulatory Board (LTFRB). These are reference documents only — read-only,
            and not editable within the app.
          </Text>

          {VEHICLE_ORDER.map((vt) => {
            const meta = VEHICLE_META[vt];
            const rows = guides.filter((g) => g.vehicle_type === vt);
            return (
              <View key={vt} style={s.section}>
                <View style={s.sectionHeader}>
                  <View style={[s.sectionIcon, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon as any} size={14} color={meta.color} />
                  </View>
                  <Text style={s.sectionTitle}>{vt}</Text>
                </View>

                {rows.length === 0 ? (
                  <View style={s.emptyCard}>
                    <Text style={s.emptyTxt}>No LTFRB Fare Guide available for this vehicle type.</Text>
                  </View>
                ) : (
                  rows.map((g) => (
                    <TouchableOpacity
                      key={g.id}
                      style={s.docCard}
                      onPress={() => openGuide(g)}
                      activeOpacity={0.8}
                      disabled={openingId === g.id}
                    >
                      <Ionicons name="document-text-outline" size={18} color="#1a4a52" />
                      <Text style={s.docLabel} numberOfLines={1}>{g.label}</Text>
                      {openingId === g.id ? (
                        <ActivityIndicator size="small" color="#1a4a52" />
                      ) : (
                        <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
                      )}
                    </TouchableOpacity>
                  ))
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#f9fafb" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 3, height: 32, borderRadius: 16, paddingHorizontal: 10, backgroundColor: "#f1f5f9", justifyContent: "center" },
  backBtnText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: "#1a4a52" },

  centred: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  errorTitle: { fontSize: 14, fontWeight: "700", color: "#6b7280", textAlign: "center" },
  retryBtn: { marginTop: 4, backgroundColor: "#1a4a52", borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnTxt: { fontSize: 13, fontWeight: "800", color: "#fff" },

  intro: { fontSize: 12.5, color: "#6b7280", lineHeight: 18, marginBottom: 20 },

  section: { marginBottom: 22 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  sectionIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: "#1a4a52" },

  emptyCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#f1f5f9", padding: 14 },
  emptyTxt: { fontSize: 12.5, color: "#9ca3af" },

  docCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#f1f5f9", paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  docLabel: { flex: 1, fontSize: 13.5, fontWeight: "700", color: "#374151" },
});
