import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../config/api";

// Shared phone-OTP verification field for the registration screens
// (Commuter/Operator/Association — Driver is excluded, accounts are
// operator-created, never self-service). Registration must be verified
// BEFORE the account is created, so this field owns the whole Send Code /
// Enter Code / Verify loop itself and only reports a `verified` boolean
// back to the parent form's own phone state (same value/onChange controlled
// pattern as DateField.tsx in this folder) — the parent's own submit gate
// just checks `verified` alongside its other required-field checks, the
// same way it already gates on Terms accepted.
//
// The backend (auth/send_phone_otp.php / verify_phone_otp.php) is the only
// place that ever talks to IPROG SMS — this component never sees or stores
// the actual OTP code, only what the commuter types in to submit for
// verification.

export default function PhoneOtpField({
  phone, onPhoneChange, verified, onVerifiedChange,
  label = "Mobile/Phone Number", required = true,
}: {
  phone: string; onPhoneChange: (v: string) => void;
  verified: boolean; onVerifiedChange: (v: boolean) => void;
  label?: string; required?: boolean;
}) {
  const digits = phone.replace(/\D/g, "");
  const isValidPhone = /^09\d{9}$/.test(digits);

  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  // Tracks consecutive send/verify failures purely for the escape-hatch
  // message below — this is the real gap behind "OTP failures leaving users
  // stuck": a wrong-code lockout is already self-recoverable via Resend
  // (each resend starts a fresh attempt counter server-side), but repeated
  // network/provider failures previously showed the same generic message
  // forever with no indication of what to do next.
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleSend = async () => {
    if (!isValidPhone || sending || cooldown > 0) return;
    setError("");
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/auth/send_phone_otp.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to send verification code.");
        setConsecutiveFailures((c) => c + 1);
      } else {
        setSent(true);
        setOtp("");
        setCooldown(60);
        setConsecutiveFailures(0);
      }
    } catch {
      setError("Couldn't reach the network. Check your internet connection and try again.");
      setConsecutiveFailures((c) => c + 1);
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    if (otp.length !== 6 || verifying) return;
    setError("");
    setVerifying(true);
    try {
      const res = await fetch(`${API_BASE}/auth/verify_phone_otp.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, otp }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        // A 429 lockout (3 wrong attempts) is already self-recoverable via
        // Resend below — say so explicitly instead of leaving it looking
        // like a dead end.
        setError(
          res.status === 429
            ? "Too many incorrect attempts. Tap Resend to get a new code."
            : (data.message || "Incorrect or expired code. Please try again or tap Resend.")
        );
        setConsecutiveFailures((c) => c + 1);
      } else {
        onVerifiedChange(true);
        setSent(false);
        setOtp("");
        setConsecutiveFailures(0);
      }
    } catch {
      setError("Couldn't reach the network. Check your internet connection and try again.");
      setConsecutiveFailures((c) => c + 1);
    } finally {
      setVerifying(false);
    }
  };

  const handleChangeNumber = () => {
    onVerifiedChange(false);
    setSent(false);
    setOtp("");
    setError("");
    setCooldown(0);
  };

  return (
    <View style={s.fieldWrap}>
      <Text style={s.fieldLabel}>{label}{required ? " *" : ""}</Text>

      <View style={s.row}>
        <TextInput
          style={[s.input, verified && s.inputLocked]}
          placeholder="09XX-XXX-XXXX"
          placeholderTextColor="#9ca3af"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={onPhoneChange}
          maxLength={13}
          editable={!verified}
        />
        {verified ? (
          <View style={s.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
            <Text style={s.verifiedText}>Verified</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[s.actionBtn, (!isValidPhone || sending || cooldown > 0) && s.actionBtnDisabled]}
            onPress={handleSend}
            disabled={!isValidPhone || sending || cooldown > 0}
            activeOpacity={0.8}
          >
            {sending
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.actionBtnText}>{cooldown > 0 ? `Resend (${cooldown}s)` : sent ? "Resend" : "Send Code"}</Text>}
          </TouchableOpacity>
        )}
      </View>

      {verified && (
        <TouchableOpacity onPress={handleChangeNumber}>
          <Text style={s.changeLink}>Use a different number</Text>
        </TouchableOpacity>
      )}

      {!verified && sent && (
        <>
          <View style={s.otpRow}>
            <TextInput
              style={s.otpInput}
              placeholder="6-digit code"
              placeholderTextColor="#9ca3af"
              keyboardType="number-pad"
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              // Auto-fill hints only — no native module needed. iOS shows a
              // QuickType suggestion above the keyboard reading the code from
              // Messages; Android's own Autofill Framework offers something
              // similar. Neither is fully silent (that needs the Android SMS
              // Retriever API — a native module + a signed-build-specific
              // app-hash appended to the SMS body, deliberately out of scope
              // for this pass), but both save the user from leaving the app.
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
            />
            <TouchableOpacity
              style={[s.actionBtn, (otp.length !== 6 || verifying) && s.actionBtnDisabled]}
              onPress={handleVerify}
              disabled={otp.length !== 6 || verifying}
              activeOpacity={0.8}
            >
              {verifying
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.actionBtnText}>Verify</Text>}
            </TouchableOpacity>
          </View>
          <Text style={s.helperText}>We sent a 6-digit code to {phone}. It expires in 5 minutes.</Text>
        </>
      )}

      {error ? <Text style={s.errorText}>{error}</Text> : null}
      {consecutiveFailures >= 3 ? (
        <Text style={s.helperText}>
          Still having trouble? Double-check your number is correct, then try again in a minute —
          the SMS provider may be briefly delayed.
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151" },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1, borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13, fontSize: 14,
    color: "#111827", backgroundColor: "#fff",
  },
  inputLocked: { backgroundColor: "#f0faf4", borderColor: "#bbf7d0", color: "#166534" },
  actionBtn: {
    backgroundColor: "#1a4a52", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, minWidth: 96, alignItems: "center", justifyContent: "center",
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 12.5 },
  verifiedBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 13,
  },
  verifiedText: { color: "#16a34a", fontWeight: "700", fontSize: 13 },
  changeLink: { color: "#1a4a52", fontWeight: "700", fontSize: 12, alignSelf: "flex-start" },
  otpRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  otpInput: {
    flex: 1, borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, letterSpacing: 4,
    color: "#111827", backgroundColor: "#fff",
  },
  helperText: { fontSize: 11.5, color: "#6b7280" },
  errorText: { fontSize: 12, color: "#dc2626" },
});
