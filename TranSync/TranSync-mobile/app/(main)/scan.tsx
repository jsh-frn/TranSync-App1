import { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Modal, Vibration,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import API_BASE from "../../src/config/api";

type ScanResult = {
  success:          boolean;
  ride_id?:         number;
  driver_name?:     string;
  commuter_name?:   string;
  category?:        string;
  is_verified?:     number;
  wallet_balance?:  number;
  insufficient?:    boolean;
  current_balance?: number;
  minimum_required?:number;
  message?:         string;
};

export default function Scan() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();

  const [commuterId,   setCommuterId]   = useState<number | null>(null);
  const [scanning,     setScanning]     = useState(true);
  const [processing,   setProcessing]   = useState(false);
  const [result,       setResult]       = useState<ScanResult | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const lastScanRef = useRef<string>("");

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (raw) setCommuterId(JSON.parse(raw).id);
    })();
    if (!permission?.granted) requestPermission();
  }, []);

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (!scanning || processing || data === lastScanRef.current) return;
    if (!data.startsWith("DRIVER_")) return;

    lastScanRef.current = data;
    setScanning(false);
    setProcessing(true);
    Vibration.vibrate(120);

    // Get current location for boarding point
    let board_lat = 0, board_lng = 0;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      board_lat = loc.coords.latitude;
      board_lng = loc.coords.longitude;
    } catch (_) {}

    try {
      const res = await fetch(`${API_BASE}/system/verify_qr_board.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commuter_id: commuterId,
          qr_data:     data,
          board_lat,
          board_lng,
        }),
      });
      const json: ScanResult = await res.json();
      setResult(json);
      setModalVisible(true);
    } catch (_) {
      setResult({ success: false, message: "Network error. Please try again." });
      setModalVisible(true);
    } finally {
      setProcessing(false);
    }
  };

  const handleCloseResult = () => {
    setModalVisible(false);

    if (result?.success && result.ride_id) {
      // Navigate to active trip screen
      router.replace({
        pathname: "/(main)/active-trip",
        params: {
          ride_id:     result.ride_id,
          driver_name: result.driver_name ?? "",
        },
      });
    } else if (result?.insufficient) {
      // Go to wallet to top up
      router.replace("/(main)/wallet");
    } else {
      // Reset for retry
      setResult(null);
      lastScanRef.current = "";
      setTimeout(() => setScanning(true), 800);
    }
  };

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator color="#1a4a52" size="large" /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>📷 Camera access is required to scan QR codes.</Text>
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
          <Text style={styles.topLabelText}>📷 Scan Driver QR to Board</Text>
          <Text style={styles.topLabelSub}>Point your camera at the driver's QR code</Text>
        </View>

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
            {processing ? "Processing…" : scanning ? "Align the driver's QR inside the frame" : "Preparing…"}
          </Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Result Modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={handleCloseResult}>
        <View style={styles.modalOverlay}>
          <View style={styles.resultModal}>

            {/* Insufficient balance */}
            {result?.insufficient ? (
              <>
                <Text style={styles.resultIcon}>💳</Text>
                <Text style={styles.resultTitle}>Insufficient Balance</Text>
                <Text style={styles.resultErrorMsg}>{result.message}</Text>
                <View style={styles.balanceBox}>
                  <Text style={styles.balanceRow}>
                    Current balance: <Text style={styles.balanceVal}>₱{result.current_balance?.toFixed(2)}</Text>
                  </Text>
                  <Text style={styles.balanceRow}>
                    Minimum needed: <Text style={styles.balanceVal}>₱{result.minimum_required?.toFixed(2)}</Text>
                  </Text>
                </View>
                <TouchableOpacity style={styles.topUpBtn} onPress={handleCloseResult} activeOpacity={0.85}>
                  <Text style={styles.topUpBtnText}>💰 Go to Wallet</Text>
                </TouchableOpacity>
              </>

            ) : result?.success ? (
              <>
                <Text style={styles.resultIcon}>✅</Text>
                <Text style={styles.resultTitle}>Boarded!</Text>
                <Text style={styles.resultSub}>Your fare meter has started</Text>

                {result.driver_name && (
                  <View style={styles.infoBox}>
                    <Text style={styles.infoRow}>🚌  <Text style={styles.infoVal}>{result.driver_name}</Text></Text>
                    <Text style={[styles.infoRow, { marginTop: 6 }]}>
                      💳  Wallet: <Text style={styles.infoVal}>₱{result.wallet_balance?.toFixed(2)}</Text>
                    </Text>
                  </View>
                )}

                {result.category && result.category !== "default" && (
                  <View style={[
                    styles.verifyBadge,
                    result.is_verified === 1
                      ? { backgroundColor: "#f0fdf4", borderColor: "#86efac" }
                      : { backgroundColor: "#fff7ed", borderColor: "#fed7aa" },
                  ]}>
                    <Text style={[
                      styles.verifyBadgeText,
                      { color: result.is_verified === 1 ? "#15803d" : "#c2410c" },
                    ]}>
                      {result.is_verified === 1
                        ? `✅ ${result.category} discount will apply`
                        : `⚠️ Unverified ${result.category} — no discount`}
                    </Text>
                  </View>
                )}

                <View style={styles.meterNotice}>
                  <Text style={styles.meterNoticeText}>
                    🔴 Fare meter is running. Tap "Drop Off" when you arrive.
                  </Text>
                </View>

                <TouchableOpacity style={styles.resultCloseBtn} onPress={handleCloseResult} activeOpacity={0.85}>
                  <Text style={styles.resultCloseBtnText}>View Trip →</Text>
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
  resultTitle:  { fontSize: 22, fontWeight: "900", color: "#1a4a52" },
  resultSub:    { fontSize: 14, color: "#6b7280" },

  infoBox:  { backgroundColor: "#f9fafb", borderRadius: 12, padding: 14, width: "100%", borderWidth: 1, borderColor: "#e5e7eb" },
  infoRow:  { fontSize: 14, color: "#374151", fontWeight: "600" },
  infoVal:  { fontWeight: "800", color: "#1a4a52" },

  verifyBadge:    { borderRadius: 10, padding: 10, borderWidth: 1, width: "100%", alignItems: "center" },
  verifyBadgeText:{ fontSize: 12, fontWeight: "700", textAlign: "center" },

  meterNotice:     { backgroundColor: "#fef2f2", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#fecaca", width: "100%" },
  meterNoticeText: { fontSize: 13, color: "#dc2626", fontWeight: "600", textAlign: "center" },

  balanceBox:  { backgroundColor: "#fef2f2", borderRadius: 12, padding: 14, width: "100%", borderWidth: 1, borderColor: "#fecaca", gap: 6 },
  balanceRow:  { fontSize: 13, color: "#374151", fontWeight: "600" },
  balanceVal:  { fontWeight: "800", color: "#dc2626" },

  topUpBtn:     { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 56, width: "100%", alignItems: "center" },
  topUpBtnText: { fontSize: 15, fontWeight: "800", color: "#fff" },

  resultErrorMsg:    { fontSize: 14, color: "#dc2626", textAlign: "center", lineHeight: 20, paddingHorizontal: 12 },
  resultCloseBtn:    { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 56, marginTop: 4, width: "100%", alignItems: "center" },
  resultCloseBtnText:{ fontSize: 15, fontWeight: "800", color: "#fff" },
});