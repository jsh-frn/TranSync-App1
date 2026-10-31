import { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import API_BASE from "../../src/config/api";
import {
  getCommuterDraft, setCommuterDraft, clearCommuterDraft, BLANK_COMMUTER_DRAFT,
} from "../../src/state/registrationDraft";
import PhoneOtpField from "../../src/components/registration/PhoneOtpField";
import TermsGate from "../../src/components/registration/TermsGate";
import { COMMUTER_TERMS, PRIVACY_POLICY } from "../../src/constants/registrationTerms";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

// 3 small, single-purpose steps (Name → Password → Contact Info + OTP),
// replacing an earlier 2-step version whose Step 1 bundled all three
// together. Always ends in a plain Default account — Student/PWD/Senior
// discount type is no longer picked here at all; a commuter applies for one
// later from Settings' "Discount Eligibility" section once logged in (Core
// Flow 2b), which reuses the exact same OCR/liveness verification wizards
// this screen used to hand off into directly.
const TOTAL_STEPS = 3;

export default function CommuterRegister() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const existing = getCommuterDraft();
  const [step, setStep] = useState(1);

  // ── Step 1 — name ────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState(existing?.first_name ?? "");
  const [lastName,  setLastName]  = useState(existing?.last_name  ?? "");

  // ── Step 2 — password ───────────────────────────────────────────────────
  const [password,        setPassword]        = useState(existing?.password ?? "");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass,        setShowPass]        = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  // ── Step 3 — contact info + OTP + terms ─────────────────────────────────
  const [email,     setEmail]     = useState(existing?.email      ?? "");
  const [phone,     setPhone]     = useState(existing?.phone      ?? "");
  const [phoneVerified, setPhoneVerified] = useState(existing?.phone_verified ?? false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  // Persists every field to the shared draft on change — this is what makes
  // "Back" (out of this screen entirely, or between steps) non-destructive.
  const persist = (patch: Partial<typeof BLANK_COMMUTER_DRAFT>) => setCommuterDraft(patch);

  const handlePhoneChange = (raw: string) => {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("639")) digits = "0" + digits.slice(2);
    if (digits.startsWith("9"))   digits = "0" + digits;
    digits = digits.slice(0, 11);
    let formatted = digits;
    if (digits.length > 7)      formatted = digits.slice(0, 4) + "-" + digits.slice(4, 7) + "-" + digits.slice(7);
    else if (digits.length > 4) formatted = digits.slice(0, 4) + "-" + digits.slice(4);
    setPhone(formatted);
    persist({ phone: formatted });
  };

  const handleNextFromStep1 = () => {
    setError("");
    if (!firstName || !lastName) {
      setError("Please enter your first and last name."); return;
    }
    persist({ first_name: firstName, last_name: lastName });
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

  const normalizedPhone = phone.replace(/\D/g, "");

  const createRegularAccount = async () => {
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("first_name", firstName);
      formData.append("last_name",  lastName);
      formData.append("email",    email);
      formData.append("phone",    normalizedPhone);
      formData.append("password", password);
      formData.append("category", "default");
      formData.append("terms_accepted", "1");

      const res  = await fetch(`${API_BASE}/auth/commuter_register.php`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Registration failed.");
      } else {
        clearCommuterDraft();
        // Always a plain Default account now — nothing pending admin review
        // at registration time, ever.
        router.replace("/(auth)/register-success?noVerification=1" as any);
      }
    } catch {
      setError("Cannot connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = () => {
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
    if (!termsAccepted) {
      setError("You must agree to the Terms & Conditions and Privacy Policy to continue."); return;
    }
    persist({ email, phone: normalizedPhone, phone_verified: phoneVerified });
    createRegularAccount();
  };

  const stepLabel = step === 1 ? "Name" : step === 2 ? "Password" : "Contact Info";

  return (
    <KeyboardAwareForm contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 48 }]}>

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
          <Text style={styles.title}>Commuter Registration</Text>
          <Text style={styles.subtitle}>Step {step} of {TOTAL_STEPS} — {stepLabel}</Text>
          <View style={styles.stepRow}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
              <View key={n} style={[styles.stepDot, step >= n && styles.stepDotDone]} />
            ))}
          </View>
        </View>

        {/* ERROR */}
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
                  value={firstName} onChangeText={(v) => { setFirstName(v); persist({ first_name: v }); }} />
              </Field>
              <Field label="Last Name" required>
                <TextInput style={styles.input} placeholder="Dela Cruz" placeholderTextColor="#9ca3af"
                  value={lastName} onChangeText={(v) => { setLastName(v); persist({ last_name: v }); }} />
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
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Min. 6 characters"
                    placeholderTextColor="#9ca3af"
                    secureTextEntry={!showPass}
                    value={password}
                    onChangeText={(v) => { setPassword(v); persist({ password: v }); }}
                  />
                  <TouchableOpacity onPress={() => setShowPass(!showPass)} style={styles.eyeBtn} accessibilityLabel={showPass ? "Hide password" : "Show password"}>
                    <Ionicons name={showPass ? "eye-off" : "eye"} size={18} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
              </Field>
              <Field label="Confirm Password" required>
                <View style={styles.passwordWrap}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Re-enter your password"
                    placeholderTextColor="#9ca3af"
                    secureTextEntry={!showConfirmPass}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                  />
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

            <TermsGate
              accepted={termsAccepted}
              onAcceptedChange={setTermsAccepted}
              termsTitle="Terms & Conditions"
              termsSections={COMMUTER_TERMS}
              privacySections={PRIVACY_POLICY}
            />

            <TouchableOpacity
              style={[styles.btnSubmit, (loading || !termsAccepted || !phoneVerified) && { opacity: 0.5 }]}
              onPress={handleRegister}
              disabled={loading || !termsAccepted || !phoneVerified}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnText}>Register</Text>}
            </TouchableOpacity>
          </>
        )}

    </KeyboardAwareForm>
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

const styles = StyleSheet.create({
  container: {
    flexGrow: 1, backgroundColor: "#f9fafb",
    paddingHorizontal: 24,
  },
  back:     { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 32 },
  backText: { fontSize: 14, color: "#1a4a52", fontWeight: "700" },
  header:   { marginBottom: 28 },
  title:    { fontSize: 26, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#6b7280" },
  stepRow:  { flexDirection: "row", gap: 6, marginTop: 10 },
  stepDot:  { width: 28, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb" },
  stepDotDone: { backgroundColor: "#1a4a52" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20,
  },
  errorText: { flex: 1, color: "#dc2626", fontSize: 13 },

  sectionTitle: { fontSize: 12, fontWeight: "800", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12, marginTop: 4 },

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

  btnSubmit: {
    backgroundColor: "#1a4a52", borderRadius: 14,
    paddingVertical: 16, alignItems: "center", marginTop: 24,
  },
  btnText: { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
});
