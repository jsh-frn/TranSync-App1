import { useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import type { BookingDraft, BusTrip, UvSession, UvSlot } from "../../types/booking";
import { VEHICLE_META, isUvSlot } from "../../types/booking";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

interface Props {
  draft: BookingDraft;
  qrCode: string;
  reservationId: number;
  newBalance: number | undefined;
  fareAmount: number;
  discountType: string | null;
  discountCapped?: boolean;
  queueNumber: number | null;
  qrActiveAt: string | null;
  seatLabel: string | null;
  onNewBooking: () => void;
  onBackHome: () => void;
  onViewBookings: () => void;
}

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

export function BookingConfirm({
  draft, qrCode, reservationId, newBalance, fareAmount, discountType, discountCapped, queueNumber, qrActiveAt, seatLabel,
  onNewBooking, onBackHome, onViewBookings,
}: Props) {
  const isBus      = draft.mode === "bus";
  const isSlot     = !isBus && !!draft.selected && isUvSlot(draft.selected as UvSession | UvSlot);
  const meta       = VEHICLE_META[isBus ? "Bus" : "UV Express"];
  const bus        = isBus ? (draft.selected as BusTrip) : null;
  const uv         = !isBus && !isSlot ? (draft.selected as UvSession) : null;
  const slot       = isSlot ? (draft.selected as UvSlot) : null;
  const from       = bus?.from_location ?? uv?.from_location ?? slot?.from_location ?? "";
  const to         = bus?.to_location ?? uv?.to_location ?? slot?.to_location ?? "";
  const plate      = bus?.vehicle_plate ?? uv?.vehicle_plate ?? "";
  const ownerInit  = meta.label.charAt(0).toUpperCase();
  const discounted = !!discountType && discountType !== "default";
  const departureIso = bus?.departure_time ?? slot?.departure_time ?? null;

  const qrOpensAt = qrActiveAt ? new Date(qrActiveAt.replace(" ", "T")).getTime() : null;
  const qrPending = qrOpensAt !== null && Date.now() < qrOpensAt;

  const qrRef = useRef<{ toDataURL: (cb: (data: string) => void) => void } | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function handleDownloadTicket() {
    if (downloading) return;
    setDownloading(true);
    try {
      let qrImgTag = "";
      if (qrRef.current) {
        const dataUrl = await new Promise<string>((resolve) => {
          qrRef.current!.toDataURL((data) => resolve(data));
        });
        qrImgTag = `<img src="data:image/png;base64,${dataUrl}" style="width:170px;height:170px;" />`;
      }
      const html = `
        <html>
          <body style="font-family:-apple-system,Helvetica,sans-serif;padding:28px;color:#111827;">
            <h2 style="color:#1a4a52;margin-bottom:4px;">TranSync E-Ticket</h2>
            <p style="color:#6b7280;margin-top:0;">Booking #${reservationId}</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
            <table style="width:100%;font-size:14px;line-height:1.9;">
              <tr><td style="color:#6b7280;">Route</td><td style="text-align:right;font-weight:700;">${from} → ${to}</td></tr>
              ${isBus && seatLabel ? `<tr><td style="color:#6b7280;">Seat</td><td style="text-align:right;font-weight:700;">${seatLabel}</td></tr>` : ""}
              <tr><td style="color:#6b7280;">Vehicle No.</td><td style="text-align:right;font-weight:700;">${plate || meta.label}</td></tr>
              <tr><td style="color:#6b7280;">Passenger</td><td style="text-align:right;font-weight:700;">${draft.passenger.name || "—"}</td></tr>
              ${departureIso ? `<tr><td style="color:#6b7280;">Departure</td><td style="text-align:right;font-weight:700;">${fmtDeparture(departureIso)}</td></tr>` : ""}
              <tr><td style="color:#6b7280;">Fare Paid</td><td style="text-align:right;font-weight:900;color:#1a4a52;">₱${fareAmount.toLocaleString()}</td></tr>
            </table>
            <div style="text-align:center;margin-top:24px;">
              ${qrImgTag}
              <p style="font-size:12px;letter-spacing:1px;color:#1a4a52;font-weight:700;">${qrCode}</p>
              <p style="font-size:11px;color:#9ca3af;">Show this QR code to the driver when boarding</p>
            </div>
          </body>
        </html>
      `;
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Save or share your ticket" });
      }
    } catch {
      // Best-effort — if generation/sharing fails, the ticket is still fully
      // visible and usable on this screen; nothing else depends on this.
    } finally {
      setDownloading(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={c.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Success banner */}
      <View style={c.successBanner}>
        <View style={c.successIcon}>
          <Ionicons name="checkmark-circle" size={44} color="#a8d832" />
        </View>
        <Text style={c.successTitle}>Booking Confirmed!</Text>
        <Text style={c.successSub}>
          Reservation #{reservationId} · Show QR to the driver.
        </Text>
        {newBalance !== undefined && (
          <Text style={c.balanceTxt}>Wallet balance: ₱{newBalance.toLocaleString()}</Text>
        )}
        {discountCapped && (
          <Text style={c.cappedTxt}>Discount already used on this trip — booked at full fare.</Text>
        )}
      </View>

      {/* Ticket card */}
      <View style={c.ticket}>

        {/* Ticket header */}
        <View style={c.ticketHeader}>
          <View style={[c.opBadge, { backgroundColor: meta.bg }]}>
            <Text style={[c.opInitial, { color: meta.color }]}>{ownerInit}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={c.opName}>{plate || meta.label}</Text>
            <Text style={c.opType}>{meta.label} {isBus || isSlot ? "Trip" : "Queue"}</Text>
          </View>
          {queueNumber != null ? (
            <View style={c.queueBadge}>
              <Text style={c.queueTxt}>Queue #{queueNumber}</Text>
            </View>
          ) : (
            <View style={c.confirmedBadge}>
              <Text style={c.confirmedTxt}>Confirmed</Text>
            </View>
          )}
        </View>

        <TearLine />

        {/* Route block */}
        <View style={c.routeBlock}>
          <View style={c.routeCity}>
            <Text style={c.cityLabel}>FROM</Text>
            <Text style={c.cityName} numberOfLines={2}>{from}</Text>
          </View>
          <Ionicons name="arrow-forward" size={22} color="#a8d832" style={{ marginHorizontal: 8 }} />
          <View style={[c.routeCity, c.routeCityRight]}>
            <Text style={[c.cityLabel, { textAlign: "right" }]}>TO</Text>
            <Text style={[c.cityName, { textAlign: "right" }]} numberOfLines={2}>{to}</Text>
          </View>
        </View>

        {/* Total paid — pulled out of the detail grid and enlarged so it's
            the single most prominent number on the ticket. */}
        <View style={c.totalBlock}>
          <Text style={c.totalLabel}>{discounted ? "Total Paid (20% off applied)" : "Total Paid"}</Text>
          <Text style={c.totalValue}>₱{fareAmount.toLocaleString()}</Text>
        </View>

        {/* Detail grid */}
        <View style={c.detailGrid}>
          <DetailField icon="receipt-outline"     label="Booking ID" value={`#${reservationId}`} />
          <DetailField icon="person-outline"      label="Passenger"  value={draft.passenger.name || "—"} />
          {isBus && seatLabel && (
            <DetailField icon="grid-outline" label="Seat" value={seatLabel} highlight />
          )}
          <DetailField icon="bus-outline" label="Vehicle No." value={plate || meta.label} />
          {departureIso && (
            <DetailField icon="calendar-outline" label="Departure" value={fmtDeparture(departureIso)} />
          )}
          {!departureIso && (
            <DetailField icon="calendar-outline" label="Departure" value="When vehicle is full" />
          )}
          {queueNumber != null && (
            <DetailField icon="people-outline" label="Queue Number" value={`#${queueNumber}`} />
          )}
        </View>

        <TearLine />

        {/* QR block */}
        <View style={c.qrBlock}>
          {qrPending ? (
            <>
              <View style={c.qrPendingIcon}>
                <Ionicons name="time-outline" size={40} color="#9ca3af" />
              </View>
              <Text style={c.qrPendingTitle}>QR not active yet</Text>
              <Text style={c.qrNote}>
                To prevent line-skipping, this opens at {qrOpensAt ? new Date(qrOpensAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) : "—"}{"\n"}
                (30 minutes before departure). Check "My Upcoming Bookings" then.
              </Text>
            </>
          ) : (
            <>
              <QRCode
                value={qrCode}
                size={140}
                backgroundColor="#ffffff"
                color="#1a4a52"
                getRef={(ref: any) => (qrRef.current = ref)}
              />
              <Text style={c.qrRef}>{qrCode}</Text>
              <Text style={c.qrNote}>Show this QR code to the driver when boarding</Text>
            </>
          )}
        </View>
      </View>

      {!qrPending && (
        <TouchableOpacity style={c.downloadBtn} onPress={handleDownloadTicket} disabled={downloading} activeOpacity={0.85}>
          {downloading
            ? <ActivityIndicator color="#1a4a52" size="small" />
            : <>
                <Ionicons name="download-outline" size={17} color="#1a4a52" />
                <Text style={c.downloadBtnTxt}>Download Ticket</Text>
              </>
          }
        </TouchableOpacity>
      )}

      <TouchableOpacity style={c.newBtn} onPress={onNewBooking} activeOpacity={0.85}>
        <Ionicons name="add-circle-outline" size={17} color="#fff" />
        <Text style={c.newBtnTxt}>Book Another Trip</Text>
      </TouchableOpacity>

      <TouchableOpacity style={c.homeBtn} onPress={onBackHome} activeOpacity={0.85}>
        <Ionicons name="home-outline" size={17} color="#1a4a52" />
        <Text style={c.homeBtnTxt}>Back to Home</Text>
      </TouchableOpacity>

      <TouchableOpacity style={c.viewBookingsLink} onPress={onViewBookings} activeOpacity={0.7}>
        <Text style={c.viewBookingsTxt}>View My Bookings →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function TearLine() {
  return (
    <View style={tl.row}>
      <View style={tl.circle} />
      <View style={tl.dash} />
      <View style={[tl.circle, tl.circleRight]} />
    </View>
  );
}
const tl = StyleSheet.create({
  row:         { flexDirection: "row", alignItems: "center", height: 28 },
  circle:      { width: 26, height: 26, borderRadius: 13, backgroundColor: "#f9fafb", position: "absolute", left: -13 },
  circleRight: { left: undefined, right: -13 },
  dash:        { flex: 1, height: 1, borderStyle: "dashed", borderWidth: 1, borderColor: "#e5e7eb", marginHorizontal: 16 },
});

function DetailField({ icon, label, value, highlight }: { icon?: IoniconsName; label: string; value: string; highlight?: boolean }) {
  return (
    <View style={df.wrap}>
      <View style={df.labelRow}>
        {icon && <Ionicons name={icon} size={11} color="#9ca3af" />}
        <Text style={df.label}>{label}</Text>
      </View>
      {highlight ? (
        <View style={df.highlightChip}>
          <Text style={df.highlightTxt}>{value}</Text>
        </View>
      ) : (
        <Text style={df.value}>{value}</Text>
      )}
    </View>
  );
}
const df = StyleSheet.create({
  wrap:     { width: "50%", paddingVertical: 8, paddingHorizontal: 4 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  label:    { fontSize: 10, color: "#9ca3af", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  value:    { fontSize: 13, color: "#1a4a52", fontWeight: "800", marginTop: 2 },
  // Seat number highlighted the same blue used for a selected seat on the
  // seat map itself, so the two screens read as the same visual language.
  highlightChip: { alignSelf: "flex-start", backgroundColor: "#2563eb", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 },
  highlightTxt:  { fontSize: 12, fontWeight: "900", color: "#fff" },
});

const c = StyleSheet.create({
  scroll:         { padding: 20, paddingBottom: 60 },
  successBanner:  { alignItems: "center", paddingVertical: 20, gap: 6 },
  successIcon:    { width: 76, height: 76, borderRadius: 38, backgroundColor: "#f0fdf4", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  successTitle:   { fontSize: 22, fontWeight: "900", color: "#1a4a52" },
  successSub:     { fontSize: 13, color: "#6b7280", textAlign: "center" },
  balanceTxt:     { fontSize: 13, color: "#059669", fontWeight: "700", marginTop: 4 },
  cappedTxt:      { fontSize: 12, color: "#d97706", fontWeight: "600", marginTop: 4, textAlign: "center" },
  ticket:         { backgroundColor: "#fff", borderRadius: 20, marginBottom: 16, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 16, elevation: 6 },
  ticketHeader:   { flexDirection: "row", alignItems: "center", padding: 16 },
  opBadge:        { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  opInitial:      { fontSize: 16, fontWeight: "900" },
  opName:         { fontSize: 15, fontWeight: "800", color: "#1a4a52" },
  opType:         { fontSize: 12, color: "#6b7280", marginTop: 2 },
  confirmedBadge: { backgroundColor: "#ecfdf5", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  confirmedTxt:   { fontSize: 12, fontWeight: "700", color: "#059669" },
  queueBadge:     { backgroundColor: "#faf5ff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  queueTxt:       { fontSize: 12, fontWeight: "700", color: "#9333ea" },
  routeBlock:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16 },
  routeCity:      { flex: 1 },
  routeCityRight: { alignItems: "flex-end" },
  cityLabel:      { fontSize: 10, fontWeight: "700", color: "#a8d832", letterSpacing: 0.8 },
  cityName:       { fontSize: 15, fontWeight: "900", color: "#1a4a52", marginTop: 2 },
  totalBlock:     { alignItems: "center", paddingBottom: 16, paddingHorizontal: 20 },
  totalLabel:     { fontSize: 11, color: "#9ca3af", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  totalValue:     { fontSize: 34, fontWeight: "900", color: "#1a4a52", marginTop: 2 },
  detailGrid:     { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, paddingBottom: 8 },
  qrBlock:        { alignItems: "center", padding: 20, gap: 10 },
  qrRef:          { fontSize: 12, fontWeight: "900", color: "#1a4a52", letterSpacing: 1.5 },
  qrNote:         { fontSize: 11, color: "#9ca3af", textAlign: "center" },
  qrPendingIcon:  { width: 72, height: 72, borderRadius: 36, backgroundColor: "#f9fafb", alignItems: "center", justifyContent: "center" },
  qrPendingTitle: { fontSize: 15, fontWeight: "800", color: "#374151" },
  downloadBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fff", borderRadius: 14, paddingVertical: 15, borderWidth: 1.5, borderColor: "#e5e7eb", marginBottom: 12 },
  downloadBtnTxt: { fontSize: 15, fontWeight: "800", color: "#1a4a52" },
  newBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 15 },
  newBtnTxt:      { fontSize: 15, fontWeight: "800", color: "#fff" },
  homeBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fff", borderRadius: 14, paddingVertical: 15, borderWidth: 1.5, borderColor: "#1a4a52", marginTop: 12 },
  homeBtnTxt:     { fontSize: 15, fontWeight: "800", color: "#1a4a52" },
  viewBookingsLink: { alignItems: "center", paddingVertical: 14 },
  viewBookingsTxt:  { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
});
