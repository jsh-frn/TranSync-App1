import { useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useUser } from "../../src/context/UserContext";

// Read-only current-status summary — pushed from Profile → "Verification
// Status" (previously a dead stub). Deliberately no new fetch of its own:
// every field here already lives in UserContext (commuter/get_profile.php,
// refreshed on focus/poll elsewhere in the app — see Core Flow 2 point 7),
// so this screen is pure presentation over data that's already live.

const CATEGORY_LABEL: Record<string, string> = {
  default:  "Standard",
  student:  "Student",
  disabled: "PWD",
  elderly:  "Senior Citizen",
};

export default function VerificationStatusScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshUser } = useUser();

  useFocusEffect(useCallback(() => { refreshUser(); }, [refreshUser]));

  if (!user) return null;

  const isVerified   = user.is_verified == 1;
  const canSwitch     = !!user.can_switch_category;
  const rawCategory   = user.raw_category ?? user.category;
  const categoryLabel = CATEGORY_LABEL[rawCategory] ?? "Standard";
  const isRejected    = !!user.rejected_at;
  // Same fix as (main)/home.tsx and (main)/profile.tsx — category/raw_category
  // can't be used here: both stay 'default' for the entire time a genuine
  // Student/PWD/Senior submission is awaiting admin review, so a plain
  // Regular commuter and a genuinely-pending one read identically on that
  // field alone. has_pending_discount_verification is the real signal.
  const isPending     = !isVerified && !isRejected && !canSwitch && !!user.has_pending_discount_verification;

  const statusLabel = canSwitch ? "Expired" : isRejected ? "Rejected" : isVerified ? "Verified" : isPending ? "Pending" : "Standard";
  const statusColor = canSwitch ? "#dc2626" : isRejected ? "#dc2626" : isVerified ? "#16a34a" : isPending ? "#b45309" : "#6b7280";
  const statusIcon  = canSwitch || isRejected ? "close-circle" : isVerified ? "checkmark-circle" : isPending ? "time" : "information-circle";

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Verification Status</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View style={s.statusCard}>
          <View style={[s.statusIconWrap, { backgroundColor: statusColor + "18" }]}>
            <Ionicons name={statusIcon as any} size={32} color={statusColor} />
          </View>
          <Text style={[s.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
          <Text style={s.statusSub}>
            {canSwitch
              ? `Your ${categoryLabel} discount verification has expired.`
              : isRejected
              ? "Your last verification submission was rejected."
              : isVerified
              ? `You're a verified ${categoryLabel} commuter.`
              : isPending
              ? "Your verification is still awaiting admin review."
              : "You haven't applied for a discount category, so there's nothing to verify. Fares are charged at the standard rate."}
          </Text>
        </View>

        <View style={s.card}>
          <InfoRow icon="pricetag" label="Discount Category" value={`${categoryLabel}${canSwitch ? " (Expired)" : ""}`} />
          {user.discount_expires_at && (
            <InfoRow
              icon="calendar-outline"
              label="Discount Expiration Date"
              value={String(user.discount_expires_at).split(" ")[0]}
              valueColor={canSwitch ? "#dc2626" : undefined}
            />
          )}
          {isRejected && (
            <InfoRow
              icon="alert-circle-outline"
              label="Rejected On"
              value={String(user.rejected_at).split(" ")[0]}
              valueColor="#dc2626"
            />
          )}
          {isRejected && user.rejection_reason && (
            <InfoRow
              icon="chatbox-ellipses-outline"
              label="Reason"
              value={user.rejection_reason}
              valueColor="#dc2626"
            />
          )}
          <InfoRow icon="calendar" label="Member Since" value={user.created_at?.split(" ")[0] ?? "—"} last />
        </View>

        {isRejected && (
          <View style={s.noteCard}>
            <Ionicons name="information-circle-outline" size={16} color="#b45309" />
            <Text style={s.noteText}>
              You can resubmit your documents 24 hours after rejection. Check your Profile
              for a resubmission option once the cooldown has passed.
            </Text>
          </View>
        )}

        {canSwitch && (
          <View style={s.noteCard}>
            <Ionicons name="information-circle-outline" size={16} color="#b45309" />
            <Text style={s.noteText}>
              Renew your verification or switch to a different discount type from your
              Profile screen to restore your discount.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({
  icon, label, value, valueColor, last = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string; valueColor?: string; last?: boolean;
}) {
  return (
    <View style={[s.infoRow, !last && s.infoBorder]}>
      <View style={s.infoIconWrap}>
        <Ionicons name={icon} size={18} color="#1a4a52" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={[s.infoValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#f9fafb" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 3, height: 32, borderRadius: 16, paddingHorizontal: 10, backgroundColor: "#f1f5f9", justifyContent: "center" },
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

  card: {
    backgroundColor: "#fff", borderRadius: 16, marginBottom: 16,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    overflow: "hidden",
  },
  infoRow:    { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  infoBorder: { borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  infoIconWrap: { width: 28, alignItems: "center" },
  infoLabel:  { fontSize: 11, color: "#9ca3af", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  infoValue:  { fontSize: 14, fontWeight: "700", color: "#1a4a52", marginTop: 2 },

  noteCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a",
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  noteText: { flex: 1, fontSize: 12, color: "#92400e", lineHeight: 17 },
});
