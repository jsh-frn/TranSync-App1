import { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Passenger, BookingDraft, BusTrip, UvSession, UvSlot } from "../../types/booking";
import { isUvSlot } from "../../types/booking";
import KeyboardAwareForm from "../common/KeyboardAwareForm";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

interface Props {
  passenger: Passenger;
  draft: BookingDraft;
  // null for UV (no seat map — headcount only, see Core Flow 13). Always a
  // single label today (one seat per reservation) — SeatRow below already
  // renders from an array so multi-seat support is a display-layer no-op
  // if the booking flow ever grows to support it.
  selectedSeat: string | null;
  // The commuter's own admin-verified category/status — the ONLY thing that
  // determines a discount (create_reservation.php derives it the same way,
  // server-side). There is deliberately no manual passenger-type picker
  // here — see Do Not Break rule #70.
  commuterProfile: { category: string; isVerified: boolean } | null;
  walletBalance: number | null;
  onChange: (p: Passenger) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  student: "Student", elderly: "Senior Citizen", disabled: "PWD",
};

const SEAT_HIGHLIGHT = "#2563eb"; // matches sp.seatSelected in book.tsx's seat map

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

function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const roundQuarter = (n: number) => Math.round(n * 4) / 4;

export function PassengerForm({
  passenger, draft, selectedSeat, commuterProfile, walletBalance, onChange, onSubmit, submitting, error,
}: Props) {
  const router = useRouter();
  const selected = draft.selected;
  const isBus    = draft.mode === "bus";

  // The one and only discount source in this app — server-verified account
  // status. No selector, no self-declaration; automatic and non-editable.
  const realCategory = commuterProfile?.category ?? "default";
  const realEligible  = !!commuterProfile?.isVerified && realCategory in CATEGORY_LABEL;

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showCancellationPolicy, setShowCancellationPolicy] = useState(false);

  const canSubmit = passenger.name.trim().length > 0 && passenger.phone.trim().length > 0 && termsAccepted;

  // Fare breakdown mirrors create_reservation.php's own math exactly (20%
  // off, rounded to nearest ₱0.25) — a preview only. The actual charge is
  // still computed authoritatively server-side from the commuter's real
  // verified category at booking time.
  const baseFare        = selected ? roundQuarter(selected.fare) : 0;
  const discountedFare  = roundQuarter(baseFare * 0.8);
  const discountAmount  = realEligible ? +(baseFare - discountedFare).toFixed(2) : 0;
  const bookingFee       = 0; // this app has no separate booking/convenience fee — the fare is the whole charge
  const totalFare        = (realEligible ? discountedFare : baseFare) + bookingFee;

  const seatLabels = selectedSeat ? [selectedSeat] : [];
  const insufficientBalance = walletBalance !== null && walletBalance < totalFare;

  // Live UV "go online" sessions (UvSession) are dormant/unreachable from the
  // current UI (see Core Flow 8b point 8) — draft.selected in practice is
  // always a BusTrip or UvSlot, both of which carry departure_time. The type
  // guard is kept anyway so this doesn't silently misbehave if that legacy
  // path is ever hit via a historical/direct caller.
  const slot = !isBus && selected && isUvSlot(selected as UvSession | UvSlot) ? (selected as UvSlot) : null;
  const routeLabel = selected
    ? `${selected.from_location} → ${selected.to_location}`
    : "—";
  const terminalLabel = selected ? selected.from_location : "—";
  const vehicleLabel = isBus
    ? `Bus · ${(selected as BusTrip)?.vehicle_plate ?? "—"}`
    : "UV Express";
  const departureIso = isBus ? (selected as BusTrip)?.departure_time : slot?.departure_time;
  const departureLabel = departureIso ? fmtDeparture(departureIso) : "When vehicle is full";

  // Rough estimate — Haversine distance along the route's own waypoints ÷ a
  // flat per-vehicle-type speed (config/policy.php-adjacent constants,
  // mirrors routes/route_planner.php's own method, Core Flow 6), computed
  // server-side. Not a live traffic/ETA service; null when the route has no
  // waypoint data to estimate from, shown as "—" rather than guessed.
  const durationMin = (isBus ? (selected as BusTrip)?.estimated_duration_minutes : slot?.estimated_duration_minutes) ?? null;
  const travelTimeLabel = durationMin ? fmtDuration(durationMin) : "—";
  const arrivalLabel = departureIso && durationMin
    ? fmtTimeOnly(new Date(new Date(departureIso.replace(" ", "T")).getTime() + durationMin * 60000))
    : "—";

  function handleConfirmPress() {
    if (!canSubmit) return;
    setShowConfirmDialog(true);
  }

  function handleDialogConfirm() {
    setShowConfirmDialog(false);
    onSubmit();
  }

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareForm
        style={{ flex: 1 }}
        contentContainerStyle={f.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Booking Summary ── */}
        <Text style={f.sectionLabel}>Booking Summary</Text>
        <View style={f.summaryCard}>
          <SRow icon="map-outline"        label="Route"     value={routeLabel} />
          <SRow icon="bus-outline"        label="Vehicle"   value={vehicleLabel} />
          {isBus && (
            <View style={sr.row}>
              <View style={sr.labelWrap}>
                <Ionicons name="grid-outline" size={14} color="#9ca3af" />
                <Text style={sr.label}>Seat{seatLabels.length > 1 ? "s" : ""}</Text>
              </View>
              {seatLabels.length > 0 ? (
                <View style={f.seatChipRow}>
                  {seatLabels.map((s) => (
                    <View key={s} style={f.seatChip}>
                      <Text style={f.seatChipTxt}>{s}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={sr.value}>—</Text>
              )}
            </View>
          )}
          <SRow icon="location-outline"   label="Terminal"       value={terminalLabel} />
          <SRow icon="calendar-outline"   label="Departure"      value={departureLabel} />
          <SRow icon="flag-outline"       label="Est. Arrival"   value={arrivalLabel} />
          <SRow icon="time-outline"       label="Travel Time"    value={travelTimeLabel} />
        </View>

        {/* ── Passenger Details ── */}
        <Text style={[f.sectionLabel, { marginTop: 28 }]}>Passenger Details</Text>
        <Text style={f.hint}>Auto-filled from your account — edit if booking for someone else.</Text>

        <Field
          label="Full Name"
          icon="person-outline"
          value={passenger.name}
          onChangeText={(v) => onChange({ ...passenger, name: v })}
          placeholder="As on valid ID"
        />
        <Field
          label="Phone Number"
          icon="call-outline"
          value={passenger.phone}
          onChangeText={(v) => onChange({ ...passenger, phone: v })}
          placeholder="09XXXXXXXXX"
          keyboardType="phone-pad"
        />
        <Field
          label="Age (optional)"
          icon="calendar-number-outline"
          value={passenger.age}
          onChangeText={(v) => onChange({ ...passenger, age: v })}
          placeholder="e.g. 24"
          keyboardType="number-pad"
        />
        <Field
          label="Email Address (optional)"
          icon="mail-outline"
          value={passenger.email}
          onChangeText={(v) => onChange({ ...passenger, email: v })}
          placeholder="you@email.com"
          keyboardType="email-address"
        />
        <Field
          label="Emergency Contact Name (optional)"
          icon="people-outline"
          value={passenger.emergencyName}
          onChangeText={(v) => onChange({ ...passenger, emergencyName: v })}
          placeholder="Contact person's name"
        />
        <Field
          label="Emergency Contact Number (optional)"
          icon="call-outline"
          value={passenger.emergencyPhone}
          onChangeText={(v) => onChange({ ...passenger, emergencyPhone: v })}
          placeholder="09XXXXXXXXX"
          keyboardType="phone-pad"
        />

        {/* ── Fare Breakdown ── */}
        <Text style={[f.sectionLabel, { marginTop: 28 }]}>Fare Breakdown</Text>
        <View style={f.summaryCard}>
          {realEligible && (
            <View style={f.verifiedBadgeRow}>
              <Ionicons name="checkmark-circle" size={14} color="#16a34a" />
              <Text style={f.verifiedBadgeTxt}>
                Verified {CATEGORY_LABEL[realCategory]} discount applied automatically
              </Text>
            </View>
          )}
          <SRow label="Base Fare" value={`₱${baseFare.toLocaleString()}`} />
          <SRow
            label={realEligible ? `Verified Discount (${CATEGORY_LABEL[realCategory]})` : "Discount"}
            value={discountAmount > 0 ? `−₱${discountAmount.toLocaleString()}` : "₱0"}
            valueColor={discountAmount > 0 ? "#16a34a" : undefined}
          />
          <SRow label="Booking Fee" value={`₱${bookingFee.toLocaleString()}`} />
          <View style={f.divider} />
          <View style={sr.row}>
            <Text style={f.totalLabel}>Total Amount</Text>
            <Text style={f.totalValue}>₱{totalFare.toLocaleString()}</Text>
          </View>
        </View>

        {/* ── Payment Method Preview ── */}
        <Text style={[f.sectionLabel, { marginTop: 28 }]}>Payment Method</Text>
        <View style={[f.summaryCard, f.paymentCard]}>
          <View style={f.paymentIconWrap}>
            <Ionicons name="wallet-outline" size={20} color="#1a4a52" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={f.paymentLabel}>Wallet Balance</Text>
            <Text style={f.paymentValue}>
              {walletBalance !== null ? `₱${walletBalance.toLocaleString()}` : "—"}
            </Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/(main)/wallet")} activeOpacity={0.7}>
            <Text style={f.paymentChangeTxt}>{insufficientBalance ? "Top Up" : "Manage"}</Text>
          </TouchableOpacity>
        </View>
        {insufficientBalance && (
          <View style={f.errorBox}>
            <Ionicons name="warning-outline" size={15} color="#ef4444" />
            <Text style={f.errorTxt}>Your wallet balance is lower than this trip's total — top up before confirming.</Text>
          </View>
        )}

        {/* ── Booking Reminder ── */}
        <View style={f.reminderCard}>
          <Ionicons name="information-circle" size={18} color="#1a4a52" />
          <View style={{ flex: 1 }}>
            <Text style={f.reminderTitle}>Before you go</Text>
            <Text style={f.reminderTxt}>• Arrive at least 30 minutes before departure.</Text>
            <Text style={f.reminderTxt}>
              {realEligible
                ? "• Bring a valid physical ID — your verified discount will still be checked at boarding."
                : "• Bring a valid ID, especially if you plan to show one for a discount at boarding."}
            </Text>
            <Text style={f.reminderTxt}>• Your boarding QR ticket will be available right after booking.</Text>
          </View>
        </View>

        {/* ── Terms & Conditions / Cancellation Policy ── */}
        <TouchableOpacity style={f.termsRow} onPress={() => setTermsAccepted((v) => !v)} activeOpacity={0.8}>
          <View style={[f.checkbox, termsAccepted && f.checkboxChecked]}>
            {termsAccepted && <Ionicons name="checkmark" size={13} color="#fff" />}
          </View>
          <Text style={f.termsTxt}>I agree to the policies below before confirming this booking.</Text>
        </TouchableOpacity>
        {/* Two clickable links, side by side in one row — blue against the
            surrounding gray label, each opening its own modal. */}
        <View style={f.policyLinksRow}>
          <Text style={f.policyLinksLabel}>Read our </Text>
          <TouchableOpacity onPress={() => setShowTerms(true)} activeOpacity={0.7}>
            <Text style={f.policyLinkTxt}>Terms & Conditions</Text>
          </TouchableOpacity>
          <Text style={f.policyLinksLabel}> and </Text>
          <TouchableOpacity onPress={() => setShowCancellationPolicy(true)} activeOpacity={0.7}>
            <Text style={f.policyLinkTxt}>Cancellation Policy</Text>
          </TouchableOpacity>
        </View>

        {error && (
          <View style={f.errorBox}>
            <Ionicons name="warning-outline" size={15} color="#ef4444" />
            <Text style={f.errorTxt}>{error}</Text>
          </View>
        )}
      </KeyboardAwareForm>

      {/* ── Sticky Confirm Booking button ── */}
      <View style={f.stickyFooter}>
        <TouchableOpacity
          style={[f.submitBtn, (!canSubmit || submitting) && f.submitBtnDisabled]}
          onPress={handleConfirmPress}
          disabled={!canSubmit || submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={17} color="#fff" />
              <Text style={f.submitTxt}>Confirm Booking</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Confirmation dialog — prevents accidental bookings ── */}
      <Modal visible={showConfirmDialog} transparent animationType="fade" onRequestClose={() => setShowConfirmDialog(false)}>
        <View style={cd.overlay}>
          <View style={cd.box}>
            <Text style={cd.title}>Confirm Your Booking</Text>
            <View style={cd.summaryBox}>
              <CdRow label="Route"    value={routeLabel} />
              {isBus && <CdRow label={seatLabels.length > 1 ? "Seats" : "Seat"} value={seatLabels.join(", ") || "—"} />}
              <CdRow label="Passenger" value={passenger.name || "—"} />
              {realEligible && <CdRow label="Verified Discount" value={`${CATEGORY_LABEL[realCategory]} (−₱${discountAmount.toLocaleString()})`} />}
              <CdRow label="Payment"  value={`Wallet Balance${walletBalance !== null ? ` (₱${walletBalance.toLocaleString()})` : ""}`} />
              <View style={f.divider} />
              <CdRow label="Total Fare" value={`₱${totalFare.toLocaleString()}`} bold />
            </View>
            <View style={cd.actions}>
              <TouchableOpacity style={cd.cancelBtn} onPress={() => setShowConfirmDialog(false)} activeOpacity={0.8}>
                <Text style={cd.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={cd.confirmBtn} onPress={handleDialogConfirm} activeOpacity={0.85}>
                <Text style={cd.confirmTxt}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Terms & Conditions (view-only, optional) ── */}
      <PolicySheet visible={showTerms} title="Terms & Conditions" onClose={() => setShowTerms(false)}>
        <TcSection title="Your Responsibilities">
          Provide accurate passenger details, arrive at the terminal at least 30 minutes before departure,
          and carry a valid physical ID — especially if a verified discount is applied to your fare, since
          the driver will check it again at boarding. Keep your wallet funded; a booking's fare is charged
          from it the moment your booking is confirmed.
        </TcSection>
        <TcSection title="Booking Validity">
          Both Bus and UV Express bookings require at least 24 hours' notice before departure. Once
          confirmed, your fare is held (escrowed) until your trip is resolved — released to the
          driver/operator/system at boarding, refunded on a timely cancellation, or forfeited on a late
          cancellation or no-show. See our Cancellation Policy for the full rules.
        </TcSection>
        <TcSection title="QR Code Usage">
          Your booking QR is personal to your reservation — do not share it. It's valid from the moment of
          booking until shortly after departure (20 minutes for Bus, 30 minutes for UV Express), after
          which an unboarded ticket is marked a no-show. UV Express slot QRs only become scannable starting
          30 minutes before departure, to prevent line-skipping.
        </TcSection>
        <TcSection title="Refund Eligibility">
          Refunds are tiered by how early you cancel — 100% or 50%, depending on how close to departure you
          are — with no cancellation ever refused a refund entirely. Full details, including the exact
          schedule for Bus and UV Express, are in our Cancellation Policy.
        </TcSection>
        <TcSection title="Verified Discounts">
          A 20% discount is applied automatically only if your account has been verified by an admin as
          Student, Senior Citizen, or PWD, and can be used once per commuter per trip — a repeat booking on
          the same trip is charged full fare.
        </TcSection>
        <TcSection title="Compliance">
          By booking, you agree to follow TranSync's booking, boarding, and conduct policies, and any
          reasonable instruction from drivers, operators, or associations. Accounts found abusing the
          platform (e.g. fraudulent discount claims, repeated no-shows) may be restricted.
        </TcSection>
        <Text style={tc.footerNote}>
          This summary reflects TranSync's current booking, QR, and discount policies as implemented in the
          app. Contact your operator or association for any trip-specific exceptions.
        </Text>
      </PolicySheet>

      {/* ── Cancellation Policy (view-only, optional) ── */}
      <PolicySheet visible={showCancellationPolicy} title="Cancellation Policy" onClose={() => setShowCancellationPolicy(false)}>
        <TcSection title="Bus Refund Schedule">
          Cancelling 3 days (72 hours) or more before departure refunds 100%. Cancelling less than 3 days
          before departure refunds 50%, no matter how close to departure — there is no point at which a
          cancellation is refused a refund entirely.
        </TcSection>
        <TcSection title="UV Express Refund Schedule">
          Cancelling 1 day (24 hours) or more before your booked time refunds 100%. Cancelling less than
          1 day before refunds 50%, no matter how close to your booked time.
        </TcSection>
        <TcSection title="Where the Other Half Goes">
          On a 50% cancellation, the half that isn't refunded is paid out to the driver/operator/system,
          the same as if the trip had happened.
        </TcSection>
        <TcSection title="If the Operator Cancels Your Trip">
          If your operator cancels a scheduled trip, you always receive a 100% refund, no matter how close
          to departure the cancellation happens.
        </TcSection>
        <TcSection title="Where Your Refund Goes">
          Any refund — full or partial — is credited straight back to your TranSync wallet balance, never
          to an external payment method.
        </TcSection>
        <TcSection title="If You Miss Your Trip (No-Show)">
          An unboarded ticket past its boarding window becomes a no-show — the full fare is paid out to the
          driver/operator/system, and no refund is issued. You then have 24 hours to request a rebook on
          that booking.
        </TcSection>
        <TcSection title="Rebooking a Missed Trip">
          A rebook request must be approved by your operator before you can act on it. Once approved, you
          pick a new departure of the same vehicle type from the same operator and pay a fee equal to 10%
          of your original fare — not a second full fare. If you don't request a rebook within 24 hours, or
          the operator doesn't approve it, the original fare stays settled to the driver/operator/system
          and the booking is closed.
        </TcSection>
        <TcSection title="Booking Again After Cancelling">
          Cancelling doesn't hold your seat — if you still want to travel, you'll need to make a new
          booking at the standard fare. The 10% rebooking fee only applies to an approved rebook on a
          missed booking; it never applies to a fresh booking after your own cancellation.
        </TcSection>
        <TcSection title="When You Can No Longer Cancel">
          Once your QR ticket has been scanned at boarding, or your trip has departed and its boarding
          window has passed, the booking can no longer be cancelled — it becomes a no-show instead, per
          the rule above.
        </TcSection>
        <Text style={tc.footerNote}>
          This summary reflects TranSync's current cancellation and refund policy as implemented in the
          app. Contact your operator or association for any trip-specific exceptions.
        </Text>
      </PolicySheet>
    </View>
  );
}

// Shared sheet chrome for the two separate policy modals below — same
// slide-up shell the old combined Terms & Conditions sheet used, just
// parameterized by title/content so Terms & Conditions and Cancellation
// Policy can be two independent modals instead of one combined one.
function PolicySheet({
  visible, title, onClose, children,
}: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={tc.overlay}>
        <View style={tc.sheet}>
          <View style={tc.header}>
            <Text style={tc.headerTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={tc.headerCloseBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={18} color="#1a4a52" />
              <Text style={tc.headerCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            {children}
          </ScrollView>
          <View style={[tc.footer, { paddingBottom: 16 + insets.bottom }]}>
            <TouchableOpacity style={tc.doneBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={tc.doneBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TcSection({ title, children }: { title: string; children: string }) {
  return (
    <View style={tc.section}>
      <Text style={tc.sectionTitle}>{title}</Text>
      <Text style={tc.sectionBody}>{children}</Text>
    </View>
  );
}
const tc = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:       { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, height: "82%" },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  headerTitle: { fontSize: 17, fontWeight: "900", color: "#1a4a52" },
  headerCloseBtn:  { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 4, paddingLeft: 8 },
  headerCloseText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  section:     { marginBottom: 18 },
  sectionTitle:{ fontSize: 13, fontWeight: "800", color: "#1a4a52", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 },
  sectionBody: { fontSize: 13, color: "#374151", lineHeight: 20 },
  footerNote:  { fontSize: 11, color: "#9ca3af", lineHeight: 16, marginTop: 4, marginBottom: 8 },
  footer:      { padding: 16, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  doneBtn:     { alignItems: "center", justifyContent: "center", backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 15 },
  doneBtnTxt:  { fontSize: 15, fontWeight: "800", color: "#fff" },
});

function CdRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={sr.row}>
      <Text style={sr.label}>{label}</Text>
      <Text style={[sr.value, bold && sr.bold]} numberOfLines={1}>{value}</Text>
    </View>
  );
}
const cd = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  box:        { backgroundColor: "#fff", borderRadius: 20, padding: 20 },
  title:      { fontSize: 17, fontWeight: "900", color: "#1a4a52", marginBottom: 14, textAlign: "center" },
  summaryBox: { backgroundColor: "#f9fafb", borderRadius: 12, padding: 14 },
  actions:    { flexDirection: "row", gap: 10, marginTop: 18 },
  cancelBtn:  { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb" },
  cancelTxt:  { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  confirmBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 13, borderRadius: 12, backgroundColor: "#1a4a52" },
  confirmTxt: { fontSize: 14, fontWeight: "800", color: "#fff" },
});

function Field({
  label, icon, value, onChangeText, placeholder, keyboardType,
}: {
  label: string; icon: IoniconsName; value: string;
  onChangeText: (v: string) => void; placeholder: string; keyboardType?: any;
}) {
  return (
    <View style={fi.wrap}>
      <Text style={fi.label}>{label}</Text>
      <View style={fi.row}>
        <Ionicons name={icon} size={16} color="#9ca3af" />
        <TextInput
          style={fi.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          keyboardType={keyboardType}
        />
      </View>
    </View>
  );
}
const fi = StyleSheet.create({
  wrap:  { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: "700", color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  row:   { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1.5, borderColor: "#e5e7eb" },
  input: { flex: 1, fontSize: 14, color: "#111827" },
});

function SRow({ icon, label, value, bold, valueColor }: { icon?: IoniconsName; label: string; value: string; bold?: boolean; valueColor?: string }) {
  return (
    <View style={sr.row}>
      <View style={sr.labelWrap}>
        {icon && <Ionicons name={icon} size={14} color="#9ca3af" />}
        <Text style={sr.label}>{label}</Text>
      </View>
      <Text style={[sr.value, bold && sr.bold, valueColor ? { color: valueColor } : null]} numberOfLines={2}>{value}</Text>
    </View>
  );
}
const sr = StyleSheet.create({
  row:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9 },
  labelWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  label:     { fontSize: 13, color: "#6b7280" },
  value:     { fontSize: 13, color: "#374151", fontWeight: "600", flex: 1, textAlign: "right", marginLeft: 8 },
  bold:      { color: "#1a4a52", fontWeight: "900", fontSize: 15 },
});

const f = StyleSheet.create({
  scroll:       { padding: 20, paddingBottom: 24 },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 },
  hint:         { fontSize: 12, color: "#9ca3af", marginBottom: 12 },
  summaryCard:  { backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#f1f5f9", marginTop: 8 },
  divider:      { height: 1, backgroundColor: "#f1f5f9", marginVertical: 8 },

  seatChipRow:  { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", flex: 1, marginLeft: 8 },
  seatChip:     { backgroundColor: SEAT_HIGHLIGHT, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  seatChipTxt:  { fontSize: 12, fontWeight: "800", color: "#fff" },

  verifiedBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0fdf4", borderRadius: 10, padding: 10, marginBottom: 8 },
  verifiedBadgeTxt: { fontSize: 12, color: "#166534", fontWeight: "700", flex: 1 },

  totalLabel: { fontSize: 15, fontWeight: "800", color: "#1a4a52" },
  totalValue: { fontSize: 22, fontWeight: "900", color: "#1a4a52" },

  paymentCard:     { flexDirection: "row", alignItems: "center", gap: 12 },
  paymentIconWrap: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#f0fdf4", alignItems: "center", justifyContent: "center" },
  paymentLabel:    { fontSize: 11, color: "#9ca3af", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  paymentValue:    { fontSize: 16, fontWeight: "900", color: "#1a4a52", marginTop: 2 },
  paymentChangeTxt:{ fontSize: 13, fontWeight: "800", color: "#2563eb" },

  reminderCard:  { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#eff6ff", borderRadius: 14, padding: 14, marginTop: 28 },
  reminderTitle: { fontSize: 13, fontWeight: "800", color: "#1a4a52", marginBottom: 4 },
  reminderTxt:   { fontSize: 12, color: "#374151", lineHeight: 18 },

  termsRow:      { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 20 },
  checkbox:      { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: "#9ca3af", alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxChecked: { backgroundColor: "#1a4a52", borderColor: "#1a4a52" },
  termsTxt:      { fontSize: 12, color: "#6b7280", flex: 1, lineHeight: 18 },

  // Two hyperlink-styled entries, side by side in one row, surrounded by
  // gray label text — a direct way to open either policy from the bottom
  // of the screen without going through the checkbox above.
  policyLinksRow:   { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 8, marginLeft: 30 },
  policyLinksLabel: { fontSize: 12, color: "#9ca3af" },
  policyLinkTxt:    { fontSize: 12, color: "#2563eb", fontWeight: "800" },

  errorBox:     { flexDirection: "row", gap: 8, backgroundColor: "#fef2f2", borderRadius: 12, padding: 12, marginTop: 12 },
  errorTxt:     { fontSize: 13, color: "#ef4444", flex: 1 },

  stickyFooter: { padding: 16, backgroundColor: "#f9fafb", borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  submitBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 15 },
  submitBtnDisabled: { backgroundColor: "#9ca3af" },
  submitTxt:    { fontSize: 15, fontWeight: "800", color: "#fff" },
});
