import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Dimensions, Image } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width } = Dimensions.get("window");

function Smoke({ delay, x, y, size }: { delay: number; x: number; y: number; size: number }) {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale      = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0.6, duration: 200, useNativeDriver: true }),
          Animated.timing(scale,   { toValue: 1,   duration: 200, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(opacity,    { toValue: 0,   duration: 600, useNativeDriver: true }),
          Animated.timing(translateX, { toValue: -24, duration: 600, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: y,   duration: 600, useNativeDriver: true }),
          Animated.timing(scale,      { toValue: 1.8, duration: 600, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(translateX, { toValue: 0,   duration: 0, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 0,   duration: 0, useNativeDriver: true }),
          Animated.timing(scale,      { toValue: 0.2, duration: 0, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={{
        position: "absolute",
        left: x,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "rgba(255,255,255,0.55)",
        opacity,
        transform: [{ translateX }, { translateY }, { scale }],
      }}
    />
  );
}

export default function SplashScreen() {
  const router     = useRouter();
  const bounce     = useRef(new Animated.Value(0)).current;
  const carX       = useRef(new Animated.Value(0)).current;
  const bounceAnim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    bounceAnim.current = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: -5, duration: 250, useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0,  duration: 250, useNativeDriver: true }),
      ])
    );
    bounceAnim.current.start();

    const check = async () => {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const user = await AsyncStorage.getItem("user"); // ✅ correct key
        const role = await AsyncStorage.getItem("role"); // ✅ correct key

        bounceAnim.current?.stop();
        Animated.timing(carX, {
          toValue: width + 200,
          duration: 400,
          useNativeDriver: true,
        }).start(() => {
          if (user && role === "commuter") {
            router.replace("/(main)/home");
          } else if (user && role === "operator") {
            router.replace("/(operator)/dashboard");
          } else if (user && role === "driver") {
            router.replace("/(driver)/dashboard");
          } else if (user && role === "association") {
            router.replace("/(association)/dashboard");
          } else {
            router.replace("/(auth)/onboard");
          }
        });
      } catch {
        router.replace("/(auth)/onboard");
      }
    };
    check();
  }, []);

  return (
    <View style={styles.container}>

      {/* ── LOGO ── */}
      <View style={styles.logoWrap}>
        <Image
          source={require("../assets/TranSync_Logo.png")}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.logoText}>
          Tran<Text style={styles.accent}>S</Text>ync
        </Text>
        <Text style={styles.tagline}>Integrated Public Transportation</Text>
        <Text style={styles.tagline}>System for Pampanga</Text>
      </View>

      {/* ── CAR + SMOKE ── */}
      <Animated.View
        style={[
          styles.carWrap,
          { transform: [{ translateX: carX }, { translateY: bounce }] },
        ]}
      >
        <Smoke delay={0}   x={-10} y={-10} size={14} />
        <Smoke delay={200} x={-6}  y={-16} size={10} />
        <Smoke delay={400} x={-14} y={-6}  size={12} />
        <Image
          source={require("../assets/car_loading.png")}
          style={styles.car}
          resizeMode="contain"
        />
      </Animated.View>

      {/* ── SUBTITLE ── */}
      <Text style={styles.sub}>Your ride is on its way...</Text>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a4a52",
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
  },
  logoWrap:  { alignItems: "center" },
  logoImage: { width: 120, height: 120, marginBottom: 8 },
  logoText:  { fontSize: 48, fontWeight: "900", color: "#fff", letterSpacing: 1 },
  accent:    { color: "#a8d832" },
  tagline: {
    color: "rgba(168,216,50,0.75)",
    fontSize: 12,
    marginTop: 2,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  carWrap: { alignItems: "center", justifyContent: "center" },
  car:     { width: 60, height: 30 },
  sub: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 13,
    letterSpacing: 1.5,
    fontStyle: "italic",
  },
});