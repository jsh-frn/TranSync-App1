import { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet,
  TouchableOpacity, TextInput, ActivityIndicator,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import API_BASE from "../../../src/config/api";
import { authFetch } from "../../../src/config/session";
import KeyboardAwareForm from "../../../src/components/common/KeyboardAwareForm";

const TOP_UP_AMOUNTS = [100, 200, 500, 1000];

type Transaction = {
  type:           "debit" | "credit";
  amount:         number;
  reference_type: "jeepney_ride" | "topup" | "booking" | "refund";
  note:           string;
  balance_after:  number;
  created_at:     string;
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function txIcon(tx: Transaction): { name: any; color: string; bg: string } {
  if (tx.reference_type === "topup")       return { name: "add-circle",     color: "#16a34a", bg: "#f0fdf4" };
  if (tx.reference_type === "jeepney_ride")return { name: "bus",            color: "#2563eb", bg: "#eff6ff" };
  if (tx.reference_type === "refund")      return { name: "return-up-back", color: "#d97706", bg: "#fffbeb" };
  return { name: "receipt",                                                  color: "#6b7280", bg: "#f9fafb" };
}

function txLabel(tx: Transaction): string {
  if (tx.note)                             return tx.note;
  if (tx.reference_type === "topup")       return "Wallet Top Up";
  if (tx.reference_type === "jeepney_ride")return "Jeepney Fare";
  if (tx.reference_type === "refund")      return "Refund";
  return "Transaction";
}

export default function WalletScreen() {
  const insets = useSafeAreaInsets();

  const [user,          setUser]          = useState<any>(null);
  const [balance,       setBalance]       = useState<number>(0);
  const [transactions,  setTransactions]  = useState<Transaction[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [selected,      setSelected]      = useState<number | null>(null);
  const [custom,        setCustom]        = useState("");
  const [processing,    setProcessing]    = useState(false);
  const [verifying,     setVerifying]     = useState(false);
  const [successMsg,    setSuccessMsg]    = useState("");
  const [errorMsg,      setErrorMsg]      = useState("");
  const [pendingSource, setPendingSource] = useState<{ id: string; amount: number } | null>(null);

  const fetchWallet = useCallback(async (uid: number) => {
    try {
      const res  = await fetch(`${API_BASE}/wallet/wallet.php?commuter_id=${uid}`);
      const data = await res.json();
      if (data.success) {
        setBalance(data.balance ?? 0);
        setTransactions(data.transactions ?? []);
      }
    } catch (_) {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) return;
      const u = JSON.parse(raw);
      setUser(u);
      fetchWallet(u.id);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user) fetchWallet(user.id);
    }, [user])
  );

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(""), 5000);
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const verifyPayment = useCallback(async (source_id: string) => {
    setVerifying(true);
    try {
      const res  = await authFetch(`${API_BASE}/wallet/verify_payment.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ commuter_id: user.id, source_id }),
      });
      const data = await res.json();

      if (data.success) {
        setBalance(data.new_balance);
        showSuccess(`₱${(data.amount as number).toFixed(2)} added via GCash (Demo)!`);
        setSelected(null);
        setCustom("");
        setPendingSource(null);
        fetchWallet(user.id);
      } else {
        showError(data.message || "Payment verification failed.");
      }
    } catch (_) {
      showError("Verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  }, [user, fetchWallet]);

  const handlePayment = async (method: "gcash") => {
    const amount = selected ?? (custom ? parseFloat(custom) : 0);
    if (!amount || amount <= 0) {
      showError("Please enter an amount.");
      return;
    }

    setProcessing(true);
    setErrorMsg("");

    try {
      const res  = await authFetch(`${API_BASE}/wallet/create_source.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ commuter_id: user.id, amount, method }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showError(data.message || "Could not start payment. Please try again.");
        return;
      }

      setPendingSource({ id: data.source_id, amount });
      setProcessing(false);

      // Open PayMongo checkout — waits for redirect back to transyncmobile://
      await WebBrowser.openAuthSessionAsync(data.checkout_url, "transyncmobile://");

      // Browser closed (paid, cancelled, or dismissed) — always try to verify
      await verifyPayment(data.source_id);
    } catch (_) {
      showError("Network error. Please check your connection.");
    } finally {
      setProcessing(false);
    }
  };

  const retryVerify = () => {
    if (pendingSource) verifyPayment(pendingSource.id);
  };

  if (loading) return (
    <View style={styles.loadingWrap}>
      <ActivityIndicator color="#1a4a52" size="large" />
    </View>
  );

  const topUpAmount = selected ?? (custom ? parseFloat(custom) : 0);
  const amountValid = topUpAmount > 0;
  const busy        = processing || verifying;

  return (
    <KeyboardAwareForm
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); if (user) fetchWallet(user.id); }}
          tintColor="#1a4a52"
        />
      }
    >
      {/* SUCCESS TOAST */}
      {successMsg !== "" && (
        <View style={styles.toastSuccess}>
          <Ionicons name="checkmark-circle" size={16} color="#15803d" />
          <Text style={styles.toastSuccessText}>{successMsg}</Text>
        </View>
      )}

      {/* ERROR TOAST */}
      {errorMsg !== "" && (
        <View style={styles.toastError}>
          <Ionicons name="alert-circle" size={16} color="#dc2626" />
          <Text style={styles.toastErrorText}>{errorMsg}</Text>
        </View>
      )}

      {/* HEADER */}
      <View style={styles.pageTitleRow}>
        <Ionicons name="wallet" size={24} color="#1a4a52" />
        <Text style={styles.pageTitle}>My Wallet</Text>
      </View>

      {/* BALANCE CARD */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Available Balance</Text>
        <Text style={styles.balanceAmount}>₱{Number(balance).toFixed(2)}</Text>
        <View style={styles.balanceRow}>
          <Ionicons name="shield-checkmark" size={12} color="rgba(255,255,255,0.5)" />
          <Text style={styles.balanceFooter}>TranSync e-Wallet · {user?.name}</Text>
        </View>
        <View style={styles.balanceCircle1} />
        <View style={styles.balanceCircle2} />
      </View>

      {/* TOP UP SECTION */}
      <Text style={styles.sectionTitle}>Top Up</Text>
      <View style={styles.amountsGrid}>
        {TOP_UP_AMOUNTS.map((a) => (
          <TouchableOpacity
            key={a}
            style={[styles.amountBtn, selected === a && styles.amountBtnActive]}
            onPress={() => { setSelected(a); setCustom(""); }}
            activeOpacity={0.8}
          >
            <Text style={[styles.amountText, selected === a && styles.amountTextActive]}>₱{a}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.customWrap}>
        <Text style={styles.customPrefix}>₱</Text>
        <TextInput
          style={styles.customInput}
          placeholder="Custom amount"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
          value={custom}
          onChangeText={(v) => { setCustom(v); setSelected(null); }}
        />
      </View>

      {/* PAYMENT METHOD BUTTONS */}
      <Text style={[styles.sectionTitle, { marginTop: 4, marginBottom: 2 }]}>Pay via</Text>
      <Text style={styles.demoNote}>
        Demo payment methods — sandbox transactions for testing, not real charges.
      </Text>
      <View style={styles.methodRow}>
        <TouchableOpacity
          style={[styles.methodBtn, styles.methodGcash, (!amountValid || busy) && styles.methodBtnDisabled]}
          onPress={() => handlePayment("gcash")}
          disabled={!amountValid || busy}
          activeOpacity={0.8}
        >
          {processing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <View style={styles.methodBadge}>
                <Text style={styles.methodBadgeText}>G</Text>
              </View>
              <Text style={styles.methodBtnText}>
                {verifying ? "Verifying…" : topUpAmount >= 100 ? `GCash (Demo)  ₱${topUpAmount}` : "GCash (Demo)"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>


      {/* RETRY VERIFICATION (shown if browser closed without confirmation) */}
      {pendingSource && !verifying && errorMsg !== "" && (
        <TouchableOpacity style={styles.retryBtn} onPress={retryVerify} activeOpacity={0.8}>
          <Ionicons name="refresh" size={14} color="#1a4a52" />
          <Text style={styles.retryText}>Retry verification</Text>
        </TouchableOpacity>
      )}

      {verifying && (
        <View style={styles.verifyingRow}>
          <ActivityIndicator size="small" color="#1a4a52" />
          <Text style={styles.verifyingText}>Verifying payment…</Text>
        </View>
      )}

      {/* TRANSACTIONS */}
      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Recent Transactions</Text>

      {transactions.length === 0 ? (
        <View style={styles.emptyTx}>
          <Ionicons name="receipt-outline" size={36} color="#d1d5db" />
          <Text style={styles.emptyTxText}>No transactions yet</Text>
          <Text style={styles.emptyTxSub}>Your ride and top up history will appear here</Text>
        </View>
      ) : (
        <View style={styles.txList}>
          {transactions.map((tx, i) => {
            const icon = txIcon(tx);
            return (
              <View
                key={i}
                style={[styles.txRow, i === transactions.length - 1 && { borderBottomWidth: 0 }]}
              >
                <View style={[styles.txIcon, { backgroundColor: icon.bg }]}>
                  <Ionicons name={icon.name} size={18} color={icon.color} />
                </View>
                <View style={styles.txInfo}>
                  <Text style={styles.txLabel}>{txLabel(tx)}</Text>
                  <Text style={styles.txDate}>{formatDate(tx.created_at)}</Text>
                </View>
                <View style={styles.txRight}>
                  <Text style={[
                    styles.txAmount,
                    { color: tx.type === "credit" ? "#16a34a" : "#374151" },
                  ]}>
                    {tx.type === "credit" ? "+" : "-"}₱{tx.amount.toFixed(2)}
                  </Text>
                  <Text style={styles.txBalance}>₱{tx.balance_after.toFixed(2)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ height: 32 }} />
    </KeyboardAwareForm>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f9fafb" },
  content:     { paddingHorizontal: 20 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  toastSuccess: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#f0fdf4", borderRadius: 12, padding: 12,
    marginBottom: 16, borderWidth: 1, borderColor: "#bbf7d0",
  },
  toastSuccessText: { fontSize: 13, fontWeight: "700", color: "#15803d", flex: 1 },

  toastError: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fef2f2", borderRadius: 12, padding: 12,
    marginBottom: 16, borderWidth: 1, borderColor: "#fecaca",
  },
  toastErrorText: { fontSize: 13, fontWeight: "700", color: "#dc2626", flex: 1 },

  pageTitleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 },
  pageTitle:    { fontSize: 22, fontWeight: "900", color: "#1a4a52" },

  balanceCard: {
    backgroundColor: "#1a4a52", borderRadius: 20, padding: 24,
    marginBottom: 28, overflow: "hidden",
    shadowColor: "#1a4a52", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35, shadowRadius: 16, elevation: 10,
  },
  balanceLabel:   { fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: "600", marginBottom: 6 },
  balanceAmount:  { fontSize: 44, fontWeight: "900", color: "#fff", letterSpacing: -1, marginBottom: 12 },
  balanceRow:     { flexDirection: "row", alignItems: "center", gap: 5 },
  balanceFooter:  { fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: "600" },
  balanceCircle1: { position: "absolute", width: 140, height: 140, borderRadius: 70, backgroundColor: "rgba(255,255,255,0.04)", top: -40, right: -30 },
  balanceCircle2: { position: "absolute", width: 90,  height: 90,  borderRadius: 45, backgroundColor: "rgba(168,216,50,0.08)", bottom: -20, right: 60 },

  sectionTitle: { fontSize: 15, fontWeight: "800", color: "#1a4a52", marginBottom: 12 },
  demoNote:     { fontSize: 11, color: "#9ca3af", marginBottom: 10 },

  amountsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  amountBtn: {
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  amountBtnActive:  { backgroundColor: "#1a4a52", borderColor: "#1a4a52" },
  amountText:       { fontSize: 14, fontWeight: "700", color: "#374151" },
  amountTextActive: { color: "#fff" },

  customWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    backgroundColor: "#fff", paddingHorizontal: 14, marginBottom: 16,
  },
  customPrefix: { fontSize: 16, fontWeight: "700", color: "#374151", marginRight: 6 },
  customInput:  { flex: 1, fontSize: 15, color: "#111827", paddingVertical: 13 },

  methodRow: { flexDirection: "row", gap: 12, marginBottom: 8 },

  methodBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 14, borderRadius: 14,
    shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  methodGcash:       { backgroundColor: "#0071bc" },
  methodBtnDisabled: { opacity: 0.45 },

  methodBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  methodBadgeText: { fontSize: 13, fontWeight: "900", color: "#fff" },
  methodBtnText:   { fontSize: 14, fontWeight: "800", color: "#fff" },

  minWarn: { fontSize: 12, color: "#dc2626", marginBottom: 8, textAlign: "center" },

  retryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 10, marginTop: 4,
    borderWidth: 1.5, borderColor: "#1a4a52", borderRadius: 10,
  },
  retryText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },

  verifyingRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", paddingVertical: 10 },
  verifyingText: { fontSize: 13, color: "#6b7280", fontWeight: "600" },

  emptyTx:     { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyTxText: { fontSize: 15, fontWeight: "700", color: "#374151" },
  emptyTxSub:  { fontSize: 12, color: "#9ca3af", textAlign: "center" },

  txList: {
    backgroundColor: "#fff", borderRadius: 16, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  txRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#f8fafc",
  },
  txIcon:    { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  txInfo:    { flex: 1 },
  txLabel:   { fontSize: 13, fontWeight: "700", color: "#374151" },
  txDate:    { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  txRight:   { alignItems: "flex-end", gap: 2 },
  txAmount:  { fontSize: 14, fontWeight: "800" },
  txBalance: { fontSize: 10, color: "#9ca3af", fontWeight: "600" },
});
