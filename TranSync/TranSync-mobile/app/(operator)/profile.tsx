import { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Alert, Modal,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import API_BASE, { FILE_BASE } from "../../src/config/api";
import AvatarPicker, { buildAvatarFormData } from "../../src/components/common/AvatarPicker";
import {
  type AssocApplication, type AssociationGroup,
  groupApprovedByAssociation, resolveActiveAssociation, setActiveAssociationId,
  ACTIVE_ASSOCIATION_STORAGE_KEY,
} from "../../src/utils/activeAssociation";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

const TYPE_ICONS: Record<string, IoniconsName> = {
  "Jeepney": "bus", "UV Express": "car", "Bus": "bus-outline",
};
const TYPE_COLORS: Record<string, string> = {
  "Jeepney": "#16a34a", "UV Express": "#9333ea", "Bus": "#2563eb",
};
const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: IoniconsName }> = {
  pending:  { label: "Pending Review",  color: "#92400e", bg: "#fffbeb", icon: "time" },
  approved: { label: "Approved",        color: "#15803d", bg: "#f0fdf4", icon: "checkmark-circle" },
  rejected: { label: "Rejected",        color: "#991b1b", bg: "#fef2f2", icon: "close-circle" },
  removed:  { label: "Removed",         color: "#6b7280", bg: "#f9fafb", icon: "remove-circle" },
};

export default function OperatorProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [user,    setUser]    = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Association memberships — one per vehicle type ever applied for (Core Flow 8)
  const [applications, setApplications] = useState<AssocApplication[]>([]);
  const [leaveBusy,     setLeaveBusy]    = useState<string | null>(null);

  // Approved applications grouped by association (an operator can hold
  // several approved vehicle types at the same association, or approved
  // types spread across several associations — but never the same vehicle
  // type at two associations at once, see Core Flow 8). "Active" is which
  // association's data other screens (Vehicles/Drivers/Trips/Fare) filter
  // to by default — only meaningful, and only shown as switchable, once the
  // operator has 2+ approved associations.
  const [associationGroups,   setAssociationGroups]   = useState<AssociationGroup[]>([]);
  const [activeAssociationId, setActiveAssociationIdState] = useState<number | null>(null);
  const [switchingTo,         setSwitchingTo]         = useState<number | null>(null);
  const [showSwitcher,        setShowSwitcher]        = useState(false);
  const [uploadingAvatar,     setUploadingAvatar]     = useState(false);

  useFocusEffect(useCallback(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (raw) {
        const u = JSON.parse(raw);
        setUser(u);
        loadApplications(u.id);
        // Live re-sync (Operator Settings) — the AsyncStorage snapshot only
        // ever reflects login-time state, so an admin verifying/rejecting
        // this operator's account mid-session wouldn't otherwise show up
        // without a re-login. Same pattern as commuter/UserContext and
        // associations/profile.tsx.
        try {
          const res  = await fetch(`${API_BASE}/operators/get_profile.php?operator_id=${u.id}`);
          const data = await res.json();
          if (data?.success && data.operator) {
            const merged = { ...u, ...data.operator };
            await AsyncStorage.setItem("user", JSON.stringify(merged));
            setUser(merged);
          }
        } catch {
          // Cached value stays shown.
        }
      }
      setLoading(false);
    })();
  }, []));

  const loadApplications = async (operatorId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/operators/association_status.php?operator_id=${operatorId}`);
      const data = await res.json();
      if (data.success) {
        const apps: AssocApplication[] = data.applications ?? [];
        setApplications(apps);
        const groups = groupApprovedByAssociation(apps);
        setAssociationGroups(groups);
        const active = await resolveActiveAssociation(groups);
        setActiveAssociationIdState(active?.association_id ?? null);
      }
    } catch (_) {}
  };

  const handleSwitchAssociation = async (associationId: number) => {
    if (associationId === activeAssociationId) { setShowSwitcher(false); return; }
    setSwitchingTo(associationId);
    await setActiveAssociationId(associationId);
    setActiveAssociationIdState(associationId);
    setSwitchingTo(null);
    setShowSwitcher(false);
  };

  const handleLeave = (app: AssocApplication) => {
    Alert.alert(
      "Leave Association",
      `Leave ${app.association_name} for ${app.vehicle_type}? You'll need to re-apply to operate ${app.vehicle_type} vehicles at this association again.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: async () => {
          // Keyed by application id, not vehicle_type — an operator can now
          // hold the same vehicle_type approved at several associations at
          // once, so vehicle_type alone would light up every matching
          // "Leave" button across associations at the same time.
          setLeaveBusy(String(app.id));
          try {
            const res  = await fetch(`${API_BASE}/operators/leave_association.php`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ operator_id: user.id, vehicle_type: app.vehicle_type, association_id: app.association_id }),
            });
            const data = await res.json();
            if (data.success) loadApplications(user.id);
          } catch (_) {}
          finally { setLeaveBusy(null); }
        }},
      ]
    );
  };

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(["user", "role", ACTIVE_ASSOCIATION_STORAGE_KEY]);
    router.replace("/(auth)/login");
  };

  const handleAvatarChange = async (localUri: string | null) => {
    if (!user) return;
    setUploadingAvatar(true);
    try {
      const fd  = buildAvatarFormData("operator_id", user.id, localUri);
      const res = await fetch(`${API_BASE}/operators/update_avatar.php`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        const merged = { ...user, avatar_url: data.avatar_url };
        setUser(merged);
        await AsyncStorage.setItem("user", JSON.stringify(merged));
      } else {
        Alert.alert("Error", data.message || "Failed to update photo.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (loading) return (
    <View style={styles.loadingWrap}>
      <ActivityIndicator size="large" color="#1a4a52" />
    </View>
  );

  const isVerified = user?.is_verified == 1;
  const isRejected = user?.status === "inactive";
  const initials   = user?.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() ?? "OP";

  const menuItems: { icon: IoniconsName; label: string; sub: string; path: string | null }[] = [
    { icon: "people",        label: "Manage Drivers", sub: "View and manage your drivers", path: "/(operator)/drivers" },
    { icon: "car",           label: "Manage Vehicles", sub: "View and manage your fleet",  path: "/(operator)/vehicles" },
    { icon: "settings",      label: "Settings",        sub: "Account, notifications, security", path: "/(operator)/settings" },
    { icon: "information-circle", label: "About TranSync", sub: "Version 1.0.0",           path: null },
  ];

  const verifyIcon: IoniconsName = isVerified ? "checkmark-circle" : isRejected ? "close-circle" : "time";
  const verifyColor = isVerified ? "#15803d" : isRejected ? "#991b1b" : "#92400e";
  const verifySubColor = isVerified ? "#166534" : isRejected ? "#b91c1c" : "#b45309";
  const verifyCardStyle = isVerified ? styles.verifyCardOk : isRejected ? styles.verifyCardBad : styles.verifyCardPending;

  // "My Associations" now shows one card per association (not per vehicle
  // type) — each card lists every non-removed application the operator has
  // at that association. Switching is only offered once there are 2+
  // associations with at least one approved type each.
  const displayGroups: { association_id: number; association_name: string; apps: AssocApplication[] }[] = (() => {
    const map = new Map<number, { association_id: number; association_name: string; apps: AssocApplication[] }>();
    for (const a of applications.filter(a => a.status !== "removed")) {
      const g = map.get(a.association_id);
      if (g) g.apps.push(a);
      else map.set(a.association_id, { association_id: a.association_id, association_name: a.association_name, apps: [a] });
    }
    return Array.from(map.values()).sort((a, b) => a.association_name.localeCompare(b.association_name));
  })();
  const canSwitchAssociations = associationGroups.length > 1;
  // The "Active Association / Switch Account" bar lives here (moved from Home).
  // Shown from the first approved association on so the feature is visible;
  // with only one it's dimmed and tapping it explains how to unlock it.
  const hasAnyAssociation = associationGroups.length > 0;
  const activeGroup =
    associationGroups.find(g => g.association_id === activeAssociationId)
    ?? (associationGroups.length === 1 ? associationGroups[0] : null);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* SWITCH ACCOUNT POPUP — same associationGroups data and the same shared
          setActiveAssociationId() persistence as the per-association buttons
          below, so switching here updates every other operator tab. */}
      <Modal visible={showSwitcher} transparent animationType="slide" onRequestClose={() => setShowSwitcher(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Switch Account</Text>
            <Text style={styles.modalSub}>
              Choose which association's vehicles, drivers, and other data you want to manage. This also updates the
              active association on your other tabs.
            </Text>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {associationGroups.map(group => {
                const isActive = group.association_id === activeAssociationId;
                return (
                  <View key={group.association_id} style={[styles.switchCard, isActive && styles.switchCardActive]}>
                    <View style={styles.switchCardTop}>
                      <Text style={styles.switchCardName}>{group.association_name}</Text>
                      {isActive && (
                        <View style={styles.activeBadge}>
                          <Ionicons name="checkmark-circle" size={12} color="#15803d" />
                          <Text style={styles.activeBadgeText}>Active</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.switchTypeRow}>
                      {group.vehicle_types.map(t => (
                        <View key={t} style={styles.switchTypeChip}>
                          <Ionicons name={TYPE_ICONS[t] ?? "bus"} size={11} color="#1a4a52" />
                          <Text style={styles.switchTypeChipText}>{t}</Text>
                        </View>
                      ))}
                    </View>
                    {!isActive && (
                      <TouchableOpacity
                        style={styles.switchToBtn}
                        onPress={() => handleSwitchAssociation(group.association_id)}
                        disabled={switchingTo === group.association_id}
                        activeOpacity={0.8}
                      >
                        {switchingTo === group.association_id
                          ? <ActivityIndicator size="small" color="#1a4a52" />
                          : (<>
                              <Ionicons name="swap-horizontal" size={13} color="#1a4a52" />
                              <Text style={styles.switchToBtnText}>Switch to this association</Text>
                            </>)}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowSwitcher(false)} activeOpacity={0.85}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* AVATAR */}
      <View style={styles.avatarSection}>
        <AvatarPicker
          uri={user?.avatar_url ? FILE_BASE + user.avatar_url : null}
          fallbackText={initials}
          size={80}
          uploading={uploadingAvatar}
          onChange={handleAvatarChange}
        />
        <Text style={styles.userName}>{user?.name}</Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
      </View>

      {/* VERIFICATION STATUS — account-level, admin-side. Association
          membership (per vehicle type) is shown separately below and no
          longer affects this card, since verification and vehicle-type
          association approval are now fully independent steps. */}
      <TouchableOpacity
        style={[styles.verifyCard, verifyCardStyle]}
        onPress={() => router.push("/(operator)/operator-verification" as any)}
        activeOpacity={0.8}
      >
        <Ionicons name={verifyIcon} size={22} color={verifyColor} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.verifyTitle, { color: verifyColor }]}>
            {isVerified ? "Account Verified" : isRejected ? "Verification Rejected" : "Verification Pending"}
          </Text>
          <Text style={[styles.verifySub, { color: verifySubColor }]}>
            {isVerified
              ? "Admin has verified your account"
              : isRejected
              ? "Your account was not accepted. Contact support."
              : "Admin is reviewing your account"}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={verifyColor} />
      </TouchableOpacity>

      {/* INFO CARD */}
      <View style={styles.infoCard}>
        <InfoRow icon="call-outline"    label="Phone"      value={user?.phone ?? "—"} />
        <View style={styles.divider} />
        <InfoRow icon="mail-outline"    label="Email"      value={user?.email ?? "—"} />
        <View style={styles.divider} />
        <InfoRow icon="id-card-outline" label="Operator ID" value={`#${user?.id}`} />
      </View>

      {/* ACTIVE ASSOCIATION / SWITCH ACCOUNT BAR — with 2+ approved associations
          it opens the switcher; with just one it's dimmed and explains how to
          unlock it. */}
      {hasAnyAssociation && (
        <TouchableOpacity
          style={styles.workspaceBar}
          onPress={() => {
            if (canSwitchAssociations) { setShowSwitcher(true); return; }
            Alert.alert(
              "Switch Account",
              "You're approved at only one association right now. Once you're approved at a second association (tap Apply under My Associations), you can switch between them here.",
            );
          }}
          activeOpacity={0.85}
        >
          <View style={styles.workspaceBarLeft}>
            <View style={styles.workspaceBarIcon}>
              <Ionicons name="business" size={16} color="#1a4a52" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.workspaceBarLabel}>ACTIVE ASSOCIATION</Text>
              <Text style={styles.workspaceBarName} numberOfLines={1}>{activeGroup?.association_name ?? "—"}</Text>
            </View>
          </View>
          <View style={[styles.switchPill, !canSwitchAssociations && { opacity: 0.55 }]}>
            <Ionicons name="swap-horizontal" size={13} color="#1a4a52" />
            <Text style={styles.switchPillText}>Switch Account</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* MY ASSOCIATIONS — one card per association (not per vehicle type);
          each card lists every vehicle type applied for at that association.
          "Switch to this association" only appears once the operator has
          2+ associations with an approved vehicle type — a single-association
          operator never sees any switching UI at all. */}
      <View style={styles.infoCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My Associations</Text>
          <TouchableOpacity
            style={styles.applyAssocBtn}
            onPress={() => router.push("/(operator)/apply-association" as any)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={14} color="#1a4a52" />
            <Text style={styles.applyAssocBtnText}>Apply</Text>
          </TouchableOpacity>
        </View>

        {canSwitchAssociations && (
          <Text style={styles.activeWorkspaceHint}>
            You manage multiple associations — the active one determines which vehicles, drivers, and trips you see
            on the other tabs.
          </Text>
        )}

        {displayGroups.length === 0 ? (
          <Text style={styles.assocEmptyText}>
            Not a member of any association yet. Tap "Apply" to pick a vehicle type and submit your documents.
          </Text>
        ) : (
          displayGroups.map(group => {
            const isActive = activeAssociationId === group.association_id;
            const hasApproved = group.apps.some(a => a.status === "approved");
            return (
              <View key={group.association_id} style={[styles.assocCard, isActive && canSwitchAssociations && styles.assocCardActive]}>
                <View style={styles.assocCardTop}>
                  <Text style={styles.assocName}>{group.association_name}</Text>
                  {isActive && canSwitchAssociations && (
                    <View style={styles.activeBadge}>
                      <Ionicons name="checkmark-circle" size={12} color="#15803d" />
                      <Text style={styles.activeBadgeText}>Active</Text>
                    </View>
                  )}
                </View>

                <View style={styles.assocTypeRow}>
                  {group.apps.map(app => {
                    const meta  = STATUS_META[app.status];
                    const color = TYPE_COLORS[app.vehicle_type] ?? "#1a4a52";
                    const icon  = TYPE_ICONS[app.vehicle_type]  ?? "bus";
                    return (
                      <View key={app.id} style={[styles.assocTypeBadge, { backgroundColor: color + "18" }]}>
                        <Ionicons name={icon} size={12} color={color} />
                        <Text style={[styles.assocTypeBadgeText, { color }]}>{app.vehicle_type}</Text>
                        <Ionicons name={meta.icon} size={11} color={meta.color} style={{ marginLeft: 2 }} />
                      </View>
                    );
                  })}
                </View>

                {group.apps.filter(a => a.status === "rejected" && a.rejection_reason).map(a => (
                  <Text key={a.id} style={styles.assocRejectedText}>{a.vehicle_type}: {a.rejection_reason}</Text>
                ))}

                <View style={styles.assocCardActions}>
                  {group.apps.filter(a => a.status === "approved").map(a => (
                    <TouchableOpacity
                      key={a.id}
                      style={styles.leaveAssocBtn}
                      onPress={() => handleLeave(a)}
                      disabled={leaveBusy === String(a.id)}
                      activeOpacity={0.8}
                    >
                      {leaveBusy === String(a.id)
                        ? <ActivityIndicator size="small" color="#dc2626" />
                        : (<>
                            <Ionicons name="log-out-outline" size={12} color="#dc2626" />
                            <Text style={styles.leaveAssocBtnText}>Leave {a.vehicle_type}</Text>
                          </>)}
                    </TouchableOpacity>
                  ))}
                  {canSwitchAssociations && hasApproved && !isActive && (
                    <TouchableOpacity
                      style={styles.switchAssocBtn}
                      onPress={() => handleSwitchAssociation(group.association_id)}
                      disabled={switchingTo === group.association_id}
                      activeOpacity={0.8}
                    >
                      {switchingTo === group.association_id
                        ? <ActivityIndicator size="small" color="#1a4a52" />
                        : (<>
                            <Ionicons name="swap-horizontal" size={13} color="#1a4a52" />
                            <Text style={styles.switchAssocBtnText}>Switch to this association</Text>
                          </>)}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* MENU */}
      <View style={styles.menuCard}>
        {menuItems.map((item, i) => (
          <View key={item.label}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => item.path && router.push(item.path as any)}
              activeOpacity={item.path ? 0.7 : 1}
            >
              <View style={styles.menuIconWrap}>
                <Ionicons name={item.icon} size={18} color="#6b7280" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Text style={styles.menuSub}>{item.sub}</Text>
              </View>
              {item.path && <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />}
            </TouchableOpacity>
            {i < menuItems.length - 1 && <View style={styles.divider} />}
          </View>
        ))}
      </View>

      {/* LOGOUT */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
        <Ionicons name="log-out-outline" size={18} color="#dc2626" />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

function InfoRow({ icon, label, value }: { icon: IoniconsName; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIconWrap}>
        <Ionicons name={icon} size={18} color="#1a4a52" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f9fafb" },
  content:     { paddingHorizontal: 20, paddingBottom: 20 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  avatarSection: { alignItems: "center", marginBottom: 24, gap: 6 },
  userName:      { fontSize: 22, fontWeight: "900", color: "#1a4a52" },
  userEmail:     { fontSize: 13, color: "#6b7280" },

  verifyCard:        { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1 },
  verifyCardOk:      { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" },
  verifyCardBad:     { backgroundColor: "#fef2f2", borderColor: "#fecaca" },
  verifyCardPending: { backgroundColor: "#fffbeb", borderColor: "#fde68a" },
  verifyTitle:       { fontSize: 13, fontWeight: "800" },
  verifySub:         { fontSize: 11, marginTop: 2 },

  infoCard:    { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, gap: 4 },
  infoRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  infoIconWrap:{ width: 28, alignItems: "center" },
  infoLabel:   { fontSize: 11, color: "#9ca3af", fontWeight: "600" },
  infoValue:   { fontSize: 14, fontWeight: "700", color: "#1a4a52" },
  divider:     { height: 1, backgroundColor: "#f1f5f9" },

  menuCard:     { backgroundColor: "#fff", borderRadius: 16, padding: 8, marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  menuItem:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 8 },
  menuIconWrap: { width: 38, height: 38, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  menuLabel:    { fontSize: 14, fontWeight: "700", color: "#1a4a52" },
  menuSub:      { fontSize: 11, color: "#9ca3af", marginTop: 1 },

  logoutBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#fef2f2", borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: "#fecaca" },
  logoutText: { fontSize: 14, fontWeight: "800", color: "#dc2626" },

  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sectionTitle: { fontSize: 12, fontWeight: "800", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6 },
  assocEmptyText: { fontSize: 12, color: "#9ca3af", lineHeight: 18 },
  activeWorkspaceHint: { fontSize: 11, color: "#6b7280", lineHeight: 16, marginBottom: 10 },

  assocCard:       { borderWidth: 1.5, borderColor: "#f1f5f9", borderRadius: 12, padding: 12, marginBottom: 8, gap: 8 },
  assocCardActive: { borderColor: "#a8d832", backgroundColor: "#f9fdf0" },
  assocCardTop:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  assocName:       { fontSize: 15, fontWeight: "800", color: "#111827" },
  workspaceBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10,
    backgroundColor: "#fff", borderRadius: 14, padding: 12, marginBottom: 16,
    borderWidth: 1.5, borderColor: "#f1f5f9",
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  workspaceBarLeft:  { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  workspaceBarIcon:  { width: 32, height: 32, borderRadius: 10, backgroundColor: "#f0faf4", alignItems: "center", justifyContent: "center" },
  workspaceBarLabel: { fontSize: 9, fontWeight: "800", color: "#9ca3af", letterSpacing: 0.6 },
  workspaceBarName:  { fontSize: 13, fontWeight: "800", color: "#1a4a52", marginTop: 1 },
  switchPill:        { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0, backgroundColor: "#f0faf4", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: "#1a4a52" },
  switchPillText:    { fontSize: 11, fontWeight: "800", color: "#1a4a52" },

  modalOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:      { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHandle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },
  modalTitle:      { fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  modalSub:        { fontSize: 13, color: "#6b7280", marginBottom: 16, lineHeight: 18 },
  switchCard:       { borderWidth: 1.5, borderColor: "#f1f5f9", borderRadius: 12, padding: 12, marginBottom: 8, gap: 8 },
  switchCardActive: { borderColor: "#a8d832", backgroundColor: "#f9fdf0" },
  switchCardTop:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchCardName:   { fontSize: 15, fontWeight: "800", color: "#111827", flex: 1 },
  switchTypeRow:       { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  switchTypeChip:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#f0faf4", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  switchTypeChipText:  { fontSize: 11, fontWeight: "800", color: "#1a4a52" },
  switchToBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#f0faf4", borderRadius: 10, paddingVertical: 8, borderWidth: 1, borderColor: "#1a4a52", alignSelf: "flex-start", paddingHorizontal: 14 },
  switchToBtnText: { fontSize: 12, fontWeight: "700", color: "#1a4a52" },
  modalCloseBtn:     { marginTop: 16, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  modalCloseBtnText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },

  activeBadge:     { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f0fdf4", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  activeBadgeText: { fontSize: 10, fontWeight: "800", color: "#15803d" },

  assocTypeRow:       { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  assocTypeBadge:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  assocTypeBadgeText: { fontSize: 11, fontWeight: "800" },
  assocRejectedText:  { fontSize: 12, color: "#dc2626" },

  assocCardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  leaveAssocBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#fef2f2", borderRadius: 10, paddingVertical: 8, borderWidth: 1, borderColor: "#fecaca", alignSelf: "flex-start", paddingHorizontal: 14 },
  leaveAssocBtnText: { fontSize: 12, fontWeight: "700", color: "#dc2626" },
  switchAssocBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#f0faf4", borderRadius: 10, paddingVertical: 8, borderWidth: 1, borderColor: "#1a4a52", alignSelf: "flex-start", paddingHorizontal: 14 },
  switchAssocBtnText: { fontSize: 12, fontWeight: "700", color: "#1a4a52" },
  applyAssocBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "#f0faf4", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: "#1a4a52" },
  applyAssocBtnText:  { fontSize: 11, fontWeight: "700", color: "#1a4a52" },
});
