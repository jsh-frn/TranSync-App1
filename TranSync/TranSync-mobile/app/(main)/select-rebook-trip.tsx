import { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  fetchBusTrips, fetchAvailableSlots, fetchAvailableSeats, completeRebook,
  type SeatInfo,
} from "../../src/services/bookingService";
import type { BusTrip, UvSlot } from "../../src/types/booking";
import { useBookings } from "../../src/context/BookingsContext";

// Commuter's half of the 2-step rebooking flow, reached only once an
// operator has approved a rebook request (operator_review_rebook.php) —
// see BookingDetailsModal's "Select New Trip" button. Scoped to the
// ORIGINAL operator's own fleet only (any route, matching vehicle
// category) — never a cross-operator marketplace, per complete_rebook.php's
// own server-side enforcement, which this screen's fetches mirror via the
// operator_id filter. No passenger-info step — that's already on file from
// the original booking; complete_rebook.php carries it forward.

type Stage = "trip" | "seat" | "confirm" | "done";

function fmtDeparture(iso: string): string {
  try {
    return new Date(iso.replace(" ", "T")).toLocaleString("en-PH", {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch {
    return iso;
  }
}

export default function SelectRebookTripScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const router = useRouter();
  const { refreshAll } = useBookings();
  const { reservationId, operatorId, vehicleCategory, originalFare, routeName } = useLocalSearchParams<{
    reservationId: string; operatorId: string; vehicleCategory: string; originalFare: string; routeName: string;
  }>();

  const resId       = Number(reservationId);
  const opId         = operatorId ? Number(operatorId) : null;
  const isBus        = vehicleCategory === "Bus";
  const origFare      = Number(originalFare) || 0;
  const fee            = Math.round(origFare * 0.10 * 4) / 4; // nearest ₱0.25 — matches REBOOKING_SURCHARGE_PCT (server is authoritative)

  const [commuterId, setCommuterId] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>("trip");
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<BusTrip[]>([]);
  const [slots, setSlots] = useState<UvSlot[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<BusTrip | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<UvSlot | null>(null);
  const [seatOptions, setSeatOptions] = useState<SeatInfo[]>([]);
  // Seat cell size: 44dp normally, shrunk so the widest row (crew cells are
  // ~2.1x wide) never overflows narrow screens. Gap between cells is 10dp.
  const seatSize = (() => {
    const rows: Record<number, { units: number; n: number }> = {};
    seatOptions.forEach(st => {
      const r = (rows[st.seat_row] ??= { units: 0, n: 0 });
      r.units += (st.state === "driver" || st.state === "conductor") ? 92 / 44 : 1;
      r.n += 1;
    });
    const avail = windowWidth - 72; // screen + card horizontal padding
    let size = 44;
    Object.values(rows).forEach(r => {
      size = Math.min(size, Math.floor((avail - 10 * (r.n - 1)) / r.units));
    });
    return Math.max(28, size);
  })();
  const [seatsLoading, setSeatsLoading] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultQr, setResultQr] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem("user").then((raw) => {
      const u = raw ? JSON.parse(raw) : null;
      if (u?.id) setCommuterId(u.id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!opId) { setLoading(false); return; }
    setLoading(true);
    if (isBus) {
      setTrips(await fetchBusTrips(undefined, undefined, opId));
    } else {
      setSlots(await fetchAvailableSlots(undefined, opId));
    }
    setLoading(false);
  }, [opId, isBus]);

  useEffect(() => { load(); }, [load]);

  async function selectTrip(trip: BusTrip) {
    setSelectedTrip(trip);
    setSelectedSeat(null);
    setSeatsLoading(true);
    setSeatOptions(await fetchAvailableSeats(trip.id));
    setSeatsLoading(false);
    setStage("seat");
  }

  function selectSlot(slot: UvSlot) {
    setSelectedSlot(slot);
    setStage("confirm");
  }

  async function handleConfirm() {
    if (!commuterId || busy) return;
    if (isBus && !selectedSeat) return;
    setBusy(true);
    setError(null);
    try {
      const result = await completeRebook(commuterId, resId, {
        newTripId: isBus ? selectedTrip?.id : undefined,
        newUvSlotId: !isBus ? selectedSlot?.id : undefined,
        newSeatLabel: isBus ? selectedSeat ?? undefined : undefined,
      });
      if (!result.success) {
        setError(result.message ?? "Failed to complete rebooking.");
        return;
      }
      setResultQr(result.qr_code ?? null);
      setStage("done");
      refreshAll();
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setBusy(false);
    }
  }

  if (!opId) {
    return (
      <View style={[s.root, s.centered, { paddingTop: insets.top }]}>
        <Ionicons name="alert-circle-outline" size={40} color="#d1d5db" />
        <Text style={s.emptyText}>This booking has no single operator to rebook within — please contact support.</Text>
        <TouchableOpacity style={s.backLink} onPress={() => router.back()}>
          <Text style={s.backLinkTxt}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => (stage === "trip" || stage === "done" ? router.back() : setStage("trip"))} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={s.backBtnText}>{stage === "trip" || stage === "done" ? "Back" : "Change Trip"}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Select New Trip</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={s.feeCard}>
          <Ionicons name="information-circle-outline" size={16} color="#1a4a52" />
          <Text style={s.feeCardTxt}>
            Your original fare (₱{origFare.toLocaleString()}) has already been settled — you'll only pay a{" "}
            <Text style={{ fontWeight: "900" }}>₱{fee.toLocaleString()}</Text> rebooking fee to confirm your new trip.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color="#1a4a52" style={{ marginTop: 40 }} />
        ) : stage === "trip" ? (
          isBus ? (
            trips.length === 0 ? (
              <Text style={s.emptyText}>No other scheduled trips are available from this operator right now.</Text>
            ) : trips.map((t) => (
              <TouchableOpacity key={t.id} style={s.tripCard} onPress={() => selectTrip(t)} activeOpacity={0.85}>
                <View style={s.tripCardTop}>
                  <Text style={s.tripRoute}>{t.route_name ?? `${t.from_location} → ${t.to_location}`}</Text>
                  <Text style={s.tripSeats}>{t.seats_left ?? "—"} seats left</Text>
                </View>
                <Text style={s.tripDep}>{fmtDeparture(t.departure_time)}</Text>
              </TouchableOpacity>
            ))
          ) : (
            slots.length === 0 ? (
              <Text style={s.emptyText}>No other scheduled departures are available from this operator right now.</Text>
            ) : slots.map((sl) => (
              <TouchableOpacity key={sl.id} style={s.tripCard} onPress={() => selectSlot(sl)} activeOpacity={0.85}>
                <View style={s.tripCardTop}>
                  <Text style={s.tripRoute}>{sl.route_name ?? `${sl.from_location} → ${sl.to_location}`}</Text>
                  <Text style={s.tripSeats}>{sl.seats_left ?? "Open"} {sl.seats_left != null ? "seats left" : ""}</Text>
                </View>
                <Text style={s.tripDep}>{fmtDeparture(sl.departure_time)}</Text>
              </TouchableOpacity>
            ))
          )
        ) : stage === "seat" ? (
          <>
            <Text style={s.cardLabel}>Select a Seat</Text>
            {seatsLoading ? (
              <ActivityIndicator color="#1a4a52" style={{ marginVertical: 20 }} />
            ) : seatOptions.length === 0 ? (
              <Text style={s.emptyText}>No seat map is available for this vehicle yet.</Text>
            ) : (
              <>
                <View style={sp.legendRow}>
                  <View style={sp.legendItem}><View style={[sp.seatSwatch, sp.seatAvailable]} /><Text style={sp.legendTxt}>Available</Text></View>
                  <View style={sp.legendItem}><View style={[sp.seatSwatch, sp.seatBooked]} /><Text style={sp.legendTxt}>Booked</Text></View>
                  <View style={sp.legendItem}><View style={[sp.seatSwatch, sp.seatSelected]} /><Text style={sp.legendTxt}>Selected</Text></View>
                  <View style={sp.legendItem}><View style={[sp.seatSwatch, sp.seatBlocked]} /><Text style={sp.legendTxt}>Reserved/Saved</Text></View>
                  <View style={sp.legendItem}><View style={[sp.seatSwatch, sp.seatCrew]} /><Text style={sp.legendTxt}>Driver/Conductor</Text></View>
                </View>
                {Object.entries(
                  seatOptions.reduce((rows: Record<number, SeatInfo[]>, seat) => {
                    (rows[seat.seat_row] ??= []).push(seat); return rows;
                  }, {})
                )
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([row, rowSeats]) => (
                    <View key={row} style={sp.gridRow}>
                      {rowSeats.sort((a, b) => a.seat_col - b.seat_col).map((seat) => {
                        if (seat.state === "blank") {
                          return <View key={seat.seat_label} style={[sp.seatAislePath, { width: seatSize, height: seatSize }]} />;
                        }
                        const isCrew = seat.state === "driver" || seat.state === "conductor";
                        const isSelected = selectedSeat === seat.seat_label;
                        const seatStyle =
                          isCrew ? sp.seatCrew :
                          seat.state === "booked" ? sp.seatBooked :
                          seat.state === "blocked" ? sp.seatBlocked :
                          isSelected ? sp.seatSelected : sp.seatAvailable;
                        const canSelect = seat.state === "available";
                        return (
                          <TouchableOpacity
                            key={seat.seat_label}
                            style={[sp.seat, isCrew && sp.seatCrewWide, seatStyle, { width: isCrew ? Math.round(seatSize * 92 / 44) : seatSize, height: seatSize }]}
                            disabled={!canSelect}
                            onPress={() => canSelect && setSelectedSeat(isSelected ? null : seat.seat_label)}
                            activeOpacity={0.75}
                            accessibilityLabel={isCrew ? `${seat.state === "driver" ? "Driver" : "Conductor"} seat` : `Seat ${seat.seat_label}`}
                          >
                            <Text
                              style={[
                                isCrew ? sp.crewTxt : sp.seatTxt,
                                (isSelected || (!canSelect && !isCrew)) && { color: "#fff" },
                              ]}
                              numberOfLines={1}
                            >
                              {isCrew ? (seat.state === "driver" ? "Driver" : "Conductor") : seat.seat_label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
              </>
            )}
            <TouchableOpacity
              style={[s.primaryBtn, !selectedSeat && { opacity: 0.5 }]}
              disabled={!selectedSeat}
              onPress={() => setStage("confirm")}
              activeOpacity={0.85}
            >
              <Text style={s.primaryBtnTxt}>Continue</Text>
            </TouchableOpacity>
          </>
        ) : stage === "confirm" ? (
          <>
            <View style={s.summaryCard}>
              <Text style={s.cardLabel}>New Trip</Text>
              <Text style={s.summaryRoute}>
                {(isBus ? selectedTrip?.route_name : selectedSlot?.route_name) ?? routeName}
              </Text>
              <Text style={s.summaryDep}>
                {fmtDeparture((isBus ? selectedTrip?.departure_time : selectedSlot?.departure_time) ?? "")}
              </Text>
              {isBus && selectedSeat && (
                <View style={s.summarySeatRow}>
                  <Text style={s.summarySeatLabel}>Seat</Text>
                  <View style={s.summarySeatChip}><Text style={s.summarySeatChipTxt}>{selectedSeat}</Text></View>
                </View>
              )}
            </View>

            <View style={s.summaryCard}>
              <Text style={s.cardLabel}>Fare Breakdown</Text>
              <View style={s.feeRow}><Text style={s.feeRowLabel}>Original Fare (already settled)</Text><Text style={s.feeRowValue}>₱{origFare.toLocaleString()}</Text></View>
              <View style={s.feeRow}><Text style={s.feeRowLabel}>Rebooking Fee (10%)</Text><Text style={s.feeRowValue}>₱{fee.toLocaleString()}</Text></View>
              <View style={[s.feeRow, { marginTop: 6 }]}>
                <Text style={s.totalLabel}>Total to Pay Now</Text>
                <Text style={s.totalValue}>₱{fee.toLocaleString()}</Text>
              </View>
            </View>

            {error && (
              <View style={s.errorBox}>
                <Ionicons name="warning-outline" size={15} color="#ef4444" />
                <Text style={s.errorTxt}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.primaryBtn, busy && { opacity: 0.6 }]}
              onPress={handleConfirm}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnTxt}>Confirm &amp; Pay ₱{fee.toLocaleString()}</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <View style={s.doneBox}>
            <Ionicons name="checkmark-circle" size={48} color="#16a34a" />
            <Text style={s.doneTitle}>Rebooking Complete</Text>
            <Text style={s.doneSub}>Your new ticket is ready — you'll find it in My Upcoming Bookings.</Text>
            {resultQr && <Text style={s.doneQr}>{resultQr}</Text>}
            <TouchableOpacity style={s.primaryBtn} onPress={() => router.back()} activeOpacity={0.85}>
              <Text style={s.primaryBtnTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#f9fafb" },
  centered: { alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 3, height: 32, borderRadius: 16, paddingHorizontal: 10, backgroundColor: "#f1f5f9", justifyContent: "center" },
  backBtnText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: "#1a4a52" },
  backLink: { marginTop: 8 },
  backLinkTxt: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },

  feeCard: { flexDirection: "row", gap: 8, backgroundColor: "#eff6ff", borderRadius: 12, padding: 12, marginBottom: 16 },
  feeCardTxt: { flex: 1, fontSize: 12, color: "#1e40af", lineHeight: 17 },

  emptyText: { fontSize: 13, color: "#9ca3af", textAlign: "center", paddingVertical: 24 },

  tripCard: { backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  tripCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  tripRoute: { fontSize: 14, fontWeight: "800", color: "#1a4a52", flex: 1 },
  tripSeats: { fontSize: 11, color: "#6b7280", fontWeight: "600" },
  tripDep: { fontSize: 12, color: "#6b7280" },

  cardLabel: { fontSize: 13, fontWeight: "800", color: "#374151", marginBottom: 10 },

  primaryBtn: { alignItems: "center", justifyContent: "center", backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 15, marginTop: 16 },
  primaryBtnTxt: { fontSize: 14, fontWeight: "800", color: "#fff" },

  summaryCard: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 12 },
  summaryRoute: { fontSize: 16, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  summaryDep: { fontSize: 13, color: "#6b7280" },
  summarySeatRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  summarySeatLabel: { fontSize: 12, color: "#6b7280" },
  summarySeatChip: { backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  summarySeatChipTxt: { fontSize: 12, fontWeight: "800", color: "#fff" },

  feeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  feeRowLabel: { fontSize: 13, color: "#6b7280" },
  feeRowValue: { fontSize: 13, fontWeight: "700", color: "#374151" },
  totalLabel: { fontSize: 15, fontWeight: "800", color: "#1a4a52" },
  totalValue: { fontSize: 20, fontWeight: "900", color: "#1a4a52" },

  errorBox: { flexDirection: "row", gap: 8, backgroundColor: "#fef2f2", borderRadius: 12, padding: 12, marginBottom: 4 },
  errorTxt: { fontSize: 13, color: "#ef4444", flex: 1 },

  doneBox: { alignItems: "center", gap: 8, paddingVertical: 40 },
  doneTitle: { fontSize: 18, fontWeight: "900", color: "#1a4a52", marginTop: 8 },
  doneSub: { fontSize: 13, color: "#6b7280", textAlign: "center", paddingHorizontal: 20 },
  doneQr: { fontSize: 12, fontWeight: "800", color: "#9ca3af", letterSpacing: 1, marginTop: 8 },
});

const sp = StyleSheet.create({
  legendRow:  { flexDirection: "row", flexWrap: "wrap", gap: 14, marginBottom: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendTxt:  { fontSize: 11, color: "#6b7280", fontWeight: "600" },
  seatSwatch: { width: 14, height: 14, borderRadius: 4 },
  gridRow:    { flexDirection: "row", gap: 10, marginBottom: 10 },
  seat:       { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#e5e7eb" },
  seatAvailable: { backgroundColor: "#dcfce7", borderColor: "#16a34a" },
  seatSelected:  { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  seatBooked:    { backgroundColor: "#fecaca", borderColor: "#dc2626" },
  seatBlocked:   { backgroundColor: "#fef9c3", borderColor: "#eab308" },
  seatCrew:      { backgroundColor: "#e5e7eb", borderColor: "#6b7280" },
  seatTxt:    { fontSize: 12, fontWeight: "800", color: "#1a4a52" },
  seatAislePath: { width: 44, height: 44 },
  seatCrewWide: { width: 92 },
  crewTxt:      { fontSize: 11, fontWeight: "500", color: "#4b5563", textAlign: "center" },
});
