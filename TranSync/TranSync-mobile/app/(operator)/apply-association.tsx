import { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Image, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

type VehicleType = "Jeepney" | "UV Express" | "Bus";
type AssocOption = { id: number; name: string };
type DocField = { key: string; label: string; hint: string };

const VEHICLE_TYPES: { key: VehicleType; icon: React.ComponentProps<typeof Ionicons>["name"]; color: string }[] = [
  { key: "Jeepney",    icon: "bus",         color: "#16a34a" },
  { key: "UV Express", icon: "car",         color: "#9333ea" },
  { key: "Bus",        icon: "bus-outline", color: "#2563eb" },
];

// One upload field per named document, matching the LTO/LTFRB checklist for
// each vehicle type exactly — mirrors the columns on operator_association_applications.
const DOC_FIELDS: Record<VehicleType, DocField[]> = {
  "Jeepney": [
    { key: "doc_lto_cr",        label: "LTO Certificate of Registration (CR)", hint: "Must state PUJ or Modern PUV (Class 1, 2, or 3)" },
    { key: "doc_capacity_spec", label: "Capacity Specification",               hint: "Certified seating blueprint, usually 16–30 passengers" },
    { key: "doc_engine_cert",   label: "Engine Certificate",                   hint: "Manufacturer proof of Euro-4 or Euro-5 compliance" },
    { key: "doc_lto_stencil",   label: "LTO Stencil",                          hint: "Verified physical stencil of engine and chassis numbers" },
  ],
  "UV Express": [
    { key: "doc_lto_cr",             label: "LTO Certificate of Registration (CR)", hint: "Must explicitly state UV Express Service" },
    { key: "doc_model_proof",        label: "Model Proof",                          hint: "Verification the unit is an approved van or AUV model" },
    { key: "doc_terminal_route_map", label: "Terminal Route Map",                   hint: "Approved point-to-point (P2P) origin and destination map" },
    { key: "doc_garage_proof",       label: "Garage Proof",                         hint: "Certification of an off-road commercial garage slot" },
  ],
  "Bus": [
    { key: "doc_lto_cr",        label: "LTO Certificate of Registration (CR)", hint: "Must state Public Utility Bus (PUB)" },
    { key: "doc_speed_limiter", label: "Speed Limiter Paper",                  hint: "Certified calibration certificate (RA 10916)" },
    { key: "doc_gps_cert",      label: "GPS Certificate",                      hint: "Proof of an active, LTFRB-compliant tracking device" },
    { key: "doc_pami_policy",   label: "PAMI Policy",                          hint: "High-liability Passenger Accident Insurance coverage" },
    { key: "doc_fare_matrix",   label: "Fare Matrix",                          hint: "Approved distance-based fare table from the LTFRB" },
  ],
};

type DocState = { uri: string | null; file: File | null; preview: string | null };
const emptyDoc: DocState = { uri: null, file: null, preview: null };

export default function ApplyAssociation() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Optional hand-off from the registration wizard's Step 2 — reachable
  // right after a brand-new operator account is created, before any login
  // session exists yet (this app never auto-logs-in post-registration), so
  // operatorId can't come from AsyncStorage in that case. When present, this
  // screen behaves identically otherwise — same endpoint, same document
  // checklist, same validation — just pre-filled and returning to
  // register-success instead of router.back() on success.
  const params = useLocalSearchParams<{
    fromRegistration?: string; operatorId?: string; vehicleType?: string; associationId?: string;
    intendedPlateNumber?: string; intendedVehicleNumber?: string; intendedCapacity?: string;
  }>();
  const fromRegistration = params.fromRegistration === "1";

  const [operatorId, setOperatorId] = useState<number | null>(
    fromRegistration && params.operatorId ? Number(params.operatorId) : null
  );
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(
    (params.vehicleType as VehicleType) || null
  );

  const [associations,  setAssociations]  = useState<AssocOption[]>([]);
  const [assocSearch,   setAssocSearch]   = useState("");
  const [selectedAssoc, setSelectedAssoc] = useState<AssocOption | null>(null);
  const [loadingAssocs, setLoadingAssocs] = useState(false);

  const [docs, setDocs] = useState<Record<string, DocState>>({});
  const webInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");

  useEffect(() => {
    if (fromRegistration) return; // operatorId already set from params above
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (raw) setOperatorId(JSON.parse(raw).id);
    })();
  }, []);

  useEffect(() => {
    if (!vehicleType) return;
    setDocs({});
    setError("");
    (async () => {
      setLoadingAssocs(true);
      try {
        const res  = await fetch(`${API_BASE}/associations/get_associations.php`);
        const data = await res.json();
        if (data.success) {
          const list: AssocOption[] = data.associations ?? [];
          setAssociations(list);
          // Pre-select the association chosen during registration, if any —
          // only on this effect's first run for a hand-off, never overriding
          // a manual re-pick later.
          if (fromRegistration && params.associationId && !selectedAssoc) {
            const match = list.find(a => a.id === Number(params.associationId));
            if (match) setSelectedAssoc(match);
          } else if (!fromRegistration) {
            setSelectedAssoc(null);
          }
        }
      } catch (_) {}
      finally { setLoadingAssocs(false); }
    })();
  }, [vehicleType]);

  const filteredAssociations = associations.filter(a =>
    a.name.toLowerCase().includes(assocSearch.trim().toLowerCase())
  );

  const pickNative = async (key: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { setError("Permission to access photos is required."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) {
      setDocs(prev => ({ ...prev, [key]: { uri: result.assets[0].uri, file: null, preview: result.assets[0].uri } }));
    }
  };

  const handleWebFileChange = (key: string, e: any) => {
    const file = e.target.files?.[0];
    if (file) setDocs(prev => ({ ...prev, [key]: { uri: null, file, preview: URL.createObjectURL(file) } }));
  };

  const handlePickDoc = (key: string) => {
    if (Platform.OS === "web") { webInputRefs.current[key]?.click(); }
    else { pickNative(key); }
  };

  const removeDoc = (key: string) => {
    setDocs(prev => ({ ...prev, [key]: emptyDoc }));
  };

  const fields = vehicleType ? DOC_FIELDS[vehicleType] : [];
  const allDocsAttached = fields.every(f => {
    const d = docs[f.key];
    return d && (Platform.OS === "web" ? !!d.file : !!d.uri);
  });

  const handleSubmit = async () => {
    setError("");
    if (!operatorId || !vehicleType) return;
    if (!selectedAssoc) { setError("Please choose an association to apply to."); return; }
    if (!allDocsAttached) { setError("Please attach all required documents for this vehicle type."); return; }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("operator_id",    String(operatorId));
      formData.append("association_id", String(selectedAssoc.id));
      formData.append("vehicle_type",   vehicleType);
      if (fromRegistration) {
        if (params.intendedPlateNumber)   formData.append("intended_plate_number", params.intendedPlateNumber);
        if (params.intendedVehicleNumber) formData.append("intended_vehicle_number", params.intendedVehicleNumber);
        if (params.intendedCapacity)      formData.append("intended_capacity", params.intendedCapacity);
      }
      fields.forEach(f => {
        const d = docs[f.key];
        if (Platform.OS === "web") {
          formData.append(f.key, d.file!, d.file!.name);
        } else {
          formData.append(f.key, { uri: d.uri!, name: `${f.key}.jpg`, type: "image/jpeg" } as any);
        }
      });

      const res  = await fetch(`${API_BASE}/operators/apply_to_association.php`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        if (fromRegistration) {
          router.replace("/(auth)/register-success?role=operator" as any);
        } else {
          router.back();
        }
      } else {
        setError(data.message ?? "Failed to submit application.");
      }
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {Platform.OS === "web" && vehicleType && DOC_FIELDS[vehicleType].map(f => (
        <input
          key={f.key}
          ref={(el) => { webInputRefs.current[f.key] = el; }}
          type="file" accept="image/*,.pdf"
          style={{ display: "none" }}
          onChange={(e) => handleWebFileChange(f.key, e)}
        />
      ))}

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Apply to Association</Text>
          <Text style={styles.headerSub}>Pick a vehicle type, then an association, then upload its documents</Text>
        </View>
      </View>

      <KeyboardAwareForm contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="warning" size={14} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.fieldLabel}>Vehicle Type</Text>
        <View style={styles.typeRow}>
          {VEHICLE_TYPES.map(t => {
            const active = vehicleType === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.typeCard, active && { borderColor: t.color, backgroundColor: t.color + "12" }]}
                onPress={() => setVehicleType(t.key)}
                activeOpacity={0.8}
              >
                <Ionicons name={t.icon} size={22} color={active ? t.color : "#9ca3af"} />
                <Text style={[styles.typeCardText, active && { color: t.color }]}>{t.key}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {vehicleType && (
          <>
            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Association</Text>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={15} color="#9ca3af" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search associations..."
                placeholderTextColor="#9ca3af"
                value={assocSearch}
                onChangeText={setAssocSearch}
              />
            </View>
            {loadingAssocs ? (
              <ActivityIndicator color="#1a4a52" style={{ marginVertical: 16 }} />
            ) : filteredAssociations.length === 0 ? (
              <Text style={styles.emptyText}>No active associations found.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {filteredAssociations.map(a => {
                  const active = selectedAssoc?.id === a.id;
                  return (
                    <TouchableOpacity
                      key={a.id}
                      style={[styles.assocItem, active && styles.assocItemActive]}
                      onPress={() => setSelectedAssoc(active ? null : a)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="business" size={16} color={active ? "#1a4a52" : "#9ca3af"} />
                      <Text style={[styles.assocItemText, active && { color: "#1a4a52", fontWeight: "800" }]}>{a.name}</Text>
                      {active && <Ionicons name="checkmark-circle" size={18} color="#16a34a" style={{ marginLeft: "auto" }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Required Documents — {vehicleType}</Text>
            {fields.map(f => {
              const d = docs[f.key];
              const hasFile = d && (Platform.OS === "web" ? !!d.file : !!d.uri);
              return (
                <View key={f.key} style={styles.docWrap}>
                  <Text style={styles.docLabel}>{f.label}</Text>
                  <Text style={styles.docHint}>{f.hint}</Text>
                  <TouchableOpacity style={styles.uploadBtn} onPress={() => handlePickDoc(f.key)} activeOpacity={0.8}>
                    {hasFile && d.preview ? (
                      <Image source={{ uri: d.preview }} style={styles.previewImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.uploadPlaceholder}>
                        <Ionicons name="attach" size={22} color="#9ca3af" />
                        <Text style={styles.uploadText}>Tap to attach</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  {hasFile && (
                    <TouchableOpacity onPress={() => removeDoc(f.key)} style={styles.removeBtn}>
                      <Ionicons name="close-circle" size={13} color="#ef4444" />
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Application</Text>}
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 40 }} />
      </KeyboardAwareForm>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f9fafb" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, borderRadius: 10, paddingHorizontal: 10, backgroundColor: "#f1f5f9", justifyContent: "center" },
  backBtnText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  headerTitle: { fontSize: 17, fontWeight: "900", color: "#1a4a52" },
  headerSub:   { fontSize: 11, color: "#6b7280", marginTop: 2 },

  scroll: { padding: 20, paddingBottom: 20 },

  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
  errorText: { flex: 1, color: "#dc2626", fontSize: 13 },

  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },

  typeRow: { flexDirection: "row", gap: 10 },
  typeCard: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 16, borderRadius: 14, borderWidth: 1.5, borderColor: "#e5e7eb", backgroundColor: "#fff" },
  typeCardText: { fontSize: 12, fontWeight: "700", color: "#9ca3af" },

  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: "#fff", marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },
  emptyText: { fontSize: 13, color: "#9ca3af", textAlign: "center", paddingVertical: 16 },

  assocItem: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" },
  assocItemActive: { borderColor: "#1a4a52", backgroundColor: "#f0faf4" },
  assocItemText: { fontSize: 14, color: "#374151", fontWeight: "600" },

  docWrap: { marginBottom: 16 },
  docLabel: { fontSize: 13, fontWeight: "700", color: "#374151" },
  docHint:  { fontSize: 11, color: "#9ca3af", marginBottom: 8, marginTop: 1 },
  uploadBtn: { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, borderStyle: "dashed", overflow: "hidden", backgroundColor: "#fff" },
  uploadPlaceholder: { alignItems: "center", paddingVertical: 22, gap: 4 },
  uploadText: { fontSize: 12, fontWeight: "700", color: "#374151" },
  previewImage: { width: "100%", height: 140 },
  removeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 6 },
  removeBtnText: { fontSize: 11, color: "#ef4444", fontWeight: "600" },

  submitBtn: { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  submitBtnText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
