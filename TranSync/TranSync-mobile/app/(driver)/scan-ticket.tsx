import { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Modal, Vibration,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { previewTicket, boardReservation, type PreviewTicketResult, type DiscountDecision } from "../../src/services/bookingService";

type ScanResult = {
  success: boolean;
  message?: string;
  passenger_name?: string;
  queue_number?: number | null;
  destination_terminal?: string;
  fare_amount?: number;
  discount_type?: string | null;
  surcharge_charged?: number | null;
  cashback_credited?: number | null;
  // Set only when this reservation is a continuation of an earlier
  // rebooked-away booking (complete_rebook.php) — the original fare was
  // already settled at rebooking time, so there's nothing additional due.
  is_rebooked?: boolean;
  original_fare_amount?: number | null;
  rebooking_fee_amount?: number | null;
  additional_fare_due?: number | null;
};

const DISCOUNT_LABEL: Record<string, string> = {
  student: "Student", disabled: "PWD", elderly: "Senior Citizen",
};

export default function ScanTicket() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();

  const [driverId,     setDriverId]     = useState<number | null>(null);
  const [scanning,     setScanning]     = useState(true);
  const [processing,   setProcessing]   = useState(false);
  const [result,       setResult]       = useState<ScanResult | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const lastScanRef = useRef<string>("");

  // Persistent "physical ID shown" toggle — stays set across scans (a driver
  // may scan several ID-holding passengers in a row), only affects the
  // opposite direction (granting a discount that wasn't already verified).
  const [discountMode, setDiscountMode] = useState(false);

  // Pending decision prompt for a ticket that was already booked with a
  // system-verified discount — always shown regardless of discountMode,
  // letting the driver decline if no ID is actually shown this time.
  const [pendingQr,      setPendingQr]      = useState<string>("");
  const [preview,        setPreview]        = useState<PreviewTicketResult | null>(null);
  const [decisionBusy,   setDecisionBusy]   = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (raw) setDriverId(JSON.parse(raw).id);
    })();
    if (!permission?.granted) requestPermission();
  }, []);

  const finalizeBoard = async (qr: string, decision: DiscountDecision) => {
    if (!driverId) return;
    setDecisionBusy(true);
    try {
      const json = await boardReservation(driverId, qr, decision);
      setPreview(null);
      setResult(json);
      setModalVisible(true);
    } catch {
      setPreview(null);
      setResult({ success: false, message: "Network error. Please try again." });
      setModalVisible(true);
    } finally {
      setDecisionBusy(false);
    }
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (!scanning || processing || data === lastScanRef.current || !driverId) return;

    lastScanRef.current = data;
    setScanning(false);
    setProcessing(true);
    Vibration.vibrate(120);

    try {
      const p = await previewTicket(driverId, data);
      if (!p.success) {
        setResult({ success: false, message: p.message ?? "Could not process QR." });
        setModalVisible(true);
        return;
      }

      const bookedWithDiscount = !!p.discount_type && p.discount_type !== "default";
      if (bookedWithDiscount && p.can_decline) {
        // Always give the driver a chance to decline a pre-verified discount —
        // independent of the toggle, per the accept/decline requirement.
        setPendingQr(data);
        setPreview(p);
        return;
      }

      if (!bookedWithDiscount && discountMode && p.can_grant) {
        // Toggle itself is the driver's confirmation that ID was shown —
        // no second prompt, grant it directly.
        await finalizeBoard(data, "grant");
        return;
      }

      // Nothing to override — board normally. (If discountMode was ON but the
      // commuter has no discount category on file, this falls through here too;
      // the result modal note below covers that case.)
      await finalizeBoard(data, "keep");
    } catch {
      setResult({ success: false, message: "Network error. Please try again." });
      setModalVisible(true);
    } finally {
      setProcessing(false);
    }
  };

  const handleCloseResult = () => {
    setModalVisible(false);
    setResult(null);
    lastScanRef.current = "";
    setTimeout(() => setScanning(true), 500);
  };

  const handleAcceptDiscount = () => {
    if (!pendingQr) return;
    finalizeBoard(pendingQr, "keep").finally(() => setPendingQr(""));
  };

  const handleDeclineDiscount = () => {
    if (!pendingQr) return;
    finalizeBoard(pendingQr, "decline").finally(() => setPendingQr(""));
  };

  const cancelDiscountPrompt = () => {
    setPendingQr("");
    setPreview(null);
    lastScanRef.current = "";
    setScanning(true);
  };

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator color="#1a4a52" size="large" /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>📷 Camera access is required to scan tickets.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanning && !processing ? handleBarcodeScanned : undefined}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      />

      <View style={styles.overlay}>
        <View style={[styles.topLabel, { paddingTop: insets.top + 20 }]}>
          <Text style={styles.topLabelText}>🎫 Scan Passenger Ticket</Text>
          <Text style={styles.topLabelSub}>Point your camera at the passenger's QR code</Text>
        </View>

        {/* Discount Mode toggle — flip ON when a passenger presents a valid
            discount ID physically onboard; stays on until flipped back. */}
        <TouchableOpacity
          style={[styles.discountToggle, { top: insets.top + 60 }, discountMode && styles.discountToggleActive]}
          onPress={() => setDiscountMode(v => !v)}
          activeOpacity={0.85}
        >
          <Ionicons name={discountMode ? "checkmark-circle" : "ellipse-outline"} size={16} color={discountMode ? "#1a4a52" : "#fff"} />
          <Text style={[styles.discountToggleText, discountMode && styles.discountToggleTextActive]}>
            Discount Mode {discountMode ? "ON" : "OFF"}
          </Text>
        </TouchableOpacity>

        <View style={styles.finderFrame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
          {processing && (
            <View style={styles.processingBox}>
              <ActivityIndicator color="#fff" size="large" />
              <Text style={styles.processingText}>Verifying…</Text>
            </View>
          )}
        </View>

        <View style={[styles.bottomHint, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.bottomHintText}>
            {processing ? "Processing…" : scanning ? "Align the ticket QR inside the frame" : "Preparing…"}
          </Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Accept/Decline prompt for a ticket booked with a system-verified discount */}
      <Modal visible={!!preview} transparent animationType="slide" onRequestClose={cancelDiscountPrompt}>
        <View style={styles.modalOverlay}>
          <View style={styles.resultModal}>
            <Text style={styles.resultIcon}>🎓</Text>
            <Text style={styles.resultTitle}>
              Verified for {DISCOUNT_LABEL[preview?.discount_type ?? ""] ?? preview?.discount_type} Discount
            </Text>
            <Text style={styles.resultSub}>{preview?.passenger_name}</Text>
            <Text style={[styles.resultSub, { marginTop: -6 }]}>Did they show a valid ID onboard?</Text>

            <View style={styles.infoBox}>
              <Text style={styles.infoRow}>
                💳  Fare (discounted): <Text style={styles.infoVal}>₱{preview?.fare_amount?.toFixed(2)}</Text>
              </Text>
              <Text style={[styles.infoRow, { marginTop: 6 }]}>
                ⚠️  If declined, surcharge: <Text style={[styles.infoVal, { color: "#dc2626" }]}>
                  ₱{((preview?.full_fare ?? 0) - (preview?.fare_amount ?? 0)).toFixed(2)}
                </Text>
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.resultCloseBtn, decisionBusy && { opacity: 0.6 }]}
              onPress={handleAcceptDiscount}
              disabled={decisionBusy}
              activeOpacity={0.85}
            >
              {decisionBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.resultCloseBtnText}>✅ Accept — ID Shown</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.resultCloseBtn, styles.declineBtn, decisionBusy && { opacity: 0.6 }]}
              onPress={handleDeclineDiscount}
              disabled={decisionBusy}
              activeOpacity={0.85}
            >
              <Text style={[styles.resultCloseBtnText, { color: "#dc2626" }]}>Decline — No ID Shown</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelPromptBtn} onPress={cancelDiscountPrompt} disabled={decisionBusy}>
              <Text style={styles.cancelPromptBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Final Result Modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={handleCloseResult}>
        <View style={styles.modalOverlay}>
          <View style={styles.resultModal}>
            {result?.success ? (
              <>
                <Text style={styles.resultIcon}>✅</Text>
                <Text style={styles.resultTitle}>Boarded!</Text>
                <Text style={styles.resultSub}>{result.passenger_name}</Text>

                <View style={styles.infoBox}>
                  {result.queue_number != null && (
                    <Text style={styles.infoRow}>
                      🎟️  Queue: <Text style={styles.infoVal}>#{result.queue_number}</Text>
                    </Text>
                  )}
                  {result.destination_terminal && (
                    <Text style={[styles.infoRow, { marginTop: 6 }]}>
                      📍  To: <Text style={styles.infoVal}>{result.destination_terminal}</Text>
                    </Text>
                  )}
                  {result.fare_amount != null && (
                    <Text style={[styles.infoRow, { marginTop: 6 }]}>
                      💳  Fare: <Text style={styles.infoVal}>₱{result.fare_amount.toFixed(2)}</Text>
                      {result.discount_type && result.discount_type !== "default" ? ` (${result.discount_type} discount)` : ""}
                    </Text>
                  )}
                  {!!result.surcharge_charged && (
                    <Text style={[styles.infoRow, { marginTop: 6, color: "#dc2626" }]}>
                      ⚠️  Surcharge charged: <Text style={[styles.infoVal, { color: "#dc2626" }]}>₱{result.surcharge_charged.toFixed(2)}</Text>
                    </Text>
                  )}
                  {!!result.cashback_credited && (
                    <Text style={[styles.infoRow, { marginTop: 6, color: "#16a34a" }]}>
                      🎉  Cashback credited: <Text style={[styles.infoVal, { color: "#16a34a" }]}>₱{result.cashback_credited.toFixed(2)}</Text>
                    </Text>
                  )}
                </View>

                {result.is_rebooked && (
                  <View style={styles.rebookedBox}>
                    <Text style={styles.rebookedTitle}>🔄 REBOOKED PASSENGER</Text>
                    <Text style={styles.infoRow}>
                      Original Fare: <Text style={styles.infoVal}>₱{(result.original_fare_amount ?? 0).toFixed(2)}</Text>
                    </Text>
                    <Text style={[styles.infoRow, { marginTop: 4 }]}>
                      Rebooking Fee Paid: <Text style={styles.infoVal}>₱{(result.rebooking_fee_amount ?? 0).toFixed(2)}</Text>
                    </Text>
                    <Text style={[styles.infoRow, { marginTop: 4 }]}>
                      Additional Fare Due: <Text style={styles.infoVal}>₱{(result.additional_fare_due ?? 0).toFixed(2)}</Text>
                    </Text>
                  </View>
                )}

                <TouchableOpacity style={styles.resultCloseBtn} onPress={handleCloseResult} activeOpacity={0.85}>
                  <Text style={styles.resultCloseBtnText}>Scan Next Ticket</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.resultIcon}>❌</Text>
                <Text style={styles.resultTitle}>Boarding Failed</Text>
                <Text style={styles.resultErrorMsg}>{result?.message ?? "Could not process QR."}</Text>
                <TouchableOpacity style={styles.resultCloseBtn} onPress={handleCloseResult} activeOpacity={0.85}>
                  <Text style={styles.resultCloseBtnText}>Try Again</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const FRAME = 240; const CORNER = 28; const THICKNESS = 4; const COLOR = "#4ade80";

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: "#f9fafb", padding: 24 },
  permText:    { fontSize: 14, color: "#374151", textAlign: "center" },
  permBtn:     { backgroundColor: "#1a4a52", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  permBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  overlay:      { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  topLabel:     { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", backgroundColor: "rgba(0,0,0,0.55)", paddingBottom: 18 },
  topLabelText: { fontSize: 17, fontWeight: "800", color: "#fff" },
  topLabelSub:  { fontSize: 12, color: "#d1d5db", marginTop: 4 },

  discountToggle: {
    position: "absolute", top: 110, alignSelf: "center", zIndex: 5,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)", borderWidth: 1.5, borderColor: "#fff",
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
  },
  discountToggleActive: { backgroundColor: "#a8d832", borderColor: "#a8d832" },
  discountToggleText: { fontSize: 12, fontWeight: "800", color: "#fff" },
  discountToggleTextActive: { color: "#1a4a52" },

  finderFrame: { width: FRAME, height: FRAME, alignItems: "center", justifyContent: "center" },
  corner:      { position: "absolute", width: CORNER, height: CORNER, borderColor: COLOR },
  cornerTL:    { top: 0, left: 0,     borderTopWidth: THICKNESS,    borderLeftWidth: THICKNESS,  borderTopLeftRadius: 6 },
  cornerTR:    { top: 0, right: 0,    borderTopWidth: THICKNESS,    borderRightWidth: THICKNESS, borderTopRightRadius: 6 },
  cornerBL:    { bottom: 0, left: 0,  borderBottomWidth: THICKNESS, borderLeftWidth: THICKNESS,  borderBottomLeftRadius: 6 },
  cornerBR:    { bottom: 0, right: 0, borderBottomWidth: THICKNESS, borderRightWidth: THICKNESS, borderBottomRightRadius: 6 },
  processingBox:  { alignItems: "center", gap: 8 },
  processingText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  bottomHint:     { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", gap: 14, backgroundColor: "rgba(0,0,0,0.55)", paddingTop: 20 },
  bottomHintText: { fontSize: 13, color: "#e5e7db" },
  cancelBtn:      { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingHorizontal: 28, paddingVertical: 10 },
  cancelBtnText:  { fontSize: 13, color: "#fff", fontWeight: "700" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "flex-end" },
  resultModal:  { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, width: "100%", alignItems: "center", gap: 14, paddingBottom: 44 },
  resultIcon:   { fontSize: 56 },
  resultTitle:  { fontSize: 22, fontWeight: "900", color: "#1a4a52", textAlign: "center" },
  resultSub:    { fontSize: 14, color: "#6b7280" },

  infoBox:  { backgroundColor: "#f9fafb", borderRadius: 12, padding: 14, width: "100%", borderWidth: 1, borderColor: "#e5e7eb" },
  infoRow:  { fontSize: 14, color: "#374151", fontWeight: "600" },
  infoVal:  { fontWeight: "800", color: "#1a4a52" },
  // Same purple used app-wide for the "Rebooked" display status
  // (DISPLAY_STATUS_COLOR.Rebooked, src/types/booking.ts).
  rebookedBox:   { backgroundColor: "#f5f3ff", borderRadius: 12, padding: 14, width: "100%", borderWidth: 1, borderColor: "#ddd6fe", marginTop: 10 },
  rebookedTitle: { fontSize: 13, fontWeight: "900", color: "#7c3aed", marginBottom: 8 },

  resultErrorMsg:    { fontSize: 14, color: "#dc2626", textAlign: "center", lineHeight: 20, paddingHorizontal: 12 },
  resultCloseBtn:    { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 56, marginTop: 4, width: "100%", alignItems: "center" },
  resultCloseBtnText:{ fontSize: 15, fontWeight: "800", color: "#fff" },
  declineBtn:        { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#dc2626", marginTop: 0 },
  cancelPromptBtn:    { paddingVertical: 8 },
  cancelPromptBtnText:{ fontSize: 13, color: "#9ca3af", fontWeight: "700" },
});
