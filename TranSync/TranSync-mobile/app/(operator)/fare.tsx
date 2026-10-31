import { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, RefreshControl, Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import { groupApprovedByAssociation, resolveActiveAssociation, type AssocApplication } from "../../src/utils/activeAssociation";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

// ─── Types ────────────────────────────────────────────────────────────────────

type VehicleKind = "Jeepney" | "UV Express" | "Bus";

type Route = {
  id:            number;
  from_location: string;
  to_location:   string;
  fare:          number | null;
  status:        "active" | "inactive";
  color:         string | null;
  vehicle_type:  string | null;
};

type ClassFare = { service_type_id: number; service_type_name: string; base_fare: number };
type BusRouteFares = Route & { fares: ClassFare[] };

const KIND_META: Record<VehicleKind, { color: string; icon: string }> = {
  "Jeepney":    { color: "#16a34a", icon: "bus" },
  "UV Express": { color: "#9333ea", icon: "car" },
  "Bus":        { color: "#2563eb", icon: "bus-outline" },
};

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function FareScreen() {
  const insets = useSafeAreaInsets();

  const [operatorId,     setOperatorId]     = useState<number | null>(null);
  const [kind,           setKind]           = useState<VehicleKind>("Bus");
  // An operator can hold multiple approved vehicle-type memberships now, so
  // the fare screen shows a kind switcher when more than one applies instead
  // of assuming one fixed operator_type.
  const [availableKinds, setAvailableKinds] = useState<VehicleKind[]>([]);
  const [busAssociationId, setBusAssociationId] = useState<number | null>(null);
  const [routes,         setRoutes]         = useState<Route[]>([]);
  const [busRoutes,      setBusRoutes]      = useState<BusRouteFares[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [toast,          setToast]          = useState("");

  // Fare-update modal (Jeepney / UV Express only — Bus fares are association-set)
  const [editingRoute,   setEditingRoute]   = useState<Route | null>(null);
  const [fareInput,      setFareInput]      = useState("");
  const [fareSubmitting, setFareSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) return;
      const u = JSON.parse(raw);
      setOperatorId(u.id);

      // Scoped to the operator's currently *active* association (Profile →
      // My Associations → Switch) — for an operator with only one
      // association this is identical to every approved type, so nothing
      // changes for them.
      const statusRes = await fetch(`${API_BASE}/operators/association_status.php?operator_id=${u.id}`).then(r => r.json());
      const apps: AssocApplication[] = statusRes?.applications ?? [];
      const groups = groupApprovedByAssociation(apps);
      const activeAssoc = await resolveActiveAssociation(groups);
      const kinds: VehicleKind[] = (activeAssoc?.vehicle_types ?? []) as VehicleKind[];
      setAvailableKinds(kinds);
      const busAssocId = kinds.includes("Bus") ? activeAssoc!.association_id : null;
      setBusAssociationId(busAssocId);

      const k: VehicleKind = kinds[0] ?? "Bus";
      setKind(k);
      loadRoutes(u.id, k, false, busAssocId);
    })();
  }, []);

  const switchKind = (k: VehicleKind) => {
    setKind(k);
    if (operatorId) loadRoutes(operatorId, k, false, busAssociationId);
  };

  const loadRoutes = async (opId: number, k: VehicleKind, isRefresh = false, busAssocId?: number | null) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      if (k === "Bus") {
        // Bus routes + fares are association-owned — pull from the operator's
        // own approved Bus association (read-only) instead of the operator-owned list.
        const associationId = busAssocId !== undefined ? busAssocId : busAssociationId;
        if (!associationId) { setBusRoutes([]); return; }

        const routesRes = await fetch(`${API_BASE}/routes/get_association_routes.php?association_id=${associationId}`).then(r => r.json());
        const list: Route[] = Array.isArray(routesRes?.routes)
          ? routesRes.routes.filter((r: Route) => r.vehicle_type === "Bus")
          : [];

        const withFares = await Promise.all(list.map(async (r) => {
          const faresRes = await fetch(`${API_BASE}/routes/set_service_fare.php?route_id=${r.id}`).then(res => res.json());
          return { ...r, fares: Array.isArray(faresRes?.fares) ? faresRes.fares : [] };
        }));
        setBusRoutes(withFares);
      } else {
        const res  = await fetch(`${API_BASE}/routes/routes.php?operator_id=${opId}`);
        const data = await res.json();
        const list: Route[] = Array.isArray(data) ? data : [];
        setRoutes(list.filter(r => (r.vehicle_type ?? k) === k));
      }
    } catch { setRoutes([]); setBusRoutes([]); }
    finally  { setLoading(false); setRefreshing(false); }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // ── Toggle status (Jeepney / UV Express) ────────────────────────────────────

  const handleToggle = async (route: Route) => {
    const next = route.status === "active" ? "inactive" : "active";
    try {
      await fetch(`${API_BASE}/routes/routes.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: route.id, status: next }),
      });
      setRoutes(prev => prev.map(r => r.id === route.id ? { ...r, status: next } : r));
      showToast(`Route marked ${next}.`);
    } catch { showToast("Failed to update status."); }
  };

  // ── Delete route (Jeepney / UV Express) ─────────────────────────────────────

  const handleDelete = (route: Route) => {
    Alert.alert(
      "Remove Route",
      `Remove "${route.from_location} → ${route.to_location}"?\nThis cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: async () => {
          try {
            await fetch(`${API_BASE}/routes/routes.php`, {
              method: "DELETE", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: route.id }),
            });
            setRoutes(prev => prev.filter(r => r.id !== route.id));
            showToast("Route removed.");
          } catch { showToast("Failed to remove route."); }
        }},
      ]
    );
  };

  // ── Fare update (Jeepney / UV Express) ──────────────────────────────────────

  const openFareEdit = (route: Route) => {
    setEditingRoute(route);
    setFareInput(route.fare != null ? String(route.fare) : "");
  };

  const handleSaveFare = async () => {
    if (!editingRoute) return;
    const parsed = fareInput.trim() === "" ? null : parseFloat(fareInput);
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) {
      showToast("Enter a valid fare amount.");
      return;
    }
    setFareSubmitting(true);
    try {
      await fetch(`${API_BASE}/routes/routes.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingRoute.id, fare: parsed }),
      });
      setRoutes(prev => prev.map(r =>
        r.id === editingRoute.id ? { ...r, fare: parsed } : r
      ));
      setEditingRoute(null);
      showToast("Fare updated!");
    } catch { showToast("Failed to update fare."); }
    finally  { setFareSubmitting(false); }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const accentCol = KIND_META[kind].color;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {toast !== "" && (
        <View style={[s.toast, { top: insets.top + 80 }]}>
          <Ionicons name="checkmark-circle" size={14} color="#a8d832" />
          <Text style={s.toastText}>{toast}</Text>
        </View>
      )}

      {/* Header */}
      <View style={[s.header, { borderBottomColor: accentCol + "33" }]}>
        <View style={[s.headerIcon, { backgroundColor: accentCol + "1a" }]}>
          <Ionicons name={KIND_META[kind].icon as any} size={20} color={accentCol} />
        </View>
        <View>
          <Text style={s.headerTitle}>Fare Management</Text>
          <Text style={[s.headerSub, { color: accentCol }]}>{kind} routes</Text>
        </View>
      </View>

      {availableKinds.length > 1 && (
        <View style={s.kindRow}>
          {availableKinds.map(k => {
            const active = kind === k;
            const c = KIND_META[k].color;
            return (
              <TouchableOpacity
                key={k}
                style={[s.kindChip, active && { backgroundColor: c + "18", borderColor: c }]}
                onPress={() => switchKind(k)}
                activeOpacity={0.8}
              >
                <Ionicons name={KIND_META[k].icon as any} size={14} color={active ? c : "#9ca3af"} />
                <Text style={[s.kindChipText, active && { color: c }]}>{k}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={accentCol} />
        </View>
      ) : kind === "Bus" ? (
        // ── Bus: read-only — the association owns the route and its per-class fares ──
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => operatorId && loadRoutes(operatorId, kind, true)}
              colors={[accentCol]}
              tintColor={accentCol}
            />
          }
        >
          <View style={[s.guideCard, { borderColor: accentCol + "40" }]}>
            <View style={s.guideHeader}>
              <Ionicons name="business-outline" size={15} color={accentCol} />
              <Text style={[s.guideTitle, { color: accentCol }]}>Managed by Your Association</Text>
            </View>
            <Text style={s.guideNoteStandalone}>
              Bus routes and their per-class fares are set entirely by your association.
              You can assign a class to your vehicles (Vehicles tab) and set up their seat
              layout, but the route and price shown here are read-only.
            </Text>
          </View>

          <View style={s.sectionRow}>
            <Text style={s.sectionLabel}>Point-to-Point Routes</Text>
            <Text style={s.sectionCount}>{busRoutes.length} route{busRoutes.length !== 1 ? "s" : ""}</Text>
          </View>

          {busRoutes.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="map-outline" size={48} color="#d1d5db" />
              <Text style={s.emptyTitle}>No routes yet</Text>
              <Text style={s.emptySub}>
                Your association hasn't published any Bus routes yet.
              </Text>
            </View>
          ) : (
            busRoutes.map(route => (
              <View key={route.id} style={s.card}>
                <View style={[s.cardBar, { backgroundColor: accentCol }]} />
                <View style={s.cardBody}>

                  <View style={s.ptpRow}>
                    <View style={s.ptpStop}>
                      <View style={[s.ptpDot, { backgroundColor: accentCol }]} />
                      <Text style={[s.ptpText, { color: accentCol }]} numberOfLines={2}>
                        {route.from_location || "Origin"}
                      </Text>
                    </View>
                    <View style={s.ptpMid}>
                      <View style={[s.ptpLine, { backgroundColor: accentCol + "30" }]} />
                      <Ionicons name="arrow-forward-circle" size={22} color="#a8d832" />
                      <View style={[s.ptpLine, { backgroundColor: accentCol + "30" }]} />
                    </View>
                    <View style={s.ptpStop}>
                      <View style={[s.ptpDot, { backgroundColor: "#a8d832" }]} />
                      <Text style={s.ptpTextDest} numberOfLines={2}>
                        {route.to_location || "Destination"}
                      </Text>
                    </View>
                  </View>

                  {route.fares.length === 0 ? (
                    <Text style={s.noClassFares}>No class fares set yet.</Text>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {route.fares.map(f => (
                        <View key={f.service_type_id} style={[s.classFareRow, { borderColor: accentCol + "30" }]}>
                          <Text style={s.classFareName}>{f.service_type_name}</Text>
                          <Text style={[s.classFareAmount, { color: accentCol }]}>₱{Number(f.base_fare).toFixed(2)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      ) : (
        // ── Jeepney / UV Express: operator sets a flat fare directly ─────────────
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => operatorId && loadRoutes(operatorId, kind, true)}
              colors={[accentCol]}
              tintColor={accentCol}
            />
          }
        >
          <View style={s.sectionRow}>
            <Text style={s.sectionLabel}>Point-to-Point Routes</Text>
            <Text style={s.sectionCount}>{routes.length} route{routes.length !== 1 ? "s" : ""}</Text>
          </View>

          {routes.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="map-outline" size={48} color="#d1d5db" />
              <Text style={s.emptyTitle}>No routes assigned</Text>
              <Text style={s.emptySub}>
                Routes assigned to your drivers will appear here so you can set their fares.
              </Text>
            </View>
          ) : (
            routes.map(route => (
              <View key={route.id} style={s.card}>
                <View style={[s.cardBar, { backgroundColor: accentCol }]} />
                <View style={s.cardBody}>

                  {/* Point-to-point */}
                  <View style={s.ptpRow}>
                    <View style={s.ptpStop}>
                      <View style={[s.ptpDot, { backgroundColor: accentCol }]} />
                      <Text style={[s.ptpText, { color: accentCol }]} numberOfLines={2}>
                        {route.from_location || "Origin"}
                      </Text>
                    </View>
                    <View style={s.ptpMid}>
                      <View style={[s.ptpLine, { backgroundColor: accentCol + "30" }]} />
                      <Ionicons name="arrow-forward-circle" size={22} color="#a8d832" />
                      <View style={[s.ptpLine, { backgroundColor: accentCol + "30" }]} />
                    </View>
                    <View style={s.ptpStop}>
                      <View style={[s.ptpDot, { backgroundColor: "#a8d832" }]} />
                      <Text style={s.ptpTextDest} numberOfLines={2}>
                        {route.to_location || "Destination"}
                      </Text>
                    </View>
                  </View>

                  {/* Fare box */}
                  <View style={[s.fareBox, { borderColor: accentCol + "30" }]}>
                    <View>
                      <Text style={s.fareTag}>FARE PER PERSON</Text>
                      <Text style={[s.fareAmount, route.fare == null && s.fareAmountUnset]}>
                        {route.fare != null
                          ? `₱${Number(route.fare).toFixed(2)}`
                          : "Not set"}
                      </Text>
                      {route.fare != null && (
                        <Text style={s.fareSub}>commuters see this when booking</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={[s.updateBtn, { backgroundColor: accentCol }]}
                      onPress={() => openFareEdit(route)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="create-outline" size={14} color="#fff" />
                      <Text style={s.updateBtnText}>
                        {route.fare != null ? "Update" : "Set Fare"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Status + delete */}
                  <View style={s.cardFooter}>
                    <TouchableOpacity
                      style={[
                        s.statusBtn,
                        { backgroundColor: route.status === "active" ? "#f0fdf4" : "#fef2f2" },
                      ]}
                      onPress={() => handleToggle(route)}
                      activeOpacity={0.8}
                    >
                      <View style={[s.statusDot, { backgroundColor: route.status === "active" ? "#16a34a" : "#dc2626" }]} />
                      <Text style={[s.statusText, { color: route.status === "active" ? "#16a34a" : "#dc2626" }]}>
                        {route.status === "active" ? "Active — visible to commuters" : "Inactive — hidden from commuters"}
                      </Text>
                      <Ionicons name="swap-horizontal-outline" size={12} color={route.status === "active" ? "#16a34a" : "#dc2626"} />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.deleteBtn} onPress={() => handleDelete(route)} activeOpacity={0.8}>
                      <Ionicons name="trash-outline" size={15} color="#ef4444" />
                      <Text style={s.deleteBtnText}>Delete</Text>
                    </TouchableOpacity>
                  </View>

                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* ══ FARE UPDATE MODAL (Jeepney / UV Express) ══ */}
      <Modal
        visible={editingRoute !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingRoute(null)}
      >
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={s.handle} />
            <Text style={s.sheetTitle}>
              {editingRoute?.fare != null ? "Update Fare" : "Set Fare"}
            </Text>

            {/* Route recap */}
            <View style={[s.routeRecap, { borderColor: accentCol + "30" }]}>
              <View style={[s.ptpDot, { backgroundColor: accentCol }]} />
              <Text style={s.recapText} numberOfLines={1}>{editingRoute?.from_location}</Text>
              <Ionicons name="arrow-forward" size={13} color="#a8d832" />
              <Text style={s.recapText} numberOfLines={1}>{editingRoute?.to_location}</Text>
              <View style={[s.ptpDot, { backgroundColor: "#a8d832" }]} />
            </View>

            {editingRoute?.fare != null && (
              <View style={[s.currentFare, { borderColor: accentCol + "30" }]}>
                <Text style={s.currentFareLabel}>Current fare</Text>
                <Text style={[s.currentFareValue, { color: accentCol }]}>
                  ₱{Number(editingRoute.fare).toFixed(2)}
                </Text>
              </View>
            )}

            <Text style={s.fieldLabel}>New Fare (₱ per person)</Text>
            <TextInput
              style={[s.input, s.inputLarge]}
              placeholder="e.g. 250.00"
              placeholderTextColor="#9ca3af"
              value={fareInput}
              onChangeText={setFareInput}
              keyboardType="decimal-pad"
              autoFocus
            />
            <Text style={s.inputHint}>
              Leave blank to remove the fare.
            </Text>

            <View style={s.sheetActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setEditingRoute(null)}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, { backgroundColor: accentCol }, fareSubmitting && { opacity: 0.6 }]}
                onPress={handleSaveFare}
                disabled={fareSubmitting}
              >
                {fareSubmitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.saveBtnText}>Save Fare</Text>}
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f9fafb" },

  toast:     { position: "absolute", top: 100, left: 20, right: 20, zIndex: 99, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, padding: 12 },

  kindRow:      { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  kindChip:     { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  kindChipText: { fontSize: 12, fontWeight: "700", color: "#9ca3af" },
  toastText: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "700" },

  header:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  headerIcon:  { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  headerSub:   { fontSize: 12, fontWeight: "700", marginTop: 1 },

  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  scroll: { padding: 16, gap: 14, paddingBottom: 40 },

  guideCard:   { borderRadius: 16, padding: 16, borderWidth: 1.5, backgroundColor: "#fff" },
  guideHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  guideTitle:  { fontSize: 13, fontWeight: "800" },
  guideNoteStandalone: { fontSize: 12, color: "#374151", lineHeight: 18 },

  sectionRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.8 },
  sectionCount: { fontSize: 11, fontWeight: "700", color: "#9ca3af" },

  empty:      { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#374151" },
  emptySub:   { fontSize: 13, color: "#9ca3af", textAlign: "center", paddingHorizontal: 24, lineHeight: 20 },

  card:    { flexDirection: "row", backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", borderWidth: 1.5, borderColor: "#f1f5f9", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardBar: { width: 5, alignSelf: "stretch" },
  cardBody:{ flex: 1, padding: 16, gap: 12 },

  ptpRow:    { flexDirection: "row", alignItems: "center" },
  ptpStop:   { flex: 1, alignItems: "center", gap: 5 },
  ptpDot:    { width: 10, height: 10, borderRadius: 5 },
  ptpText:   { fontSize: 13, fontWeight: "800", textAlign: "center" },
  ptpTextDest:{ fontSize: 13, fontWeight: "800", textAlign: "center", color: "#374151" },
  ptpMid:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 4 },
  ptpLine:   { width: 14, height: 1.5 },

  fareBox:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1.5 },
  fareTag:     { fontSize: 9, fontWeight: "800", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.8 },
  fareAmount:  { fontSize: 26, fontWeight: "900", color: "#1a4a52" },
  fareAmountUnset: { fontSize: 16, color: "#9ca3af", fontStyle: "italic" },
  fareSub:     { fontSize: 10, color: "#6b7280", fontWeight: "600", marginTop: 1 },
  updateBtn:   { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  updateBtnText: { fontSize: 13, fontWeight: "800", color: "#fff" },

  noClassFares: { fontSize: 12, color: "#9ca3af", fontStyle: "italic" },
  classFareRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#f8fafc", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1.5,
  },
  classFareName:   { fontSize: 13, fontWeight: "700", color: "#374151" },
  classFareAmount: { fontSize: 15, fontWeight: "900" },

  cardFooter: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBtn:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  statusDot:  { width: 7, height: 7, borderRadius: 4 },
  statusText: { flex: 1, fontSize: 11, fontWeight: "700" },
  deleteBtn:  { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, borderRadius: 10, paddingHorizontal: 10, backgroundColor: "#fef2f2", justifyContent: "center", borderWidth: 1, borderColor: "#fecaca" },
  deleteBtnText: { fontSize: 12, fontWeight: "700", color: "#ef4444" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:   { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  handle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },

  sheetTitleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  sheetTitleIcon:{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sheetTitle:    { fontSize: 20, fontWeight: "900", color: "#1a4a52" },

  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  input:      { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#f9fafb", marginBottom: 14 },
  inputLarge: { fontSize: 20, fontWeight: "800", color: "#1a4a52" },
  inputHint:  { fontSize: 11, color: "#9ca3af", marginBottom: 20, lineHeight: 16, marginTop: -10 },

  routeRecap:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f9fafb", borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1.5 },
  recapText:   { fontSize: 13, fontWeight: "700", color: "#374151", flex: 1 },

  currentFare:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f8fafc", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16, borderWidth: 1.5 },
  currentFareLabel: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  currentFareValue: { fontSize: 20, fontWeight: "900" },

  sheetActions:  { flexDirection: "row", gap: 10 },
  cancelBtn:     { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  cancelBtnText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  saveBtn:       { flex: 2, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  saveBtnText:   { fontSize: 14, fontWeight: "800", color: "#fff" },
});
