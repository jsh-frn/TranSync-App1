import { useState, useRef } from "react";
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
  getAssociationDraft, setAssociationDraft, clearAssociationDraft, BLANK_ASSOCIATION_DRAFT,
} from "../../src/state/registrationDraft";
import TermsGate from "../../src/components/registration/TermsGate";
import PhoneOtpField from "../../src/components/registration/PhoneOtpField";
import { ASSOCIATION_TERMS, PRIVACY_POLICY } from "../../src/constants/registrationTerms";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

// Redesigned into 3 steps (was one long page): Step 1 authorized
// representative contact (no Middle Name/Suffix — dropped, none read by any
// fare/matching/verification logic), Step 2 association profile (Acronym
// and the separate association-level phone dropped — the representative's
// own already-OTP-verified phone is enough; Coverage Area/Estimated Fleet
// Size added, admin-reference only), Step 3 organizational verification
// documents (Board Resolution added, alongside the existing Registration
// Certificate and Representative's ID).

const TOTAL_STEPS = 5;
const STEP_LABELS = ["Representative Name", "Password", "Contact Info", "Association Profile", "Organizational Verification"];

type DocState = { uri: string | null; file: File | null; preview: string | null };
const emptyDoc: DocState = { uri: null, file: null, preview: null };

export default function AssociationRegister() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const existing = getAssociationDraft();
  const [step, setStep] = useState(1);

  // ── Step 1 — authorized representative contact ───────────────────────────
  const [repFirstName, setRepFirstName] = useState(existing?.rep_first_name ?? "");
  const [repLastName,  setRepLastName]  = useState(existing?.rep_last_name  ?? "");
  const [repPosition,  setRepPosition]  = useState(existing?.rep_position  ?? "");
  const [email,         setEmail]         = useState(existing?.contact_email ?? ""); // -> contact_email (login)
  const [phone,         setPhone]         = useState(existing?.contact_phone ?? ""); // -> contact_phone
  const [phoneVerified, setPhoneVerified] = useState(existing?.phone_verified ?? false);
  const [password,    setPassword]    = useState(existing?.password ?? "");
  const [confirm,     setConfirm]     = useState("");
  const [showPass,    setShowPass]    = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // ── Step 2 — association profile ──────────────────────────────────────────
  const [name,          setName]          = useState(existing?.name ?? "");
  const [address,       setAddress]       = useState(existing?.address ?? "");
  const [officialEmail, setOfficialEmail] = useState("");
  const [coverageArea,        setCoverageArea]        = useState(existing?.coverage_area ?? "");
  const [estimatedFleetSize,  setEstimatedFleetSize]  = useState(existing?.estimated_fleet_size ?? "");

  // ── Step 3 — organizational verification documents ────────────────────────
  const [regCertDoc,        setRegCertDoc]        = useState<DocState>(emptyDoc); // -> association_doc (SEC/CDA registration certificate)
  const [boardResolution,   setBoardResolution]   = useState<DocState>(emptyDoc);
  const [repIdDoc,          setRepIdDoc]          = useState<DocState>(emptyDoc); // -> rep_government_id
  const webInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const persist = (patch: Partial<typeof BLANK_ASSOCIATION_DRAFT>) => setAssociationDraft(patch);

  // ── Document pickers ──────────────────────────────────────────────────────
  const pickNative = async (setter: (d: DocState) => void) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { setError("Permission to access photos is required."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8,
    });
    if (!result.canceled) setter({ uri: result.assets[0].uri, file: null, preview: result.assets[0].uri });
  };
  const MAX_DOC_BYTES = 15 * 1024 * 1024;
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

  // ── Phone formatter (09XX-XXX-XXXX) ───────────────────────────────────────
  const formatPhone = (raw: string) => {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("639")) digits = "0" + digits.slice(2);
    if (digits.startsWith("9")) digits = "0" + digits;
    digits = digits.slice(0, 11);
    let formatted = digits;
    if (digits.length > 7)      formatted = digits.slice(0, 4) + "-" + digits.slice(4, 7) + "-" + digits.slice(7);
    else if (digits.length > 4) formatted = digits.slice(0, 4) + "-" + digits.slice(4);
    return formatted;
  };
  const handlePhoneChange = (raw: string) => {
    const f = formatPhone(raw);
    setPhone(f);
    persist({ contact_phone: f });
  };

  const handleNextFromStep1 = () => {
    setError("");
    if (!repFirstName || !repLastName || !repPosition) {
      setError("Please fill in all required fields."); return;
    }
    persist({ rep_first_name: repFirstName, rep_last_name: repLastName, rep_position: repPosition });
    setStep(2);
  };

  const handleNextFromStep2 = () => {
    setError("");
    if (!password || !confirm) {
      setError("Please fill in both password fields."); return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters."); return;
    }
    if (password !== confirm) {
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
      setError("Please verify the Authorized Representative's phone number first."); return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError("Please enter a valid email address."); return;
    }
    persist({ contact_email: email, contact_phone: phone.replace(/\D/g, ""), phone_verified: phoneVerified });
    setStep(4);
  };

  const handleNextFromStep4 = () => {
    setError("");
    if (!name || !address || !officialEmail) {
      setError("Please fill in all required Association Information fields."); return;
    }
    if (!/\S+@\S+\.\S+/.test(officialEmail)) {
      setError("Please enter a valid association email address."); return;
    }
    persist({ name, address, coverage_area: coverageArea, estimated_fleet_size: estimatedFleetSize });
    setStep(5);
  };

  const allDocsAttached =
    (Platform.OS === "web" ? !!regCertDoc.file : !!regCertDoc.uri) &&
    (Platform.OS === "web" ? !!boardResolution.file : !!boardResolution.uri) &&
    (Platform.OS === "web" ? !!repIdDoc.file : !!repIdDoc.uri);

  const handleSubmit = async () => {
    setError("");
    if (!allDocsAttached) { setError("Please attach all three required documents."); return; }
    if (!termsAccepted) { setError("You must agree to the Association Terms & Conditions and Privacy Policy to continue."); return; }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("rep_first_name",  repFirstName);
      formData.append("rep_last_name",   repLastName);
      formData.append("rep_position",    repPosition);
      formData.append("contact_email",   email);
      formData.append("contact_phone",   phone.replace(/\D/g, ""));

      formData.append("name",            name);
      formData.append("address",         address);
      formData.append("official_email",  officialEmail);
      if (coverageArea.trim())       formData.append("coverage_area", coverageArea.trim());
      if (estimatedFleetSize.trim()) formData.append("estimated_fleet_size", estimatedFleetSize.trim());

      formData.append("password",         password);
      formData.append("confirm_password", confirm);
      formData.append("terms_accepted",   "1");

      const appendDoc = (field: string, d: DocState) => {
        if (Platform.OS === "web") formData.append(field, d.file!, d.file!.name);
        else formData.append(field, { uri: d.uri!, name: `${field}.jpg`, type: "image/jpeg" } as any);
      };
      appendDoc("association_doc", regCertDoc);
      appendDoc("board_resolution", boardResolution);
      appendDoc("rep_government_id", repIdDoc);

      const res  = await fetch(`${API_BASE}/auth/association_register.php`, {
        method: "POST",
        body:   formData,
        // Do NOT set Content-Type header — let the browser set multipart boundary
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Registration failed.");
      } else {
        clearAssociationDraft();
        router.replace("/(auth)/register-success?role=association" as any);
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
          <input ref={(el) => { webInputRefs.current["association_doc"] = el; }} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => handleWebFileChange(setRegCertDoc, e)} />
          <input ref={(el) => { webInputRefs.current["board_resolution"] = el; }} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => handleWebFileChange(setBoardResolution, e)} />
          <input ref={(el) => { webInputRefs.current["rep_government_id"] = el; }} type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => handleWebFileChange(setRepIdDoc, e)} />
        </>
      )}

      <KeyboardAwareForm
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* BACK */}
        <TouchableOpacity style={styles.back} onPress={() => (step > 1 ? setStep(step - 1) : router.back())}>
          <Ionicons name="chevron-back" size={16} color="#1a4a52" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.badge}>
            <Ionicons name="business-outline" size={12} color="#1a4a52" />
            <Text style={styles.badgeText}>Association</Text>
          </View>
          <Text style={styles.title}>Association Registration</Text>
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
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Authorized Representative</Text>
            <View style={styles.form}>
              <Field label="First Name *">
                <TextInput style={styles.input} placeholder="Juan"
                  placeholderTextColor="#9ca3af" value={repFirstName} onChangeText={setRepFirstName} />
              </Field>
              <Field label="Last Name *">
                <TextInput style={styles.input} placeholder="Dela Cruz"
                  placeholderTextColor="#9ca3af" value={repLastName} onChangeText={setRepLastName} />
              </Field>
              <Field label="Position/Role in Association *">
                <TextInput style={styles.input} placeholder="e.g. President, Secretary"
                  placeholderTextColor="#9ca3af" value={repPosition} onChangeText={setRepPosition} />
              </Field>
            </View>

            <TouchableOpacity style={styles.btnSubmit} onPress={handleNextFromStep1} activeOpacity={0.85}>
              <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 2 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Account Security</Text>
            <View style={styles.form}>
              <Field label="Password *">
                <View style={styles.passwordWrap}>
                  <TextInput style={styles.passwordInput} placeholder="Min. 6 characters"
                    placeholderTextColor="#9ca3af" secureTextEntry={!showPass}
                    value={password} onChangeText={(v) => { setPassword(v); persist({ password: v }); }} />
                  <TouchableOpacity onPress={() => setShowPass(!showPass)} style={styles.eyeBtn} accessibilityLabel={showPass ? "Hide password" : "Show password"}>
                    <Ionicons name={showPass ? "eye-off" : "eye"} size={18} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
              </Field>
              <Field label="Confirm Password *">
                <View style={[styles.passwordWrap, confirm.length > 0 && password !== confirm && styles.passwordWrapError]}>
                  <TextInput style={styles.passwordInput} placeholder="Re-enter password"
                    placeholderTextColor="#9ca3af" secureTextEntry={!showConfirm}
                    value={confirm} onChangeText={setConfirm} />
                  <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)} style={styles.eyeBtn} accessibilityLabel={showConfirm ? "Hide password" : "Show password"}>
                    <Ionicons name={showConfirm ? "eye-off" : "eye"} size={18} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
                {confirm.length > 0 && password !== confirm && (
                  <Text style={styles.matchError}>Passwords do not match</Text>
                )}
              </Field>
            </View>

            <TouchableOpacity style={styles.btnSubmit} onPress={handleNextFromStep2} activeOpacity={0.85}>
              <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 3 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Contact Information</Text>
            <View style={styles.form}>
              <Field label="Direct Email Address *">
                <TextInput style={styles.input} placeholder="you@example.com"
                  placeholderTextColor="#9ca3af" keyboardType="email-address"
                  autoCapitalize="none" value={email} onChangeText={(v) => { setEmail(v); persist({ contact_email: v }); }} />
                <Text style={styles.fieldHint}>Used to sign in to your association's account.</Text>
              </Field>
              <PhoneOtpField
                label="Mobile/Phone Number"
                phone={phone} onPhoneChange={handlePhoneChange}
                verified={phoneVerified} onVerifiedChange={(v) => { setPhoneVerified(v); persist({ phone_verified: v }); }}
              />
            </View>

            <TouchableOpacity style={[styles.btnSubmit, !phoneVerified && { opacity: 0.5 }]} onPress={handleNextFromStep3} disabled={!phoneVerified} activeOpacity={0.85}>
              <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 4 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Association Profile</Text>
            <View style={styles.form}>
              <Field label="Association/Cooperative Name *">
                <TextInput style={styles.input} placeholder="e.g. Angeles City JODA"
                  placeholderTextColor="#9ca3af" value={name} onChangeText={(v) => { setName(v); persist({ name: v }); }} />
              </Field>
              <Field label="Registered Address *">
                <TextInput style={[styles.input, styles.inputMultiline]}
                  placeholder="Street, Barangay, City / Municipality"
                  placeholderTextColor="#9ca3af" value={address} onChangeText={(v) => { setAddress(v); persist({ address: v }); }}
                  multiline numberOfLines={2} />
              </Field>
              <Field label="Association Email *">
                <TextInput style={styles.input} placeholder="contact@yourassociation.org"
                  placeholderTextColor="#9ca3af" keyboardType="email-address"
                  autoCapitalize="none" value={officialEmail} onChangeText={setOfficialEmail} />
                <Text style={styles.fieldHint}>Your association's own contact email — separate from the representative's login email.</Text>
              </Field>
              <Field label="Routes / Coverage Area">
                <TextInput style={[styles.input, styles.inputMultiline]} placeholder="Optional — e.g. Angeles City to Dau Terminal"
                  placeholderTextColor="#9ca3af" value={coverageArea} onChangeText={(v) => { setCoverageArea(v); persist({ coverage_area: v }); }}
                  multiline numberOfLines={2} />
              </Field>
              <Field label="Estimated Member Fleet Size">
                <TextInput style={styles.input} placeholder="Optional — e.g. 50"
                  placeholderTextColor="#9ca3af" keyboardType="number-pad"
                  value={estimatedFleetSize} onChangeText={(v) => { const digits = v.replace(/\D/g, ""); setEstimatedFleetSize(digits); persist({ estimated_fleet_size: digits }); }} />
              </Field>
            </View>

            <TouchableOpacity style={styles.btnSubmit} onPress={handleNextFromStep4} activeOpacity={0.85}>
              <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 5 && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Organizational Verification</Text>
              <Text style={styles.sectionHint}>Each document must be 15MB or smaller.</Text>

              <DocPickerField
                label="Registration Certificate (SEC/CDA) *"
                hint="SEC Certificate for a non-profit/association, or CDA Certificate for a cooperative"
                doc={regCertDoc}
                onPick={() => handlePick("association_doc", setRegCertDoc)}
                onRemove={() => setRegCertDoc(emptyDoc)}
              />
              <DocPickerField
                label="Board Resolution / Authorization Letter *"
                hint="Proves the representative is authorized to register on the organization's behalf"
                doc={boardResolution}
                onPick={() => handlePick("board_resolution", setBoardResolution)}
                onRemove={() => setBoardResolution(emptyDoc)}
              />
              <DocPickerField
                label="Representative's Valid Government ID *"
                hint="Proves who the representative is"
                doc={repIdDoc}
                onPick={() => handlePick("rep_government_id", setRepIdDoc)}
                onRemove={() => setRepIdDoc(emptyDoc)}
              />
            </View>

            <View style={styles.noteBox}>
              <Ionicons name="information-circle-outline" size={16} color="#1e40af" style={{ marginTop: 1 }} />
              <Text style={styles.noteText}>
                Your application will be reviewed by the TranSync admin. Once approved, you can log in and start managing operator applications, routes, fares, and schedules.
              </Text>
            </View>

            <TermsGate
              accepted={termsAccepted}
              onAcceptedChange={setTermsAccepted}
              termsTitle="Association Terms & Conditions"
              termsSections={ASSOCIATION_TERMS}
              privacySections={PRIVACY_POLICY}
            />

            <TouchableOpacity
              style={[styles.btnSubmit, (loading || !termsAccepted) && { opacity: 0.5 }]}
              onPress={handleSubmit}
              disabled={loading || !termsAccepted}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : (
                  <View style={styles.btnInner}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={styles.btnText}>Submit Application</Text>
                  </View>
                )}
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.loginLink} onPress={() => router.push("/(auth)/login")}>
          <Text style={styles.loginText}>
            Already registered? <Text style={styles.loginAccent}>Sign In</Text>
          </Text>
        </TouchableOpacity>

      </KeyboardAwareForm>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function DocPickerField({ label, hint, doc, onPick, onRemove }: {
  label: string; hint: string; doc: DocState; onPick: () => void; onRemove: () => void;
}) {
  return (
    <Field label={label}>
      <TouchableOpacity
        style={[styles.uploadBtn, doc.preview && styles.uploadBtnFilled]}
        onPress={onPick}
        activeOpacity={0.8}
      >
        {doc.preview ? (
          <Image source={{ uri: doc.preview }} style={styles.previewImage} resizeMode="cover" />
        ) : (
          <View style={styles.uploadPlaceholder}>
            <View style={styles.uploadIconWrap}>
              <Ionicons name="cloud-upload-outline" size={32} color="#1a4a52" />
            </View>
            <Text style={styles.uploadText}>Tap to attach document</Text>
            <Text style={styles.uploadHint}>{hint}</Text>
          </View>
        )}
      </TouchableOpacity>
      {doc.preview && (
        <TouchableOpacity onPress={onRemove} style={styles.removeDoc}>
          <Ionicons name="close-circle" size={14} color="#ef4444" />
          <Text style={styles.removeDocText}>Remove document</Text>
        </TouchableOpacity>
      )}
    </Field>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1, backgroundColor: "#f9fafb",
    paddingHorizontal: 24,
  },

  back:     { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 32 },
  backText: { fontSize: 14, color: "#1a4a52", fontWeight: "700" },

  header:    { marginBottom: 28 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
    backgroundColor: "#f0faf4", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4,
    marginBottom: 10, borderWidth: 1, borderColor: "#1a4a52",
  },
  badgeText: { fontSize: 12, fontWeight: "700", color: "#1a4a52" },
  title:     { fontSize: 26, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  subtitle:  { fontSize: 14, color: "#6b7280", lineHeight: 20 },
  stepRow:   { flexDirection: "row", gap: 6, marginTop: 10 },
  stepDot:   { width: 28, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb" },
  stepDotDone: { backgroundColor: "#1a4a52" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20,
  },
  errorText: { flex: 1, color: "#dc2626", fontSize: 13 },

  section:      { marginBottom: 28 },
  sectionLabel: {
    fontSize: 11, fontWeight: "800", color: "#9ca3af",
    letterSpacing: 1, textTransform: "uppercase", marginBottom: 8,
  },
  sectionHint:  { fontSize: 12, color: "#6b7280", lineHeight: 18, marginBottom: 14 },

  form:       { gap: 18 },
  fieldWrap:  { gap: 6, marginBottom: 18 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151" },
  fieldHint:  { fontSize: 11, color: "#9ca3af", marginTop: 2 },

  input: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13, fontSize: 14,
    color: "#111827", backgroundColor: "#fff",
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },

  passwordWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, backgroundColor: "#fff",
  },
  passwordWrapError: { borderColor: "#fca5a5" },
  passwordInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 13, fontSize: 14, color: "#111827" },
  eyeBtn:        { paddingHorizontal: 14 },
  matchError:    { fontSize: 12, color: "#dc2626", marginTop: 4 },

  // document upload
  uploadBtn: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 16,
    borderStyle: "dashed", overflow: "hidden", backgroundColor: "#fff",
  },
  uploadBtnFilled: { borderStyle: "solid", borderColor: "#1a4a52" },
  uploadPlaceholder: { alignItems: "center", paddingVertical: 36, gap: 10 },
  uploadIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "#f0faf4", alignItems: "center", justifyContent: "center",
  },
  uploadText:  { fontSize: 14, fontWeight: "700", color: "#374151" },
  uploadHint:  { fontSize: 11, color: "#9ca3af", textAlign: "center" },
  previewImage:{ width: "100%", height: 220 },
  removeDoc: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, paddingVertical: 10,
  },
  removeDocText: { fontSize: 12, color: "#ef4444", fontWeight: "600" },

  noteBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#eff6ff", borderRadius: 12, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: "#bfdbfe",
  },
  noteText: { flex: 1, fontSize: 12, color: "#1e40af", lineHeight: 18 },

  btnSubmit: {
    backgroundColor: "#1a4a52", borderRadius: 14,
    paddingVertical: 16, alignItems: "center", marginTop: 24, marginBottom: 20,
  },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnText:  { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },

  loginLink:   { alignItems: "center" },
  loginText:   { fontSize: 13, color: "#6b7280" },
  loginAccent: { color: "#1a4a52", fontWeight: "800" },
});
