import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import {
  type AssocApplication, type AssociationGroup,
  groupApprovedByAssociation, resolveActiveAssociation,
} from "../../src/utils/activeAssociation";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

const TYPE_ICONS: Record<string, IoniconsName> = {
  "Jeepney": "bus",
  "UV Express": "car",
  "Bus":     "bus-outline",
};

// An operator can hold several rows for the same vehicle_type at once (one
// per association applied to) — collapse to one card per distinct type so
// the dashboard never shows "Bus" twice, and never key a list by the raw
// type string (not unique pre-dedup). Approved beats pending beats
// rejected/removed, so the chip reflects the operator's best standing.
// Applied to `scopedApplications` (see below), which is already narrowed to
// the active association whenever one exists, so within a single
// association a duplicate type shouldn't occur — this is just the same
// defensive dedup dashboard.tsx has always used, kept for safety.
const STATUS_RANK: Record<string, number> = { approved: 2, pending: 1 };
function dedupeByVehicleType(apps: AssocApplication[]): AssocApplication[] {
  const byType = new Map<string, AssocApplication>();
  for (const a of apps) {
    const existing = byType.get(a.vehicle_type);
    if (!existing || (STATUS_RANK[a.status] ?? 0) > (STATUS_RANK[existing.status] ?? 0)) {
      byType.set(a.vehicle_type, a);
    }
  }
  return Array.from(byType.values());
}

type VehicleRow = { id: number; status: string; association_id: number | null };
type DriverRow  = { id: number; status: string; vehicle_id: number | null; vehicle_association_id: number | null };

export default function OperatorDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [user,          setUser]          = useState<any>(null);
  const [applications,  setApplications]  = useState<AssocApplication[]>([]);
  const [vehicles,      setVehicles]      = useState<VehicleRow[]>([]);
  const [drivers,       setDrivers]       = useState<DriverRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);

  // Active-association context — identical state shape and identical
  // AsyncStorage-backed resolution/persistence logic as every other operator
  // tab (Drivers/Vehicles/Trips/Quota/Fare/Profile, see
  // src/utils/activeAssociation.ts). Home never keeps its own separate
  // notion of "which association is active" — it reads and writes the exact
  // same shared key, so switching here is instantly visible on every other
  // tab (and vice versa) without any extra event/sync plumbing.
  const [associationGroups,   setAssociationGroups]   = useState<AssociationGroup[]>([]);
  const [activeAssociationId, setActiveAssociationIdState] = useState<number | null>(null);

  const fetchAssocStatus = async (operatorId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/operators/association_status.php?operator_id=${operatorId}`);
      const data = await res.json();
      const apps: AssocApplication[] = data.success ? (data.applications ?? []) : [];
      setApplications(apps);
      const groups = groupApprovedByAssociation(apps);
      setAssociationGroups(groups);
      const active = await resolveActiveAssociation(groups);
      setActiveAssociationIdState(active?.association_id ?? null);
    } catch {
      setApplications([]); setAssociationGroups([]); setActiveAssociationIdState(null);
    }
  };

  // Full fleet/roster (not the "unassigned only" picker endpoints) — same
  // source Vehicles/Drivers tabs read, then scoped client-side to the active
  // association below, exactly like those tabs do. This replaces the old
  // operators/operator_stats.php call, which counted every vehicle/driver
  // across every association with no way to scope it — mixing an operator's
  // other associations' fleets into "their" numbers whenever they held more
  // than one membership.
  const fetchVehicles = async (operatorId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/vehicles/vehicles.php?operator_id=${operatorId}`);
      const data = await res.json();
      setVehicles(Array.isArray(data) ? data : []);
    } catch { setVehicles([]); }
  };

  const fetchDrivers = async (operatorId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/drivers/drivers.php?operator_id=${operatorId}`);
      const data = await res.json();
      setDrivers(Array.isArray(data) ? data : []);
    } catch { setDrivers([]); }
  };

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) { router.replace("/(auth)/login"); return; }
      const u = JSON.parse(raw);
      setUser(u);
      await Promise.all([fetchAssocStatus(u.id), fetchVehicles(u.id), fetchDrivers(u.id)]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Re-resolves the active association (and refetches every scoped list)
  // on every focus — the same trigger Drivers/Vehicles/Trips/Quota use, so
  // switching from Profile (or any other tab) and returning Home always
  // shows the newly-active association's data, never a stale one.
  useFocusEffect(
    useCallback(() => { loadData(); }, [])
  );

  // Count of unresolved emergency alerts from this operator's drivers — drives
  // the red banner below. Polled every 15s while Home is focused so a driver's
  // SOS shows up without the operator having to pull to refresh. A failed poll
  // is silent (the banner just stays as it was).
  const [emergencyCount, setEmergencyCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;
      let cancelled = false;
      const poll = async (opId: number) => {
        try {
          const res  = await fetch(`${API_BASE}/operators/get_emergency_alerts.php?operator_id=${opId}&status=active`);
          const data = await res.json();
          if (!cancelled && data.success) setEmergencyCount(data.active_count ?? 0);
        } catch { /* keep last value */ }
      };
      (async () => {
        const raw = await AsyncStorage.getItem("user");
        const id  = raw ? JSON.parse(raw)?.id : null;
        if (!id || cancelled) return;
        poll(id);
        timer = setInterval(() => poll(id), 15000);
      })();
      return () => { cancelled = true; if (timer) clearInterval(timer); };
    }, [])
  );

  if (loading) return (
    <View style={styles.loadingWrap}>
      <ActivityIndicator size="large" color="#1a4a52" />
    </View>
  );

  // Which association is active (switched on Profile → Switch Account) — this
  // screen only reads it, to scope the Vehicle Types card below.
  const activeGroup =
    associationGroups.find(g => g.association_id === activeAssociationId)
    ?? (associationGroups.length === 1 ? associationGroups[0] : null);

  // Vehicle Types card — scoped to the active association whenever one
  // exists, so an operator approved for the same vehicle type at two
  // associations never sees a merged/ambiguous chip; falls back to every
  // application the operator has ever submitted only while nothing has been
  // approved anywhere yet (nothing to scope to, and the operator still
  // needs to see their pending/rejected applications while onboarding).
  const scopedApplications = activeAssociationId != null
    ? applications.filter(a => a.status !== "removed" && a.association_id === activeAssociationId)
    : applications.filter(a => a.status !== "removed");
  const typeCards = dedupeByVehicleType(scopedApplications);

  // Vehicles/drivers scoped to the active association — a vehicle belongs to
  // an association via its own association_id; an unassigned driver
  // (vehicle_id null) isn't tied to any association yet so it always counts
  // (matching Drivers tab's identical activeAssocDrivers filter exactly).
  const activeAssocVehicles = vehicles.filter(v => v.association_id === activeAssociationId);
  const activeAssocDrivers  = drivers.filter(d => d.vehicle_id === null || d.vehicle_association_id === activeAssociationId);
  const stats = {
    total_vehicles:  activeAssocVehicles.length,
    active_vehicles: activeAssocVehicles.filter(v => v.status === "active").length,
    total_drivers:   activeAssocDrivers.length,
    active_drivers:  activeAssocDrivers.filter(d => d.status === "active").length,
  };

  const isVerified   = user?.is_verified == 1;
  const isRejected   = user?.status === "inactive";
  const isPending    = !isVerified && !isRejected;
  const hasAssociation = (activeGroup?.vehicle_types.length ?? 0) > 0;
  const isOnHold     = isVerified && !isRejected && !hasAssociation;
  const isOperational = isVerified && hasAssociation;
  const firstName  = user?.name?.split(" ")[0] ?? "Operator";

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  };

  const verificationBadge = isVerified
    ? { icon: "checkmark-circle" as IoniconsName, label: "Verified"  }
    : isRejected
    ? { icon: "close-circle"     as IoniconsName, label: "Rejected"  }
    : { icon: "time"             as IoniconsName, label: "Pending"   };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)}
          colors={["#1a4a52"]} tintColor="#1a4a52" />
      }
    >
      {/* ── REJECTED BANNER ── */}
      {isRejected && (
        <View style={styles.rejectedBanner}>
          <Ionicons name="close-circle" size={22} color="#dc2626" />
          <View style={{ flex: 1 }}>
            <Text style={styles.rejectedTitle}>Verification Rejected</Text>
            <Text style={styles.rejectedSub}>Your documents were not accepted. Please contact support.</Text>
          </View>
        </View>
      )}

      {/* ── PENDING BANNER ── */}
      {isPending && (
        <View style={styles.pendingBanner}>
          <Ionicons name="time" size={22} color="#b45309" />
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingTitle}>Verification Pending</Text>
            <Text style={styles.pendingSub}>Your account is under review. Full access unlocks after verification.</Text>
          </View>
        </View>
      )}

      {/* ── ON HOLD BANNER (verified, but not yet approved by an association) ── */}
      {isOnHold && (
        <View style={styles.pendingBanner}>
          <Ionicons name="business" size={22} color="#b45309" />
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingTitle}>Account On Hold</Text>
            <Text style={styles.pendingSub}>Waiting for your association to approve your account. Full access unlocks after approval.</Text>
          </View>
        </View>
      )}

      {/* ── EMERGENCY ALERT BANNER — only while a driver's SOS is unresolved ── */}
      {emergencyCount > 0 && (
        <TouchableOpacity
          style={styles.emergencyBanner}
          onPress={() => router.push("/(operator)/emergency-alerts" as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="warning" size={22} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.emergencyBannerTitle}>
              {emergencyCount} active emergency alert{emergencyCount === 1 ? "" : "s"}
            </Text>
            <Text style={styles.emergencyBannerSub}>A driver needs help — tap to see who and where.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#fff" />
        </TouchableOpacity>
      )}

      {/* ── HEADER ── */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>{getGreeting()},</Text>
          <Text style={styles.name}>{firstName}</Text>
        </View>
        {/* Navigates to Profile (this app has no notification inbox) — icon
            and label changed together to match the real destination, not a
            bell promising notifications that don't exist. */}
        <TouchableOpacity style={styles.notifBtn} onPress={() => router.push("/(operator)/profile")} activeOpacity={0.8}>
          <Ionicons name="person-circle-outline" size={18} color="#1a4a52" />
          <Text style={styles.notifBtnText}>Profile</Text>
        </TouchableOpacity>
      </View>

      {/* ── VEHICLE TYPES CARD — scoped to the active association (see
          scopedApplications above). Switching accounts now happens on
          Profile (Switch Account bar), and changes exactly what's shown
          here, never a union of every association's types. ── */}
      <View style={[styles.typeCard, { backgroundColor: "#1a4a52" }]}>
        <View style={styles.typeCardLeft}>
          <Text style={styles.typeCardLabel}>Vehicle Types</Text>
          {scopedApplications.length === 0 ? (
            <Text style={styles.typeCardName}>None yet</Text>
          ) : (
            <View style={styles.typeChipsRow}>
              {typeCards.map(a => (
                <View key={a.vehicle_type} style={styles.typeChip}>
                  <Ionicons name={TYPE_ICONS[a.vehicle_type] ?? "bus"} size={12} color="#fff" />
                  <Text style={styles.typeChipText}>{a.vehicle_type}</Text>
                  <Text style={styles.typeChipStatus}>
                    {a.status === "approved" ? "✓" : a.status === "pending" ? "…" : "!"}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.typeCardBadge}>
            <Ionicons name={verificationBadge.icon} size={11} color="#fff" />
            <Text style={styles.typeCardBadgeText}>{verificationBadge.label}</Text>
          </View>
        </View>
        <Ionicons name="bus" size={52} color="rgba(255,255,255,0.9)" style={{ zIndex: 1 }} />
        <View style={styles.typeCircle1} />
        <View style={styles.typeCircle2} />
      </View>

      {/* ── "FINISH ADDING YOUR VEHICLE" REMINDER — from the registration
          wizard's Step 2 (see migration 055): once an application this
          reminder is attached to gets approved, and no real vehicle has been
          registered against it yet, nudge the operator back to the Vehicles
          tab with what they already typed at signup instead of asking again
          from scratch. ── */}
      {applications.filter(a => a.status === "approved" && !a.vehicle_added && a.intended_plate_number).map(a => (
        <TouchableOpacity
          key={`reminder-${a.id}`}
          style={styles.reminderBanner}
          onPress={() => router.push("/(operator)/vehicles" as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="car-sport-outline" size={18} color="#92400e" />
          <View style={{ flex: 1 }}>
            <Text style={styles.reminderTitle}>Finish adding your {a.vehicle_type}</Text>
            <Text style={styles.reminderText}>
              You're approved at {a.association_name} — plate {a.intended_plate_number}
              {a.intended_vehicle_number ? `, ${a.intended_vehicle_number}` : ""}
              {a.intended_capacity ? `, ${a.intended_capacity} seats` : ""}. Tap to add it now.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#92400e" />
        </TouchableOpacity>
      ))}

      {/* ── STATS GRID — Total/Active Drivers and Vehicles, scoped to the
          active association (see stats above). ── */}
      <Text style={styles.sectionTitle}>Overview</Text>
      <View style={styles.statsGrid}>
        <StatCard
          icon="people"    label="Total Drivers"
          value={stats.total_drivers}
          sub={`${stats.active_drivers} active`}
          color="#e0f2fe" accent="#0284c7"
          onPress={() => router.push("/(operator)/drivers")}
        />
        <StatCard
          icon="car"       label="Vehicles"
          value={stats.total_vehicles}
          sub={`${stats.active_vehicles} active`}
          color="#f0fdf4" accent="#16a34a"
          onPress={() => router.push("/(operator)/vehicles")}
        />
      </View>

      {/* ── QUICK ACTIONS ── */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsCol}>

        <TouchableOpacity
          style={[styles.actionCard, !isOperational && styles.actionCardDisabled]}
          onPress={() => isOperational && router.push("/(operator)/drivers")}
          activeOpacity={isOperational ? 0.8 : 1}
        >
          <View style={[styles.actionIcon, { backgroundColor: "#e0f2fe" }]}>
            <Ionicons name="people" size={22} color="#0284c7" />
          </View>
          <View style={styles.actionInfo}>
            <Text style={styles.actionTitle}>Manage Drivers</Text>
            <Text style={styles.actionSub}>Add, view or remove your drivers</Text>
          </View>
          {!isOperational
            ? <View style={styles.lockBadge}><Ionicons name="lock-closed" size={14} color="#94a3b8" /></View>
            : <Ionicons name="chevron-forward" size={20} color="#cbd5e1" />}
        </TouchableOpacity>

      </View>

      {!isOperational && (
        <View style={styles.lockNote}>
          <Ionicons name="lock-closed" size={13} color="#64748b" />
          <Text style={styles.lockNoteText}>
            {!isVerified
              ? "Driver management unlocks after admin verification."
              : "Driver management unlocks after your association approves your account."}
          </Text>
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

function StatCard({ icon, label, value, sub, color, accent, onPress }: {
  icon: IoniconsName; label: string; value: number;
  sub?: string; color: string; accent: string; onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.statCard, { backgroundColor: color }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.8 : 1}
    >
      <Ionicons name={icon} size={24} color={accent} style={{ marginBottom: 4 }} />
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: accent }]}>{label}</Text>
      {sub && <Text style={[styles.statSub, { color: accent + "99" }]}>{sub}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f9fafb" },
  content:     { paddingHorizontal: 20, paddingBottom: 20 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  emergencyBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#dc2626", borderRadius: 14, padding: 14, marginBottom: 16, minHeight: 56,
  },
  emergencyBannerTitle: { color: "#fff", fontSize: 15, fontWeight: "900" },
  emergencyBannerSub:   { color: "#fee2e2", fontSize: 12, fontWeight: "600", marginTop: 2 },

  rejectedBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
    borderRadius: 14, padding: 14, marginBottom: 16,
  },
  pendingBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a",
    borderRadius: 14, padding: 14, marginBottom: 16,
  },
  rejectedTitle: { fontSize: 13, fontWeight: "800", color: "#991b1b" },
  rejectedSub:   { fontSize: 11, color: "#b91c1c", marginTop: 2 },
  pendingTitle:  { fontSize: 13, fontWeight: "800", color: "#92400e" },
  pendingSub:    { fontSize: 11, color: "#b45309", marginTop: 2 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  greeting:  { fontSize: 14, color: "#6b7280", fontWeight: "500" },
  name:      { fontSize: 24, fontWeight: "900", color: "#1a4a52" },
  notifBtn:  { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 38, borderRadius: 19, paddingHorizontal: 14, backgroundColor: "#fff", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, elevation: 4 },
  notifBtnText: { fontSize: 12.5, fontWeight: "800", color: "#1a4a52" },

  workspaceBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#fff", borderRadius: 14, padding: 12, marginBottom: 16,
    borderWidth: 1.5, borderColor: "#f1f5f9",
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  workspaceBarLeft:  { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  workspaceBarIcon:  { width: 32, height: 32, borderRadius: 10, backgroundColor: "#f0faf4", alignItems: "center", justifyContent: "center" },
  workspaceBarLabel: { fontSize: 9, fontWeight: "800", color: "#9ca3af", letterSpacing: 0.6 },
  workspaceBarName:  { fontSize: 13, fontWeight: "800", color: "#1a4a52", marginTop: 1 },
  switchPill:        { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#f0faf4", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: "#1a4a52" },
  switchPillText:    { fontSize: 11, fontWeight: "800", color: "#1a4a52" },

  typeCard: {
    borderRadius: 20, padding: 22, marginBottom: 28,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    overflow: "hidden",
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 10,
  },
  // flex:1 + minWidth:0 lets the chip row wrap inside the space left of the bus
  // icon; without it a third vehicle-type chip ran past the card's right edge
  // on narrow phones and was clipped.
  typeCardLeft:      { gap: 6, flex: 1, minWidth: 0, marginRight: 10 },
  typeCardLabel:     { fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: "600" },
  typeCardName:      { fontSize: 26, fontWeight: "900", color: "#fff" },
  typeCardBadge:     { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.2)" },
  typeCardBadgeText: { fontSize: 11, color: "#fff", fontWeight: "700" },
  typeChipsRow:      { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  typeChip:          { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  typeChipText:      { fontSize: 11, fontWeight: "800", color: "#fff" },
  typeChipStatus:    { fontSize: 11, fontWeight: "900", color: "#fff" },
  typeCircle1:       { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(255,255,255,0.06)", top: -30, right: 60 },
  typeCircle2:       { position: "absolute", width: 80,  height: 80,  borderRadius: 40, backgroundColor: "rgba(255,255,255,0.06)", bottom: -20, right: 10 },

  reminderBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a",
    borderRadius: 12, padding: 14, marginBottom: 16,
  },
  reminderTitle: { fontSize: 13, fontWeight: "800", color: "#92400e", marginBottom: 2 },
  reminderText:  { fontSize: 12, color: "#92400e", lineHeight: 16 },

  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#1a4a52", marginBottom: 12 },

  statsGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 28 },
  statCard:       { width: "47%", borderRadius: 16, padding: 16, gap: 2 },
  statValue:      { fontSize: 28, fontWeight: "900" },
  statLabel:      { fontSize: 12, fontWeight: "700" },
  statSub:        { fontSize: 11, fontWeight: "500", marginTop: 2 },

  actionsCol:         { gap: 12, marginBottom: 16 },
  actionCard:         { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff", borderRadius: 16, padding: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  actionCardDisabled: { opacity: 0.6 },
  actionIcon:         { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  actionInfo:         { flex: 1 },
  actionTitle:        { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  actionSub:          { fontSize: 12, color: "#6b7280", marginTop: 2 },
  lockBadge:          { backgroundColor: "#f1f5f9", borderRadius: 8, padding: 6 },

  lockNote:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f1f5f9", borderRadius: 12, padding: 12 },
  lockNoteText: { flex: 1, fontSize: 12, color: "#64748b", fontWeight: "600" },

  // Switch Account modal — mirrors Profile → My Associations' card layout
  // exactly (assocCard/assocCardActive/activeBadge/switchAssocBtn), just
  // renamed for this file's own StyleSheet.
  modalOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:      { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHandle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },
  modalTitle:      { fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  modalSub:        { fontSize: 13, color: "#6b7280", marginBottom: 16, lineHeight: 18 },

  switchCard:       { borderWidth: 1.5, borderColor: "#f1f5f9", borderRadius: 12, padding: 12, marginBottom: 8, gap: 8 },
  switchCardActive: { borderColor: "#a8d832", backgroundColor: "#f9fdf0" },
  switchCardTop:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchCardName:   { fontSize: 15, fontWeight: "800", color: "#111827" },
  activeBadge:      { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f0fdf4", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  activeBadgeText:  { fontSize: 10, fontWeight: "800", color: "#15803d" },

  switchTypeRow:       { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  switchTypeChip:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#f0faf4", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  switchTypeChipText:  { fontSize: 11, fontWeight: "800", color: "#1a4a52" },

  switchToBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#f0faf4", borderRadius: 10, paddingVertical: 8, borderWidth: 1, borderColor: "#1a4a52", alignSelf: "flex-start", paddingHorizontal: 14 },
  switchToBtnText: { fontSize: 12, fontWeight: "700", color: "#1a4a52" },

  // Deliberately no `flex` here — a lone TouchableOpacity in a plain
  // column View has no free vertical space to grow into, and a `flex: N`
  // shorthand (flexBasis: 0%) would collapse its Text child to zero
  // height/invisible while the padding/border still paint a visible box
  // (see the identical bug already fixed on this exact button shape in
  // (operator)/quota.tsx and (operator)/trips.tsx).
  modalCloseBtn:     { marginTop: 16, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  modalCloseBtnText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
});
