import { useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Easing,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function RegisterSuccess() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Set by the Student verification wizard on a full pass — that flow
  // auto-verifies (see Core Flow 2/commuter_register_student.php), so this
  // screen shouldn't claim the account is still pending admin review.
  // `note` carries the specific reason text when the Student pipeline's
  // automatic checks couldn't confirm everything and this landed in the
  // admin's manual-review queue instead — every other category's pending
  // registration has no equivalent specific note, so this only ever shows
  // up for that one case.
  // `role` distinguishes Commuter (default — the only role that can ever
  // land here with verified=1, and the only one with a Discounts concept)
  // from Operator/Association, whose accounts are never auto-verified and
  // have no discount status at all — showing them the commuter-worded
  // "Discounts: Granted after admin approval" row was a pre-existing gap,
  // not a deliberate design choice.
  // `noVerification=1` — set only by the Regular/"Skip for Now" paths on the
  // redesigned 2-step Commuter registration screen. Neither of those ever
  // submits a discount claim at all, so there is nothing pending admin
  // review — a real, previously-existing bug: this screen used to treat
  // "not auto-verified" (verified !== "1") as "Pending Verification"
  // unconditionally, which was wrong for a plain Regular signup (its account
  // is instantly fully active, nothing is ever reviewed for it).
  const { verified, note, role, noVerification } = useLocalSearchParams<{
    verified?: string; note?: string; role?: string; noVerification?: string;
  }>();
  const isVerified = verified === "1";
  const noVerificationNeeded = noVerification === "1";
  const accountRole = role === "operator" ? "operator" : role === "association" ? "association" : "commuter";

  // Animation values
  const iconScale    = useRef(new Animated.Value(0)).current;
  const iconRotate   = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY       = useRef(new Animated.Value(20)).current;
  const cardOpacity  = useRef(new Animated.Value(0)).current;
  const cardY        = useRef(new Animated.Value(30)).current;
  const btnOpacity   = useRef(new Animated.Value(0)).current;
  const btnY         = useRef(new Animated.Value(20)).current;
  const ringScale    = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Icon pop in
    Animated.sequence([
      Animated.delay(100),
      Animated.spring(iconScale, {
        toValue: 1, tension: 60, friction: 6, useNativeDriver: true,
      }),
    ]).start();

    // Icon subtle wobble after pop
    Animated.sequence([
      Animated.delay(500),
      Animated.timing(iconRotate, {
        toValue: 1, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(iconRotate, {
        toValue: 0, duration: 300, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
      }),
    ]).start();

    // Pulsing ring
    Animated.loop(
      Animated.sequence([
        Animated.timing(ringScale, {
          toValue: 1.12, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
        Animated.timing(ringScale, {
          toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
      ])
    ).start();

    // Title fade + slide in
    Animated.sequence([
      Animated.delay(350),
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(titleY,       { toValue: 0, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]).start();

    // Card fade + slide in
    Animated.sequence([
      Animated.delay(550),
      Animated.parallel([
        Animated.timing(cardOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(cardY,       { toValue: 0, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]).start();

    // Button fade + slide in
    Animated.sequence([
      Animated.delay(750),
      Animated.parallel([
        Animated.timing(btnOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(btnY,       { toValue: 0, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const iconSpin = iconRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "12deg"],
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#f9fafb" }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 48 }]}
      showsVerticalScrollIndicator={false}
    >

      {/* ── ICON ── */}
      <Animated.View style={[styles.ringWrap, { transform: [{ scale: ringScale }] }]}>
        <Animated.View style={[
          styles.iconWrap,
          { transform: [{ scale: iconScale }, { rotate: iconSpin }] },
        ]}>
          <Ionicons name="checkmark-circle" size={52} color="#1a4a52" />
        </Animated.View>
      </Animated.View>

      {/* ── TEXT ── */}
      <Animated.View style={[styles.textWrap, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}>
        <Text style={styles.title}>Account Created!</Text>
        <Text style={styles.subtitle}>
          {isVerified
            ? "Your Student ID was verified automatically — your account is ready to use, discounts included."
            : noVerificationNeeded
            ? "Your account is ready to use right away — sign in to get started."
            : accountRole === "operator"
            ? "Your account and registration document have been submitted for review. An admin will verify your details shortly."
            : accountRole === "association"
            ? "Your application has been submitted for review. An admin will verify your association shortly."
            : "Your account has been submitted for review. An admin will verify your details shortly."}
        </Text>
      </Animated.View>

      {/* ── STATUS CARD ── */}
      <Animated.View style={[styles.statusCard, { opacity: cardOpacity, transform: [{ translateY: cardY }] }]}>

        <View style={styles.statusRow}>
          <View style={styles.statusIconWrap}>
            {isVerified || noVerificationNeeded
              ? <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
              : <View style={styles.statusDot} />}
          </View>
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>Account Status</Text>
            <Text style={styles.statusValue}>
              {isVerified ? "Verified" : noVerificationNeeded ? "Active" : "Pending Verification"}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.statusRow}>
          <View style={styles.statusIconWrap}>
            <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
          </View>
          <View style={styles.statusInfo}>
            <Text style={styles.statusLabel}>App Access</Text>
            <Text style={styles.statusValue}>
              {isVerified || noVerificationNeeded ? "Full access, right away" : "Available with limited features"}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        {accountRole === "commuter" && (
          <View style={styles.statusRow}>
            <View style={styles.statusIconWrap}>
              <Ionicons name={isVerified ? "pricetag" : "time"} size={20} color={isVerified ? "#16a34a" : "#f59e0b"} />
            </View>
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>Discounts</Text>
              <Text style={styles.statusValue}>
                {isVerified ? "Active immediately" : noVerificationNeeded ? "None — Regular fare" : "Granted after admin approval"}
              </Text>
            </View>
          </View>
        )}

        {accountRole === "operator" && (
          <View style={styles.statusRow}>
            <View style={styles.statusIconWrap}>
              <Ionicons name="business" size={20} color="#f59e0b" />
            </View>
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>Association Membership</Text>
              <Text style={styles.statusValue}>Apply from Profile once signed in</Text>
            </View>
          </View>
        )}

        {accountRole === "association" && (
          <View style={styles.statusRow}>
            <View style={styles.statusIconWrap}>
              <Ionicons name="people" size={20} color="#f59e0b" />
            </View>
            <View style={styles.statusInfo}>
              <Text style={styles.statusLabel}>Member Operators</Text>
              <Text style={styles.statusValue}>Review applications once approved</Text>
            </View>
          </View>
        )}

      </Animated.View>

      {/* ── NOTE — either the Student pipeline's specific pending_review
          reason (see the `note` destructuring above), or, for a freshly
          registered operator, a reminder that applying to an association is
          a separate step reachable from Profile after signing in. There's
          no active session yet at this point (registration never
          auto-signs-in), so this is informational rather than a button that
          would push into a protected operator screen with no session to
          read. ── */}
      {note ? (
        <Animated.View style={[styles.noteCard, { opacity: cardOpacity, transform: [{ translateY: cardY }] }]}>
          <Ionicons name="information-circle" size={18} color="#b45309" />
          <Text style={styles.noteText}>{note}</Text>
        </Animated.View>
      ) : accountRole === "operator" ? (
        <Animated.View style={[styles.noteCard, { opacity: cardOpacity, transform: [{ translateY: cardY }] }]}>
          <Ionicons name="information-circle" size={18} color="#b45309" />
          <Text style={styles.noteText}>
            Once your account is verified and you've signed in, go to Profile → My Associations → Apply to pick a
            vehicle type (Jeepney, UV Express, or Bus) and submit that type's required documents. You can apply for
            more than one vehicle type, and your account works while an application is still pending.
          </Text>
        </Animated.View>
      ) : null}

      {/* ── BUTTON ── */}
      <Animated.View style={[styles.btnWrap, { opacity: btnOpacity, transform: [{ translateY: btnY }] }]}>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => router.replace("/(auth)/login")}
          activeOpacity={0.85}
        >
          <Ionicons name="log-in-outline" size={18} color="#fff" />
          <Text style={styles.btnText}>Go to Sign In</Text>
        </TouchableOpacity>
      </Animated.View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#f9fafb",
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
  },

  ringWrap: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: "rgba(168,216,50,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  iconWrap: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: "#f0faf4",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#a8d832",
  },

  textWrap: { alignItems: "center", gap: 8 },
  title: {
    fontSize: 28, fontWeight: "900",
    color: "#1a4a52", textAlign: "center",
  },
  subtitle: {
    fontSize: 14, color: "#6b7280",
    textAlign: "center", lineHeight: 22,
  },

  statusCard: {
    width: "100%", backgroundColor: "#fff",
    borderRadius: 20, padding: 20,
    borderWidth: 1.5, borderColor: "#e5e7eb", gap: 14,
  },
  statusRow:     { flexDirection: "row", alignItems: "center", gap: 14 },
  statusIconWrap:{ width: 28, alignItems: "center" },
  statusDot:     { width: 10, height: 10, borderRadius: 5, backgroundColor: "#f59e0b" },
  statusInfo:    { flex: 1 },
  statusLabel:   { fontSize: 12, color: "#9ca3af", marginBottom: 2 },
  statusValue:   { fontSize: 14, fontWeight: "700", color: "#374151" },
  divider:       { height: 1, backgroundColor: "#f3f4f6" },

  noteCard: {
    width: "100%", flexDirection: "row", gap: 10,
    backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a",
    borderRadius: 14, padding: 14,
  },
  noteText: { flex: 1, fontSize: 12, color: "#92400e", lineHeight: 18 },

  btnWrap: { width: "100%" },
  btnPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 16,
  },
  btnText: { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
});