import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];
type Role = "commuter" | "operator" | "association";

const OPTIONS: {
  key:  Role;
  icon: IoniconsName;
  title: string;
  desc:  string;
}[] = [
  { key: "commuter",    icon: "person",           title: "Commuter",    desc: "Book rides & manage fare"           },
  { key: "operator",    icon: "bus",               title: "Operator",    desc: "Manage fleet & drivers"             },
  { key: "association", icon: "business",          title: "Association", desc: "Approve operators & manage members" },
];

export default function Register() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Role | null>(null);

  const handleContinue = () => {
    if (selected === "commuter")    router.push("/(auth)/commuter-register");
    if (selected === "operator")    router.push("/(auth)/operator-register");
    if (selected === "association") router.push("/(auth)/association-register");
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#f9fafb" }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >

      {/* ── BACK ── */}
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={16} color="#1a4a52" />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Who are you registering as?</Text>
      </View>

      {/* ── OPTIONS ── */}
      <View style={styles.options}>
        {OPTIONS.map(({ key, icon, title, desc }) => {
          const active = selected === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.option, active && styles.optionActive]}
              onPress={() => setSelected(key)}
              activeOpacity={0.8}
            >
              <View style={[styles.optionIconWrap, active && styles.optionIconWrapActive]}>
                <Ionicons name={icon} size={26} color={active ? "#1a4a52" : "#9ca3af"} />
              </View>

              <View style={styles.optionText}>
                <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>
                  {title}
                </Text>
                <Text style={styles.optionDesc}>{desc}</Text>
              </View>

              <View style={[styles.radio, active && styles.radioActive]}>
                {active && <View style={styles.radioDot} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── CONTINUE BUTTON ── */}
      <TouchableOpacity
        style={[styles.btnContinue, !selected && styles.btnDisabled]}
        onPress={handleContinue}
        disabled={!selected}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>Continue</Text>
      </TouchableOpacity>

      {/* ── LOGIN LINK ── */}
      <TouchableOpacity onPress={() => router.push("/(auth)/login")}>
        <Text style={styles.loginText}>
          Already have an account?{" "}
          <Text style={styles.loginAccent}>Sign In</Text>
        </Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1, backgroundColor: "#f9fafb",
    paddingHorizontal: 24,
  },

  back:     { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 32 },
  backText: { fontSize: 14, color: "#1a4a52", fontWeight: "700" },

  header:   { marginBottom: 36 },
  title:    { fontSize: 30, fontWeight: "900", color: "#1a4a52", marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#6b7280" },

  options: { gap: 14, marginBottom: 40 },
  option: {
    flexDirection: "row", alignItems: "center", padding: 18,
    borderRadius: 18, borderWidth: 1.5, borderColor: "#e5e7eb",
    backgroundColor: "#fff", gap: 14,
  },
  optionActive:         { borderColor: "#1a4a52", backgroundColor: "#f0faf4" },
  optionIconWrap:       { width: 52, height: 52, borderRadius: 14, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  optionIconWrapActive: { backgroundColor: "#dff0e0" },
  optionText:           { flex: 1 },
  optionTitle:          { fontSize: 16, fontWeight: "700", color: "#374151", marginBottom: 2 },
  optionTitleActive:    { color: "#1a4a52" },
  optionDesc:           { fontSize: 12, color: "#9ca3af" },

  radio:       { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center" },
  radioActive: { borderColor: "#1a4a52" },
  radioDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: "#1a4a52" },

  btnContinue: {
    backgroundColor: "#1a4a52", borderRadius: 14,
    paddingVertical: 16, alignItems: "center", marginBottom: 20,
  },
  btnDisabled: { backgroundColor: "#d1d5db" },
  btnText:     { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },

  loginText:   { fontSize: 13, color: "#6b7280", textAlign: "center" },
  loginAccent: { color: "#1a4a52", fontWeight: "800" },
});
