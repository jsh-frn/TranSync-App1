import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Modal, Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useUser } from "../../../src/context/UserContext";
import API_BASE, { FILE_BASE } from "../../../src/config/api";
import AvatarPicker, { buildAvatarFormData } from "../../../src/components/common/AvatarPicker";
import { maskEmail, maskPhone } from "../../../src/utils/maskContact";
import { confirmRemoveExpiredDiscount } from "../../../src/utils/removeExpiredDiscount";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

const CATEGORY_LABEL: Record<string, string> = {
  default:  "Standard",
  student:  "Student",
  disabled: "PWD",
  elderly:  "Senior Citizen",
};

// Every option other than the commuter's own current raw_category — offered
// in the "Change Discount Type" picker, only ever shown once can_switch_category
// is true (see get_profile.php's server-computed gate).
const SWITCH_TARGETS: { value: "default" | "disabled" | "elderly"; label: string }[] = [
  { value: "default",  label: "Standard (no discount)" },
  { value: "disabled", label: "PWD" },
  { value: "elderly",  label: "Senior Citizen" },
];

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useUser();
  const [showSwitchPicker, setShowSwitchPicker] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // Email and phone are hidden until the commuter taps the eye — a profile is
  // often opened with other people nearby.
  const [showEmail, setShowEmail] = useState(false);
  const [showPhone, setShowPhone] = useState(false);

  // Refetch whenever this tab regains focus, so an admin verifying/
  // rejecting this commuter mid-session is reflected here without a
  // re-login (same UserContext everything else reads — see home.tsx).
  useFocusEffect(useCallback(() => { refreshUser(); }, [refreshUser]));

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(["user", "role"]);
    router.replace("/(auth)/login");
  };

  const handleAvatarChange = async (localUri: string | null) => {
    if (!user) return;
    setUploadingAvatar(true);
    try {
      const fd  = buildAvatarFormData("commuter_id", user.id, localUri);
      const res = await fetch(`${API_BASE}/commuter/update_avatar.php`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        await refreshUser();
      } else {
        Alert.alert("Error", data.message || "Failed to update photo.");
      }
    } catch {
      Alert.alert("Connection error", "Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (!user) return (
    <View style={styles.loadingWrap}>
      <ActivityIndicator color="#1a4a52" size="large" />
    </View>
  );

  const isVerified  = user?.is_verified == 1;
  const isRejected   = user?.status === "inactive" && !!user?.rejected_at;
  const canSwitch    = !!user?.can_switch_category;
  const initials      = user?.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?";
  const rawCategory   = user?.raw_category ?? user?.category;
  const categoryLabel = CATEGORY_LABEL[rawCategory] ?? "Standard";
  // A "default" (no discount) commuter never has anything pending — see the
  // identical note in (main)/home.tsx's isPending. `category`/`raw_category`
  // can no longer be used here: both stay 'default' for the entire time a
  // genuine Student/PWD/Senior submission is awaiting admin review (see
  // commuter_register_student.php et al.), so a plain Regular commuter and a
  // genuinely-pending one read identically on that field alone.
  // has_pending_discount_verification (from commuter/get_profile.php) is the
  // real, category-independent signal.
  const isPending    = !isVerified && !isRejected && !canSwitch && !!user?.has_pending_discount_verification;

  const statusLabel = canSwitch ? "Expired" : isRejected ? "Rejected" : isVerified ? "Verified" : isPending ? "Pending" : "Standard";
  const statusColor = canSwitch ? "#dc2626" : isRejected ? "#dc2626" : isVerified ? "#16a34a" : isPending ? "#b45309" : "#6b7280";

  const handleSwitchToDefault = () => {
    setShowSwitchPicker(false);
    Alert.alert(
      "Switch to Standard?",
      "You'll no longer receive a discount on fares. This takes effect immediately and needs no document or admin review.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Switch",
          style: "destructive",
          onPress: async () => {
            setSwitching(true);
            try {
              const fd = new FormData();
              fd.append("commuter_id", String(user.id));
              fd.append("target_category", "default");
              const res = await fetch(`${API_BASE}/auth/commuter_switch_category.php`, { method: "POST", body: fd });
              const data = await res.json();
              if (!data.success) {
                Alert.alert("Couldn't switch", data.message || "Please try again.");
                return;
              }
              await refreshUser();
              Alert.alert("Done", data.message || "You've switched to Standard.");
            } catch {
              Alert.alert("Connection error", "Cannot connect to server. Make sure XAMPP is running.");
            } finally {
              setSwitching(false);
            }
          },
        },
      ]
    );
  };

  const handlePickTarget = (target: "default" | "disabled" | "elderly") => {
    if (target === "default") {
      handleSwitchToDefault();
      return;
    }
    setShowSwitchPicker(false);
    router.push({ pathname: "/(main)/category-switch", params: { target } });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* AVATAR */}
      <View style={styles.avatarWrap}>
        <AvatarPicker
          uri={user?.avatar_url ? FILE_BASE + user.avatar_url : null}
          fallbackText={initials}
          size={80}
          uploading={uploadingAvatar}
          onChange={handleAvatarChange}
        />
        <View style={[styles.verifiedBadge, { backgroundColor: isVerified ? "#f0fdf4" : isRejected ? "#fef2f2" : isPending ? "#fffbeb" : "#f3f4f6", marginTop: 10 }]}>
          <Ionicons
            name={isVerified ? "checkmark-circle" : isRejected ? "close-circle" : isPending ? "time" : "information-circle"}
            size={13}
            color={isVerified ? "#16a34a" : isRejected ? "#dc2626" : isPending ? "#b45309" : "#6b7280"}
          />
          <Text style={[styles.verifiedText, { color: isVerified ? "#16a34a" : isRejected ? "#dc2626" : isPending ? "#b45309" : "#6b7280" }]}>
            {isVerified ? "Verified" : isRejected ? "Rejected" : isPending ? "Pending Verification" : "Standard Account"}
          </Text>
        </View>
      </View>

      <Text style={styles.userName}>{user?.name}</Text>
      <View style={styles.emailRow}>
        <Text style={styles.userEmailText} numberOfLines={1}>{showEmail ? (user?.email ?? "—") : maskEmail(user?.email)}</Text>
        {!!user?.email && (
          <TouchableOpacity
            onPress={() => setShowEmail((v) => !v)}
            style={styles.eyeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={showEmail ? "Hide email" : "Show email"}
          >
            <Ionicons name={showEmail ? "eye-off-outline" : "eye-outline"} size={18} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>

      {/* INFO CARD */}
      <View style={styles.card}>
        <InfoRow
          label="Phone"
          value={showPhone ? (user?.phone ?? "—") : maskPhone(user?.phone)}
          icon="call"
          revealed={showPhone}
          onToggleReveal={user?.phone ? () => setShowPhone((v) => !v) : undefined}
        />
        <InfoRow label="Category"     value={`${categoryLabel}${canSwitch ? " (Expired)" : ""}`}                    icon="pricetag"       />
        <InfoRow label="Status"       value={statusLabel} valueColor={statusColor}                                  icon="shield-checkmark" />
        {user?.discount_expires_at && (
          <InfoRow
            label="Discount Expiration Date"
            value={String(user.discount_expires_at).split(" ")[0]}
            valueColor={canSwitch ? "#dc2626" : undefined}
            icon="calendar-outline"
          />
        )}
        <InfoRow label="Member Since" value={user?.created_at?.split(" ")[0] ?? "—"} icon="calendar" last />
      </View>

      {/* EXPIRED DISCOUNT ACTIONS */}
      {canSwitch && (
        <View style={styles.expiredCard}>
          <View style={styles.expiredTop}>
            <Ionicons name="refresh-circle" size={22} color="#b45309" />
            <Text style={styles.expiredText}>
              Your {categoryLabel} discount has expired. Renew it, or switch to a different discount type.
            </Text>
          </View>
          <View style={styles.expiredActions}>
            <TouchableOpacity
              style={[styles.expiredBtn, styles.expiredBtnPrimary]}
              onPress={() => router.push({
                // rawCategory determines which auto-verification wizard this
                // commuter's discount actually belongs to — Student's own
                // expiry uses student-verification.tsx, PWD's own uses
                // pwd-verification.tsx (see Core Flow 2a). Senior Citizen
                // never expires today, so it never reaches this button.
                pathname: rawCategory === "disabled" ? "/(auth)/pwd-verification" : "/(auth)/student-verification",
                params: { mode: "renew" },
              })}
              activeOpacity={0.85}
            >
              <Ionicons name="camera" size={15} color="#fff" />
              <Text style={styles.expiredBtnPrimaryText}>Renew Verification</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.expiredBtn, styles.expiredBtnSecondary]}
              onPress={() => setShowSwitchPicker(true)}
              activeOpacity={0.85}
              disabled={switching}
            >
              {switching ? (
                <ActivityIndicator size="small" color="#1a4a52" />
              ) : (
                <>
                  <Ionicons name="swap-horizontal" size={15} color="#1a4a52" />
                  <Text style={styles.expiredBtnSecondaryText}>Change Discount Type</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          {/* Can't or won't renew: drop the expired discount so this reminder
              goes away. Always asks for confirmation first. */}
          <TouchableOpacity
            style={styles.expiredRemoveBtn}
            onPress={() => confirmRemoveExpiredDiscount({
              commuterId: user.id,
              categoryLabel,
              onStart: () => setSwitching(true),
              onFinish: () => setSwitching(false),
              onRemoved: refreshUser,
            })}
            disabled={switching}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={15} color="#b91c1c" />
            <Text style={styles.expiredRemoveText}>Remove Discount</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* NEW DISCOUNT APPLICATION (Core Flow 2b) — a Standard commuter with no
          category yet and no submission already in flight. Mutually
          exclusive with the "EXPIRED DISCOUNT ACTIONS" card above (that one
          only ever shows once a real Student/PWD category has expired,
          which can never be true while raw_category is still "default").
          Same routes/params Settings' own "Discount Eligibility" section
          already uses — this just makes the same feature discoverable
          directly from Profile instead of requiring a detour through
          Settings first. */}
      {!!user?.can_apply_category && (
        <View style={styles.applyCard}>
          <View style={styles.applyTop}>
            <Ionicons name="pricetag" size={22} color="#166534" />
            <Text style={styles.applyText}>
              Eligible for a discount? Apply as a Student, PWD, or Senior Citizen to get 20% off fares.
            </Text>
          </View>
          <View style={styles.applyActions}>
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => router.push("/(auth)/student-verification?mode=renew" as any)}
              activeOpacity={0.85}
            >
              <Ionicons name="school-outline" size={16} color="#166534" />
              <Text style={styles.applyBtnText}>Student</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => router.push("/(auth)/pwd-verification?mode=renew" as any)}
              activeOpacity={0.85}
            >
              <Ionicons name="accessibility-outline" size={16} color="#166534" />
              <Text style={styles.applyBtnText}>PWD</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => router.push("/(auth)/senior-verification?mode=apply" as any)}
              activeOpacity={0.85}
            >
              <Ionicons name="body-outline" size={16} color="#166534" />
              <Text style={styles.applyBtnText}>Senior</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* MENU */}
      <View style={styles.card}>
        <MenuItem icon="ticket"           label="My Bookings"         onPress={() => router.push("/(main)/booking-history")} />
        <MenuItem icon="wallet"           label="Wallet History"      onPress={() => router.push("/(main)/wallet-history" as any)} />
        <MenuItem icon="document-text"    label="Verification Status" onPress={() => router.push("/(main)/verification-status")} />
        <MenuItem icon="reader-outline"   label="LTFRB Fare Guide"    onPress={() => router.push("/(main)/ltfrb-fare-guide")} />
        <MenuItem icon="settings"         label="Settings"            onPress={() => router.push("/(main)/settings")} last />
      </View>

      {/* LOGOUT */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
        <Ionicons name="log-out-outline" size={20} color="#dc2626" />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      <View style={{ height: 32 }} />

      {/* CHANGE DISCOUNT TYPE PICKER */}
      <Modal visible={showSwitchPicker} transparent animationType="fade" onRequestClose={() => setShowSwitchPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowSwitchPicker(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Switch Discount Type</Text>
            {SWITCH_TARGETS.filter((t) => t.value !== rawCategory).map((t) => (
              <TouchableOpacity key={t.value} style={styles.modalOption} onPress={() => handlePickTarget(t.value)} activeOpacity={0.7}>
                <Text style={styles.modalOptionText}>{t.label}</Text>
                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowSwitchPicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

function InfoRow({
  label, value, icon, last = false, valueColor, revealed, onToggleReveal,
}: {
  label: string; value: string; icon: IoniconsName; last?: boolean; valueColor?: string;
  // Optional eye toggle for private values (phone). `revealed` is whether the
  // real value is currently shown.
  revealed?: boolean; onToggleReveal?: () => void;
}) {
  return (
    <View style={[infoStyles.row, !last && infoStyles.border]}>
      <View style={infoStyles.iconWrap}>
        <Ionicons name={icon} size={18} color="#1a4a52" />
      </View>
      <View style={infoStyles.texts}>
        <Text style={infoStyles.label}>{label}</Text>
        <Text style={[infoStyles.value, valueColor ? { color: valueColor } : null]}>{value}</Text>
      </View>
      {onToggleReveal && (
        <TouchableOpacity
          onPress={onToggleReveal}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          <Ionicons name={revealed ? "eye-off-outline" : "eye-outline"} size={20} color="#6b7280" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  border:  { borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  iconWrap:{ width: 28, alignItems: "center" },
  texts:   { flex: 1 },
  label:   { fontSize: 11, color: "#9ca3af", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  value:   { fontSize: 14, fontWeight: "700", color: "#1a4a52", marginTop: 2 },
});

function MenuItem({
  icon, label, onPress, last = false,
}: {
  icon: IoniconsName; label: string; onPress: () => void; last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[menuStyles.row, !last && menuStyles.border]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={menuStyles.iconWrap}>
        <Ionicons name={icon} size={18} color="#6b7280" />
      </View>
      <Text style={menuStyles.label}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
    </TouchableOpacity>
  );
}

const menuStyles = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, paddingHorizontal: 16 },
  border:  { borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  iconWrap:{ width: 28, alignItems: "center" },
  label:   { flex: 1, fontSize: 14, fontWeight: "600", color: "#374151" },
});

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f9fafb" },
  content:     { paddingHorizontal: 20 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  avatarWrap: { alignItems: "center", marginBottom: 12 },
  verifiedBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20 },
  verifiedText:  { fontSize: 12, fontWeight: "800" },

  userName:  { fontSize: 22, fontWeight: "900", color: "#1a4a52", textAlign: "center", marginBottom: 4 },
  userEmail: { fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 24 },
  emailRow:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 24, paddingHorizontal: 16 },
  userEmailText: { flexShrink: 1, fontSize: 13, color: "#6b7280" },
  eyeBtn:    { padding: 2 },

  card: {
    backgroundColor: "#fff", borderRadius: 16, marginBottom: 16,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    overflow: "hidden",
  },

  expiredCard: {
    backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a",
    borderRadius: 14, padding: 14, marginBottom: 16, gap: 12,
  },
  expiredTop:  { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  expiredText: { flex: 1, fontSize: 12, color: "#92400e", lineHeight: 17 },
  expiredActions: { flexDirection: "row", gap: 10 },
  expiredBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderRadius: 10, paddingVertical: 10,
  },
  expiredBtnPrimary:      { backgroundColor: "#1a4a52" },
  expiredBtnPrimaryText:  { fontSize: 12, fontWeight: "800", color: "#fff" },
  expiredBtnSecondary:    { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#1a4a52" },
  expiredBtnSecondaryText:{ fontSize: 12, fontWeight: "800", color: "#1a4a52" },
  expiredRemoveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, marginTop: 10, borderRadius: 12, borderWidth: 1.5, borderColor: "#fecaca", backgroundColor: "#fef2f2" },
  expiredRemoveText: { fontSize: 12, fontWeight: "800", color: "#b91c1c" },

  applyCard: {
    backgroundColor: "#f0fdf4", borderWidth: 1, borderColor: "#bbf7d0",
    borderRadius: 14, padding: 14, marginBottom: 16, gap: 12,
  },
  applyTop:  { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  applyText: { flex: 1, fontSize: 12, color: "#166534", lineHeight: 17 },
  applyActions: { flexDirection: "row", gap: 8 },
  applyBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    borderRadius: 10, paddingVertical: 10, backgroundColor: "#fff",
    borderWidth: 1.5, borderColor: "#166534",
  },
  applyBtnText: { fontSize: 12, fontWeight: "800", color: "#166534" },

  logoutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#fef2f2", borderRadius: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: "#fecaca", marginTop: 8,
  },
  logoutText: { fontSize: 15, fontWeight: "800", color: "#dc2626" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet:   { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  modalTitle:   { fontSize: 16, fontWeight: "800", color: "#1a4a52", marginBottom: 12 },
  modalOption:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  modalOptionText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  modalCancel:     { paddingVertical: 14, alignItems: "center", marginTop: 4 },
  modalCancelText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
});
