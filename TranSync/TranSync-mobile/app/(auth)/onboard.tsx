import { useRouter } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

export default function Onboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#1a4a52" }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom }]}
      bounces={false}
      showsVerticalScrollIndicator={false}
    >

      {/* ── LOGO ILLUSTRATION ── */}
      <View style={[styles.illustrationWrap, { paddingTop: insets.top + 48 }]}>
        <Image
          source={require("../../assets/TranSync_Logo.png")}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <View style={styles.textTranSync}>
          <Text style={styles.logo}>
            Tran<Text style={styles.accent}>S</Text>ync
          </Text>
          <Text style={styles.tagline}>Integrated Public Transportation</Text>
          <Text style={styles.tagline}>System for Pampanga</Text>
        </View>
      </View>

      {/* ── BOTTOM CARD ── */}
      <View style={styles.card}>
        <Text style={styles.heading}>
          Your Commute,{"\n"}
          <Text style={styles.headingAccent}>Smarter.</Text>
        </Text>
        <Text style={styles.description}>
          Book rides, track vehicles, and manage your fare all in one app built for Pampanga commuters.
        </Text>

        {/* Features */}
        <View style={styles.features}>
          <FeaturePill icon="map"    label="Live Tracking"  />
          <FeaturePill icon="card"   label="Digital Wallet" />
          <FeaturePill icon="ticket" label="Easy Booking"   />
        </View>

        {/* Buttons */}
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => router.push("/(auth)/register")}
          activeOpacity={0.85}
        >
          <Text style={styles.btnPrimaryText}>Get Started</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={() => router.push("/(auth)/login")}
          activeOpacity={0.85}
        >
          <Text style={styles.btnSecondaryText}>
            Already have an account?{" "}
            <Text style={styles.btnSecondaryAccent}>Sign In</Text>
          </Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

function FeaturePill({ icon, label }: { icon: IoniconsName; label: string }) {
  return (
    <View style={styles.pill}>
      <Ionicons name={icon} size={13} color="#1a4a52" />
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1, backgroundColor: "#1a4a52",
    alignItems: "center", justifyContent: "space-between",
  },

  textTranSync: { alignItems: "center" },
  logo:    { fontSize: 48, fontWeight: "900", color: "#fff", letterSpacing: 1 },
  accent:  { color: "#a8d832" },
  tagline: { color: "rgba(168,216,50,0.7)", fontSize: 12, marginTop: 2, letterSpacing: 0.5, textAlign: "center" },

  illustrationWrap: { alignItems: "center" },
  logoImage:        { width: 160, height: 160 },

  card: {
    width: "100%", backgroundColor: "#fff",
    borderTopLeftRadius: 36, borderTopRightRadius: 36,
    paddingHorizontal: 28, paddingTop: 36, paddingBottom: 48,
  },
  heading:       { fontSize: 30, fontWeight: "800", color: "#1a4a52", lineHeight: 38, marginBottom: 12 },
  headingAccent: { color: "#a8d832" },
  description:   { fontSize: 14, color: "#6b7280", lineHeight: 22, marginBottom: 24 },

  features: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#f0f9e8",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginHorizontal: 3,
  },
  pillLabel: { fontSize: 11, fontWeight: "700", color: "#1a4a52" },

  btnPrimary: {
    backgroundColor: "#a8d832", borderRadius: 16,
    paddingVertical: 16, alignItems: "center", marginBottom: 14,
    shadowColor: "#a8d832", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 4,
  },
  btnPrimaryText:     { fontSize: 16, fontWeight: "800", color: "#1a2a10", letterSpacing: 0.5 },
  btnSecondary:       { alignItems: "center", paddingVertical: 8 },
  btnSecondaryText:   { fontSize: 14, color: "#6b7280" },
  btnSecondaryAccent: { color: "#1a4a52", fontWeight: "800" },
});