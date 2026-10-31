import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import QRCode from "react-native-qrcode-svg";
import { useRouter } from "expo-router";
import type { CommuterReservation } from "../../types/booking";
import { VEHICLE_META, getDisplayStatus, DISPLAY_STATUS_COLOR, previewRefundPct } from "../../types/booking";
import {
  requestRefund, cancelLateNoRefund, requestRebook,
  getReservationStatus, type ReservationStatus,
} from "../../services/bookingService";
import { useBookings } from "../../context/BookingsContext";

// How long after a booking becomes no_show the commuter still has a chance
// to request a rebook — client-side mirror of
// NO_SHOW_REBOOK_REQUEST_GRACE_HOURS (config/policy.php). Server stays
// authoritative; this only drives which button/message shows here.
const NO_SHOW_REBOOK_REQUEST_GRACE_HOURS = 24;

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

interface Props {
  booking: CommuterReservation | null;
  onClose: () => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  student: "Student", elderly: "Senior Citizen", disabled: "PWD",
};

function fmtDeparture(iso: string): string {
  try {
    return new Date(iso.replace(" ", "T")).toLocaleString("en-PH", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch {
    return iso;
  }
}
function fmtTimeOnly(d: Date): string {
  return d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });
}
function fmtGrace(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const LIVE_STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled", boarding: "Boarding Now", departed: "Departed", completed: "Completed", cancelled: "Cancelled",
};
const LIVE_STATUS_ICON: Record<string, IoniconsName> = {
  scheduled: "time-outline", boarding: "walk-outline", departed: "car-outline", completed: "checkmark-done", cancelled: "close-circle",
};
const LIVE_STATUS_STYLE: Record<string, { backgroundColor: string }> = {
  boarding: { backgroundColor: "#2563eb" },
  departed: { backgroundColor: "#d97706" },
  completed: { backgroundColor: "#16a34a" },
  cancelled: { backgroundColor: "#dc2626" },
};

// Every important fact a commuter needs before boarding — the same QR the
// driver scans, plus everything from the ticket (BookingConfirm.tsx) and
// the original lighter view-booking sheet, merged into one place reachable
// from both "My Upcoming Bookings" and Booking History.
export function BookingDetailsModal({ booking, onClose }: Props) {
  const { applyLocalStatusChange, refreshAll } = useBookings();
  const router = useRouter();
  const [commuterId, setCommuterId] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<ReservationStatus | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rebookBusy, setRebookBusy] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("user").then((raw) => {
      const u = raw ? JSON.parse(raw) : null;
      if (u?.id) setCommuterId(u.id);
    });
  }, []);

  useEffect(() => {
    setShowCancelConfirm(false);
    setActionError(null);
    setRebookBusy(false);
  }, [booking?.id]);

  // Live status polling — only Bus/UV-slot bookings have a trip/slot
  // lifecycle + QR grace period to poll; a live UV session (walk-up, now
  // dormant/unreachable, Core Flow 8b point 8) has no fixed schedule to track.
  useEffect(() => {
    if (!booking || (booking.trip_id == null && booking.uv_slot_id == null)) {
      setLiveStatus(null);
      return;
    }
    let cancelled = false;
    const poll = () => getReservationStatus(booking.id).then((s) => { if (!cancelled) setLiveStatus(s); });
    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [booking?.id]);

  if (!booking) return null;
  const bk = booking;

  const meta = VEHICLE_META[bk.vehicle_category] ?? VEHICLE_META["UV Express"];
  const dep  = new Date(bk.departure_time.replace(" ", "T"));
  const discounted = !!bk.discount_type && bk.discount_type !== "default";

  const baseFare = bk.base_fare_amount ?? bk.fare_amount;
  const discountAmount = discounted ? +(baseFare - bk.fare_amount).toFixed(2) : 0;

  const durationMin = bk.estimated_duration_minutes ?? null;
  const arrivalLabel = durationMin ? fmtTimeOnly(new Date(dep.getTime() + durationMin * 60000)) : "—";

  const seatLabels = bk.seat_labels ? bk.seat_labels.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const qrOpensAt = bk.uv_slot_id != null ? dep.getTime() - 30 * 60 * 1000 : null;
  const qrPending = qrOpensAt !== null && Date.now() < qrOpensAt;

  // ── Cancel eligibility — a future departure is the only real gate left to
  // check here (24h+ advance booking already guaranteed a future departure
  // at booking time). ────────────────────────────────────────────────────
  const cancellable = bk.boarding_status === "reserved" && (bk.trip_id != null || bk.uv_slot_id != null)
    && (dep.getTime() - Date.now()) / 3600000 > 0;

  // ── Tiered refund preview (Core Flow 9.2, rewritten 2026-08-11) — a
  // client-side-only preview of what request_refund.php will actually
  // compute server-side, so the confirm dialog and button label can show
  // the expected outcome (100% / 50% / 0%) before the commuter confirms.
  // Never trusted for the actual charge — the server recomputes this from
  // its own DB clock at cancellation time.
  const previewPct = previewRefundPct(bk.vehicle_category, bk.created_at, bk.departure_time);
  const previewPctLabel = Math.round(previewPct * 100);

  // ── Rebook eligibility — a commuter can request proactively while still
  // 'reserved' (before departure, no cutoff) or reactively within
  // NO_SHOW_REBOOK_REQUEST_GRACE_HOURS of becoming 'no_show'. Client-side
  // mirror of config/rebook_eligibility.php's isRebookEligible() — server
  // stays authoritative, this only drives which button/message shows here.
  // A booking that's already been rebooked away (cancellation_type ===
  // 'rebooked') is never eligible again regardless of boarding_status.
  const alreadyRebooked = bk.cancellation_type === "rebooked";
  const rebookEligible = !alreadyRebooked && (
    (bk.boarding_status === "reserved" && dep.getTime() > Date.now()) ||
    (bk.boarding_status === "no_show" && !!bk.resolved_at &&
      Date.now() <= new Date(bk.resolved_at.replace(" ", "T")).getTime() + NO_SHOW_REBOOK_REQUEST_GRACE_HOURS * 3600000)
  );
  // This never rebooks anything itself — only flags the request for the
  // operator to approve/reject from their own manifest
  // (operator_review_rebook.php); the commuter only picks a new trip
  // themselves once approved (complete_rebook.php via select-rebook-trip.tsx).
  const rrStatus = bk.rebook_request_status;
  const canRequestRebook = rebookEligible && (rrStatus == null || rrStatus === "rejected" || rrStatus === "expired");

  async function handleConfirmCancel() {
    if (!commuterId) return;
    setActionBusy(true);
    setActionError(null);
    try {
      // Single endpoint now — the server computes the actual tiered outcome
      // (100% or 50%, never 0%) from its own DB clock; previewPct above is
      // only a pre-confirm estimate, never trusted for what actually happened.
      const result = await requestRefund(bk.id, commuterId);
      if (!result.success) {
        setActionError(result.message ?? "Failed to cancel this booking.");
        return;
      }
      const refundedSomething = (result.refund_pct ?? 0) > 0;
      applyLocalStatusChange(bk.id, {
        boarding_status: "cancelled",
        status: "cancelled",
        cancellation_type: refundedSomething ? "refunded" : "late_cancelled",
        payment_status: refundedSomething ? "refunded" : "forfeited",
        refund_amount: result.refunded ?? null,
        refund_pct: result.refund_pct ?? null,
        resolved_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      });
      setShowCancelConfirm(false);
      onClose();
      refreshAll();
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRequestRebook() {
    if (!commuterId || !canRequestRebook || rebookBusy) return;
    setRebookBusy(true);
    setActionError(null);
    try {
      const result = await requestRebook(commuterId, bk.id);
      if (!result.success) {
        setActionError(result.message ?? "Failed to send rebook request.");
        return;
      }
      // Refetch so bk.rebook_request_status reflects the real 'pending' row
      // — the server is the source of truth, no local status guessing.
      refreshAll();
    } catch {
      setActionError("Cannot connect to server.");
    } finally {
      setRebookBusy(false);
    }
  }

  function handleSelectNewTrip() {
    onClose();
    router.push({
      pathname: "/(main)/select-rebook-trip",
      params: {
        reservationId: String(bk.id),
        operatorId: bk.rebooking_operator_id != null ? String(bk.rebooking_operator_id) : "",
        vehicleCategory: bk.vehicle_category,
        originalFare: String(bk.fare_amount),
        routeName: bk.route_name ?? "",
      },
    });
  }

  return (
    <Modal visible={!!booking} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
            {/* ── Header ── */}
            <View style={s.header}>
              <View style={[s.badge, { backgroundColor: meta.bg }]}>
                <Ionicons name={meta.icon as IoniconsName} size={14} color={meta.color} />
                <Text style={[s.badgeTxt, { color: meta.color }]}>{meta.label}</Text>
              </View>
              <Text style={[s.statusTxt, { color: DISPLAY_STATUS_COLOR[getDisplayStatus(bk)] }]}>{getDisplayStatus(bk)}</Text>
              <TouchableOpacity onPress={onClose} style={[s.headerCloseBtn, { marginLeft: "auto" }]} activeOpacity={0.7}>
                <Ionicons name="close" size={18} color="#6b7280" />
                <Text style={s.headerCloseText}>Close</Text>
              </TouchableOpacity>
            </View>

            <Text style={s.route}>{bk.route_name ?? `${bk.origin_terminal} → ${bk.destination_terminal}`}</Text>

            {liveStatus?.vehicle_status && (
              <View style={[s.liveStatusPill, LIVE_STATUS_STYLE[liveStatus.vehicle_status] ?? {}]}>
                <Ionicons name={LIVE_STATUS_ICON[liveStatus.vehicle_status] ?? "ellipse"} size={13} color="#fff" />
                <Text style={s.liveStatusPillText}>{LIVE_STATUS_LABEL[liveStatus.vehicle_status] ?? liveStatus.vehicle_status}</Text>
              </View>
            )}
            {liveStatus?.grace_seconds_remaining != null && (
              <View style={s.graceBanner}>
                <Ionicons name="hourglass-outline" size={16} color="#d97706" />
                <Text style={s.graceBannerText}>
                  Your ride has departed — {fmtGrace(liveStatus.grace_seconds_remaining)} left to board before your ticket expires.
                </Text>
              </View>
            )}

            {/* ── QR ── */}
            <View style={s.qrBox}>
              {bk.boarding_status !== "reserved" ? (
                <>
                  <View style={s.qrPendingIcon}>
                    <Ionicons
                      name={bk.boarding_status === "boarded" || bk.boarding_status === "completed" ? "checkmark-circle-outline" : "close-circle-outline"}
                      size={36}
                      color="#9ca3af"
                    />
                  </View>
                  <Text style={s.qrPendingTitle}>
                    {bk.boarding_status === "boarded" || bk.boarding_status === "completed" ? "Ticket already used" : "QR no longer valid"}
                  </Text>
                </>
              ) : qrPending ? (
                <>
                  <View style={s.qrPendingIcon}><Ionicons name="time-outline" size={36} color="#9ca3af" /></View>
                  <Text style={s.qrPendingTitle}>QR not active yet</Text>
                  <Text style={s.qrNote}>
                    Opens at {qrOpensAt ? fmtTimeOnly(new Date(qrOpensAt)) : "—"} — 30 minutes before departure.
                  </Text>
                </>
              ) : (
                <>
                  <QRCode value={bk.qr_code} size={150} backgroundColor="#ffffff" color="#1a4a52" />
                  <Text style={s.qrRef}>{bk.qr_code}</Text>
                  <Text style={s.qrNote}>Show this QR code to the driver when boarding</Text>
                </>
              )}
            </View>

            <Divider />

            {/* ── Trip Details ── */}
            <SectionLabel>Trip Details</SectionLabel>
            <DRow icon="receipt-outline" label="Booking ID" value={`#${bk.id}`} />
            <DRow icon="bus-outline" label="Vehicle Type" value={bk.vehicle_category} />
            <DRow
              icon="car-outline"
              label="Vehicle Number"
              value={bk.vehicle_plate ?? (bk.vehicle_category === "UV Express" ? "Assigned at boarding" : "—")}
            />
            {bk.vehicle_category === "Bus" && (
              seatLabels.length > 0 ? (
                <View style={dr.row}>
                  <View style={dr.labelWrap}>
                    <Ionicons name="grid-outline" size={14} color="#9ca3af" />
                    <Text style={dr.label}>Seat{seatLabels.length > 1 ? "s" : ""}</Text>
                  </View>
                  <View style={s.seatChipRow}>
                    {seatLabels.map((sl) => (
                      <View key={sl} style={s.seatChip}><Text style={s.seatChipTxt}>{sl}</Text></View>
                    ))}
                  </View>
                </View>
              ) : <DRow icon="grid-outline" label="Seat" value="—" />
            )}
            <DRow icon="location-outline" label="Terminal" value={bk.origin_terminal} />
            <DRow icon="calendar-outline" label="Departure" value={fmtDeparture(bk.departure_time)} />
            <DRow icon="flag-outline" label="Est. Arrival" value={arrivalLabel} />

            <Divider />

            {/* ── Passenger Information ── */}
            <SectionLabel>Passenger Information</SectionLabel>
            <DRow icon="person-outline" label="Name" value={bk.passenger_name || "—"} />
            {!!bk.passenger_phone && <DRow icon="call-outline" label="Phone" value={bk.passenger_phone} />}
            {bk.passenger_age != null && <DRow icon="calendar-number-outline" label="Age" value={String(bk.passenger_age)} />}

            <Divider />

            {/* ── Fare Breakdown ── */}
            <SectionLabel>Fare Breakdown</SectionLabel>
            <DRow label="Base Fare" value={`₱${baseFare.toLocaleString()}`} />
            <DRow
              label={discounted ? `Verified Discount (${CATEGORY_LABEL[bk.discount_type ?? ""] ?? bk.discount_type})` : "Discount"}
              value={discountAmount > 0 ? `−₱${discountAmount.toLocaleString()}` : "₱0"}
              valueColor={discountAmount > 0 ? "#16a34a" : undefined}
            />
            <View style={dr.row}>
              <Text style={s.totalLabel}>Total Paid</Text>
              <Text style={s.totalValue}>₱{bk.fare_amount.toLocaleString()}</Text>
            </View>

            <Divider />

            {/* ── Payment Details ── */}
            <SectionLabel>Payment Details</SectionLabel>
            <DRow icon="wallet-outline" label="Method" value="Wallet Balance" />
            <DRow icon="shield-checkmark-outline" label="Payment Status" value={PAYMENT_STATUS_LABEL[bk.payment_status ?? ""] ?? bk.payment_status ?? "—"} />
            {bk.refund_amount != null && (
              <DRow
                icon="return-down-back-outline"
                label="Refund"
                value={`₱${bk.refund_amount.toFixed(2)} (${Math.round(bk.refund_pct ?? 0)}%)`}
              />
            )}

            {actionError && (
              <View style={s.errorBox}>
                <Ionicons name="warning-outline" size={15} color="#ef4444" />
                <Text style={s.errorTxt}>{actionError}</Text>
              </View>
            )}

            {/* ── Actions ── */}
            {cancellable && (
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowCancelConfirm(true)} activeOpacity={0.85}>
                <Ionicons name="close-circle-outline" size={15} color="#dc2626" />
                <Text style={s.cancelBtnTxt}>
                  {previewPct >= 1 ? "Cancel & Refund (100%)" : `Cancel & Refund (${previewPctLabel}%)`}
                </Text>
              </TouchableOpacity>
            )}
            {alreadyRebooked ? (
              <View style={s.rebookedBadge}>
                <Ionicons name="swap-horizontal" size={15} color="#7c3aed" />
                <Text style={s.rebookedBadgeTxt}>This booking was rebooked — see your new ticket in Upcoming Bookings.</Text>
              </View>
            ) : rrStatus === "pending" ? (
              <View style={s.rebookPendingBox}>
                <ActivityIndicator color="#d97706" size="small" />
                <Text style={s.rebookPendingTxt}>Waiting for the operator to review your rebooking request.</Text>
              </View>
            ) : rrStatus === "approved" ? (
              <>
                <Text style={s.rebookNote}>Your rebooking was approved — pick a new date and time to finish.</Text>
                <TouchableOpacity style={s.rebookBtn} onPress={handleSelectNewTrip} activeOpacity={0.85}>
                  <Ionicons name="calendar-outline" size={15} color="#1a4a52" />
                  <Text style={s.rebookBtnTxt}>Select New Trip</Text>
                </TouchableOpacity>
              </>
            ) : (
              (canRequestRebook || rrStatus === "rejected" || rrStatus === "expired") && (
                <>
                  {rrStatus === "rejected" && (
                    <Text style={s.rebookNote}>
                      The operator declined your last rebooking request
                      {bk.rebook_rejection_reason ? ` — "${bk.rebook_rejection_reason}"` : ""}.
                      {canRequestRebook ? " You can request again below." : ""}
                    </Text>
                  )}
                  {rrStatus === "expired" && (
                    <Text style={s.rebookNote}>
                      Your last rebooking request expired before it was reviewed.
                      {canRequestRebook ? " You can request again below." : ""}
                    </Text>
                  )}
                  {rrStatus == null && bk.boarding_status === "no_show" && (
                    <Text style={s.rebookNote}>
                      Your trip has already departed. You may request a rebooking from the operator.
                    </Text>
                  )}
                  {canRequestRebook && (
                    <TouchableOpacity
                      style={[s.rebookBtn, rebookBusy && s.rebookBtnDone]}
                      onPress={handleRequestRebook}
                      disabled={rebookBusy}
                      activeOpacity={0.85}
                    >
                      {rebookBusy ? (
                        <ActivityIndicator color="#1a4a52" size="small" />
                      ) : (
                        <>
                          <Ionicons name="refresh-outline" size={15} color="#1a4a52" />
                          <Text style={s.rebookBtnTxt}>Request Rebooking</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              )
            )}

            <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={s.closeBtnTxt}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>

      {/* ── Cancel confirm ── */}
      <Modal visible={showCancelConfirm} transparent animationType="fade" onRequestClose={() => setShowCancelConfirm(false)}>
        <View style={cc.overlay}>
          <View style={cc.box}>
            <View style={cc.iconWrap}><Ionicons name="close-circle" size={28} color="#dc2626" /></View>
            <Text style={cc.title}>Cancel this booking?</Text>
            <Text style={cc.sub}>
              {previewPct >= 1
                ? "You're within the full-refund window — your fare will be refunded to your wallet in full."
                : `You're cancelling in the partial-refund window — ${previewPctLabel}% of your fare will be refunded to your wallet, and the rest goes to the driver/operator.`}
            </Text>
            <Text style={cc.subNote}>The exact amount is confirmed by the server at the moment you cancel.</Text>
            <View style={cc.actions}>
              <TouchableOpacity style={cc.keepBtn} onPress={() => setShowCancelConfirm(false)} disabled={actionBusy}>
                <Text style={cc.keepBtnTxt}>Keep Booking</Text>
              </TouchableOpacity>
              <TouchableOpacity style={cc.confirmBtn} onPress={handleConfirmCancel} disabled={actionBusy}>
                {actionBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={cc.confirmBtnTxt}>Cancel Booking</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  held: "Held (in escrow until boarding)", released: "Released", refunded: "Refunded", forfeited: "Forfeited",
};

function SectionLabel({ children }: { children: string }) {
  return <Text style={s.sectionLabel}>{children}</Text>;
}
function Divider() {
  return <View style={s.divider} />;
}
function DRow({ icon, label, value, valueColor }: { icon?: IoniconsName; label: string; value: string; valueColor?: string }) {
  return (
    <View style={dr.row}>
      <View style={dr.labelWrap}>
        {icon && <Ionicons name={icon} size={14} color="#9ca3af" />}
        <Text style={dr.label}>{label}</Text>
      </View>
      <Text style={[dr.value, valueColor ? { color: valueColor } : null]} numberOfLines={2}>{value}</Text>
    </View>
  );
}
const dr = StyleSheet.create({
  row:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  labelWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  label:     { fontSize: 13, color: "#6b7280" },
  value:     { fontSize: 13, color: "#374151", fontWeight: "700", flex: 1, textAlign: "right", marginLeft: 8 },
});

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:   { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%", paddingTop: 10 },
  handle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 8 },
  scroll:  { padding: 20, paddingBottom: 36 },

  header:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  badge:    { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  badgeTxt: { fontSize: 12, fontWeight: "800" },
  statusTxt:{ fontSize: 12, fontWeight: "700", color: "#6b7280" },
  headerCloseBtn:  { flexDirection: "row", alignItems: "center", gap: 3 },
  headerCloseText: { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  route:    { fontSize: 19, fontWeight: "900", color: "#1a4a52", marginBottom: 10 },

  liveStatusPill:     { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 10 },
  liveStatusPillText: { fontSize: 12, fontWeight: "800", color: "#fff" },
  graceBanner:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fffbeb", borderRadius: 12, padding: 12, marginBottom: 10 },
  graceBannerText:  { fontSize: 12, color: "#92400e", flex: 1, fontWeight: "600" },

  qrBox:          { alignItems: "center", backgroundColor: "#f9fafb", borderRadius: 16, padding: 20, gap: 8, marginBottom: 4 },
  qrRef:          { fontSize: 12, fontWeight: "900", color: "#1a4a52", letterSpacing: 1.5 },
  qrNote:         { fontSize: 11, color: "#9ca3af", textAlign: "center" },
  qrPendingIcon:  { width: 64, height: 64, borderRadius: 32, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  qrPendingTitle: { fontSize: 14, fontWeight: "800", color: "#374151" },

  divider: { height: 1, backgroundColor: "#f1f5f9", marginVertical: 14 },
  sectionLabel: { fontSize: 12, fontWeight: "800", color: "#374151", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },

  seatChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", flex: 1, marginLeft: 8 },
  seatChip:    { backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  seatChipTxt: { fontSize: 12, fontWeight: "800", color: "#fff" },

  totalLabel: { fontSize: 15, fontWeight: "800", color: "#1a4a52" },
  totalValue: { fontSize: 22, fontWeight: "900", color: "#1a4a52" },

  errorBox: { flexDirection: "row", gap: 8, backgroundColor: "#fef2f2", borderRadius: 12, padding: 12, marginTop: 12 },
  errorTxt: { fontSize: 13, color: "#ef4444", flex: 1 },

  cancelBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fef2f2", borderRadius: 14, paddingVertical: 14, marginTop: 20 },
  cancelBtnTxt: { fontSize: 14, fontWeight: "800", color: "#dc2626" },
  rebookBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fff", borderRadius: 14, paddingVertical: 14, marginTop: 12, borderWidth: 1.5, borderColor: "#1a4a52" },
  rebookBtnDone: { opacity: 0.6 },
  rebookBtnTxt:  { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  rebookNote:    { fontSize: 12, color: "#6b7280", marginTop: 8, lineHeight: 17 },
  rebookedBadge:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f5f3ff", borderRadius: 14, padding: 14, marginTop: 20 },
  rebookedBadgeTxt: { fontSize: 12, color: "#7c3aed", flex: 1, fontWeight: "700", lineHeight: 17 },
  rebookPendingBox:    { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fffbeb", borderRadius: 14, padding: 14, marginTop: 20 },
  rebookPendingTxt:    { fontSize: 12, color: "#92400e", flex: 1, fontWeight: "700", lineHeight: 17 },
  closeBtn:    { alignItems: "center", justifyContent: "center", paddingVertical: 14, marginTop: 12 },
  closeBtnTxt: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
});

const cc = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  box:        { backgroundColor: "#fff", borderRadius: 20, padding: 22, alignItems: "center" },
  iconWrap:   { width: 56, height: 56, borderRadius: 28, backgroundColor: "#fef2f2", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title:      { fontSize: 16, fontWeight: "900", color: "#1a4a52", marginBottom: 6, textAlign: "center" },
  sub:        { fontSize: 13, color: "#6b7280", textAlign: "center", lineHeight: 19, marginBottom: 4 },
  subNote:    { fontSize: 11, color: "#9ca3af", textAlign: "center", marginBottom: 14 },
  actions:    { flexDirection: "row", gap: 10, width: "100%" },
  keepBtn:    { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb" },
  keepBtnTxt: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  confirmBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 12, backgroundColor: "#dc2626" },
  confirmBtnTxt: { fontSize: 14, fontWeight: "800", color: "#fff" },
});
