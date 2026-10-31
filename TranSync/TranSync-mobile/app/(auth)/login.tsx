import { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Image, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import API_BASE from "../../src/config/api";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  // Shown only after a failed login attempt — this app has no session
  // enforcement (see Auth security in CLAUDE.md), so "invalid credentials"
  // is the only reliable signal we have that the account holder might have
  // actually forgotten their password (as opposed to just landing on this
  // screen fresh).
  const [loginFailed, setLoginFailed] = useState(false);

  const handleLogin = async () => {
    setError("");
    if (!email || !password) { setError("Please fill in all fields."); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/auth/login_mobile.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        // No role sent — backend detects the account type automatically
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Invalid email or password.");
        setLoginFailed(true);
      } else {
        await AsyncStorage.setItem("user", JSON.stringify(data.user));
        await AsyncStorage.setItem("role", data.role);
        if (data.session_token) {
          await AsyncStorage.setItem("session_token", data.session_token);
        }

        if (data.role === "commuter") {
          router.replace("/(main)/home");
        } else if (data.role === "driver") {
          router.replace("/(driver)/dashboard");
        } else if (data.role === "operator") {
          router.replace("/(operator)/dashboard");
        } else if (data.role === "association") {
          router.replace("/(association)/dashboard");
        }
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

          {/* ── TOP ── */}
          <View style={styles.top}>
            <Image
              source={require("../../assets/TranSync_Logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.appName}>
              Tran<Text style={styles.accent}>S</Text>ync
            </Text>
            <Text style={styles.tagline}>Welcome back!</Text>
          </View>

          {/* ── CARD ── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign In</Text>
            <Text style={styles.cardSub}>Enter your credentials to continue</Text>

            {/* ── ERROR ── */}
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="warning" size={14} color="#dc2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* ── EMAIL ── */}
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>Email Address</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#9ca3af"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                returnKeyType="next"
              />
            </View>

            {/* ── PASSWORD ── */}
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="••••••••"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry={!showPass}
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity onPress={() => setShowPass(!showPass)} style={styles.eyeBtn} accessibilityLabel={showPass ? "Hide password" : "Show password"}>
                  <Ionicons name={showPass ? "eye-off" : "eye"} size={18} color="#9ca3af" />
                </TouchableOpacity>
              </View>
              {loginFailed && (
                <TouchableOpacity
                  style={styles.forgotLink}
                  onPress={() => router.push("/(auth)/forgot-password")}
                >
                  <Text style={styles.forgotLinkText}>Forgot Password?</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── SUBMIT ── */}
            <TouchableOpacity
              style={[styles.btnPrimary, loading && { opacity: 0.7 }]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#1a2a10" />
                : <Text style={styles.btnPrimaryText}>Sign In</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.registerLink} onPress={() => router.push("/(auth)/register")}>
              <Text style={styles.registerText}>
                Don't have an account?{" "}
                <Text style={styles.registerAccent}>Register</Text>
              </Text>
            </TouchableOpacity>
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

  top:     { alignItems: "center", marginBottom: 32 },
  logo:    { width: 90, height: 90, marginBottom: 8 },
  appName: { fontSize: 36, fontWeight: "900", color: "#fff", letterSpacing: 1 },
  accent:  { color: "#a8d832" },
  tagline: { color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 4 },

  card: {
    width: "100%", backgroundColor: "#fff", borderRadius: 28, padding: 28,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 16, elevation: 8,
  },
  cardTitle: { fontSize: 24, fontWeight: "800", color: "#1a4a52", marginBottom: 4 },
  cardSub:   { fontSize: 13, color: "#6b7280", marginBottom: 20 },

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
  passwordWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, backgroundColor: "#f9fafb",
  },
  passwordInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: "#111827" },
  eyeBtn:        { paddingHorizontal: 14 },
  forgotLink:     { alignSelf: "flex-end", marginTop: 8 },
  forgotLinkText: { fontSize: 12.5, fontWeight: "700", color: "#1a4a52" },

  btnPrimary: {
    backgroundColor: "#a8d832", borderRadius: 14, paddingVertical: 15,
    alignItems: "center", marginTop: 8, marginBottom: 16,
    shadowColor: "#a8d832", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 4,
  },
  btnPrimaryText: { fontSize: 16, fontWeight: "800", color: "#1a2a10", letterSpacing: 0.5 },

  registerLink:   { alignItems: "center" },
  registerText:   { fontSize: 13, color: "#6b7280" },
  registerAccent: { color: "#1a4a52", fontWeight: "800" },
});