import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Shared "Phone" field for every role's Edit Personal Info / Account
// Information screen (Commuter/Operator/Association/Driver Settings). The
// on-file number is masked by default (e.g. "09*******89") with an eye
// toggle to reveal it — the full number was previously shown in plain text
// on every one of these screens, which is more exposure than necessary for
// a value that's rarely actually looked at digit-by-digit.
//
// Changing the number: an OTP-verification step was tried here (same
// send-code/verify-code flow as registration) and explicitly reverted on
// request — the account password (already required to save the rest of
// this form) is the only gate on a phone change now, same as every other
// field.

export default function MaskedPhoneField({
  currentPhone, onPendingNewPhoneChange, label = "Phone",
}: {
  currentPhone: string;
  onPendingNewPhoneChange: (newPhone: string | null) => void;
  label?: string;
}) {
  const [changing, setChanging] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [newPhone, setNewPhone] = useState("");

  const mask = (p: string) => {
    const digits = p.replace(/\D/g, "");
    if (digits.length < 4) return digits;
    return digits.slice(0, 2) + "*".repeat(digits.length - 4) + digits.slice(-2);
  };

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

  const handleChangeNewPhone = (raw: string) => {
    const formatted = formatPhone(raw);
    setNewPhone(formatted);
    const digits = formatted.replace(/\D/g, "");
    onPendingNewPhoneChange(/^09\d{9}$/.test(digits) ? digits : null);
  };

  const handleCancelChange = () => {
    setChanging(false);
    setNewPhone("");
    onPendingNewPhoneChange(null);
  };

  if (changing) {
    return (
      <View style={s.wrap}>
        <Text style={s.fieldLabel}>New {label}</Text>
        <TextInput
          style={s.input}
          value={newPhone}
          onChangeText={handleChangeNewPhone}
          keyboardType="phone-pad"
          placeholder="09XX-XXX-XXXX"
          placeholderTextColor="#9ca3af"
          maxLength={13}
        />
        <TouchableOpacity onPress={handleCancelChange} style={s.cancelLink}>
          <Text style={s.cancelLinkText}>Cancel — keep my current number</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <Text style={s.fieldLabel}>{label}</Text>
      {/* The masked number itself now opens edit mode too — it previously
          looked like a tappable field but was actually static Text, with
          only the small "Change Number" link below it (easy to miss)
          actually doing anything; tapping the number itself did nothing,
          which read as "I can't input anything." */}
      <TouchableOpacity style={s.row} onPress={() => setChanging(true)} activeOpacity={0.7}>
        <Text style={s.value}>{currentPhone ? (revealed ? currentPhone : mask(currentPhone)) : "—"}</Text>
        {!!currentPhone && (
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); setRevealed(r => !r); }}
            style={s.eyeBtn}
            accessibilityLabel={revealed ? "Hide phone number" : "Show phone number"}
          >
            <Ionicons name={revealed ? "eye-off" : "eye"} size={18} color="#6b7280" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setChanging(true)} style={s.changeLink}>
        <Text style={s.changeLinkText}>Change Number</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6, marginBottom: 4 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151" },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13, backgroundColor: "#f9fafb",
  },
  value: { fontSize: 14, color: "#111827", letterSpacing: 0.5 },
  eyeBtn: { paddingLeft: 10 },
  input: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13, fontSize: 14,
    color: "#111827", backgroundColor: "#fff",
  },
  changeLink: { alignSelf: "flex-start", marginTop: 2 },
  changeLinkText: { fontSize: 12, fontWeight: "600", color: "#1a4a52" },
  cancelLink: { alignSelf: "flex-start", marginTop: 2 },
  cancelLinkText: { fontSize: 12, fontWeight: "600", color: "#6b7280" },
});
