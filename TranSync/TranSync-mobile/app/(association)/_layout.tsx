import { Tabs } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: {
  key:        string;
  label:      string;
  icon:       IoniconsName;
  iconActive: IoniconsName;
}[] = [
  { key: "dashboard",           label: "Applications", icon: "documents-outline",     iconActive: "documents"      },
  { key: "members",             label: "Members",      icon: "people-outline",        iconActive: "people"         },
  { key: "route-builder",       label: "Routes",       icon: "map-outline",           iconActive: "map"            },
  { key: "fare",                label: "Fares",        icon: "pricetag-outline",      iconActive: "pricetag"       },
  { key: "schedules",           label: "Schedules",    icon: "calendar-outline",      iconActive: "calendar"       },
  { key: "profile",             label: "Profile",      icon: "person-circle-outline", iconActive: "person-circle"  },
];

export default function AssociationLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <AssociationTabBar {...props} />}
    >
      <Tabs.Screen name="dashboard"     />
      <Tabs.Screen name="members"       />
      <Tabs.Screen name="route-builder" />
      <Tabs.Screen name="fare"          />
      <Tabs.Screen name="schedules"     />
      <Tabs.Screen name="profile"       />
    </Tabs>
  );
}

function AssociationTabBar({ state, navigation }: any) {
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
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
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
  tabItem:        { flex: 1, alignItems: "center", gap: 3 },
  tabLabel:       { fontSize: 10, color: "#94a3b8", fontWeight: "600" },
  tabLabelActive: { color: "#1a4a52", fontWeight: "800" },
  tabDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: "#a8d832", marginTop: 1,
  },
});