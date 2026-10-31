import { useEffect, useRef } from "react";
import { Tabs, useRouter } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Vibration, AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: { key: string; label: string; icon: IoniconsName; iconActive: IoniconsName }[] = [
  { key: "dashboard", label: "Home",     icon: "home-outline",          iconActive: "home"           },
  { key: "drivers",   label: "Drivers",  icon: "people-outline",        iconActive: "people"         },
  { key: "vehicles",  label: "Vehicles", icon: "car-outline",           iconActive: "car"            },
  { key: "trips",     label: "Trips",    icon: "calendar-outline",      iconActive: "calendar"       },
  { key: "quota",     label: "Quotas",   icon: "receipt-outline",       iconActive: "receipt"        },
  { key: "profile",   label: "Profile",  icon: "person-circle-outline", iconActive: "person-circle"  },
];

const EMERGENCY_POLL_MS = 10000;

// Watches for a driver's emergency (SOS) alert on EVERY operator screen, not
// just Home — vibrates and shows a popup the moment a new one appears, and
// again if the app returns from the background with one still unseen. This is
// an in-app alert, not a true push notification: it only works while the app
// is open (real push needs a development build + Firebase, which Expo Go
// can't do). Each alert id is announced once per app session.
function useEmergencyWatcher() {
  const router = useRouter();
  const seen   = useRef<Set<number>>(new Set());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const poll = async (opId: number) => {
      try {
        const res  = await fetch(`${API_BASE}/operators/get_emergency_alerts.php?operator_id=${opId}&status=active`);
        const data = await res.json();
        if (cancelled || !data.success) return;
        const fresh = (data.alerts ?? []).filter((a: any) => !seen.current.has(a.id));
        if (fresh.length === 0) return;
        fresh.forEach((a: any) => seen.current.add(a.id));

        Vibration.vibrate([0, 600, 300, 600, 300, 600]);
        const first = fresh[0];
        Alert.alert(
          "EMERGENCY ALERT",
          fresh.length === 1
            ? `${first.driver_name}${first.plate_number ? ` (${first.plate_number})` : ""} sent an emergency alert and may need help.`
            : `${fresh.length} of your drivers sent emergency alerts and may need help.`,
          [
            { text: "Later", style: "cancel" },
            { text: "View", onPress: () => router.push("/(operator)/emergency-alerts" as any) },
          ]
        );
      } catch { /* keep polling — a failed poll must never surface an error */ }
    };

    let opId: number | null = null;
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      opId = raw ? JSON.parse(raw)?.id ?? null : null;
      if (!opId || cancelled) return;
      poll(opId);
      timer = setInterval(() => poll(opId as number), EMERGENCY_POLL_MS);
    })();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && opId) poll(opId);
    });

    return () => { cancelled = true; if (timer) clearInterval(timer); sub.remove(); };
  }, []);
}

export default function OperatorLayout() {
  useEmergencyWatcher();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="dashboard" />
      <Tabs.Screen name="drivers"   />
      <Tabs.Screen name="vehicles"  />
      <Tabs.Screen name="trips"     />
      <Tabs.Screen name="quota"     />
      <Tabs.Screen name="profile"   />
    </Tabs>
  );
}

function CustomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: insets.bottom + 8 }]}>
      {TABS.map((tab, index) => {
        const isActive = state.index === index;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tabItem}
            onPress={() => navigation.navigate(tab.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isActive ? tab.iconActive : tab.icon}
              size={22}
              color={isActive ? "#1a4a52" : "#94a3b8"}
            />
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{tab.label}</Text>
            {isActive && <View style={styles.tabDot} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    paddingTop: 10,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 12,
  },
  tabItem:        { flex: 1, alignItems: "center", gap: 3 },
  tabLabel:       { fontSize: 10, color: "#94a3b8", fontWeight: "600" },
  tabLabelActive: { color: "#1a4a52", fontWeight: "800" },
  tabDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: "#a8d832", marginTop: 1,
  },
});