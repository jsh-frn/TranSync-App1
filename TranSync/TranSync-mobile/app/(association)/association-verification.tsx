import { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";

// Pushed from Profile → "Association Verification". Read-only, backed
// entirely by the association's own `status` column (pending|active|
// inactive, admin-approved via auth/verify.php) — this app has no separate
// "representative account verification" concept the way commuters/
// operators have both a status AND an is_verified column; an association's
// login credential IS the account, with no separate rep sub-identity to
// verify independently. Showing only what actually exists here, rather
// than fabricating a second status the schema doesn't have.

type Assoc = { id: number; name: string; status: string };

const STATUS_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; bg: string; body: string }> = {
  active: {
    label: "Active", icon: "checkmark-circle", color: "#16a34a", bg: "#f0fdf4",
    body: "Your association has been verified and approved by the TranSync administrator. All features are fully available.",
  },
  pending: {
    label: "Pending Review", icon: "time", color: "#b45309", bg: "#fffbeb",
    body: "Your association's registration is awaiting admin review. Some features may be limited until it's approved.",
  },
  inactive: {
    label: "Inactive", icon: "close-circle", color: "#dc2626", bg: "#fef2f2",
    body: "Your association is currently inactive. Contact the TranSync administrator for more information.",
  },
};

export default function AssociationVerificationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [assoc, setAssoc] = useState<Assoc | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem("user");
    const current: Assoc | null = raw ? JSON.parse(raw) : null;
    if (current) setAssoc(current);
    setLoading(false);
    if (!current?.id) return;
    try {
      const res  = await fetch(`${API_BASE}/associations/get_profile.php?association_id=${current.id}`);
      const data = await res.json();
      if (data?.success && data.association) setAssoc((prev) => ({ ...(prev as Assoc), ...data.association }));
    } catch {
      // Cached value stays shown.
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !assoc) {
    return (
      <View style={[s.root, s.centered]}>
        <ActivityIndicator color="#1a4a52" size="large" />
      </View>
    );
  }

  const meta = STATUS_META[assoc.status] ?? STATUS_META.pending;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Association Verification</Text>
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
            This status is set by the TranSync administrator and can't be changed from the app.
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
