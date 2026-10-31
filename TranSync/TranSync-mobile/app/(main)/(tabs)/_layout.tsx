import { Tabs } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

// The 5 real tabs only — moved into this nested (tabs) GROUP (parens = no
// URL segment, so every existing router.push("/(main)/home") etc. call
// anywhere in the app keeps resolving exactly as before) so that Settings
// and the other pushed detail screens (verification-status, booking-history,
// ltfrb-fare-guide, category-switch, select-rebook-trip, active-trip, scan,
// wallet-history) are siblings of this group under (main)/_layout.tsx's own
// Stack instead of being implicitly absorbed into this Tabs navigator.
//
// Root cause this fixes (found live, reported as "Back on Settings goes to
// Home, and the tab bar shows on Settings"): any route file living directly
// inside a directory whose _layout.tsx renders <Tabs> becomes a screen of
// that SAME tab navigator, whether or not it's declared as a <Tabs.Screen> —
// meaning it always got the persistent tab-bar chrome, and router.back()
// followed the tab navigator's own history model (which has no concept of
// "the previous tab's screen") rather than a real Stack's push/pop history.

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: {
  key: string;
  label: string;
  icon: IoniconsName;
  iconActive: IoniconsName;
}[] = [
  { key: "home",    label: "Home",    icon: "home-outline",          iconActive: "home"           },
  { key: "map",     label: "Map",     icon: "map-outline",           iconActive: "map"            },
  { key: "book",    label: "Book",    icon: "ticket-outline",        iconActive: "ticket"         },
  { key: "wallet",  label: "Wallet",  icon: "wallet-outline",        iconActive: "wallet"         },
  { key: "profile", label: "Profile", icon: "person-circle-outline", iconActive: "person-circle"  },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="home"    />
      <Tabs.Screen name="map"     />
      <Tabs.Screen name="book"    />
      <Tabs.Screen name="wallet"  />
      <Tabs.Screen name="profile" />
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
            <Text numberOfLines={1} style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
              {tab.label}
            </Text>
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
  tabItem: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  tabLabel:       { fontSize: 10, color: "#94a3b8", fontWeight: "600" },
  tabLabelActive: { color: "#1a4a52", fontWeight: "800" },
  tabDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#a8d832",
    marginTop: 1,
  },
});
