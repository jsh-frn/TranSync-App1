import { useState, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Platform, ActivityIndicator, Image,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import API_BASE from "../../src/config/api";
import {
  getOperatorDraft, setOperatorDraft, clearOperatorDraft, BLANK_OPERATOR_DRAFT,
} from "../../src/state/registrationDraft";
import PhoneOtpField from "../../src/components/registration/PhoneOtpField";
import TermsGate from "../../src/components/registration/TermsGate";
import { OPERATOR_TERMS, PRIVACY_POLICY } from "../../src/constants/registrationTerms";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

// Redesigned into 5 small, single-purpose steps (was 3 larger ones): Name →
// Password → Contact Info + OTP → Business & Fleet Setup → Identity &
// Compliance Documents. No Date of Birth/Middle Name/Suffix — dropped, none
// read by any fare/matching/verification logic.
//
// Step 2's vehicle type/plate/vehicle_number/capacity CANNOT become a real
// `vehicles` row yet — vehicles.php requires an already-APPROVED association
// membership first, and approval is a manual review step. So those answers
// are carried as an "intended vehicle" reminder into the association
// application (if a real association was picked) — see migration 055 and
// operators/apply_to_association.php. If "Independent" was picked, they're
// simply discarded; the operator can register a vehicle for real once
// they've applied and been approved, same as any operator today.
//
// A real association application still needs its own vehicle-type document
// checklist (4-5 docs) — Step 3 here only collects 3 generic ones, so this
// screen does NOT call apply_to_association.php itself. Instead, right after
// the account is created, it hands off into the existing, unmodified
// apply-association.tsx screen (pre-filled) to complete that separately.

const TOTAL_STEPS = 5;
const STEP_LABELS = ["Name", "Password", "Contact Info", "Business & Fleet Setup", "Identity & Compliance Verification"];

type VehicleType = "Jeepney" | "UV Express" | "Bus";
type AssocOption = { id: number; name: string };

type DocState = { uri: string | null; file: File | null; preview: string | null };
const emptyDoc: DocState = { uri: null, file: null, preview: null };

export default function OperatorRegister() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const existing = getOperatorDraft();
  const [step, setStep] = useState(1);

  // ── Step 1 — account & profile ────────────────────────────────────────────
  // Full name is persisted to the draft as one string ("full_name") — split
  // back out for the two inputs on rehydration, computed once as part of
  // each field's own initial state (never via a setter call during render).
  const draftNameParts = existing?.full_name ? existing.full_name.trim().split(/\s+/) : [];
  const [firstName, setFirstName] = useState(draftNameParts[0] ?? "");
  const [lastName,  setLastName]  = useState(draftNameParts.slice(1).join(" "));
  const [email,     setEmail]     = useState(existing?.email ?? "");
  const [phone,     setPhone]     = useState(existing?.phone ?? "");
  const [phoneVerified, setPhoneVerified] = useState(existing?.phone_verified ?? false);
  const [password,        setPassword]        = useState(existing?.password ?? "");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass,        setShowPass]        = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  // ── Step 2 — business & fleet setup ───────────────────────────────────────
  const [entityType,   setEntityType]   = useState<"individual" | "business">(existing?.entity_type ?? "individual");
  const [businessName, setBusinessName] = useState(existing?.business_name ?? "");
  const [vehicleType,  setVehicleType]  = useState<VehicleType | "">(existing?.vehicle_type ?? "");
  const [plateNumber,  setPlateNumber]  = useState(existing?.plate_number ?? "");
  const [vehicleNumber, setVehicleNumber] = useState(existing?.vehicle_number ?? "");
  const [capacity,      setCapacity]      = useState(existing?.seating_capacity ?? "");
  const [associationId, setAssociationId] = useState<number | null>(existing?.association_id ?? null);
  const [associations,  setAssociations]  = useState<AssocOption[]>([]);
  const [loadingAssocs, setLoadingAssocs]  = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingAssocs(true);
      try {
        const res  = await fetch(`${API_BASE}/associations/get_associations.php`);
        const data = await res.json();
        if (data.success) setAssociations(data.associations ?? []);
      } catch (_) {}
      finally { setLoadingAssocs(false); }
    })();
  }, []);

  // ── Step 3 — identity & compliance documents (15MB max each) ─────────────
  const MAX_DOC_BYTES = 15 * 1024 * 1024;
  const [driversLicense,       setDriversLicense]       = useState<DocState>(emptyDoc);
  const [vehicleOrCr,          setVehicleOrCr]          = useState<DocState>(emptyDoc);
  const [businessRegistration, setBusinessRegistration] = useState<DocState>(emptyDoc);
  const webInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const persist = (patch: Partial<typeof BLANK_OPERATOR_DRAFT>) => setOperatorDraft(patch);

  const formatPhone = (raw: string) => {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("639")) digits = "0" + digits.slice(2);
    if (digits.startsWith("9"))   digits = "0" + digits;
    digits = digits.slice(0, 11);
    let formatted = digits;
    if (digits.length > 7)      formatted = digits.slice(0, 4) + "-" + digits.slice(4, 7) + "-" + digits.slice(7);
    else if (digits.length > 4) formatted = digits.slice(0, 4) + "-" + digits.slice(4);
    return formatted;
  };
  const handlePhoneChange = (raw: string) => {
    const f = formatPhone(raw);
    setPhone(f);
    persist({ phone: f });
  };

  const handleNextFromStep1 = () => {
    setError("");
    if (!firstName || !lastName) {
      setError("Please enter your first and last name."); return;
    }
    persist({ full_name: `${firstName} ${lastName}`.trim() });
    setStep(2);
  };

  const handleNextFromStep2 = () => {
    setError("");
    if (!password || !confirmPassword) {
      setError("Please fill in both password fields."); return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters."); return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match."); return;
    }
    persist({ password });
    setStep(3);
  };

  const handleNextFromStep3 = () => {
    setError("");
    if (!email || !phone) {
      setError("Please fill in all required fields."); return;
    }
    if (phone.replace(/\D/g, "").length !== 11) {
      setError("Enter a valid 11-digit Philippine mobile number (e.g. 09XX-XXX-XXXX)."); return;
    }
    if (!phoneVerified) {
      setError("Please verify your phone number first."); return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError("Please enter a valid email address."); return;
    }
    persist({ email, phone: phone.replace(/\D/g, ""), phone_verified: phoneVerified });
    setStep(4);
  };

  const capacityRange = vehicleType === "Jeepney"
    ? "Even number, 12–36"
    : vehicleType === "UV Express"
      ? "9–18, including the driver's seat"
      : "";

  const handleNextFromStep4 = () => {
    setError("");
    if (!vehicleType) { setError("Please select the vehicle type you'll operate."); return; }
    if (!plateNumber.trim()) { setError("Please enter your vehicle's plate number."); return; }
    if (!vehicleNumber.trim()) { setError("Please enter your vehicle's fleet number."); return; }
    if (vehicleType !== "Bus") {
      const cap = parseInt(capacity, 10);
      if (vehicleType === "Jeepney" && (!cap || cap < 12 || cap > 36 || cap % 2 !== 0)) {
        setError("Jeepney seating capacity must be an even number between 12 and 36."); return;
      }
      if (vehicleType === "UV Express" && (!cap || cap < 9 || cap > 18)) {
        setError("UV Express seating capacity (including the driver) must be between 9 and 18."); return;
      }
    }
    persist({
      entity_type: entityType, business_name: businessName,
      vehicle_type: vehicleType, plate_number: plateNumber.trim(),
      vehicle_number: vehicleNumber.trim(),
      seating_capacity: vehicleType === "Bus" ? "" : capacity,
      association_id: associationId,
    });
    setStep(5);
  };

  const pickNative = async (setter: (d: DocState) => void) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { setError("Permission to access photos is required."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.7,
    });
    if (!result.canceled) setter({ uri: result.assets[0].uri, file: null, preview: result.assets[0].uri });
  };
  const handleWebFileChange = (setter: (d: DocState) => void, e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_DOC_BYTES) { setError("Each document must be 15MB or smaller."); return; }
    setter({ uri: null, file, preview: URL.createObjectURL(file) });
  };
  const handlePick = (key: string, setter: (d: DocState) => void) => {
    if (Platform.OS === "web") webInputRefs.current[key]?.click();
    else pickNative(setter);
  };

  const allDocsAttached =
    (Platform.OS === "web" ? !!driversLicense.file : !!driversLicense.uri) &&
    (Platform.OS === "web" ? !!vehicleOrCr.file : !!vehicleOrCr.uri) &&
    (Platform.OS === "web" ? !!businessRegistration.file : !!businessRegistration.uri);

  const handleSubmit = async () => {
    setError("");
    if (!allDocsAttached) { setError("Please attach all three required documents."); return; }
    if (!termsAccepted) { setError("You must agree to the Operator Terms & Conditions and Privacy Policy to continue."); return; }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("first_name", firstName);
      formData.append("last_name",  lastName);
      formData.append("email",    email);
      formData.append("phone",    phone.replace(/\D/g, ""));
      formData.append("password", password);
      formData.append("entity_type",   entityType);
      if (businessName.trim()) formData.append("business_name", businessName.trim());
      formData.append("terms_accepted", "1");

      const appendDoc = (field: string, d: DocState) => {
        if (Platform.OS === "web") formData.append(field, d.file!, d.file!.name);
        else formData.append(field, { uri: d.uri!, name: `${field}.jpg`, type: "image/jpeg" } as any);
      };
      appendDoc("drivers_license", driversLicense);
      appendDoc("vehicle_or_cr", vehicleOrCr);
      appendDoc("business_registration", businessRegistration);

      const res  = await fetch(`${API_BASE}/auth/operator_register.php`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Registration failed.");
        return;
      }

      clearOperatorDraft();
      const newOperatorId = data.id;

      if (associationId) {
        router.replace({
          pathname: "/(operator)/apply-association" as any,
          params: {
            fromRegistration: "1",
            operatorId: String(newOperatorId),
            vehicleType,
            associationId: String(associationId),
            ...(plateNumber ? { intendedPlateNumber: plateNumber.trim() } : {}),
            ...(vehicleNumber ? { intendedVehicleNumber: vehicleNumber.trim() } : {}),
            ...(vehicleType !== "Bus" && capacity ? { intendedCapacity: capacity } : {}),
          },
        });
      } else {
        router.replace("/(auth)/register-success?role=operator" as any);
      }
    } catch {
      setError("Cannot connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {Platform.OS === "web" && (
        <>
          <input ref={(el) => { webInputRefs.current["drivers_license"] = el; }} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => handleWebFileChange(setDriversLicense, e)} />
          <input ref={(el) => { webInputRefs.current["vehicle_or_cr"] = el; }} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => handleWebFileChange(setVehicleOrCr, e)} />
          <input ref={(el) => { webInputRefs.current["business_registration"] = el; }} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => handleWebFileChange(setBusinessRegistration, e)} />
        </>
      )}

      <KeyboardAwareForm style={{ flex: 1 }} contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 48 }]}>

        {/* BACK */}
        <TouchableOpacity
          style={styles.back}
          onPress={() => (step > 1 ? setStep(step - 1) : router.back())}
        >
          <Ionicons name="chevron-back" size={16} color="#1a4a52" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.title}>Operator Registration</Text>
          <Text style={styles.subtitle}>
            Step {step} of {TOTAL_STEPS} — {STEP_LABELS[step - 1]}
          </Text>
          <View style={styles.stepRow}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n => (
              <View key={n} style={[styles.stepDot, step >= n && styles.stepDotDone]} />
            ))}
          </View>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="warning" size={14} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {step === 1 && (
          <>
            <SectionTitle>Personal Information</SectionTitle>
            <View style={styles.form}>
              <Field label="First Name" required>
                <TextInput style={styles.input} placeholder="Juan" placeholderTextColor="#9ca3af"
                  value={firstName} onChangeText={setFirstName} />
              </Field>
              <Field label="Last Name" required>
                <TextInput style={styles.input} placeholder="Dela Cruz" placeholderTextColor="#9ca3af"
                  value={lastName} onChangeText={setLastName} />
              </Field>
            </View>

            <TouchableOpacity style={styles.btnSubmit} onPress={handleNextFromStep1} activeOpacity={0.85}>
              <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 2 && (
          <>
            <SectionTitle>Account Security</SectionTitle>
            <View style={styles.form}>
              <Field label="Password" required>
                <View style={styles.passwordWrap}>
                  <TextInput style={styles.passwordInput} placeholder="Min. 6 characters" placeholderTextColor="#9ca3af"
                    secureTextEntry={!showPass} value={password} onChangeText={(v) => { setPassword(v); persist({ password: v }); }} />
                  <TouchableOpacity onPress={() => setShowPass(!showPass)} style={styles.eyeBtn} accessibilityLabel={showPass ? "Hide password" : "Show password"}>
                    <Ionicons name={showPass ? "eye-off" : "eye"} size={18} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
              </Field>
              <Field label="Confirm Password" required>
                <View style={styles.passwordWrap}>
                  <TextInput style={styles.passwordInput} placeholder="Re-enter your password" placeholderTextColor="#9ca3af"
                    secureTextEntry={!showConfirmPass} value={confirmPassword} onChangeText={setConfirmPassword} />
                  <TouchableOpacity onPress={() => setShowConfirmPass(!showConfirmPass)} style={styles.eyeBtn} accessibilityLabel={showConfirmPass ? "Hide password" : "Show password"}>
                    <Ionicons name={showConfirmPass ? "eye-off" : "eye"} size={18} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
              </Field>
            </View>

            <TouchableOpacity style={styles.btnSubmit} onPress={handleNextFromStep2} activeOpacity={0.85}>
              <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 3 && (
          <>
            <SectionTitle>Contact Information</SectionTitle>
            <View style={styles.form}>
              <Field label="Email Address" required>
                <TextInput style={styles.input} placeholder="you@example.com" placeholderTextColor="#9ca3af"
                  keyboardType="email-address" autoCapitalize="none" value={email}
                  onChangeText={(v) => { setEmail(v); persist({ email: v }); }} />
              </Field>
              <PhoneOtpField
                phone={phone} onPhoneChange={handlePhoneChange}
                verified={phoneVerified} onVerifiedChange={(v) => { setPhoneVerified(v); persist({ phone_verified: v }); }}
              />
            </View>

            <TouchableOpacity style={[styles.btnSubmit, !phoneVerified && { opacity: 0.5 }]} onPress={handleNextFromStep3} disabled={!phoneVerified} activeOpacity={0.85}>
              <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 4 && (
          <>
            <SectionTitle>Entity Type</SectionTitle>
            <View style={styles.form}>
              <Field label="Operator Type" required>
                <View style={styles.chipRow}>
                  {(["individual", "business"] as const).map((t) => (
                    <TouchableOpacity key={t} style={[styles.chipBtn, entityType === t && styles.chipActive]}
                      onPress={() => { setEntityType(t); persist({ entity_type: t }); }} activeOpacity={0.8}>
                      <Text style={[styles.chipText, entityType === t && styles.chipTextActive]}>
                        {t === "individual" ? "Sole Proprietor" : "Corporation"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Field>
              <Field label="Operator/Business Name">
                <TextInput style={styles.input} placeholder="Optional — e.g. Dela Cruz Transport Services" placeholderTextColor="#9ca3af"
                  value={businessName} onChangeText={(v) => { setBusinessName(v); persist({ business_name: v }); }} />
              </Field>
            </View>

            <SectionTitle>Vehicle Information</SectionTitle>
            <View style={styles.form}>
              <Field label="Vehicle Type" required>
                <View style={styles.chipRow}>
                  {(["Jeepney", "UV Express", "Bus"] as const).map((t) => (
                    <TouchableOpacity key={t} style={[styles.chipBtn, vehicleType === t && styles.chipActive]}
                      onPress={() => { setVehicleType(t); persist({ vehicle_type: t }); }} activeOpacity={0.8}>
                      <Text style={[styles.chipText, vehicleType === t && styles.chipTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Field>
              <Field label="Plate Number" required>
                <TextInput style={styles.input} placeholder="ABC 1234" placeholderTextColor="#9ca3af" autoCapitalize="characters"
                  value={plateNumber} onChangeText={(v) => { setPlateNumber(v); persist({ plate_number: v }); }} />
              </Field>
              <Field label="Vehicle/Fleet Number" required>
                <TextInput style={styles.input} placeholder="e.g. Unit 12" placeholderTextColor="#9ca3af"
                  value={vehicleNumber} onChangeText={(v) => { setVehicleNumber(v); persist({ vehicle_number: v }); }} />
              </Field>
              {vehicleType === "Bus" ? (
                <View style={styles.noteBox}>
                  <Ionicons name="information-circle-outline" size={14} color="#92400e" style={{ marginTop: 1 }} />
                  <Text style={styles.noteText}>
                    Bus seating comes from its own seat layout, built after your account is approved — no capacity to enter here.
                  </Text>
                </View>
              ) : vehicleType !== "" ? (
                <Field label="Seating Capacity" required>
                  <TextInput style={styles.input} placeholder={capacityRange} placeholderTextColor="#9ca3af"
                    keyboardType="number-pad" value={capacity} onChangeText={(v) => { setCapacity(v.replace(/\D/g, "")); persist({ seating_capacity: v.replace(/\D/g, "") }); }} />
                </Field>
              ) : null}
              <Field label="Association / Fleet Affiliation">
                {loadingAssocs ? (
                  <ActivityIndicator color="#1a4a52" />
                ) : (
                  <View style={styles.chipRow}>
                    <TouchableOpacity style={[styles.chipBtn, associationId === null && styles.chipActive]}
                      onPress={() => { setAssociationId(null); persist({ association_id: null }); }} activeOpacity={0.8}>
                      <Text style={[styles.chipText, associationId === null && styles.chipTextActive]}>Independent</Text>
                    </TouchableOpacity>
                    {associations.map(a => (
                      <TouchableOpacity key={a.id} style={[styles.chipBtn, associationId === a.id && styles.chipActive]}
                        onPress={() => { setAssociationId(a.id); persist({ association_id: a.id }); }} activeOpacity={0.8}>
                        <Text style={[styles.chipText, associationId === a.id && styles.chipTextActive]}>{a.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </Field>
            </View>

            {associationId && (
              <View style={styles.noteBox}>
                <Ionicons name="document-text-outline" size={14} color="#92400e" style={{ marginTop: 1 }} />
                <Text style={styles.noteText}>
                  After your account is created, you'll complete this association's own document checklist for {vehicleType}.
                  Your vehicle details above are saved so you don't have to re-type them once approved.
                </Text>
              </View>
            )}

            <TouchableOpacity style={styles.btnSubmit} onPress={handleNextFromStep4} activeOpacity={0.85}>
              <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 5 && (
          <>
            <SectionTitle>Identity & Compliance Documents</SectionTitle>
            <Text style={styles.inputHint}>Each document must be 15MB or smaller.</Text>
            <View style={styles.form}>
              <DocPickerField
                label="Driver's License" required
                doc={driversLicense}
                onPick={() => handlePick("drivers_license", setDriversLicense)}
                onRemove={() => setDriversLicense(emptyDoc)}
              />
              <DocPickerField
                label="Vehicle Registration (OR/CR)" required
                doc={vehicleOrCr}
                onPick={() => handlePick("vehicle_or_cr", setVehicleOrCr)}
                onRemove={() => setVehicleOrCr(emptyDoc)}
              />
              <DocPickerField
                label={entityType === "business" ? "Business Name Registration (SEC)" : "Business Name Registration (DTI)"}
                required
                doc={businessRegistration}
                onPick={() => handlePick("business_registration", setBusinessRegistration)}
                onRemove={() => setBusinessRegistration(emptyDoc)}
              />
            </View>

            <View style={styles.noteBox}>
              <Ionicons name="document-text-outline" size={14} color="#92400e" style={{ marginTop: 1 }} />
              <Text style={styles.noteText}>
                Your account and these documents will be reviewed by an admin first — you can use the app while pending.
              </Text>
            </View>

            <TermsGate
              accepted={termsAccepted}
              onAcceptedChange={setTermsAccepted}
              termsTitle="Operator Terms & Conditions"
              termsSections={OPERATOR_TERMS}
              privacySections={PRIVACY_POLICY}
            />

            <TouchableOpacity
              style={[styles.btnSubmit, (loading || !termsAccepted) && { opacity: 0.5 }]}
              onPress={handleSubmit}
              disabled={loading || !termsAccepted}
              activeOpacity={0.85}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Submit for Approval</Text>}
            </TouchableOpacity>
          </>
        )}

      </KeyboardAwareForm>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}{required ? " *" : ""}</Text>
      {children}
    </View>
  );
}

function DocPickerField({ label, required, doc, onPick, onRemove }: {
  label: string; required?: boolean; doc: DocState; onPick: () => void; onRemove: () => void;
}) {
  return (
    <Field label={label} required={required}>
      <TouchableOpacity style={styles.uploadBtn} onPress={onPick} activeOpacity={0.8}>
        {doc.preview ? (
          <Image source={{ uri: doc.preview }} style={styles.previewImage} resizeMode="cover" />
        ) : (
          <View style={styles.uploadPlaceholder}>
            <Ionicons name="attach" size={28} color="#9ca3af" />
            <Text style={styles.uploadText}>Tap to attach a document</Text>
            <Text style={styles.uploadHint}>JPG, PNG, or PDF — max 15MB</Text>
          </View>
        )}
      </TouchableOpacity>
      {doc.preview && (
        <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
          <Ionicons name="close-circle" size={14} color="#ef4444" />
          <Text style={styles.removeBtnText}>Remove attachment</Text>
        </TouchableOpacity>
      )}
    </Field>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: "#f9fafb", paddingHorizontal: 24 },

  back:     { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 32 },
  backText: { fontSize: 14, color: "#1a4a52", fontWeight: "700" },

  header:        { marginBottom: 28 },
  title:         { fontSize: 26, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  subtitle:      { fontSize: 14, color: "#6b7280" },
  stepRow:       { flexDirection: "row", gap: 6, marginTop: 10 },
  stepDot:       { width: 28, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb" },
  stepDotDone:   { backgroundColor: "#1a4a52" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20,
  },
  errorText: { flex: 1, color: "#dc2626", fontSize: 13 },

  sectionTitle: { fontSize: 12, fontWeight: "800", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12, marginTop: 4 },
  inputHint:    { fontSize: 12, color: "#9ca3af", marginBottom: 12, marginTop: -6 },

  form:       { gap: 20, marginBottom: 24 },
  fieldWrap:  { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151" },
  input: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13, fontSize: 14,
    color: "#111827", backgroundColor: "#fff",
  },
  passwordWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, backgroundColor: "#fff",
  },
  passwordInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 13, fontSize: 14, color: "#111827" },
  eyeBtn:        { paddingHorizontal: 14 },

  chipRow:        { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  chipBtn:        { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: "#e5e7eb", backgroundColor: "#fff" },
  chipActive:     { borderColor: "#1a4a52", backgroundColor: "#f0faf4" },
  chipText:       { fontSize: 13, fontWeight: "600", color: "#6b7280" },
  chipTextActive: { color: "#1a4a52" },

  uploadBtn:         { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, borderStyle: "dashed", overflow: "hidden", backgroundColor: "#fff" },
  uploadPlaceholder: { alignItems: "center", paddingVertical: 28, gap: 4 },
  uploadText:        { fontSize: 13, fontWeight: "700", color: "#374151" },
  uploadHint:        { fontSize: 11, color: "#9ca3af" },
  previewImage:      { width: "100%", height: 180 },
  removeBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8 },
  removeBtnText:     { fontSize: 12, color: "#ef4444", fontWeight: "600" },

  noteBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#fffbeb", borderRadius: 12, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: "#fde68a",
  },
  noteText: { flex: 1, fontSize: 12, color: "#92400e", lineHeight: 18 },

  btnSubmit: { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 24 },
  btnText:   { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
});
