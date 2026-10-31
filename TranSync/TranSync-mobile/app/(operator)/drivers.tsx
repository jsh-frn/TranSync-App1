import { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Modal,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import { groupApprovedByAssociation, resolveActiveAssociation, type AssocApplication } from "../../src/utils/activeAssociation";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

type Driver = {
  id:             number;
  name:           string;
  email:          string;
  phone:          string;
  license_number: string;
  status:         "active" | "inactive";
  vehicle_id:     number | null;
  vehicle_type:   string | null;
  vehicle_plate:  string | null;
  // Which association the driver's CURRENT vehicle belongs to — an operator
  // can hold the same vehicle type approved at several associations at
  // once, so vehicle_type alone can't identify which workspace this driver
  // belongs to (see Switch Association).
  vehicle_association_id: number | null;
  route_id:       number | null;
  route_name:     string | null;
};

type Vehicle = {
  id:             number;
  type:           string;
  plate_number:   string;
  capacity:       number | null;
  status:         string;
  association_id: number | null;
};

// Routes now belong to vehicles, not drivers (set from Add/Edit Vehicle
// instead) — this screen no longer manages route assignment at all.
const VEHICLE_TYPES = ["Jeepney", "UV Express", "Bus"];

// Driver-list filter — a driver has no vehicle type of its own until a
// vehicle is assigned (drivers.php LEFT JOINs vehicles, so vehicle_type is
// null for an unassigned driver); those only ever show under "All".
type DriverTypeFilter = "All" | "Jeepney" | "UV Express" | "Bus";
const DRIVER_TYPE_FILTERS: { key: DriverTypeFilter; label: string }[] = [
  { key: "All",        label: "All" },
  { key: "Bus",        label: "Bus Driver" },
  { key: "Jeepney",    label: "Jeepney Driver" },
  { key: "UV Express", label: "UV Express Driver" },
];

export default function DriversScreen() {
  const insets = useSafeAreaInsets();

  const [user,          setUser]          = useState<any>(null);
  const [drivers,       setDrivers]       = useState<Driver[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [hasAssociation, setHasAssociation] = useState(false);

  // Vehicle types approved at the operator's currently *active* association
  // (Profile → My Associations → Switch) — see fetchAssocStatus. For an
  // operator with only one association this is every approved type, so
  // nothing changes for them; switching elsewhere and returning here
  // re-resolves it via useFocusEffect.
  const [approvedTypes, setApprovedTypes] = useState<string[]>([]);
  // The active association's own id — matching a driver/vehicle by type
  // alone isn't enough once the same type can be approved at several
  // associations at once; only association_id disambiguates.
  const [activeAssociationId, setActiveAssociationId] = useState<number | null>(null);

  // Driver-list filter — client-side only (the operator's full roster is
  // already fetched by operator_id, see fetchDrivers), updates immediately.
  // Options are further scoped to approvedTypes, same as the underlying list.
  const [driverFilter, setDriverFilter] = useState<DriverTypeFilter>("All");

  // If switching active association drops the current filter out of scope,
  // fall back to "All" rather than showing an empty list with no chip active.
  useEffect(() => {
    if (driverFilter !== "All" && !approvedTypes.includes(driverFilter)) {
      setDriverFilter("All");
    }
  }, [approvedTypes]);

  // modals
  const [showAdd,            setShowAdd]            = useState(false);
  const [showDelete,         setShowDelete]         = useState<Driver | null>(null);
  const [showAssignVehicle,  setShowAssignVehicle]  = useState<Driver | null>(null);
  const [assigningVehicle,   setAssigningVehicle]   = useState(false);
  const [assignVehicleError, setAssignVehicleError] = useState("");

  // edit driver
  const [showEdit,     setShowEdit]     = useState<Driver | null>(null);
  const [eName,        setEName]        = useState("");
  const [eEmail,       setEEmail]       = useState("");
  const [ePhone,       setEPhone]       = useState("");
  const [eLicense,     setELicense]     = useState("");
  const [ePassword,    setEPassword]    = useState("");
  const [eVehicleId,   setEVehicleId]   = useState<number | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError,    setEditError]    = useState("");

  const [vehicles,      setVehicles]      = useState<Vehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);

  const [submitting,    setSubmitting]    = useState(false);

  const [toast,         setToast]         = useState("");

  // add driver form
  const [dName,     setDName]     = useState("");
  const [dEmail,    setDEmail]    = useState("");
  const [dPhone,    setDPhone]    = useState("");
  const [dLicense,  setDLicense]  = useState("");
  const [dPassword, setDPassword] = useState("");
  const [showPass,  setShowPass]  = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (raw) {
        const u = JSON.parse(raw);
        setUser(u);
        loadAll(u.id);
      }
    })();
  }, []);

  useFocusEffect(useCallback(() => {
    if (user) loadAll(user.id);
  }, [user]));

  const loadAll = async (operatorId: number) => {
    setLoading(true);
    await Promise.all([fetchDrivers(operatorId), fetchAssocStatus(operatorId)]);
    setLoading(false);
  };

  const fetchDrivers = async (operatorId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/drivers/drivers.php?operator_id=${operatorId}`);
      const data = await res.json();
      setDrivers(Array.isArray(data) ? data : []);
    } catch { setDrivers([]); }
  };

  const fetchAssocStatus = async (operatorId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/operators/association_status.php?operator_id=${operatorId}`);
      const data = await res.json();
      const apps: AssocApplication[] = data.success ? (data.applications ?? []) : [];
      const groups = groupApprovedByAssociation(apps);
      const active = await resolveActiveAssociation(groups);
      const approved = active?.vehicle_types ?? [];
      setApprovedTypes(approved);
      setActiveAssociationId(active?.association_id ?? null);
      // A driver record has no vehicle type of its own until a vehicle is
      // assigned, so any approved membership *at the active association*
      // unlocks this screen.
      setHasAssociation(approved.length > 0);
    } catch { setHasAssociation(false); setApprovedTypes([]); setActiveAssociationId(null); }
  };

  const fetchVehicles = async (operatorId: number) => {
    setLoadingVehicles(true);
    try {
      const res  = await fetch(`${API_BASE}/operators/get_operator_vehicles.php?operator_id=${operatorId}`);
      const data = await res.json();
      if (data.success) setVehicles(data.vehicles ?? []);
    } catch (_) {}
    finally { setLoadingVehicles(false); }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const resetForm = () => {
    setDName(""); setDEmail(""); setDPhone("");
    setDLicense(""); setDPassword("");
    setFormError(""); setShowPass(false);
    setSelectedVehicle(null);
  };

  // Philippine mobile: 09XX-XXX-XXXX (11 digits, always starts with 09)
  const PHONE_REGEX = /^09\d{2}-\d{3}-\d{4}$/;

  const formatPhoneNumber = (raw: string): string => {
    const digits = raw.replace(/\D/g, "").slice(0, 11);
    const p1 = digits.slice(0, 4);  // 09XX
    const p2 = digits.slice(4, 7);  // XXX
    const p3 = digits.slice(7, 11); // XXXX
    let result = p1;
    if (p2.length > 0) result += "-" + p2;
    if (p3.length > 0) result += "-" + p3;
    return result;
  };

  // Philippine LTO driver's license: 1 letter + 2 digits - 2 digits - 6 digits (e.g. N01-00-000000)
  const LICENSE_REGEX = /^[A-Z]\d{2}-\d{2}-\d{6}$/;

  const formatLicenseNumber = (raw: string): string => {
    const clean = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    // Collect: first letter, then up to 10 digits
    let letter = "";
    let digits = "";
    for (const ch of clean) {
      if (!letter) {
        if (/[A-Z]/.test(ch)) letter = ch;
      } else {
        if (/[0-9]/.test(ch) && digits.length < 10) digits += ch;
      }
    }
    const d1 = digits.slice(0, 2);  // 2 digits after letter
    const d2 = digits.slice(2, 4);  // next 2 digits
    const d3 = digits.slice(4, 10); // last 6 digits
    let result = letter + d1;
    if (d2.length > 0) result += "-" + d2;
    if (d3.length > 0) result += "-" + d3;
    return result;
  };

  // ── ADD DRIVER ───────────────────────────────────────────────────────────────
  const handleAddDriver = async () => {
    setFormError("");
    if (!dName || !dEmail || !dPhone || !dLicense || !dPassword) {
      setFormError("All fields are required."); return;
    }
    if (!/\S+@\S+\.\S+/.test(dEmail)) {
      setFormError("Please enter a valid email address."); return;
    }
    if (!PHONE_REGEX.test(dPhone)) {
      setFormError("Invalid phone number. Use 09XX-XXX-XXXX (e.g. 0917-123-4567)."); return;
    }
    if (!LICENSE_REGEX.test(dLicense)) {
      setFormError("Invalid license format. Use A##-##-###### (e.g. N01-00-000000)."); return;
    }
    if (dPassword.length < 6) {
      setFormError("Password must be at least 6 characters."); return;
    }
    if (!selectedVehicle) {
      setFormError("Please assign a vehicle to this driver."); return;
    }
    setSubmitting(true);
    try {
      const res  = await fetch(`${API_BASE}/drivers/drivers.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: user.id,
          name: dName, email: dEmail, phone: dPhone,
          license: dLicense, password: dPassword,
          vehicle_id: selectedVehicle ?? 0,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAdd(false); resetForm();
        loadAll(user.id);
        showToast("Driver registered successfully!");
      } else { setFormError(data.message || "Failed to register driver."); }
    } catch { setFormError("Cannot connect to server."); }
    finally  { setSubmitting(false); }
  };

  // ── TOGGLE STATUS ────────────────────────────────────────────────────────────
  const handleToggleStatus = async (driver: Driver) => {
    const newStatus = driver.status === "active" ? "inactive" : "active";
    try {
      await fetch(`${API_BASE}/drivers/drivers.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: driver.id, status: newStatus }),
      });
      setDrivers(prev => prev.map(d => d.id === driver.id ? { ...d, status: newStatus } : d));
      showToast(`Driver marked as ${newStatus}`);
    } catch { showToast("Failed to update status."); }
  };

  // ── DELETE ───────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!showDelete) return;
    try {
      await fetch(`${API_BASE}/drivers/drivers.php`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: showDelete.id }),
      });
      setDrivers(prev => prev.filter(d => d.id !== showDelete.id));
      setShowDelete(null);
      showToast("Driver removed.");
    } catch { showToast("Failed to remove driver."); }
  };

  const isVerified   = user?.is_verified == 1;
  const isOperational = isVerified && hasAssociation;

  // ── ASSIGN VEHICLE TO DRIVER ──────────────────────────────────────────────────
  // Route assignment no longer happens here — a route belongs to the vehicle
  // itself now (set from Add/Edit Vehicle), so picking a vehicle carries
  // whatever route it already has along with it automatically.
  const handleOpenAssignVehicle = async (driver: Driver) => {
    setShowAssignVehicle(driver);
    setSelectedVehicle(null);
    setAssignVehicleError("");
    await fetchVehicles(user.id);
  };

  const handleAssignVehicle = async () => {
    if (!showAssignVehicle || !selectedVehicle) {
      setAssignVehicleError("Please select a vehicle."); return;
    }
    setAssigningVehicle(true);
    setAssignVehicleError("");
    try {
      const res  = await fetch(`${API_BASE}/vehicles/vehicles.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedVehicle, action: "assign", driver_id: showAssignVehicle.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAssignVehicle(null);
        setSelectedVehicle(null);
        fetchDrivers(user.id);
        showToast("Vehicle assigned. Driver account reactivated.");
      } else {
        setAssignVehicleError(data.message || "Failed to assign vehicle.");
      }
    } catch { setAssignVehicleError("Cannot connect to server."); }
    finally  { setAssigningVehicle(false); }
  };

  // ── EDIT DRIVER ──────────────────────────────────────────────────────────────
  const openEdit = (driver: Driver) => {
    setShowEdit(driver);
    setEName(driver.name);
    setEEmail(driver.email);
    setEPhone(driver.phone);
    setELicense(driver.license_number);
    setEPassword("");
    setEVehicleId(driver.vehicle_id);
    setEditError("");
    if (user) fetchVehicles(user.id);
  };

  const handleEditDriver = async () => {
    if (!showEdit || !user) return;
    setEditError("");
    if (!eName || !eEmail || !ePhone || !eLicense) {
      setEditError("All fields are required."); return;
    }
    if (!/\S+@\S+\.\S+/.test(eEmail)) {
      setEditError("Please enter a valid email address."); return;
    }
    if (!PHONE_REGEX.test(ePhone)) {
      setEditError("Invalid phone number. Use 09XX-XXX-XXXX (e.g. 0917-123-4567)."); return;
    }
    if (!LICENSE_REGEX.test(eLicense)) {
      setEditError("Invalid license format. Use A##-##-###### (e.g. N01-00-000000)."); return;
    }
    if (ePassword !== "" && ePassword.length < 6) {
      setEditError("Password must be at least 6 characters."); return;
    }
    if (!eVehicleId) {
      setEditError("Please select a vehicle."); return;
    }
    setEditSubmitting(true);
    try {
      const res  = await fetch(`${API_BASE}/drivers/drivers.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: showEdit.id, action: "update_details", operator_id: user.id,
          name: eName, email: eEmail, phone: ePhone, license: eLicense,
          password: ePassword || undefined, vehicle_id: eVehicleId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        loadAll(user.id);
        setShowEdit(null);
        showToast("Driver details updated.");
      } else {
        setEditError(data.message || "Failed to update driver.");
      }
    } catch { setEditError("Cannot connect to server."); }
    finally  { setEditSubmitting(false); }
  };

  // Scoped to the driver's own vehicle_association_id matching the active
  // association — matching by type alone isn't enough once an operator can
  // hold the same vehicle type approved at several associations at once, so
  // only vehicle_association_id actually disambiguates which workspace a
  // driver belongs to. A driver whose vehicle belongs to a *different*
  // association is hidden entirely, not just filterable-away. Unassigned
  // drivers (vehicle_id null) always stay visible under "All" regardless of
  // active association, since they aren't tied to any association yet.
  const activeAssocDrivers = drivers.filter(d => d.vehicle_id === null || d.vehicle_association_id === activeAssociationId);
  const driverFilterOptions: { key: DriverTypeFilter; label: string }[] =
    [DRIVER_TYPE_FILTERS[0], ...DRIVER_TYPE_FILTERS.slice(1).filter(f => approvedTypes.includes(f.key))];
  const driverFilterCounts: Record<DriverTypeFilter, number> = {
    All:          activeAssocDrivers.length,
    "Jeepney":    activeAssocDrivers.filter(d => d.vehicle_type === "Jeepney").length,
    "UV Express": activeAssocDrivers.filter(d => d.vehicle_type === "UV Express").length,
    "Bus":        activeAssocDrivers.filter(d => d.vehicle_type === "Bus").length,
  };
  const filteredDrivers = driverFilter === "All" ? activeAssocDrivers : activeAssocDrivers.filter(d => d.vehicle_type === driverFilter);

  // Vehicle-assignment pickers (Add Driver / Edit Driver) should only offer
  // vehicles belonging to the active association too — assigning a DAU bus
  // to a driver while managing Angeles would silently cross contexts.
  const pickableVehicles = vehicles.filter(v => v.association_id === activeAssociationId);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── TOAST ── */}
      {toast !== "" && (
        <View style={[styles.toast, { top: insets.top + 56 }]}>
          <Ionicons name="checkmark-circle" size={14} color="#a8d832" />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* ── ADD DRIVER MODAL ── */}
      <Modal visible={showAdd} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Register Driver</Text>
              <Text style={styles.modalSub}>Create a login account for your driver</Text>
              {formError ? (
                <View style={styles.errorBox}>
                  <Ionicons name="warning" size={14} color="#dc2626" />
                  <Text style={styles.errorText}>{formError}</Text>
                </View>
              ) : null}
              <Field label="Full Name">
                <TextInput style={styles.input} placeholder="Juan Dela Cruz"
                  placeholderTextColor="#9ca3af" value={dName} onChangeText={setDName} />
              </Field>
              <Field label="Email Address">
                <TextInput style={styles.input} placeholder="driver@email.com"
                  placeholderTextColor="#9ca3af" keyboardType="email-address"
                  autoCapitalize="none" value={dEmail} onChangeText={setDEmail} />
              </Field>
              <Field label="Phone Number">
                <TextInput style={styles.input} placeholder="0917-123-4567"
                  placeholderTextColor="#9ca3af" keyboardType="number-pad"
                  value={dPhone} onChangeText={(text) => setDPhone(formatPhoneNumber(text))} />
                <Text style={styles.licenseHint}>Philippine mobile: 09XX-XXX-XXXX (11 digits)</Text>
              </Field>
              <Field label="License Number">
                <TextInput style={styles.input} placeholder="N01-00-000000"
                  placeholderTextColor="#9ca3af" autoCapitalize="none"
                  value={dLicense} onChangeText={(text) => setDLicense(formatLicenseNumber(text))} />
                <Text style={styles.licenseHint}>Philippine LTO format: A##-##-###### (e.g. N01-00-000000)</Text>
              </Field>
              <Field label="Password">
                <View style={styles.passwordWrap}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Min. 6 characters"
                    placeholderTextColor="#9ca3af"
                    secureTextEntry={!showPass}
                    value={dPassword}
                    onChangeText={setDPassword}
                  />
                  <TouchableOpacity onPress={() => setShowPass(!showPass)} style={styles.eyeBtn} accessibilityLabel={showPass ? "Hide password" : "Show password"}>
                    <Ionicons name={showPass ? "eye-off" : "eye"} size={18} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.fieldHint}>Share these credentials with your driver so they can log in.</Text>
              </Field>

              {/* ── Vehicle assignment (required) ── */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.fieldLabel}>Assign Vehicle <Text style={{ color: "#dc2626" }}>*</Text></Text>
                {loadingVehicles ? (
                  <ActivityIndicator color="#1a4a52" style={{ marginTop: 8 }} />
                ) : pickableVehicles.length === 0 ? (
                  <View style={styles.noVehicleBox}>
                    <Ionicons name="warning" size={20} color="#d97706" />
                    <Text style={[styles.noVehicleText, { color: "#92400e" }]}>No unassigned vehicles available.{"\n"}Go to the Vehicles tab to add one first.</Text>
                  </View>
                ) : (
                  <VehiclePicker
                    vehicles={pickableVehicles}
                    selectedId={selectedVehicle}
                    onSelect={(v) => setSelectedVehicle(prev => (prev === v.id ? null : v.id))}
                    maxHeight={180}
                  />
                )}
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel}
                  onPress={() => { setShowAdd(false); resetForm(); }}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirm, (submitting || pickableVehicles.length === 0) && { opacity: 0.5 }]}
                  onPress={handleAddDriver}
                  disabled={submitting || pickableVehicles.length === 0}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.modalConfirmText}>Register</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareForm>
        </View>
      </Modal>

      {/* ── EDIT DRIVER MODAL ── */}
      <Modal visible={!!showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(null)}>
        <View style={styles.modalOverlay}>
          <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Edit Driver</Text>
              <Text style={styles.modalSub}>Update {showEdit?.name}'s details</Text>

              {editError ? (
                <View style={styles.errorBox}>
                  <Ionicons name="warning" size={14} color="#dc2626" />
                  <Text style={styles.errorText}>{editError}</Text>
                </View>
              ) : null}

              <Field label="Full Name">
                <TextInput style={styles.input} value={eName} onChangeText={setEName} placeholderTextColor="#9ca3af" />
              </Field>
              <Field label="Email">
                <TextInput
                  style={styles.input} value={eEmail} onChangeText={setEEmail}
                  autoCapitalize="none" keyboardType="email-address" placeholderTextColor="#9ca3af"
                />
              </Field>
              <Field label="Phone">
                <TextInput
                  style={styles.input} value={ePhone}
                  onChangeText={(t) => setEPhone(formatPhoneNumber(t))}
                  keyboardType="number-pad" placeholder="09XX-XXX-XXXX" placeholderTextColor="#9ca3af"
                />
              </Field>
              <Field label="License Number">
                <TextInput
                  style={styles.input} value={eLicense}
                  onChangeText={(t) => setELicense(formatLicenseNumber(t))}
                  autoCapitalize="characters" placeholder="A##-##-######" placeholderTextColor="#9ca3af"
                />
              </Field>
              <Field label="New Password (optional)">
                <TextInput
                  style={styles.input} value={ePassword} onChangeText={setEPassword}
                  secureTextEntry placeholder="Leave blank to keep current password" placeholderTextColor="#9ca3af"
                />
              </Field>

              <Text style={styles.fieldLabel}>Assigned Vehicle</Text>
              {loadingVehicles ? (
                <ActivityIndicator color="#1a4a52" style={{ marginVertical: 12 }} />
              ) : (() => {
                  const options = [...pickableVehicles];
                  if (showEdit?.vehicle_id && !options.some(v => v.id === showEdit.vehicle_id)) {
                    options.unshift({
                      id: showEdit.vehicle_id,
                      type: showEdit.vehicle_type ?? "",
                      plate_number: showEdit.vehicle_plate ?? "",
                      capacity: null,
                      status: "active",
                      association_id: showEdit.vehicle_association_id,
                    });
                  }
                  if (options.length === 0) {
                    return <Text style={styles.noVehicleText}>No vehicles available — add one in the Vehicles tab first.</Text>;
                  }
                  return (
                    <VehiclePicker
                      vehicles={options}
                      selectedId={eVehicleId}
                      onSelect={(v) => setEVehicleId(v.id)}
                      maxHeight={220}
                    />
                  );
                })()}

              <View style={[styles.modalActions, { marginTop: 14 }]}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setShowEdit(null)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirm, editSubmitting && { opacity: 0.6 }]}
                  onPress={handleEditDriver}
                  disabled={editSubmitting}
                >
                  {editSubmitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.modalConfirmText}>Save Changes</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareForm>
        </View>
      </Modal>

      {/* ── DELETE CONFIRM ── */}
      <Modal visible={!!showDelete} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.confirmBox}>
            <View style={styles.confirmIconWrap}>
              <Ionicons name="trash" size={28} color="#dc2626" />
            </View>
            <Text style={styles.confirmTitle}>Remove Driver?</Text>
            <Text style={styles.confirmSub}>
              This will delete {showDelete?.name}'s account. They won't be able to log in anymore.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowDelete(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalConfirm, { backgroundColor: "#dc2626" }]} onPress={handleDelete}>
                <Text style={styles.modalConfirmText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── ASSIGN VEHICLE MODAL ── */}
      <Modal visible={!!showAssignVehicle} transparent animationType="slide" onRequestClose={() => setShowAssignVehicle(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: "80%", paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Assign Vehicle</Text>
            {showAssignVehicle && (
              <Text style={{ color: "#6b7280", fontSize: 13, marginBottom: 12 }}>
                Driver: <Text style={{ fontWeight: "800", color: "#1a4a52" }}>{showAssignVehicle.name}</Text>
              </Text>
            )}

            {assignVehicleError ? (
              <View style={styles.errorBox}>
                <Ionicons name="warning" size={14} color="#dc2626" />
                <Text style={styles.errorText}>{assignVehicleError}</Text>
              </View>
            ) : null}

            {loadingVehicles ? (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <ActivityIndicator color="#1a4a52" />
              </View>
            ) : pickableVehicles.length === 0 ? (
              <View style={styles.noVehicleBox}>
                <Ionicons name="warning" size={20} color="#d97706" />
                <Text style={[styles.noVehicleText, { color: "#92400e" }]}>
                  No unassigned vehicles available.{"\n"}Go to the Vehicles tab to add or free up a vehicle.
                </Text>
              </View>
            ) : (
              <VehiclePicker
                vehicles={pickableVehicles}
                selectedId={selectedVehicle}
                onSelect={(v) => setSelectedVehicle(prev => (prev === v.id ? null : v.id))}
                maxHeight={260}
              />
            )}

            <View style={[styles.modalActions, { marginTop: 16 }]}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setShowAssignVehicle(null); setSelectedVehicle(null); setAssignVehicleError(""); }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, (!selectedVehicle || assigningVehicle) && { opacity: 0.5 }]}
                onPress={handleAssignVehicle}
                disabled={!selectedVehicle || assigningVehicle}
              >
                {assigningVehicle
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalConfirmText}>Assign</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="people" size={22} color="#1a4a52" />
          <View>
            <Text style={styles.headerTitle}>Drivers</Text>
            <Text style={styles.headerSub}>{drivers.length} driver{drivers.length !== 1 ? "s" : ""} registered</Text>
          </View>
        </View>
        {isOperational && (
          <TouchableOpacity style={styles.addBtn} onPress={() => { setShowAdd(true); fetchVehicles(user.id); }} activeOpacity={0.85}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {!isOperational && (
        <View style={styles.lockBanner}>
          <Ionicons name="lock-closed" size={13} color="#92400e" />
          <Text style={styles.lockBannerText}>
            {!isVerified
              ? "Driver management is locked until your account is verified."
              : "Driver management is locked until your association approves your account."}
          </Text>
        </View>
      )}

      {!loading && drivers.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.typeFilterRow}
          contentContainerStyle={styles.typeFilterRowContent}
        >
          {driverFilterOptions.map(({ key, label }) => {
            const active = driverFilter === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.typeFilterChip, active && styles.typeFilterChipActive]}
                onPress={() => setDriverFilter(key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.typeFilterChipText, active && styles.typeFilterChipTextActive]}>
                  {label} ({driverFilterCounts[key]})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color="#1a4a52" size="large" /></View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {drivers.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color="#d1d5db" style={{ marginBottom: 4 }} />
              <Text style={styles.emptyText}>No drivers yet</Text>
              <Text style={styles.emptySub}>
                {isOperational ? "Tap + Add to register your first driver" : "Complete verification and association approval to add drivers"}
              </Text>
            </View>
          ) : filteredDrivers.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color="#d1d5db" style={{ marginBottom: 4 }} />
              <Text style={styles.emptyText}>No {DRIVER_TYPE_FILTERS.find(f => f.key === driverFilter)?.label}s</Text>
              <Text style={styles.emptySub}>Try a different filter</Text>
            </View>
          ) : (
            filteredDrivers.map((driver) => {
              return (
                <View key={driver.id} style={styles.driverCard}>
                  <View style={[styles.driverAvatar, driver.status === "inactive" && { backgroundColor: "#94a3b8" }]}>
                    <Text style={styles.driverAvatarText}>
                      {driver.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.driverInfo}>
                    <Text style={styles.driverName}>{driver.name}</Text>
                    <View style={styles.driverDetailRow}>
                      <Ionicons name="mail-outline" size={11} color="#9ca3af" />
                      <Text style={styles.driverDetail}>{driver.email}</Text>
                    </View>
                    <View style={styles.driverDetailRow}>
                      <Ionicons name="call-outline" size={11} color="#9ca3af" />
                      <Text style={styles.driverDetail}>{driver.phone}</Text>
                    </View>
                    <View style={styles.driverDetailRow}>
                      <Ionicons name="card-outline" size={11} color="#9ca3af" />
                      <Text style={styles.driverDetail}>{driver.license_number}</Text>
                    </View>
                    {driver.vehicle_plate ? (
                      <View style={styles.vehicleChip}>
                        <Ionicons name="car-outline" size={11} color="#6b7280" />
                        <Text style={styles.vehicleChipText}>
                          {driver.vehicle_type} · {driver.vehicle_plate}
                        </Text>
                      </View>
                    ) : isOperational ? (
                      <TouchableOpacity
                        style={styles.assignVehicleBtn}
                        onPress={() => handleOpenAssignVehicle(driver)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="car-outline" size={12} color="#d97706" />
                        <Text style={styles.assignVehicleBtnText}>Assign Vehicle</Text>
                      </TouchableOpacity>
                    ) : null}
                    {/* Route is no longer shown/set here — it belongs to the
                        vehicle now (see Vehicles tab), and shows on that
                        vehicle's own card instead. */}
                    {driver.vehicle_plate && driver.route_name ? (
                      <View style={styles.routeChip}>
                        <Ionicons name="map-outline" size={11} color="#6b7280" />
                        <Text style={styles.routeChipText}>{driver.route_name}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.driverActions}>
                    <TouchableOpacity
                      style={[styles.statusBadge, { backgroundColor: driver.status === "active" ? "#f0fdf4" : "#fef2f2" }]}
                      onPress={() => handleToggleStatus(driver)} activeOpacity={0.8}
                    >
                      <View style={[styles.statusDot, { backgroundColor: driver.status === "active" ? "#16a34a" : "#dc2626" }]} />
                      <Text style={[styles.statusText, { color: driver.status === "active" ? "#16a34a" : "#dc2626" }]}>
                        {driver.status === "active" ? "Active" : "Inactive"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => openEdit(driver)} activeOpacity={0.8}>
                      <Ionicons name="create-outline" size={15} color="#1a4a52" />
                      <Text style={[styles.deleteBtnText, { color: "#1a4a52" }]}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => setShowDelete(driver)} activeOpacity={0.8}>
                      <Ionicons name="trash-outline" size={15} color="#ef4444" />
                      <Text style={[styles.deleteBtnText, { color: "#ef4444" }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// Category (vehicle type) chip row, then the vehicle list for whichever
// category is selected — replaces a single flat list across all three
// pickers on this screen (Add Driver, Assign Vehicle, Edit Driver) so a
// mixed Jeepney/UV Express/Bus fleet is easier to navigate.
function VehiclePicker({
  vehicles, selectedId, onSelect, maxHeight = 220,
}: {
  vehicles: Vehicle[];
  selectedId: number | null;
  onSelect: (v: Vehicle) => void;
  maxHeight?: number;
}) {
  const grouped = vehicles.reduce<Record<string, Vehicle[]>>((acc, v) => {
    (acc[v.type] ??= []).push(v);
    return acc;
  }, {});
  const categories = VEHICLE_TYPES.filter(t => (grouped[t]?.length ?? 0) > 0);
  const selectedType = vehicles.find(v => v.id === selectedId)?.type ?? null;
  const [category, setCategory] = useState<string | null>(selectedType ?? categories[0] ?? null);

  // Keep the active chip in sync if the selected vehicle changes from
  // outside this component (e.g. Edit Driver prefilling the driver's
  // current vehicle, which may belong to a different category).
  useEffect(() => {
    if (selectedType && selectedType !== category) setCategory(selectedType);
  }, [selectedType]);

  if (categories.length === 0) return null;

  const list = category ? (grouped[category] ?? []) : [];

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
        {categories.map(cat => {
          const active = category === cat;
          return (
            <TouchableOpacity
              key={cat}
              style={[styles.categoryChip, active && styles.categoryChipActive]}
              onPress={() => setCategory(cat)}
              activeOpacity={0.8}
            >
              <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                {cat} ({grouped[cat].length})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <ScrollView style={{ maxHeight }} nestedScrollEnabled showsVerticalScrollIndicator={true}>
        {list.map(v => {
          const isSelected = selectedId === v.id;
          return (
            <TouchableOpacity
              key={v.id}
              style={[styles.vehiclePickerItem, isSelected && styles.vehiclePickerItemActive]}
              onPress={() => onSelect(v)}
              activeOpacity={0.8}
            >
              <View style={[styles.vehiclePickerIcon, isSelected && { backgroundColor: "#e0f2fe" }]}>
                <Ionicons name="car" size={18} color={isSelected ? "#0284c7" : "#9ca3af"} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.vehiclePickerPlate, isSelected && { color: "#1a4a52" }]}>
                  {v.plate_number}
                </Text>
                <Text style={styles.vehiclePickerType}>
                  {v.type}{v.capacity ? ` · ${v.capacity} seats` : ""}
                </Text>
              </View>
              {isSelected && <Ionicons name="checkmark-circle" size={20} color="#16a34a" />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f9fafb" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  toast:       { position: "absolute", top: 60, left: 20, right: 20, zIndex: 99, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, padding: 12 },
  toastText:   { color: "#fff", fontSize: 13, fontWeight: "700", flex: 1 },

  header:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 12 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle:    { fontSize: 22, fontWeight: "900", color: "#1a4a52" },
  headerSub:      { fontSize: 12, color: "#6b7280", marginTop: 2 },
  addBtn:         { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#1a4a52", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  addBtnText:     { color: "#fff", fontSize: 13, fontWeight: "800" },
  lockBanner:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fef9c3", borderRadius: 12, margin: 20, marginTop: 0, padding: 12, borderWidth: 1, borderColor: "#fde68a" },
  lockBannerText: { flex: 1, fontSize: 12, color: "#92400e", fontWeight: "600" },

  typeFilterRow:        { flexGrow: 0, paddingBottom: 12 },
  typeFilterRowContent: { flexDirection: "row", gap: 8, paddingHorizontal: 20 },
  typeFilterChip:       { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: "#fff" },
  typeFilterChipActive: { borderColor: "#1a4a52", backgroundColor: "#1a4a52" },
  typeFilterChipText:       { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  typeFilterChipTextActive: { color: "#fff" },

  list:      { flex: 1 },
  empty:     { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: "800", color: "#374151" },
  emptySub:  { fontSize: 12, color: "#9ca3af", textAlign: "center" },

  driverCard:       { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#fff", borderRadius: 16, padding: 14, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  driverAvatar:     { width: 46, height: 46, borderRadius: 23, backgroundColor: "#1a4a52", alignItems: "center", justifyContent: "center" },
  driverAvatarText: { fontSize: 16, fontWeight: "900", color: "#fff" },
  driverInfo:       { flex: 1, gap: 3 },
  driverName:       { fontSize: 14, fontWeight: "800", color: "#1a4a52", marginBottom: 2 },
  driverDetailRow:  { flexDirection: "row", alignItems: "center", gap: 5 },
  driverDetail:     { fontSize: 11, color: "#6b7280" },
  driverActions:    { alignItems: "flex-end", gap: 8 },
  statusBadge:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusDot:        { width: 6, height: 6, borderRadius: 3 },
  statusText:       { fontSize: 11, fontWeight: "800" },
  deleteBtn:        { flexDirection: "row", alignItems: "center", gap: 3, padding: 4 },
  deleteBtnText:    { fontSize: 12, fontWeight: "700" },

  // membership card (active association member)
  membershipCard:  { borderRadius: 8, borderWidth: 1.5, borderColor: "#bbf7d0", backgroundColor: "#f0fdf4", paddingHorizontal: 8, paddingVertical: 7, marginTop: 6, gap: 4 },
  membershipRow:   { flexDirection: "row", alignItems: "center", gap: 5 },
  membershipAssoc: { fontSize: 11, fontWeight: "800", color: "#16a34a", flex: 1 },
  membershipRoute: { fontSize: 11, fontWeight: "600", color: "#1a4a52", flex: 1 },

  // association badge (pending / rejected status)
  assocBadge:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginTop: 6, alignSelf: "flex-start" },
  assocBadgeText: { fontSize: 11, fontWeight: "700", maxWidth: 160 },

  // apply button
  applyBtn:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, borderWidth: 1.5, borderColor: "#1a4a52", paddingHorizontal: 8, paddingVertical: 5, marginTop: 6, alignSelf: "flex-start" },
  applyBtnText: { fontSize: 11, fontWeight: "700", color: "#1a4a52" },

  // leave association button
  leaveBtn:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, borderWidth: 1.5, borderColor: "#dc2626", paddingHorizontal: 8, paddingVertical: 5, marginTop: 6, alignSelf: "flex-start" },
  leaveBtnText: { fontSize: 11, fontWeight: "700", color: "#dc2626" },

  // vehicle chip on driver card
  vehicleChip:          { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  vehicleChipText:      { fontSize: 11, color: "#6b7280" },
  assignVehicleBtn:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, borderWidth: 1.5, borderColor: "#fde68a", backgroundColor: "#fffbeb", paddingHorizontal: 8, paddingVertical: 5, marginTop: 5, alignSelf: "flex-start" },
  assignVehicleBtnText: { fontSize: 11, fontWeight: "700", color: "#d97706" },

  // route chip on driver card — read-only display now; set from Vehicles tab
  routeChip:          { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  routeChipText:      { fontSize: 11, color: "#6b7280" },

  // vehicle picker (Add Driver / Assign Vehicle / Edit Driver) — grouped by
  // category (vehicle type) so an operator with a large mixed fleet doesn't
  // have to scan one long flat list to find the right vehicle.
  noVehicleBox:          { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f9fafb", borderRadius: 10, borderWidth: 1, borderColor: "#e5e7eb", padding: 12, marginTop: 4 },
  noVehicleText:         { fontSize: 12, color: "#9ca3af" },
  vehiclePickerItem:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", marginBottom: 8, backgroundColor: "#f9fafb" },
  vehiclePickerItemActive: { borderColor: "#0284c7", backgroundColor: "#f0f9ff" },
  vehiclePickerIcon:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  vehiclePickerPlate:    { fontSize: 14, fontWeight: "700", color: "#374151" },
  vehiclePickerType:     { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  categoryChip:          { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff" },
  categoryChipActive:    { borderColor: "#1a4a52", backgroundColor: "#1a4a52" },
  categoryChipText:      { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  categoryChipTextActive:{ color: "#fff" },

  // association picker inside modal
  assocPickerItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: "#e5e7eb", marginBottom: 8, backgroundColor: "#f9fafb",
  },
  assocPickerItemActive: { borderColor: "#1a4a52", backgroundColor: "#f0faf4" },
  assocPickerIcon:       { width: 36, height: 36, borderRadius: 18, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  assocPickerName:       { fontSize: 14, fontWeight: "700", color: "#374151" },
  assocPickerRegion:     { fontSize: 11, color: "#9ca3af", marginTop: 2 },

  stepLabel:   { fontSize: 12, fontWeight: "800", color: "#374151", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  stepDivider: { height: 1, backgroundColor: "#f3f4f6", marginVertical: 14 },

  noRoutesBox:  { alignItems: "center", paddingVertical: 24, gap: 6 },
  noRoutesText: { fontSize: 15, fontWeight: "800", color: "#374151" },

  modalOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:       { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHandle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },
  modalTitle:       { fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  modalSub:         { fontSize: 13, color: "#6b7280", marginBottom: 20 },
  errorBox:         { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca", borderRadius: 12, padding: 12, marginBottom: 14 },
  errorText:        { flex: 1, color: "#dc2626", fontSize: 13 },
  fieldLabel:       { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  fieldHint:        { fontSize: 11, color: "#9ca3af", marginTop: 6 },
  licenseHint:      { fontSize: 11, color: "#9ca3af", marginTop: 6 },
  input:            { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#f9fafb" },
  passwordWrap:     { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, backgroundColor: "#f9fafb" },
  passwordInput:    { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827" },
  eyeBtn:           { paddingHorizontal: 14 },
  modalActions:     { flexDirection: "row", gap: 10, marginTop: 8 },
  modalCancel:      { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  modalCancelText:  { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  modalConfirm:     { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: "#1a4a52", alignItems: "center" },
  modalConfirmText: { fontSize: 14, fontWeight: "800", color: "#fff" },
  confirmBox:       { backgroundColor: "#fff", borderRadius: 20, margin: 32, padding: 24, alignItems: "center", gap: 8 },
  confirmIconWrap:  { width: 64, height: 64, borderRadius: 32, backgroundColor: "#fef2f2", alignItems: "center", justifyContent: "center" },
  confirmTitle:     { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  confirmSub:       { fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 8 },
});