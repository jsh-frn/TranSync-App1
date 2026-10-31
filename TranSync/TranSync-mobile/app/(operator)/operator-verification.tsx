import { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";

// Pushed from Profile → the verification badge card. Read-only, backed by
// the operator's own admin-reviewed account fields (is_verified/status/
// rejected_at — operators.registration_document_url is what the admin
// actually reviews, see Core Flow 8). Deliberately separate from Association
// Approval (per vehicle type, shown on Profile's own "My Associations"
// section) — being verified as an operator does NOT auto-approve any
// association membership, and this page says so explicitly rather than
// leaving the distinction implicit.

type Op = { id: number; name: string; is_verified: number; status: string; rejected_at: string | null };

export default function OperatorVerificationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [op, setOp] = useState<Op | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem("user");
    const current: Op | null = raw ? JSON.parse(raw) : null;
    if (current) setOp(current);
    setLoading(false);
    if (!current?.id) return;
    try {
      const res  = await fetch(`${API_BASE}/operators/get_profile.php?operator_id=${current.id}`);
      const data = await res.json();
      if (data?.success && data.operator) setOp((prev) => ({ ...(prev as Op), ...data.operator }));
    } catch {
      // Cached value stays shown.
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !op) {
    return (
      <View style={[s.root, s.centered]}>
        <ActivityIndicator color="#1a4a52" size="large" />
      </View>
    );
  }

  const isVerified = op.is_verified == 1;
  const isRejected = op.status === "inactive";

  const meta = isVerified
    ? { label: "Account Verified", icon: "checkmark-circle" as const, color: "#15803d", bg: "#f0fdf4", body: "Admin has verified your operator account. All operator features are available, subject to your own per-association approvals." }
    : isRejected
    ? { label: "Verification Rejected", icon: "close-circle" as const, color: "#991b1b", bg: "#fef2f2", body: "Your operator account was not accepted. Contact support for more information." }
    : { label: "Verification Pending", icon: "time" as const, color: "#92400e", bg: "#fffbeb", body: "Admin is reviewing your operator account and submitted registration document." };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Operator Verification</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={s.statusCard}>
          <View style={[s.statusIconWrap, { backgroundColor: meta.bg }]}>
            <Ionicons name={meta.icon} size={32} color={meta.color} />
          </View>
          <Text style={[s.statusLabel, { color: meta.color }]}>{meta.label}</Text>
          <Text style={s.statusSub}>{meta.body}</Text>
        </View>

        <View style={s.noteCard}>
          <Ionicons name="information-circle-outline" size={16} color="#6b7280" />
          <Text style={s.noteText}>
            This is your operator account verification, set by the TranSync administrator. It's
            separate from your association memberships — see "My Associations" on your Profile
            for each association's own per-vehicle-type approval status.
          </Text>
        </View>
      </ScrollView>
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

  statusCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 24, marginBottom: 16,
    alignItems: "center", gap: 8,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  statusIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statusLabel: { fontSize: 20, fontWeight: "900" },
  statusSub:   { fontSize: 13, color: "#6b7280", textAlign: "center", lineHeight: 18 },

  noteCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#f1f5f9",
    borderRadius: 12, padding: 12,
  },
  noteText: { flex: 1, fontSize: 12, color: "#6b7280", lineHeight: 17 },
});
