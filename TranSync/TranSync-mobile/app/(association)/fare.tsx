import { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, RefreshControl, Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import API_BASE, { FILE_BASE } from "../../src/config/api";
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

type ServiceType = { id: number; name: string; description: string | null };
type ClassFare = { service_type_id: number; service_type_name: string; base_fare: number };
type FareGuide  = { id: number; vehicle_type: VehicleKind; label: string; url: string };

const KIND_META: Record<VehicleKind, { color: string; icon: string }> = {
  "Jeepney":    { color: "#16a34a", icon: "bus" },
  "UV Express": { color: "#9333ea", icon: "car" },
  "Bus":        { color: "#2563eb", icon: "bus-outline" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectKind(vehicleType: string): VehicleKind {
  const t = (vehicleType ?? "").toLowerCase();
  if (t.includes("jeepney")) return "Jeepney";
  if (t.includes("uv") || t.includes("express")) return "UV Express";
  if (t.includes("bus")) return "Bus";
  return "Jeepney";
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function FareScreen() {
  const insets = useSafeAreaInsets();

  const [associationId,  setAssociationId]  = useState<number | null>(null);
  const [kind,           setKind]           = useState<VehicleKind>("Jeepney");
  // An association can now publish routes of all three vehicle kinds at once
  // (no more fixed association_type) — always show all three as switchable
  // tabs, regardless of whether the association has routes of each kind yet;
  // each tab falls back to its own "no routes yet" empty state.
  const availableKinds: VehicleKind[] = ["Jeepney", "UV Express", "Bus"];
  const [allRoutes,      setAllRoutes]      = useState<Route[]>([]);
  const [routes,         setRoutes]         = useState<Route[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [toast,          setToast]          = useState("");

  // Fare-update modal (Jeepney / UV Express — flat fare)
  const [editingRoute,   setEditingRoute]   = useState<Route | null>(null);
  const [fareInput,      setFareInput]      = useState("");
  const [fareSubmitting, setFareSubmitting] = useState(false);

  // Classes (Bus only) — association owns this catalog
  const [classes,          setClasses]          = useState<ServiceType[]>([]);
  const [showClasses,      setShowClasses]      = useState(false);
  const [newClassName,     setNewClassName]     = useState("");
  const [addingClass,      setAddingClass]      = useState(false);

  // Per-route class fare editor (Bus only)
  const [fareRoute,        setFareRoute]        = useState<Route | null>(null);
  const [routeFares,       setRouteFares]       = useState<ClassFare[]>([]);
  const [loadingRouteFares, setLoadingRouteFares] = useState(false);
  const [classFareInputs,  setClassFareInputs]  = useState<Record<number, string>>({});
  const [classFareBusy,    setClassFareBusy]    = useState<number | null>(null);

  // LTFRB official fare reference — read-only, seeded once directly into
  // the database (no upload/edit/delete endpoint anywhere), so a single
  // fetch-all-on-mount is enough; no refetch-on-refresh needed since this
  // data can't change from inside the app. See Core Flow 13a.
  const [ltfrbGuides,   setLtfrbGuides]   = useState<FareGuide[]>([]);
  const [openingGuideId, setOpeningGuideId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) return;
      const u = JSON.parse(raw);
      setAssociationId(u.id);
      loadRoutes(u.id);
      loadClasses(u.id);
    })();
    loadLtfrbGuides();
  }, []);

  const loadLtfrbGuides = async () => {
    try {
      const res  = await fetch(`${API_BASE}/reference/ltfrb_fare_guides.php`);
      const data = await res.json();
      if (data.success) setLtfrbGuides(data.guides ?? []);
    } catch { setLtfrbGuides([]); }
  };

  const openLtfrbGuide = async (guide: FareGuide) => {
    setOpeningGuideId(guide.id);
    try {
      await WebBrowser.openBrowserAsync(FILE_BASE + guide.url);
    } finally {
      setOpeningGuideId(null);
    }
  };

  const loadRoutes = async (assocId: number, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/routes/get_association_routes.php?association_id=${assocId}`);
      const data = await res.json();
      const list: Route[] = Array.isArray(data.routes) ? data.routes : [];
      setAllRoutes(list);
      // Keep whatever kind is currently selected (defaults to "Jeepney" on
      // first load) — switching tabs is explicit via switchKind, not re-derived
      // from route counts on every refresh.
      setRoutes(list.filter(r => detectKind(r.vehicle_type ?? "Jeepney") === kind));
    } catch { setAllRoutes([]); setRoutes([]); }
    finally  { setLoading(false); setRefreshing(false); }
  };

  const switchKind = (k: VehicleKind) => {
    setKind(k);
    setRoutes(allRoutes.filter(r => detectKind(r.vehicle_type ?? "Jeepney") === k));
  };

  const loadClasses = async (assocId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/associations/service_types.php?association_id=${assocId}`);
      const data = await res.json();
      if (data.success) setClasses(data.service_types ?? []);
    } catch (_) {}
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // ── Toggle status ───────────────────────────────────────────────────────────

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

  // ── Delete route ────────────────────────────────────────────────────────────

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

  // ── Flat fare update (Jeepney / UV Express) ─────────────────────────────────

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

  // ── Class catalog (Bus) ──────────────────────────────────────────────────────

  const handleAddClass = async () => {
    if (!newClassName.trim() || !associationId) return;
    setAddingClass(true);
    try {
      const res  = await fetch(`${API_BASE}/associations/service_types.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ association_id: associationId, name: newClassName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setNewClassName("");
        loadClasses(associationId);
      } else {
        showToast(data.message ?? "Failed to add class.");
      }
    } catch { showToast("Network error."); }
    finally { setAddingClass(false); }
  };

  const handleDeleteClass = async (classId: number) => {
    if (!associationId) return;
    try {
      const res  = await fetch(`${API_BASE}/associations/service_types.php`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: classId, association_id: associationId }),
      });
      const data = await res.json();
      if (data.success) loadClasses(associationId);
      else showToast(data.message ?? "Failed to remove class.");
    } catch { showToast("Network error."); }
  };

  // ── Per-route per-class fares (Bus) ─────────────────────────────────────────

  const openRouteFares = async (route: Route) => {
    setFareRoute(route);
    setLoadingRouteFares(true);
    try {
      const res  = await fetch(`${API_BASE}/routes/set_service_fare.php?route_id=${route.id}`);
      const data = await res.json();
      const fares: ClassFare[] = Array.isArray(data.fares) ? data.fares : [];
      setRouteFares(fares);
      const inputs: Record<number, string> = {};
      classes.forEach(c => {
        const existing = fares.find(f => f.service_type_id === c.id);
        inputs[c.id] = existing ? String(existing.base_fare) : "";
      });
      setClassFareInputs(inputs);
    } catch { setRouteFares([]); }
    finally { setLoadingRouteFares(false); }
  };

  const handleSetClassFare = async (classId: number) => {
    if (!fareRoute || !associationId) return;
    const parsed = parseFloat(classFareInputs[classId] ?? "");
    if (isNaN(parsed) || parsed < 0) { showToast("Enter a valid fare amount."); return; }

    setClassFareBusy(classId);
    try {
      const res  = await fetch(`${API_BASE}/routes/set_service_fare.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route_id: fareRoute.id, association_id: associationId,
          service_type_id: classId, base_fare: parsed,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Fare saved.");
        openRouteFares(fareRoute);
      } else {
        showToast(data.message ?? "Failed to save fare.");
      }
    } catch { showToast("Network error."); }
    finally { setClassFareBusy(null); }
  };

  const handleRemoveClassFare = async (classId: number) => {
    if (!fareRoute || !associationId) return;
    setClassFareBusy(classId);
    try {
      const res  = await fetch(`${API_BASE}/routes/set_service_fare.php`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route_id: fareRoute.id, association_id: associationId, service_type_id: classId }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Class removed from route.");
        openRouteFares(fareRoute);
      } else {
        showToast(data.message ?? "Failed to remove class.");
      }
    } catch { showToast("Network error."); }
    finally { setClassFareBusy(null); }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const accentCol = KIND_META[kind].color;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      <ToastBanner toast={toast} />

      {/* Header */}
      <View style={[s.header, { borderBottomColor: accentCol + "33" }]}>
        <View style={[s.headerIcon, { backgroundColor: accentCol + "1a" }]}>
          <Ionicons name={KIND_META[kind].icon as any} size={20} color={accentCol} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Fare Management</Text>
          <Text style={[s.headerSub, { color: accentCol }]}>{kind} routes</Text>
        </View>
        {/* Bus classes are association-owned and independent of which kind's
            routes are currently shown — always reachable, not gated on `kind`. */}
        <TouchableOpacity style={[s.classesBtn, { borderColor: accentCol }]} onPress={() => setShowClasses(true)}>
          <Ionicons name="ribbon-outline" size={14} color={accentCol} />
          <Text style={[s.classesBtnText, { color: accentCol }]}>Classes</Text>
        </TouchableOpacity>
      </View>

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

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={accentCol} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => associationId && loadRoutes(associationId, true)}
              colors={[accentCol]}
              tintColor={accentCol}
            />
          }
        >
          {/* ── LTFRB Fare Reference — read-only official documents for
              whichever vehicle kind is currently selected above; always
              visible while configuring fares so the association can check
              their own settings against it. Bus has multiple official LTFRB
              documents (City/Provincial × Ordinary/Aircon/Deluxe/Super
              Deluxe/Luxury), so all of them list here — Jeepney and UV
              Express each have exactly one. Viewing never changes fare
              computation; the association still sets fares independently
              below. ── */}
          <View style={s.sectionRow}>
            <Text style={s.sectionLabel}>LTFRB Fare Reference</Text>
          </View>
          {(() => {
            const kindGuides = ltfrbGuides.filter((g) => g.vehicle_type === kind);
            return kindGuides.length === 0 ? (
              <View style={[s.empty, { paddingVertical: 20, marginBottom: 8 }]}>
                <Text style={s.emptySub}>No LTFRB Fare Guide available for this vehicle type.</Text>
              </View>
            ) : (
              <View style={{ marginBottom: 8 }}>
                {kindGuides.map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={[s.docBtn, { borderColor: accentCol }]}
                    onPress={() => openLtfrbGuide(g)}
                    activeOpacity={0.8}
                    disabled={openingGuideId === g.id}
                  >
                    <Ionicons name="document-text-outline" size={14} color={accentCol} />
                    <Text style={[s.docBtnText, { color: accentCol }]} numberOfLines={1}>{g.label}</Text>
                    {openingGuideId === g.id && <ActivityIndicator size="small" color={accentCol} />}
                  </TouchableOpacity>
                ))}
              </View>
            );
          })()}

          <View style={s.sectionRow}>
            <Text style={s.sectionLabel}>Point-to-Point Routes</Text>
            <Text style={s.sectionCount}>{routes.length} route{routes.length !== 1 ? "s" : ""}</Text>
          </View>

          {routes.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="map-outline" size={48} color="#d1d5db" />
              <Text style={s.emptyTitle}>No {kind} routes yet</Text>
              <Text style={s.emptySub}>
                {kind} routes you create in the Routes tab will appear here so you can set their fares.
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

                  {kind === "Bus" ? (
                    <TouchableOpacity
                      style={[s.updateBtn, { backgroundColor: accentCol, alignSelf: "flex-start" }]}
                      onPress={() => openRouteFares(route)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="pricetags-outline" size={14} color="#fff" />
                      <Text style={s.updateBtnText}>Manage Class Fares</Text>
                    </TouchableOpacity>
                  ) : (
                    /* Fare box */
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
                  )}

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

      {/* ══ FLAT FARE UPDATE MODAL (Jeepney / UV Express) ══ */}
      <Modal
        visible={editingRoute !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingRoute(null)}
      >
        <View style={s.overlay}>
          <ToastBanner toast={toast} />
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={s.handle} />
            <Text style={s.sheetTitle}>
              {editingRoute?.fare != null ? "Update Fare" : "Set Fare"}
            </Text>

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

      {/* ══ MANAGE CLASSES (Bus) ══ */}
      <Modal visible={showClasses} transparent animationType="slide" onRequestClose={() => setShowClasses(false)}>
        <View style={s.overlay}>
          <ToastBanner toast={toast} />
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Classes</Text>
            <Text style={s.inputHint}>
              e.g. Ordinary, Deluxe, Royal Class — operators assign these to their vehicles
              and set up the seat layout; you set the fare per route below.
            </Text>

            {classes.length === 0 ? (
              <Text style={[s.inputHint, { marginTop: 0 }]}>No classes yet — add your first one below.</Text>
            ) : (
              classes.map(c => (
                <View key={c.id} style={s.classRow}>
                  <Ionicons name="ribbon" size={14} color="#1a4a52" />
                  <Text style={s.classRowText}>{c.name}</Text>
                  <TouchableOpacity onPress={() => handleDeleteClass(c.id)} style={s.classDeleteBtn} activeOpacity={0.7}>
                    <Ionicons name="trash-outline" size={15} color="#ef4444" />
                    <Text style={s.classDeleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}

            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <TextInput
                style={[s.input, { flex: 1, marginBottom: 0 }]}
                placeholder="New class name"
                placeholderTextColor="#9ca3af"
                value={newClassName}
                onChangeText={setNewClassName}
              />
              <TouchableOpacity
                style={[s.saveBtn, { flex: 0, flexBasis: "auto", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, backgroundColor: "#2563eb" }, addingClass && { opacity: 0.6 }]}
                onPress={handleAddClass}
                disabled={addingClass || !newClassName.trim()}
                activeOpacity={0.8}
              >
                {addingClass ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={s.saveBtnText}>Add</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[s.cancelBtn, s.cancelBtnStandalone, { marginTop: 16 }]} onPress={() => setShowClasses(false)}>
              <Text style={s.cancelBtnText}>Done</Text>
            </TouchableOpacity>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ══ PER-ROUTE CLASS FARES (Bus) ══ */}
      <Modal visible={!!fareRoute} transparent animationType="slide" onRequestClose={() => setFareRoute(null)}>
        <View style={s.overlay}>
          <ToastBanner toast={toast} />
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Class Fares</Text>
            <View style={[s.routeRecap, { borderColor: accentCol + "30" }]}>
              <View style={[s.ptpDot, { backgroundColor: accentCol }]} />
              <Text style={s.recapText} numberOfLines={1}>{fareRoute?.from_location}</Text>
              <Ionicons name="arrow-forward" size={13} color="#a8d832" />
              <Text style={s.recapText} numberOfLines={1}>{fareRoute?.to_location}</Text>
              <View style={[s.ptpDot, { backgroundColor: "#a8d832" }]} />
            </View>

            {loadingRouteFares ? (
              <ActivityIndicator color={accentCol} style={{ marginVertical: 20 }} />
            ) : classes.length === 0 ? (
              <Text style={s.inputHint}>Add a class first (tap "Classes" in the header) before setting fares.</Text>
            ) : (
              <KeyboardAwareForm style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
                {classes.map(c => {
                  const isSet = routeFares.some(f => f.service_type_id === c.id);
                  const busy = classFareBusy === c.id;
                  return (
                    <View key={c.id} style={[s.classFareEditRow, { flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
                      <Text style={s.classRowText}>{c.name}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <TextInput
                          style={[s.input, { marginBottom: 0, width: 90, textAlign: "right" }]}
                          placeholder="₱0.00"
                          placeholderTextColor="#9ca3af"
                          keyboardType="decimal-pad"
                          value={classFareInputs[c.id] ?? ""}
                          onChangeText={(t) => setClassFareInputs(prev => ({ ...prev, [c.id]: t }))}
                        />
                        <TouchableOpacity
                          style={[s.miniBtn, { backgroundColor: accentCol }]}
                          onPress={() => handleSetClassFare(c.id)}
                          disabled={busy}
                          activeOpacity={0.8}
                        >
                          {busy ? <ActivityIndicator color="#fff" size="small" /> : (
                            <>
                              <Ionicons name="checkmark" size={16} color="#fff" />
                              <Text style={s.miniBtnText}>Save</Text>
                            </>
                          )}
                        </TouchableOpacity>
                        {isSet && (
                          <TouchableOpacity
                            style={[s.miniBtn, { backgroundColor: "#fef2f2" }]}
                            onPress={() => handleRemoveClassFare(c.id)}
                            disabled={busy}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="trash-outline" size={15} color="#ef4444" />
                            <Text style={[s.miniBtnText, { color: "#ef4444" }]}>Remove</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
              </KeyboardAwareForm>
            )}

            <TouchableOpacity style={[s.cancelBtn, s.cancelBtnStandalone, { marginTop: 16 }]} onPress={() => setFareRoute(null)}>
              <Text style={s.cancelBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// React Native's <Modal> renders into its own separate native root, so a
// toast positioned in the main screen's tree (as this one originally was,
// only) is invisible any time a modal is open — Save/error feedback for
// every action inside any of this screen's 3 modals silently vanished.
// Rendered once at the screen root and again inside each modal's own
// overlay so it's always visible regardless of what's currently open.
function ToastBanner({ toast }: { toast: string }) {
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View style={[s.toast, { top: insets.top + 80 }]}>
      <Ionicons name="checkmark-circle" size={14} color="#a8d832" />
      <Text style={s.toastText}>{toast}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f9fafb" },

  toast:     { position: "absolute", top: 100, left: 20, right: 20, zIndex: 99, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, padding: 12 },

  kindRow:      { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 12 },
  kindChip:     { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  docBtn:       { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 8, backgroundColor: "#fff" },
  docBtnText:   { flex: 1, fontSize: 13, fontWeight: "700" },
  kindChipText: { fontSize: 12, fontWeight: "700", color: "#9ca3af" },
  toastText: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "700" },

  header:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  headerIcon:  { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  headerSub:   { fontSize: 12, fontWeight: "700", marginTop: 1 },
  classesBtn:  { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  classesBtnText: { fontSize: 12, fontWeight: "800" },

  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  scroll: { padding: 16, gap: 14, paddingBottom: 40 },

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

  cardFooter: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBtn:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  statusDot:  { width: 7, height: 7, borderRadius: 4 },
  statusText: { flex: 1, fontSize: 11, fontWeight: "700" },
  deleteBtn:  { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, borderRadius: 10, paddingHorizontal: 10, backgroundColor: "#fef2f2", justifyContent: "center", borderWidth: 1, borderColor: "#fecaca" },
  deleteBtnText: { fontSize: 12, fontWeight: "700", color: "#ef4444" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:   { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  handle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },

  sheetTitle:    { fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 12 },

  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  input:      { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#f9fafb", marginBottom: 14 },
  inputLarge: { fontSize: 20, fontWeight: "800", color: "#1a4a52" },
  inputHint:  { fontSize: 11, color: "#9ca3af", marginBottom: 20, lineHeight: 16 },

  routeRecap:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f9fafb", borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1.5 },
  recapText:   { fontSize: 13, fontWeight: "700", color: "#374151", flex: 1 },

  currentFare:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f8fafc", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16, borderWidth: 1.5 },
  currentFareLabel: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  currentFareValue: { fontSize: 20, fontWeight: "900" },

  sheetActions:  { flexDirection: "row", gap: 10 },
  cancelBtn:     { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  cancelBtnText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  // cancelBtn's flex:1 is only correct inside a flexDirection:"row" sibling
  // pair (s.sheetActions) — reused standalone (no row sibling to share
  // width with) it collapses the Text child's height to zero, rendering as
  // an empty outlined pill with no visible label. Override for every
  // standalone "Done"/"Close" use.
  cancelBtnStandalone: { flex: 0, flexBasis: "auto" },
  saveBtn:       { flex: 2, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  saveBtnText:   { fontSize: 14, fontWeight: "800", color: "#fff" },

  classRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9",
  },
  classRowText: { flex: 1, fontSize: 14, fontWeight: "700", color: "#374151" },
  classDeleteBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  classDeleteBtnText: { fontSize: 12, fontWeight: "700", color: "#ef4444" },

  classFareEditRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9",
  },
  miniBtn:     { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40, borderRadius: 10, paddingHorizontal: 10, justifyContent: "center" },
  miniBtnText: { fontSize: 12, fontWeight: "800", color: "#fff" },
});
