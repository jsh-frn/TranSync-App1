import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import API_BASE, { FILE_BASE } from "../../src/config/api";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

// Login page's "Forgot Password" flow — Commuter/Operator/Association only
// (Driver is excluded: driver accounts are operator-created/managed, never
// self-service, see Do Not Break rule #15 — a driver who forgets their
// password goes through their operator, drivers/drivers.php's
// update_details). Four steps, each gated on the previous one actually
// succeeding server-side (never just a client-side "next"):
//   phone -> confirm ("Is this you?") -> otp -> reset (new password)
// The account is never identified to the caller until lookup_account_by_phone.php
// says so, and the OTP itself is verified via the exact same
// send_phone_otp.php/verify_phone_otp.php infrastructure the registration
// flow uses, just with purpose="password_reset".

type Step = "phone" | "confirm" | "otp" | "reset" | "done";

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  commuter:    "Commuter Account",
  operator:    "Operator Account",
  association: "Association Account",
};

export default function ForgotPassword() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");

  const [accountType, setAccountType] = useState("");
  const [maskedName,  setMaskedName]  = useState("");
  const [avatarUrl,   setAvatarUrl]   = useState<string | null>(null);

  const [otp, setOtp] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const [newPassword,     setNewPassword]     = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass,        setShowPass]        = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handlePhoneChange = (raw: string) => {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("639")) digits = "0" + digits.slice(2);
    if (digits.startsWith("9"))   digits = "0" + digits;
    digits = digits.slice(0, 11);
    let formatted = digits;
    if (digits.length > 7)      formatted = digits.slice(0, 4) + "-" + digits.slice(4, 7) + "-" + digits.slice(7);
    else if (digits.length > 4) formatted = digits.slice(0, 4) + "-" + digits.slice(4);
    setPhone(formatted);
  };
  const digits = phone.replace(/\D/g, "");

  const initialsOf = (masked: string) => {
    const letters = masked.split(/\s+/).map((w) => w[0]).filter(Boolean);
    return (letters.slice(0, 2).join("") || "?").toUpperCase();
  };

  const handleLookup = async () => {
    setError("");
    if (digits.length !== 11) {
      setError("Enter a valid 11-digit Philippine mobile number (e.g. 09XX-XXX-XXXX)."); return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/auth/lookup_account_by_phone.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const data = await res.json();
      if (!res.ok || !data.found) {
        setError(data.message || "This phone number is not registered.");
      } else {
        setAccountType(data.account_type);
        setMaskedName(data.masked_name);
        setAvatarUrl(data.avatar_url ?? null);
        setStep("confirm");
      }
    } catch {
      setError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    setError("");
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/auth/send_phone_otp.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, purpose: "password_reset" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to send verification code.");
      } else {
        setOtp("");
        setCooldown(60);
        setStep("otp");
      }
    } catch {
      setError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setLoading(false);
    }
  };

  const handleNotMe = () => {
    setAccountType("");
    setMaskedName("");
    setAvatarUrl(null);
    setError("");
    setStep("phone");
  };

  const handleVerifyOtp = async () => {
    setError("");
    if (otp.length !== 6) { setError("Enter the 6-digit code sent to your phone."); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/auth/verify_phone_otp.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, otp }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || "Incorrect or expired code.");
      } else {
        setStep("reset");
      }
    } catch {
      setError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setError("");
    if (newPassword.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/auth/reset_password_by_phone.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || "Failed to reset password.");
      } else {
        setStep("done");
      }
    } catch {
      setError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareForm
        style={styles.kav}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <TouchableOpacity
          style={styles.back}
          onPress={() => (step === "phone" ? router.back() : setStep("phone"))}
        >
          <Ionicons name="chevron-back" size={16} color="#fff" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="warning" size={14} color="#dc2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {step === "phone" && (
            <>
              <Text style={styles.cardTitle}>Forgot Password?</Text>
              <Text style={styles.cardSub}>Enter your registered mobile number and we'll help you reset it.</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>Mobile/Phone Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder="09XX-XXX-XXXX"
                  placeholderTextColor="#9ca3af"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={handlePhoneChange}
                  maxLength={13}
                />
              </View>
              <TouchableOpacity
                style={[styles.btnPrimary, (loading || digits.length !== 11) && { opacity: 0.5 }]}
                onPress={handleLookup}
                disabled={loading || digits.length !== 11}
                activeOpacity={0.85}
              >
                {loading ? <ActivityIndicator color="#1a2a10" /> : <Text style={styles.btnPrimaryText}>Continue</Text>}
              </TouchableOpacity>
            </>
          )}

          {step === "confirm" && (
            <>
              <Text style={styles.cardTitle}>Is this you?</Text>
              <View style={styles.confirmWrap}>
                <View style={styles.avatar}>
                  {avatarUrl ? (
                    <Image source={{ uri: FILE_BASE + avatarUrl }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarInitials}>{initialsOf(maskedName)}</Text>
                  )}
                </View>
                <Text style={styles.confirmName}>{maskedName}</Text>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeBadgeText}>{ACCOUNT_TYPE_LABEL[accountType] ?? "Account"}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.btnPrimary, loading && { opacity: 0.7 }]}
                onPress={handleSendOtp}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? <ActivityIndicator color="#1a2a10" /> : <Text style={styles.btnPrimaryText}>Yes, this is me</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSecondary} onPress={handleNotMe} disabled={loading}>
                <Text style={styles.btnSecondaryText}>Not me — use a different number</Text>
              </TouchableOpacity>
            </>
          )}

          {step === "otp" && (
            <>
              <Text style={styles.cardTitle}>Enter Verification Code</Text>
              <Text style={styles.cardSub}>We sent a 6-digit code to {phone}. It expires in 5 minutes.</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>Verification Code</Text>
                <TextInput
                  style={styles.otpInput}
                  placeholder="6-digit code"
                  placeholderTextColor="#9ca3af"
                  keyboardType="number-pad"
                  value={otp}
                  onChangeText={(v) => setOtp(v.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                />
              </View>
              <TouchableOpacity
                style={[styles.btnPrimary, (loading || otp.length !== 6) && { opacity: 0.5 }]}
                onPress={handleVerifyOtp}
                disabled={loading || otp.length !== 6}
                activeOpacity={0.85}
              >
                {loading ? <ActivityIndicator color="#1a2a10" /> : <Text style={styles.btnPrimaryText}>Verify</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnSecondary}
                onPress={handleSendOtp}
                disabled={loading || cooldown > 0}
              >
                <Text style={[styles.btnSecondaryText, cooldown > 0 && { opacity: 0.5 }]}>
                  {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {step === "reset" && (
            <>
              <Text style={styles.cardTitle}>Set a New Password</Text>
              <Text style={styles.cardSub}>Your phone number has been verified.</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>New Password</Text>
                <View style={styles.passwordWrap}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Min. 6 characters"
                    placeholderTextColor="#9ca3af"
                    secureTextEntry={!showPass}
                    value={newPassword}
                    onChangeText={setNewPassword}
                  />
                  <TouchableOpacity onPress={() => setShowPass(!showPass)} style={styles.eyeBtn} accessibilityLabel={showPass ? "Hide password" : "Show password"}>
                    <Ionicons name={showPass ? "eye-off" : "eye"} size={18} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>Confirm New Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Re-enter your new password"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry={!showPass}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
              </View>
              <TouchableOpacity
                style={[styles.btnPrimary, loading && { opacity: 0.7 }]}
                onPress={handleResetPassword}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? <ActivityIndicator color="#1a2a10" /> : <Text style={styles.btnPrimaryText}>Reset Password</Text>}
              </TouchableOpacity>
            </>
          )}

          {step === "done" && (
            <>
              <View style={styles.doneIconWrap}>
                <Ionicons name="checkmark-circle" size={56} color="#16a34a" />
              </View>
              <Text style={styles.cardTitle}>Password Reset</Text>
              <Text style={styles.cardSub}>You can now log in with your new password.</Text>
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={() => router.replace("/(auth)/login")}
                activeOpacity={0.85}
              >
                <Text style={styles.btnPrimaryText}>Back to Login</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAwareForm>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1a4a52" },
  kav:  { flex: 1 },

  container: {
    flexGrow: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 20,
  },

  back:     { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginBottom: 20, marginLeft: 4 },
  backText: { fontSize: 14, color: "#fff", fontWeight: "700" },

  card: {
    width: "100%", backgroundColor: "#fff", borderRadius: 28, padding: 28,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 16, elevation: 8,
  },
  cardTitle: { fontSize: 22, fontWeight: "800", color: "#1a4a52", marginBottom: 4 },
  cardSub:   { fontSize: 13, color: "#6b7280", marginBottom: 20, lineHeight: 18 },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16,
  },
  errorText: { flex: 1, color: "#dc2626", fontSize: 13 },

  inputWrap:  { marginBottom: 16 },
  inputLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 14,
    color: "#111827", backgroundColor: "#f9fafb",
  },
  otpInput: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 18, letterSpacing: 6,
    color: "#111827", backgroundColor: "#f9fafb",
  },
  passwordWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, backgroundColor: "#f9fafb",
  },
  passwordInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: "#111827" },
  eyeBtn:        { paddingHorizontal: 14 },

  btnPrimary: {
    backgroundColor: "#a8d832", borderRadius: 14, paddingVertical: 15,
    alignItems: "center", marginTop: 8,
    shadowColor: "#a8d832", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 4,
  },
  btnPrimaryText: { fontSize: 16, fontWeight: "800", color: "#1a2a10", letterSpacing: 0.5 },

  btnSecondary:     { alignItems: "center", marginTop: 14 },
  btnSecondaryText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },

  confirmWrap: { alignItems: "center", marginBottom: 8 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "#1a4a52", alignItems: "center", justifyContent: "center",
    marginBottom: 12, overflow: "hidden",
    shadowColor: "#1a4a52", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  avatarImage:    { width: 72, height: 72, borderRadius: 36 },
  avatarInitials: { fontSize: 24, fontWeight: "900", color: "#fff" },
  confirmName: { fontSize: 18, fontWeight: "800", color: "#1a4a52", marginBottom: 8 },
  typeBadge: {
    backgroundColor: "#f0faf4", borderWidth: 1, borderColor: "#1a4a52",
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4, marginBottom: 4,
  },
  typeBadgeText: { fontSize: 12, fontWeight: "700", color: "#1a4a52" },

  doneIconWrap: { alignItems: "center", marginBottom: 12 },
});
