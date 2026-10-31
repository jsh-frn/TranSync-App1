import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";

// Pushed from Profile → "Wallet History" — previously a dead
// `onPress={() => {}}` stub that navigated nowhere, which is why it always
// looked like "no records" no matter how many transactions the account
// actually had. The real data source (wallet/wallet.php, scoped by
// commuter_id from the logged-in session's own AsyncStorage "user" — never
// another account's id) was already correct; this screen is the missing
// destination. Requests a higher ?limit= than the Wallet tab's own 20-row
// preview so this dedicated history view shows a fuller list.

const HISTORY_LIMIT = 100;

type Transaction = {
  id:             number;
  type:           "debit" | "credit";
  amount:         number;
  reference_type: string;
  reference_id:   number | null;
  note:           string | null;
  balance_after:  number;
  status:         string;
  created_at:     string;
};

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr.replace(" ", "T"));
  if (isNaN(d.getTime())) return dateStr;
  const date = d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

function txIcon(tx: Transaction): { name: any; color: string; bg: string } {
  switch (tx.reference_type) {
    case "topup":            return { name: "add-circle",     color: "#16a34a", bg: "#f0fdf4" };
    case "jeepney_ride":     return { name: "bus",             color: "#2563eb", bg: "#eff6ff" };
    case "booking":          return { name: "ticket",          color: "#2563eb", bg: "#eff6ff" };
    case "refund":           return { name: "return-up-back",  color: "#d97706", bg: "#fffbeb" };
    case "rebooking_fee":    return { name: "swap-horizontal", color: "#7c3aed", bg: "#f5f3ff" };
    case "discount_surcharge": return { name: "remove-circle", color: "#dc2626", bg: "#fef2f2" };
    case "discount_cashback":  return { name: "cash",          color: "#16a34a", bg: "#f0fdf4" };
    default:                 return { name: "receipt",         color: "#6b7280", bg: "#f9fafb" };
  }
}

function txTypeLabel(tx: Transaction): string {
  if (tx.note) return tx.note;
  switch (tx.reference_type) {
    case "topup":              return "Wallet Top Up";
    case "jeepney_ride":       return "Jeepney Fare";
    case "booking":            return "Booking Payment";
    case "refund":              return "Refund";
    case "rebooking_fee":       return "Rebooking Fee";
    case "discount_surcharge":  return "Discount Surcharge";
    case "discount_cashback":   return "Discount Cashback";
    default:                   return "Transaction";
  }
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function WalletHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [commuterId,  setCommuterId]  = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [errorMsg,    setErrorMsg]    = useState("");

  const fetchHistory = useCallback(async (uid: number) => {
    setErrorMsg("");
    try {
      const res  = await fetch(`${API_BASE}/wallet/wallet.php?commuter_id=${uid}&limit=${HISTORY_LIMIT}`);
      const data = await res.json();
      if (data.success) {
        setTransactions(data.transactions ?? []);
      } else {
        setErrorMsg(data.message || "Could not load your wallet history.");
      }
    } catch (_) {
      setErrorMsg("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch every time this screen gains focus — so a top-up, refund, or
  // booking payment made elsewhere and then coming back here always shows
  // up without any extra event-plumbing between screens.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const raw = await AsyncStorage.getItem("user");
        if (!raw) { setLoading(false); setErrorMsg("Please log in again."); return; }
        const uid = JSON.parse(raw).id;
        setCommuterId(uid);
        fetchHistory(uid);
      })();
    }, [fetchHistory])
  );

  const onRefresh = () => {
    setRefreshing(true);
    if (commuterId) fetchHistory(commuterId);
    else setRefreshing(false);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Wallet History</Text>
        <TouchableOpacity
          style={s.refreshBtn}
          onPress={onRefresh}
          activeOpacity={0.7}
          accessibilityLabel="Refresh wallet history"
        >
          <Ionicons name="refresh" size={18} color="#1a4a52" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.centred}>
          <ActivityIndicator size="large" color="#1a4a52" />
          <Text style={s.centredMsg}>Loading your wallet history…</Text>
        </View>
      ) : errorMsg && transactions.length === 0 ? (
        <View style={s.centred}>
          <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          <Text style={s.errorTitle}>{errorMsg}</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => commuterId && fetchHistory(commuterId)}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={14} color="#fff" />
            <Text style={s.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : transactions.length === 0 ? (
        <View style={s.centred}>
          <Ionicons name="receipt-outline" size={48} color="#d1d5db" />
          <Text style={s.emptyTitle}>No wallet transactions yet</Text>
          <Text style={s.emptySub}>Top-ups, booking payments, refunds, and other wallet activity will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(tx) => String(tx.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a4a52" />}
          ListHeaderComponent={
            errorMsg ? (
              <View style={s.inlineErrorBanner}>
                <Ionicons name="warning-outline" size={14} color="#b45309" />
                <Text style={s.inlineErrorText}>{errorMsg} Showing your last loaded history.</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const icon = txIcon(item);
            return (
              <View style={s.card}>
                <View style={[s.txIcon, { backgroundColor: icon.bg }]}>
                  <Ionicons name={icon.name} size={18} color={icon.color} />
                </View>
                <View style={s.body}>
                  <View style={s.topRow}>
                    <Text style={s.txLabel} numberOfLines={1}>{txTypeLabel(item)}</Text>
                    <Text style={[s.txAmount, { color: item.type === "credit" ? "#16a34a" : "#374151" }]}>
                      {item.type === "credit" ? "+" : "-"}₱{item.amount.toFixed(2)}
                    </Text>
                  </View>
                  <Text style={s.metaTxt}>{formatDateTime(item.created_at)}</Text>
                  <View style={s.bottomRow}>
                    <Text style={s.refText}>Ref #{item.id}{item.reference_id ? ` · Linked #${item.reference_id}` : ""}</Text>
                    <View style={s.statusPill}>
                      <Text style={s.statusPillText}>{statusLabel(item.status)}</Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          }}
        />
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
  refreshBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },

  centred:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  centredMsg: { fontSize: 13, color: "#6b7280", fontWeight: "600" },
  errorTitle: { fontSize: 14, fontWeight: "700", color: "#dc2626", textAlign: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: "#374151" },
  emptySub:   { fontSize: 12, color: "#9ca3af", textAlign: "center", paddingHorizontal: 24 },

  retryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4,
    backgroundColor: "#1a4a52", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
  },
  retryBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  inlineErrorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a",
    borderRadius: 12, padding: 10, marginBottom: 12,
  },
  inlineErrorText: { flex: 1, fontSize: 11, color: "#92400e", fontWeight: "600" },

  card: {
    flexDirection: "row", gap: 12,
    backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: "#f1f5f9",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  txIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  body:   { flex: 1, gap: 3 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  txLabel:  { flex: 1, fontSize: 13, fontWeight: "700", color: "#374151" },
  txAmount: { fontSize: 14, fontWeight: "800" },
  metaTxt:  { fontSize: 11, color: "#9ca3af", fontWeight: "600" },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  refText: { fontSize: 10, color: "#9ca3af", flexShrink: 1 },
  statusPill: { backgroundColor: "#f0fdf4", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { fontSize: 10, fontWeight: "700", color: "#15803d" },
});
