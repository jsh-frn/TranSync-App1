import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useBookings } from "../../src/context/BookingsContext";
import { VEHICLE_META, getDisplayStatus, DISPLAY_STATUS_COLOR, type CommuterReservation } from "../../src/types/booking";
import { BookingDetailsModal } from "../../src/components/booking/BookingDetailsModal";

// Pushed from Profile → "My Bookings" (previously a dead stub). Reads the
// same BookingsContext as "My Upcoming Bookings" (book.tsx) and Recent
// Activity (home.tsx) — scope="all", every booking regardless of status,
// newest-created first. Nothing here is deleted unless the commuter deletes
// it themselves — there's no auto-purge of history. Status label/color come
// from the shared getDisplayStatus()/DISPLAY_STATUS_COLOR (types/booking.ts)
// so History always agrees with Upcoming Bookings and Booking Details on
// what a booking's current state is called.

const ACTIVITY_POLL_MS = 18000;

export default function BookingHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { history, historyLoading, refreshHistory } = useBookings();
  const [refreshing, setRefreshing] = useState(false);
  const [viewBooking, setViewBooking] = useState<CommuterReservation | null>(null);

  // Refetch on focus plus a light poll while this screen stays open (same
  // cadence as home.tsx's Recent Activity) — a booking's status here must
  // stay current (e.g. Upcoming → Boarding → Completed, or → Expired past
  // its grace period) without the commuter needing to leave and come back.
  useFocusEffect(useCallback(() => {
    refreshHistory();
    const interval = setInterval(refreshHistory, ACTIVITY_POLL_MS);
    return () => clearInterval(interval);
  }, [refreshHistory]));

  async function onRefresh() {
    setRefreshing(true);
    await refreshHistory();
    setRefreshing(false);
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Booking History</Text>
        <View style={{ width: 32 }} />
      </View>

      {historyLoading && history.length === 0 ? (
        <View style={s.centred}>
          <ActivityIndicator size="large" color="#1a4a52" />
        </View>
      ) : history.length === 0 ? (
        <View style={s.centred}>
          <Ionicons name="time-outline" size={48} color="#d1d5db" />
          <Text style={s.emptyTitle}>No booking history yet.</Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(bk) => String(bk.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a4a52" />}
          renderItem={({ item }) => <HistoryCard booking={item} onPress={() => setViewBooking(item)} />}
        />
      )}

      <BookingDetailsModal booking={viewBooking} onClose={() => setViewBooking(null)} />
    </View>
  );
}

function HistoryCard({ booking, onPress }: { booking: CommuterReservation; onPress: () => void }) {
  const meta = VEHICLE_META[booking.vehicle_category] ?? VEHICLE_META["UV Express"];
  const dep  = new Date(booking.departure_time.replace(" ", "T"));
  const dateStr = dep.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const timeStr = dep.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={[s.colorBar, { backgroundColor: booking.route_color || meta.color }]} />
      <View style={s.body}>
        <View style={s.topRow}>
          <View style={[s.badge, { backgroundColor: meta.bg }]}>
            <Ionicons name={meta.icon as any} size={11} color={meta.color} />
            <Text style={[s.badgeTxt, { color: meta.color }]}>{meta.label}</Text>
          </View>
          <Text style={[s.statusTxt, { color: DISPLAY_STATUS_COLOR[getDisplayStatus(booking)] }]}>{getDisplayStatus(booking)}</Text>
        </View>
        <Text style={s.route} numberOfLines={1}>
          {booking.route_name ?? `${booking.origin_terminal} → ${booking.destination_terminal}`}
        </Text>
        <Text style={s.metaTxt}>
          {dateStr} · {timeStr}
          {booking.seat_labels ? `  ·  Seat ${booking.seat_labels}` : ""}
        </Text>
        <View style={s.footer}>
          <Text style={s.fare}>₱{booking.fare_amount}</Text>
          <Text style={s.ref} numberOfLines={1}>Ref: {booking.qr_code}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#d1d5db" style={{ alignSelf: "center", marginRight: 12 }} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#f9fafb" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 3, height: 32, borderRadius: 16, paddingHorizontal: 10, backgroundColor: "#f1f5f9", justifyContent: "center" },
  backBtnText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: "#1a4a52" },

  centred:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: "#6b7280" },

  card:      { flexDirection: "row", backgroundColor: "#fff", borderRadius: 16, marginBottom: 12, borderWidth: 1.5, borderColor: "#f1f5f9", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2, overflow: "hidden" },
  colorBar:  { width: 5, alignSelf: "stretch" },
  body:      { flex: 1, padding: 14, gap: 4 },
  topRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge:     { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt:  { fontSize: 10, fontWeight: "800" },
  statusTxt: { fontSize: 11, fontWeight: "800" },
  route:     { fontSize: 15, fontWeight: "800", color: "#1a4a52", marginTop: 2 },
  metaTxt:   { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  footer:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  fare:      { fontSize: 14, fontWeight: "900", color: "#1a4a52" },
  ref:       { fontSize: 10, color: "#9ca3af", flexShrink: 1, marginLeft: 8 },
});
