import { useState, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, Pressable, TextInput, useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";

type MemberDriver = {
  id:                   number;
  name:                 string;
  phone:                string;
  license_number:       string;
  status:               "active" | "inactive";
  vehicle_id:           number | null;
  vehicle_type:         string | null;
  vehicle_plate:        string | null;
  assigned_route_id:    number | null;
  assigned_route:       string | null;
  assigned_route_color: string | null;
};

type MemberOperator = {
  id:             number;
  name:           string;
  vehicle_types:  string[];
  phone:          string;
  email:          string;
  drivers:        MemberDriver[];
};

type AssocRoute = { id: number; name: string; color: string };

export default function AssociationMembers() {
  const insets = useSafeAreaInsets();

  const [assoc,      setAssoc]      = useState<any>(null);
  const [operators,  setOperators]  = useState<MemberOperator[]>([]);
  const [assocRoutes,setAssocRoutes]= useState<AssocRoute[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");

  const [assignTarget, setAssignTarget] = useState<MemberDriver | null>(null);
  const [assigning,    setAssigning]    = useState(false);

  const [kickTarget, setKickTarget] = useState<MemberOperator | null>(null);
  const [kickVehicleType, setKickVehicleType] = useState<string | null>(null);
  const [kicking,    setKicking]    = useState(false);
  const [toast,      setToast]      = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) return;
      const a = JSON.parse(raw);
      setAssoc(a);
      const [mRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/associations/association_members.php?association_id=${a.id}`),
        fetch(`${API_BASE}/routes/get_association_routes.php?association_id=${a.id}`),
      ]);
      const [mData, rData] = await Promise.all([mRes.json(), rRes.json()]);
      if (mData.success) setOperators(mData.operators ?? []);
      if (rData.success) setAssocRoutes(
        (rData.routes ?? []).map((r: any) => ({ id: r.id, name: r.name, color: r.color }))
      );
    } catch (_) {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalDrivers = useMemo(
    () => operators.reduce((sum, op) => sum + op.drivers.length, 0),
    [operators]
  );

  // Search filters operators (by name) and their drivers (by name/license/phone);
  // an operator stays visible if it matches, or any of its drivers match.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return operators;
    return operators
      .map((op) => {
        const opMatches = op.name.toLowerCase().includes(q);
        const drivers = opMatches ? op.drivers : op.drivers.filter((d) =>
          d.name.toLowerCase().includes(q) ||
          d.license_number.toLowerCase().includes(q) ||
          d.phone.toLowerCase().includes(q)
        );
        return { ...op, drivers };
      })
      .filter((op) => op.name.toLowerCase().includes(q) || op.drivers.length > 0);
  }, [operators, search]);

  const handleAssign = async (routeId: number) => {
    if (!assignTarget || !assoc) return;
    setAssigning(true);
    try {
      const res  = await fetch(`${API_BASE}/associations/assign_association_driver.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          association_id: assoc.id,
          route_id:       routeId,
          driver_id:      assignTarget.id,
          action:         "assign",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAssignTarget(null);
        showToast(`${assignTarget.name} assigned to route.`);
        load();
      } else {
        showToast(data.message ?? "Assignment failed.");
        setAssignTarget(null);
      }
    } catch (_) {
      showToast("Network error. Please try again.");
      setAssignTarget(null);
    } finally {
      setAssigning(false);
    }
  };

  const handleKickConfirm = async () => {
    if (!kickTarget || !assoc || !kickVehicleType) return;
    setKicking(true);
    try {
      const res  = await fetch(`${API_BASE}/associations/kick_operator.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ association_id: assoc.id, operator_id: kickTarget.id, vehicle_type: kickVehicleType }),
      });
      const data = await res.json();
      if (data.success) {
        setKickTarget(null);
        setKickVehicleType(null);
        showToast(`${kickTarget.name} (${kickVehicleType}) has been removed from the association.`);
        load();
      } else {
        showToast(data.message ?? "Failed to remove operator.");
        setKickTarget(null);
        setKickVehicleType(null);
      }
    } catch (_) {
      showToast("Network error. Please try again.");
      setKickTarget(null);
      setKickVehicleType(null);
    } finally {
      setKicking(false);
    }
  };

  if (loading) return (
    <View style={styles.centered}><ActivityIndicator color="#1a4a52" size="large" /></View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Members</Text>
        <Text style={styles.headerSub}>
          {operators.length} operator{operators.length !== 1 ? "s" : ""} · {totalDrivers} driver{totalDrivers !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* ── SEARCH BAR ── */}
      <View style={styles.filterBar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={15} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search operators or drivers..."
            placeholderTextColor="#9ca3af"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color="#9ca3af" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── LIST ── */}
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#1a4a52" />
        }
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="business-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>
              {operators.length === 0
                ? "No member operators yet.\nApprove operator applications to see them here."
                : "No members match your search."}
            </Text>
          </View>
        ) : (
          filtered.map((op) => (
            <OperatorSection
              key={op.id}
              operator={op}
              onKick={() => { setKickTarget(op); setKickVehicleType(op.vehicle_types.length === 1 ? op.vehicle_types[0] : null); }}
              onAssign={(d) => setAssignTarget(d)}
              forceOpen={search.trim().length > 0}
              defaultOpen={operators.length === 1}
            />
          ))
        )}
      </ScrollView>

      {/* ── ASSIGN ROUTE MODAL ── */}
      <Modal
        visible={assignTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!assigning) setAssignTarget(null); }}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => { if (!assigning) setAssignTarget(null); }}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Assign to Route</Text>
            {assignTarget && (
              <Text style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
                Select a route for{" "}
                <Text style={{ fontWeight: "800", color: "#111827" }}>{assignTarget.name}</Text>
              </Text>
            )}
            {assocRoutes.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
                <Ionicons name="map-outline" size={36} color="#d1d5db" />
                <Text style={{ fontSize: 13, color: "#9ca3af", textAlign: "center" }}>
                  No routes registered yet.{"\n"}Create routes in Route Builder first.
                </Text>
              </View>
            ) : (
              assocRoutes.map((route) => (
                <TouchableOpacity
                  key={route.id}
                  style={[styles.pickerOption, assigning && { opacity: 0.5 }]}
                  onPress={() => handleAssign(route.id)}
                  disabled={assigning}
                >
                  <View style={styles.pickerOptionLeft}>
                    <View style={[styles.pickerDot, { backgroundColor: route.color }]} />
                    <Text style={styles.pickerOptionName}>{route.name}</Text>
                  </View>
                  {assigning
                    ? <ActivityIndicator size="small" color="#1a4a52" />
                    : <Ionicons name="chevron-forward" size={16} color="#9ca3af" />}
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity
              style={[styles.confirmBtn, styles.confirmBtnCancel, { marginTop: 8 }]}
              onPress={() => setAssignTarget(null)}
              disabled={assigning}
            >
              <Text style={styles.confirmBtnCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── KICK OPERATOR MODAL ── */}
      <Modal
        visible={kickTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!kicking) { setKickTarget(null); setKickVehicleType(null); } }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmBox}>
            <View style={styles.confirmIconWrap}>
              <Ionicons name="business" size={28} color="#dc2626" />
            </View>
            <Text style={styles.confirmTitle}>Remove Operator</Text>
            <Text style={styles.confirmMsg}>
              Remove <Text style={styles.confirmName}>{kickTarget?.name}</Text> from the association
              {kickVehicleType ? <> for <Text style={styles.confirmName}>{kickVehicleType}</Text></> : null}?{"\n"}
              This clears their {kickVehicleType ?? "that vehicle type's"} route assignments.
            </Text>
            {kickTarget && kickTarget.vehicle_types.length > 1 && (
              <View style={styles.kickTypeRow}>
                {kickTarget.vehicle_types.map(vt => (
                  <Pressable
                    key={vt}
                    style={[styles.kickTypeChip, kickVehicleType === vt && styles.kickTypeChipActive]}
                    onPress={() => setKickVehicleType(vt)}
                  >
                    <Text style={[styles.kickTypeChipText, kickVehicleType === vt && styles.kickTypeChipTextActive]}>{vt}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.confirmActions}>
              <Pressable
                style={[styles.confirmBtn, styles.confirmBtnCancel]}
                onPress={() => { setKickTarget(null); setKickVehicleType(null); }}
                disabled={kicking}
              >
                <Text style={styles.confirmBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmBtn, styles.confirmBtnDanger, (kicking || !kickVehicleType) && styles.confirmBtnDisabled]}
                onPress={handleKickConfirm}
                disabled={kicking || !kickVehicleType}
              >
                {kicking
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.confirmBtnDangerText}>Remove</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── TOAST ── */}
      {toast !== null && (
        <View style={[styles.toast, { bottom: insets.bottom + 90 }]}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

// Tap the operator to open/close its drivers. Operators start closed (a long
// roster no longer buries the next operator), except a lone operator which
// starts open; while a search is active every match is forced open so a driver
// found by search is never hidden inside a closed operator. An operator with
// more than a few drivers scrolls them inside their own box, so one big fleet
// can't push everything else off screen.
function OperatorSection({ operator, onKick, onAssign, forceOpen, defaultOpen }: {
  operator: MemberOperator; onKick: () => void; onAssign: (d: MemberDriver) => void;
  forceOpen: boolean; defaultOpen: boolean;
}) {
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(defaultOpen);
  const expanded = forceOpen || open;
  const count = operator.drivers.length;

  const rows = operator.drivers.map((d) => (
    <DriverRow key={d.id} driver={d} onAssign={d.assigned_route_id === null ? () => onAssign(d) : undefined} />
  ));

  return (
    <View style={styles.opSection}>
      <View style={styles.opHeader}>
        <TouchableOpacity
          style={styles.opTap}
          onPress={() => setOpen((o) => !o)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${operator.name}, ${count} driver${count !== 1 ? "s" : ""}. Tap to ${expanded ? "collapse" : "expand"}`}
        >
          <View style={styles.opIcon}>
            <Ionicons name="business" size={18} color="#1a4a52" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.opName} numberOfLines={1}>{operator.name}</Text>
            <Text style={styles.opMeta} numberOfLines={1}>{operator.vehicle_types.join(", ")} · {operator.phone}</Text>
          </View>
          <View style={styles.countPill}>
            <Ionicons name="people" size={12} color="#1a4a52" />
            <Text style={styles.countPillText}>{count}</Text>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color="#6b7280" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.kickBtn} onPress={onKick} activeOpacity={0.75}>
          <Ionicons name="close-circle-outline" size={14} color="#dc2626" />
          <Text style={styles.kickBtnText}>Remove</Text>
        </TouchableOpacity>
      </View>

      {expanded && (
        count === 0 ? (
          <Text style={styles.noDriversText}>No drivers under this operator yet.</Text>
        ) : count > 3 ? (
          <ScrollView
            style={{ maxHeight: Math.round(height * 0.5) }}
            contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            persistentScrollbar
          >
            {rows}
          </ScrollView>
        ) : (
          rows
        )
      )}
    </View>
  );
}

function DriverRow({ driver, onAssign }: { driver: MemberDriver; onAssign?: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardIcon}>
        <Ionicons name="person" size={20} color="#3b82f6" />
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardName}>{driver.name}</Text>

        <View style={styles.cardMeta}>
          <View style={styles.cardMetaItem}>
            <Ionicons name="card-outline" size={11} color="#9ca3af" />
            <Text style={styles.cardMetaText}>{driver.license_number}</Text>
          </View>
          <View style={styles.cardMetaItem}>
            <Ionicons name="call-outline" size={11} color="#9ca3af" />
            <Text style={styles.cardMetaText}>{driver.phone}</Text>
          </View>
        </View>

        {driver.vehicle_plate ? (
          <View style={styles.cardMetaItem}>
            <Ionicons name="car-outline" size={11} color="#6b7280" />
            <Text style={styles.cardMetaText}>
              {driver.vehicle_type} · {driver.vehicle_plate}
            </Text>
          </View>
        ) : (
          <View style={styles.cardMetaItem}>
            <Ionicons name="car-outline" size={11} color="#d97706" />
            <Text style={[styles.cardMetaText, { color: "#d97706" }]}>No vehicle assigned</Text>
          </View>
        )}

        {driver.assigned_route ? (
          <View style={styles.cardRouteBadge}>
            <View style={[styles.cardRouteDot, { backgroundColor: driver.assigned_route_color ?? "#9ca3af" }]} />
            <Text style={styles.cardRouteText}>{driver.assigned_route}</Text>
          </View>
        ) : (
          <View style={[styles.cardRouteBadge, { backgroundColor: "#fef9c3" }]}>
            <Ionicons name="map-outline" size={10} color="#d97706" />
            <Text style={[styles.cardRouteText, { color: "#d97706" }]}>No route assigned</Text>
          </View>
        )}
      </View>

      {onAssign && (
        <TouchableOpacity style={styles.assignRouteBtn} onPress={onAssign} activeOpacity={0.75}>
          <Ionicons name="map" size={13} color="#1a4a52" />
          <Text style={styles.assignRouteBtnText}>Assign</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: "#f3f4f6" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    paddingHorizontal: 20, paddingVertical: 16,
    backgroundColor: "#1a4a52",
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },
  headerSub:   { fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 },

  filterBar: {
    backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "#f3f4f6",
  },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#f3f4f6", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  searchInput: {
    flex: 1, fontSize: 13, color: "#111827", padding: 0,
  },

  list: { padding: 16, paddingBottom: 32, gap: 16 },

  opSection: { gap: 8 },
  // flexWrap + opTap's minWidth: on a narrow phone the Remove button drops to its
  // own line, so the operator's name gets the full row instead of being squeezed
  // to a few letters ("Pedr…") next to the count, chevron and Remove button.
  opHeader: {
    flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10,
    backgroundColor: "#fff", borderRadius: 14, padding: 12,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  opTap:  { flex: 1, minWidth: 200, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  countPill: {
    flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0,
    backgroundColor: "#f0faf4", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4,
  },
  countPillText: { fontSize: 12, fontWeight: "800", color: "#1a4a52" },
  opIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#f0faf4", alignItems: "center", justifyContent: "center" },
  opName: { fontSize: 14, fontWeight: "800", color: "#111827" },
  opMeta: { fontSize: 11, color: "#9ca3af", marginTop: 1 },
  noDriversText: { fontSize: 12, color: "#9ca3af", paddingLeft: 12, fontStyle: "italic" },

  card: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14, marginLeft: 16,
    flexDirection: "row", alignItems: "center", gap: 12,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#eff6ff",
    alignItems: "center", justifyContent: "center",
  },
  cardBody:     { flex: 1, gap: 3 },
  cardName:     { fontSize: 14, fontWeight: "800", color: "#111827" },
  cardMeta:     { flexDirection: "row", gap: 10, marginTop: 2 },
  cardMetaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  cardMetaText: { fontSize: 11, color: "#9ca3af" },

  cardRouteBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#f0fdf4", borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: "flex-start", marginTop: 2,
  },
  cardRouteDot:  { width: 7, height: 7, borderRadius: 4 },
  cardRouteText: { fontSize: 11, fontWeight: "700", color: "#15803d" },

  kickBtn: {
    marginLeft: "auto",
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#fef2f2", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6,
    borderWidth: 1, borderColor: "#fecaca",
  },
  kickBtnText: { fontSize: 11, fontWeight: "700", color: "#dc2626" },

  assignRouteBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#f0fdf4", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: 1, borderColor: "#bbf7d0",
  },
  assignRouteBtnText: { fontSize: 11, fontWeight: "700", color: "#1a4a52" },

  emptyWrap: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: "#9ca3af", textAlign: "center", lineHeight: 20 },

  // ── Pickers ──────────────────────────────────────────────────────────────────
  pickerOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36,
  },
  pickerHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 16,
  },
  pickerTitle: { fontSize: 16, fontWeight: "900", color: "#1a4a52", marginBottom: 12 },
  pickerOption: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10, marginBottom: 4,
  },
  pickerOptionLeft:   { flexDirection: "row", alignItems: "center", gap: 12 },
  pickerDot:          { width: 12, height: 12, borderRadius: 6 },
  pickerOptionName:   { fontSize: 14, fontWeight: "700", color: "#111827" },

  // ── Kick confirm ─────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  confirmBox: {
    backgroundColor: "#fff", borderRadius: 16, padding: 24,
    width: "100%", maxWidth: 360, alignItems: "center", gap: 12,
  },
  confirmIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "#fef2f2",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  confirmTitle: { fontSize: 17, fontWeight: "800", color: "#111827" },
  confirmMsg:   { fontSize: 13, color: "#6b7280", textAlign: "center", lineHeight: 20 },
  kickTypeRow:  { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  kickTypeChip: { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  kickTypeChipActive: { borderColor: "#dc2626", backgroundColor: "#fef2f2" },
  kickTypeChipText: { fontSize: 12, fontWeight: "700", color: "#9ca3af" },
  kickTypeChipTextActive: { color: "#dc2626" },
  confirmName:  { fontWeight: "800", color: "#111827" },
  confirmActions: { flexDirection: "row", gap: 10, marginTop: 4, width: "100%" },
  confirmBtn:     { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  confirmBtnCancel:      { backgroundColor: "#f3f4f6" },
  confirmBtnCancelText:  { fontSize: 14, fontWeight: "700", color: "#374151" },
  confirmBtnDanger:      { backgroundColor: "#dc2626" },
  confirmBtnDangerText:  { fontSize: 14, fontWeight: "700", color: "#fff" },
  confirmBtnDisabled:    { opacity: 0.6 },

  toast: {
    position: "absolute", left: 20, right: 20,
    backgroundColor: "#1a4a52", borderRadius: 12,
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, elevation: 6,
  },
  toastText: { fontSize: 13, fontWeight: "700", color: "#fff", flex: 1 },
});
