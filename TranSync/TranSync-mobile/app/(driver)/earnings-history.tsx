import { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";

// Pushed from the driver dashboard's Settings tab → Earnings card →
// "View Earnings History". Bus/UV Express only (the card itself is
// isUVorBus-gated) — a per-day breakdown of the same booking-credit ledger
// driver_summary.php's "Today" figure already reads from
// (creditRemittanceSplit(), reference_type='booking'), going back 30 days.
// No pagination — matches this app's established cap-and-stop convention
// (get_commuter_reservations.php's own scope=all).

type DayEarning = { date: string; trip_count: number; total_earnings: number };

function formatDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });
}

export default function EarningsHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [days, setDays] = useState<DayEarning[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [grandTrips, setGrandTrips] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    const raw = await AsyncStorage.getItem("user");
    const current = raw ? JSON.parse(raw) : null;
    if (!current?.id) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true);
    try {
      const res  = await fetch(`${API_BASE}/drivers/earnings_history.php?driver_id=${current.id}`);
      const data = await res.json();
      if (data?.success) {
        setDays(data.days ?? []);
        setGrandTotal(data.grand_total ?? 0);
        setGrandTrips(data.grand_trips ?? 0);
      }
    } catch {
      // Keep whatever was already loaded.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Earnings History</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={[s.root, s.centered]}>
          <ActivityIndicator color="#1a4a52" size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#1a4a52" />}
        >
          <View style={s.summaryCard}>
            <View style={s.summaryStat}>
              <Text style={s.summaryValue}>₱{grandTotal.toFixed(2)}</Text>
              <Text style={s.summaryLabel}>Last 30 Days</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryStat}>
              <Text style={s.summaryValue}>{grandTrips}</Text>
              <Text style={s.summaryLabel}>Trips</Text>
            </View>
          </View>

          {days.length === 0 ? (
            <View style={s.emptyBox}>
              <Ionicons name="cash-outline" size={28} color="#d1d5db" />
              <Text style={s.emptyText}>No earnings yet. Completed trips will show up here.</Text>
            </View>
          ) : (
            <View style={s.listCard}>
              {days.map((d, i) => (
                <View key={d.date} style={[s.dayRow, i === days.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={s.dayIconWrap}>
                    <Ionicons name="calendar-outline" size={16} color="#1a4a52" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.dayLabel}>{formatDay(d.date)}</Text>
                    <Text style={s.dayTrips}>{d.trip_count} trip{d.trip_count === 1 ? "" : "s"}</Text>
                  </View>
                  <Text style={s.dayEarnings}>₱{d.total_earnings.toFixed(2)}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={s.footnote}>Showing earnings from the last 30 days.</Text>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#f9fafb" },
  centered: { alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 32, borderRadius: 16, paddingHorizontal: 10, backgroundColor: "#f1f5f9", justifyContent: "center" },
  backBtnText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: "#1a4a52" },

  summaryCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#1a4a52", borderRadius: 16, padding: 20, marginBottom: 16,
  },
  summaryStat: { flex: 1, alignItems: "center", gap: 4 },
  summaryValue: { fontSize: 22, fontWeight: "900", color: "#fff" },
  summaryLabel: { fontSize: 12, color: "#cbd5c8", fontWeight: "600" },
  summaryDivider: { width: 1, height: 36, backgroundColor: "rgba(255,255,255,0.2)" },

  emptyBox: { alignItems: "center", gap: 8, paddingVertical: 40 },
  emptyText: { fontSize: 13, color: "#9ca3af", textAlign: "center", paddingHorizontal: 24 },

  listCard: {
    backgroundColor: "#fff", borderRadius: 16,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  dayRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: "#f1f5f9",
  },
  dayIconWrap: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: "#f0fdf4",
    alignItems: "center", justifyContent: "center",
  },
  dayLabel: { fontSize: 14, fontWeight: "700", color: "#1f2937" },
  dayTrips: { fontSize: 12, color: "#9ca3af", marginTop: 1 },
  dayEarnings: { fontSize: 15, fontWeight: "800", color: "#16a34a" },

  footnote: { fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 12 },
});
