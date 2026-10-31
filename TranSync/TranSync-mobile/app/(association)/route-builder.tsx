import { useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Modal, FlatList, Alert, ScrollView, useWindowDimensions,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

type LatLng    = { latitude: number; longitude: number };
type Stopover  = { terminal_id: number; terminal_name: string };
type AssocRoute = {
  id:            number;
  name:          string;
  from_location: string | null;
  to_location:   string | null;
  description:   string | null;
  direction_type: "one_way" | "vice_versa" | null;
  color:         string;
  waypoints:     LatLng[];
  has_waypoints: number;
  status:        "active" | "inactive";
  drivers:       AssocDriver[];
  terminal_id:           number | null;
  terminal_name:         string | null;
  terminal_vehicle_type: string | null;
  terminal_lat:          number | null;
  terminal_lng:          number | null;
  stopovers:             Stopover[];
};
type ExistingTerminal = { id: number; name: string; lat: number; lng: number; routeNames: string[] };
const VEHICLE_TYPES = ["Jeepney", "UV Express", "Bus"] as const;
type AssocDriver = {
  id:        number;
  name:      string;
  latitude:  number;
  longitude: number;
  is_online: number;
  is_full:   number;
};
type ApprovedMember = {
  id:            number;
  subject_id:    number;
  subject_name:  string;
  subject_detail:string;
  operator_name: string;
  approved_at:   string;
};
type LibraryRoute = {
  id:            number;
  name:          string;
  from_location: string | null;
  to_location:   string | null;
  color:         string;
  waypoints:     LatLng[];
  contributor:   string | null;
  waypoint_count:number;
};

const ROUTE_COLORS = [
  "#1a4a52", "#0369a1", "#7c3aed", "#dc2626",
  "#d97706", "#16a34a", "#db2777", "#0891b2",
];

export default function AssociationRouteBuilder() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  // Real devices report a taller bottom safe-area (gesture nav / home indicator)
  // than the emulator typically does — clamp so a bottom sheet's last row (e.g. its
  // Close button) always clears it instead of being covered by the system bar.
  const sheetBottomPad = Math.max(insets.bottom, 16) + 24;
  // Cap sheet height so tall/static content scrolls instead of overflowing past
  // the top of short screens, rather than relying on intrinsic content sizing.
  const sheetMaxHeight = screenHeight * 0.9;
  const mapRef = useRef<MapView>(null);

  const [assoc,          setAssoc]          = useState<any>(null);
  const [routes,         setRoutes]         = useState<AssocRoute[]>([]);
  const [approvedDrivers,setApprovedDrivers]= useState<ApprovedMember[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [myLocation,     setMyLocation]     = useState<LatLng | null>(null);

  // drawing state
  const [drawing,        setDrawing]        = useState(false);
  const [waypoints,      setWaypoints]      = useState<LatLng[]>([]);
  const [waypointsHistory, setWaypointsHistory] = useState<LatLng[][]>([]);
  const [fromLocation,   setFromLocation]   = useState("");
  const [toLocation,     setToLocation]     = useState("");

  // terminal placement — required before waypoint drawing unlocks for a new route
  const [placingTerminal,       setPlacingTerminal]       = useState(false);
  const [terminalPoint,         setTerminalPoint]         = useState<LatLng | null>(null);
  const [terminalName,          setTerminalName]          = useState("");
  const [terminalVehicleType,   setTerminalVehicleType]   = useState<typeof VEHICLE_TYPES[number]>("Jeepney");
  const [showTerminalNameModal, setShowTerminalNameModal] = useState(false);
  const [pendingTerminalName,   setPendingTerminalName]   = useState("");

  // choose: place a brand-new terminal, or reuse one already placed (so multiple
  // routes can genuinely share one terminal)
  const [showTerminalChoiceModal,   setShowTerminalChoiceModal]   = useState(false);
  const [showExistingTerminalModal, setShowExistingTerminalModal] = useState(false);

  // stopovers — other existing terminals this route passes by along the way
  const [stopoverIds,      setStopoverIds]      = useState<number[]>([]);
  const [showStopoverModal,setShowStopoverModal]= useState(false);

  const [description, setDescription] = useState("");
  const [directionType, setDirectionType] = useState<"one_way" | "vice_versa">("one_way");

  const [selectedWaypointIdx, setSelectedWaypointIdx] = useState<number | null>(null);
  const [nameMode,       setNameMode]       = useState<"from-to" | "custom">("from-to");
  const [customRouteName,setCustomRouteName]= useState("");
  const [routeColor,     setRouteColor]     = useState(ROUTE_COLORS[0]);
  const [editingRoute,   setEditingRoute]   = useState<AssocRoute | null>(null);
  const [mapSaving,      setMapSaving]      = useState(false);
  const [selectedRoute,  setSelectedRoute]  = useState<AssocRoute | null>(null);

  // view-only mode
  const [viewingRoute,   setViewingRoute]   = useState<AssocRoute | null>(null);

  // modals
  const [showRouteList,  setShowRouteList]  = useState(false);
  const [showSaveModal,  setShowSaveModal]  = useState(false);
  const [showAssignModal,setShowAssignModal]= useState(false);
  const [assignRoute,    setAssignRoute]    = useState<AssocRoute | null>(null);

  // route library
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryRoutes,    setLibraryRoutes]    = useState<LibraryRoute[]>([]);
  const [librarySearch,    setLibrarySearch]    = useState("");
  const [libraryLoading,   setLibraryLoading]   = useState(false);

  const [toast,          setToast]          = useState("");
  const liveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) return;
      const a = JSON.parse(raw);
      setAssoc(a);
      fetchRoutes(a.id);
      fetchApprovedDrivers(a.id);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setMyLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
    })();

    liveRef.current = setInterval(() => {
      if (assoc) fetchRoutes(assoc.id);
    }, 5000);
    return () => { if (liveRef.current) clearInterval(liveRef.current); };
  }, []));

  const fetchRoutes = async (id: number) => {
    try {
      const res  = await fetch(`${API_BASE}/routes/get_association_routes.php?association_id=${id}`);
      const data = await res.json();
      if (data.success) {
        setRoutes(data.routes ?? []);
        if (selectedRoute) {
          const updated = data.routes.find((r: AssocRoute) => r.id === selectedRoute.id);
          if (updated) setSelectedRoute(updated);
        }
      }
    } catch (_) {}
    finally { setLoading(false); }
  };

  const fetchApprovedDrivers = async (id: number) => {
    try {
      const res  = await fetch(`${API_BASE}/associations/association_members.php?association_id=${id}`);
      const data = await res.json();
      if (data.success) {
        setApprovedDrivers(data.members.filter((m: any) => m.subject_type === "driver"));
      }
    } catch (_) {}
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const fetchLibraryRoutes = async () => {
    setLibraryLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/routes/get_route_library.php`);
      const data = await res.json();
      if (data.success) setLibraryRoutes(data.routes ?? []);
    } catch (_) {}
    finally { setLibraryLoading(false); }
  };

  const openLibrary = () => {
    setLibrarySearch("");
    setShowLibraryModal(true);
    fetchLibraryRoutes();
  };

  const startFromTemplate = (route: LibraryRoute) => {
    setEditingRoute(null);
    setWaypoints(route.waypoints);
    setWaypointsHistory([]);
    setSelectedWaypointIdx(null);
    setRouteColor(route.color);
    const hasFromTo = !!route.from_location && !!route.to_location;
    if (hasFromTo) {
      setFromLocation(route.from_location ?? "");
      setToLocation(route.to_location ?? "");
      setCustomRouteName("");
      setNameMode("from-to");
    } else {
      setFromLocation("");
      setToLocation("");
      setCustomRouteName(route.name ?? "");
      setNameMode("custom");
    }
    setShowLibraryModal(false);
    setDescription("");
    setDirectionType("one_way");
    setStopoverIds([]);
    // A route from the library is still a brand-new route for this association —
    // it needs its own terminal placed (or reused) before it can be saved.
    setTerminalPoint(null);
    setTerminalName("");
    setPendingTerminalName("");
    setShowTerminalChoiceModal(true);
    if (route.waypoints.length > 0) {
      const lats = route.waypoints.map(w => w.latitude);
      const lngs = route.waypoints.map(w => w.longitude);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      mapRef.current?.animateToRegion({
        latitude:      (minLat + maxLat) / 2,
        longitude:     (minLng + maxLng) / 2,
        latitudeDelta:  (maxLat - minLat) + 0.02,
        longitudeDelta: (maxLng - minLng) + 0.02,
      }, 500);
    }
  };

  // ── Drawing ────────────────────────────────────────────────────────────────
  const handleMapPress = (e: any) => {
    const coord = e?.nativeEvent?.coordinate;
    if (!coord) return;
    const newPoint = { latitude: parseFloat(coord.latitude), longitude: parseFloat(coord.longitude) };

    if (placingTerminal) {
      setTerminalPoint(newPoint);
      setPendingTerminalName(terminalName);
      setShowTerminalNameModal(true);
      return;
    }
    if (!drawing) return;
    if (selectedWaypointIdx !== null) {
      const truncated = waypoints.slice(0, selectedWaypointIdx + 1);
      setWaypointsHistory(prev => [...prev, waypoints]);
      setWaypoints([...truncated, newPoint]);
      setSelectedWaypointIdx(null);
    } else {
      setWaypointsHistory(prev => [...prev, waypoints]);
      setWaypoints(prev => [...prev, newPoint]);
    }
  };

  const selectWaypoint = (index: number) => {
    setSelectedWaypointIdx(prev => prev === index ? null : index);
  };

  const confirmTerminal = () => {
    const nm = pendingTerminalName.trim();
    if (!nm) { Alert.alert("Required", "Please name this terminal."); return; }
    setTerminalName(nm);
    setShowTerminalNameModal(false);
    setPlacingTerminal(false);
    setDrawing(true);
  };

  // Dedupe this association's already-placed terminals from their routes list —
  // lets a new route reuse one instead of always placing a fresh pin.
  const getExistingTerminals = (): ExistingTerminal[] => {
    const map = new Map<number, ExistingTerminal>();
    for (const r of routes) {
      if (r.terminal_id == null || r.terminal_lat == null || r.terminal_lng == null) continue;
      const existing = map.get(r.terminal_id);
      if (existing) existing.routeNames.push(r.name);
      else map.set(r.terminal_id, {
        id: r.terminal_id, name: r.terminal_name ?? "Terminal",
        lat: r.terminal_lat, lng: r.terminal_lng, routeNames: [r.name],
      });
    }
    return Array.from(map.values());
  };

  const choosePlaceNewTerminal = () => {
    setShowTerminalChoiceModal(false);
    // Just a starting default — the vehicle-type picker in the naming step
    // lets the association pick any of the three types regardless, since an
    // association can now publish routes of all three kinds.
    setTerminalVehicleType("Jeepney");
    setPlacingTerminal(true);
    setDrawing(false);
  };

  const chooseUseExistingTerminal = () => {
    setShowTerminalChoiceModal(false);
    setShowExistingTerminalModal(true);
  };

  const selectExistingTerminal = (t: ExistingTerminal) => {
    setTerminalPoint({ latitude: t.lat, longitude: t.lng });
    setTerminalName(t.name);
    setShowExistingTerminalModal(false);
    setPlacingTerminal(false);
    setDrawing(true);
    mapRef.current?.animateToRegion({ latitude: t.lat, longitude: t.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 400);
  };

  const toggleStopover = (terminalId: number) => {
    setStopoverIds(prev => prev.includes(terminalId) ? prev.filter(id => id !== terminalId) : [...prev, terminalId]);
  };

  const startNewRoute = () => {
    setEditingRoute(null);
    setFromLocation("");
    setToLocation("");
    setCustomRouteName("");
    setNameMode("from-to");
    setRouteColor(ROUTE_COLORS[0]);
    setWaypoints([]);
    setWaypointsHistory([]);
    setSelectedWaypointIdx(null);
    setTerminalPoint(null);
    setTerminalName("");
    setPendingTerminalName("");
    setDescription("");
    setDirectionType("one_way");
    setStopoverIds([]);
    setShowRouteList(false);
    // A brand-new route must have its terminal placed (or reused) before drawing unlocks.
    setShowTerminalChoiceModal(true);
  };

  const startEditRoute = (route: AssocRoute) => {
    setEditingRoute(route);
    const hasFromTo = !!route.from_location && !!route.to_location;
    if (hasFromTo) {
      setFromLocation(route.from_location ?? "");
      setToLocation(route.to_location ?? "");
      setCustomRouteName("");
      setNameMode("from-to");
    } else {
      setFromLocation("");
      setToLocation("");
      setCustomRouteName(route.name ?? "");
      setNameMode("custom");
    }
    setRouteColor(route.color);
    setWaypoints(route.waypoints ?? []);
    setWaypointsHistory([]);
    setSelectedWaypointIdx(null);
    setShowRouteList(false);
    setSelectedRoute(null);
    setDescription(route.description ?? "");
    setDirectionType(route.direction_type ?? "one_way");
    setStopoverIds(route.stopovers?.map(s => s.terminal_id) ?? []);
    if (route.terminal_id && route.terminal_lat != null && route.terminal_lng != null) {
      // Already has a terminal — skip straight to editing waypoints.
      setTerminalPoint({ latitude: route.terminal_lat, longitude: route.terminal_lng });
      setTerminalName(route.terminal_name ?? "");
      setPendingTerminalName(route.terminal_name ?? "");
      setPlacingTerminal(false);
      setDrawing(true);
    } else {
      setTerminalPoint(null);
      setTerminalName("");
      setPendingTerminalName("");
      setPlacingTerminal(true);
      setDrawing(false);
    }
    if (route.waypoints?.length > 0) {
      mapRef.current?.animateToRegion({
        ...route.waypoints[0],
        latitudeDelta: 0.05, longitudeDelta: 0.05,
      }, 400);
    }
  };

  const cancelDrawing = () => {
    setWaypoints([]);
    setWaypointsHistory([]);
    setSelectedWaypointIdx(null);
    setDrawing(false);
    setPlacingTerminal(false);
    setTerminalPoint(null);
    setTerminalName("");
    setPendingTerminalName("");
    setEditingRoute(null);
    setFromLocation("");
    setToLocation("");
    setCustomRouteName("");
    setNameMode("from-to");
    setDescription("");
    setDirectionType("one_way");
    setStopoverIds([]);
    setShowTerminalChoiceModal(false);
    setShowExistingTerminalModal(false);
    setShowStopoverModal(false);
  };

  const clearWaypoints = () => {
    setWaypointsHistory(prev => [...prev, waypoints]);
    setWaypoints([]);
    setSelectedWaypointIdx(null);
  };

  const handleUndo = () => {
    if (waypointsHistory.length === 0) return;
    setWaypoints(waypointsHistory[waypointsHistory.length - 1]);
    setWaypointsHistory(prev => prev.slice(0, -1));
    setSelectedWaypointIdx(null);
  };

  const startViewRoute = (route: AssocRoute) => {
    setViewingRoute(route);
    setShowRouteList(false);
    setSelectedRoute(null);
    if (route.waypoints?.length > 0) {
      const lats = route.waypoints.map(w => w.latitude);
      const lngs = route.waypoints.map(w => w.longitude);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const pad = 0.01;
      mapRef.current?.animateToRegion({
        latitude:      (minLat + maxLat) / 2,
        longitude:     (minLng + maxLng) / 2,
        latitudeDelta:  (maxLat - minLat) + pad,
        longitudeDelta: (maxLng - minLng) + pad,
      }, 500);
    }
  };

  const handleSaveRoute = async () => {
    if (waypoints.length < 2) { Alert.alert("Too short", "Draw at least 2 points."); return; }
    if (!editingRoute?.terminal_id && !terminalPoint) {
      Alert.alert("Terminal required", "Place this route's terminal before saving.");
      return;
    }
    let nameToUse: string;
    let fromVal: string;
    let toVal: string;
    if (nameMode === "from-to") {
      fromVal = fromLocation.trim();
      toVal   = toLocation.trim();
      if (!fromVal || !toVal) { Alert.alert("Required", "Please enter both From and To locations."); return; }
      nameToUse = `${fromVal} -> ${toVal}`;
    } else {
      const custom = customRouteName.trim();
      if (!custom) { Alert.alert("Required", "Please enter a route name."); return; }
      nameToUse = custom;
      fromVal   = "";
      toVal     = "";
    }
    setMapSaving(true);
    try {
      const res  = await fetch(`${API_BASE}/routes/save_route.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          association_id: assoc.id,
          operator_id:    0,
          name:           nameToUse,
          from_location:  fromVal,
          to_location:    toVal,
          description,
          direction_type: directionType,
          color:          routeColor,
          waypoints,
          stopover_terminal_ids: stopoverIds,
          ...(editingRoute ? { route_id: editingRoute.id } : {}),
          ...(editingRoute?.terminal_id
            ? { terminal_id: editingRoute.terminal_id }
            : terminalPoint
              ? {
                  terminal_name: terminalName,
                  terminal_lat: terminalPoint.latitude,
                  terminal_lng: terminalPoint.longitude,
                  terminal_vehicle_type: terminalVehicleType,
                }
              : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowSaveModal(false);
        cancelDrawing();
        fetchRoutes(assoc.id);
        showToast(editingRoute ? "Route updated!" : "Route saved!");
      } else {
        Alert.alert("Save Failed", data.message ?? "Unknown error");
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Could not reach server.");
    } finally { setMapSaving(false); }
  };

  const handleDeleteRoute = (route: AssocRoute) => {
    Alert.alert("Delete Route", `Delete "${route.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await fetch(`${API_BASE}/routes/delete_route.php`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ route_id: route.id, association_id: assoc.id }),
          });
          if (selectedRoute?.id === route.id) setSelectedRoute(null);
          if (editingRoute?.id === route.id) cancelDrawing();
          fetchRoutes(assoc.id);
          showToast("Route deleted.");
        } catch (_) {}
      }},
    ]);
  };

  // ── Driver assignment ──────────────────────────────────────────────────────
  const handleAssignDriver = async (driver: ApprovedMember, route: AssocRoute) => {
    try {
      const res  = await fetch(`${API_BASE}/associations/assign_association_driver.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          association_id: assoc.id,
          route_id:       route.id,
          driver_id:      driver.subject_id,
          action:         "assign",
        }),
      });
      const data = await res.json();
      if (data.success) {
        fetchRoutes(assoc.id);
        showToast(`${driver.subject_name} assigned!`);
      } else {
        showToast(data.message || "Assignment failed.");
      }
    } catch (_) { showToast("Cannot connect to server."); }
  };

  const handleUnassignDriver = async (driverId: number) => {
    try {
      await fetch(`${API_BASE}/associations/assign_association_driver.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          association_id: assoc.id,
          driver_id:      driverId,
          action:         "unassign",
        }),
      });
      fetchRoutes(assoc.id);
      showToast("Driver unassigned.");
    } catch (_) {}
  };

  const getAssignedRouteId = (driverId: number): number | null => {
    for (const r of routes) {
      if (r.drivers.some(d => d.id === driverId)) return r.id;
    }
    return null;
  };


  if (loading) return (
    <View style={[styles.container, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
      <ActivityIndicator color="#1a4a52" size="large" />
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── TOAST ── */}
      {!!toast && (
        <View style={[styles.toast, { top: insets.top + 80 }]}>
          <Ionicons name="checkmark-circle" size={14} color="#a8d832" />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* ── TOOLBAR ── */}
      <View style={styles.toolbar}>
        <View>
          <Text style={styles.toolbarTitle}>Route Builder</Text>
          <Text style={styles.toolbarSub}>{routes.length} route{routes.length !== 1 ? "s" : ""} drawn</Text>
        </View>
        <View style={styles.toolbarBtns}>
          <TouchableOpacity style={styles.toolbarBtn} onPress={() => setShowRouteList(true)}>
            <Ionicons name="list" size={16} color="#1a4a52" />
            <Text style={styles.toolbarBtnText}>Routes</Text>
          </TouchableOpacity>
          {!drawing && !placingTerminal && (
            <TouchableOpacity style={styles.toolbarBtn} onPress={openLibrary}>
              <Ionicons name="library-outline" size={16} color="#1a4a52" />
              <Text style={styles.toolbarBtnText}>Library</Text>
            </TouchableOpacity>
          )}
          {!drawing && !placingTerminal && (
            <TouchableOpacity style={[styles.toolbarBtn, styles.toolbarBtnPrimary]} onPress={startNewRoute}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={[styles.toolbarBtnText, { color: "#fff" }]}>Draw</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── MAP ── */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        onPress={handleMapPress}
        initialRegion={myLocation
          ? { ...myLocation, latitudeDelta: 0.05, longitudeDelta: 0.05 }
          : { latitude: 15.18, longitude: 120.59, latitudeDelta: 0.1, longitudeDelta: 0.1 }
        }
        showsUserLocation
      >
        {/* Saved routes — not tappable while drawing/placing a terminal, otherwise a
            tap near an overlapping route (common in dense areas like Angeles City)
            gets swallowed here instead of registering a new waypoint. */}
        {routes.map(route => (
          <Polyline
            key={`route-${route.id}`}
            coordinates={route.waypoints}
            strokeColor={route.color}
            strokeWidth={selectedRoute?.id === route.id ? 5 : 3}
            tappable={!drawing && !placingTerminal}
            onPress={drawing || placingTerminal ? undefined : () => setSelectedRoute(route)}
          />
        ))}

        {/* In-progress drawing */}
        {drawing && waypoints.length >= 2 && selectedWaypointIdx === null && (
          <Polyline coordinates={waypoints} strokeColor={routeColor} strokeWidth={4} lineDashPattern={[8, 4]} />
        )}
        {drawing && waypoints.length >= 2 && selectedWaypointIdx !== null && (
          <>
            <Polyline
              coordinates={waypoints.slice(0, selectedWaypointIdx + 1)}
              strokeColor={routeColor} strokeWidth={4} lineDashPattern={[8, 4]}
            />
            {selectedWaypointIdx < waypoints.length - 1 && (
              <Polyline
                coordinates={waypoints.slice(selectedWaypointIdx)}
                strokeColor="#d1d5db" strokeWidth={3} lineDashPattern={[4, 6]}
              />
            )}
          </>
        )}
        {drawing && waypoints.map((wp, i) => {
          const isSelected = selectedWaypointIdx === i;
          const isGhost    = selectedWaypointIdx !== null && i > selectedWaypointIdx;
          const showA      = i === 0;
          const showB      = isSelected
            ? true
            : selectedWaypointIdx === null && i === waypoints.length - 1 && i > 0;
          return (
            <Marker key={`wp-${i}`} coordinate={wp} anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => selectWaypoint(i)}>
              <View style={[
                styles.waypointDot,
                { backgroundColor: isGhost ? "#d1d5db" : isSelected ? "#fff" : routeColor },
                isSelected && { borderWidth: 2.5, borderColor: routeColor, width: 26, height: 26, borderRadius: 13 },
              ]}>
                {showA && <Text style={[styles.waypointDotText, isSelected && { color: routeColor }]}>A</Text>}
                {showB && !showA && <Text style={[styles.waypointDotText, isSelected && { color: routeColor }]}>B</Text>}
              </View>
            </Marker>
          );
        })}

        {/* Existing terminals (shown for reference, so a new terminal isn't placed on top of one) */}
        {!drawing && !placingTerminal && routes.filter(r => r.terminal_lat != null && r.terminal_lng != null).map(r => (
          <Marker key={`terminal-${r.terminal_id}`}
            coordinate={{ latitude: r.terminal_lat as number, longitude: r.terminal_lng as number }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.terminalMarker}>
              <Ionicons name="flag" size={14} color="#fff" />
            </View>
          </Marker>
        ))}

        {/* Terminal being placed/edited for the current route */}
        {terminalPoint && (
          <Marker coordinate={terminalPoint} anchor={{ x: 0.5, y: 1 }}>
            <View style={[styles.terminalMarker, { backgroundColor: routeColor }]}>
              <Ionicons name="flag" size={14} color="#fff" />
            </View>
          </Marker>
        )}

        {/* Stopover terminals selected for this route (read-only, reference an existing terminal) */}
        {drawing && stopoverIds.map(id => {
          const t = getExistingTerminals().find(et => et.id === id);
          if (!t) return null;
          return (
            <Marker key={`stopover-${id}`} coordinate={{ latitude: t.lat, longitude: t.lng }} anchor={{ x: 0.5, y: 1 }}>
              <View style={[styles.terminalMarker, { backgroundColor: "#9333ea" }]}>
                <Ionicons name="git-branch" size={12} color="#fff" />
              </View>
            </Marker>
          );
        })}

        {/* Driver markers */}
        {routes.flatMap(r => r.drivers)
          .filter(driver => driver.latitude != null && driver.longitude != null)
          .map(driver => (
          <Marker key={`driver-${driver.id}`}
            coordinate={{ latitude: driver.latitude, longitude: driver.longitude }}>
            <View style={[styles.driverMarker, { borderColor: driver.is_online ? "#16a34a" : "#94a3b8" }]}>
              <Ionicons name="bus" size={14} color={driver.is_online ? "#16a34a" : "#94a3b8"} />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* ── SELECTED ROUTE INFO BAR ── */}
      {selectedRoute && !drawing && (
        <View style={[styles.routeInfoBar, { top: insets.top + 64 }]}>
          <View style={[styles.routeColorDot, { backgroundColor: selectedRoute.color }]} />
          <Text style={styles.routeInfoName} numberOfLines={1}>{selectedRoute.name}</Text>
          <Text style={styles.routeInfoDrivers}>{selectedRoute.drivers.length} driver{selectedRoute.drivers.length !== 1 ? "s" : ""}</Text>
          <TouchableOpacity style={styles.assignBtn}
            onPress={() => { setAssignRoute(selectedRoute); setShowAssignModal(true); }}>
            <Ionicons name="people" size={13} color="#0369a1" />
            <Text style={styles.assignBtnText}>Assign</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelectedRoute(null)} style={styles.routeInfoCloseBtn} activeOpacity={0.7}>
            <Ionicons name="close" size={16} color="#9ca3af" />
            <Text style={styles.routeInfoCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── TERMINAL PLACEMENT BANNER ── */}
      {placingTerminal && (
        <View style={[styles.drawBanner, { top: insets.top + 64 }]}>
          <Ionicons name="flag" size={14} color="#92400e" />
          <Text style={styles.drawBannerText}>
            Tap the map to place this route's terminal
          </Text>
        </View>
      )}
      {placingTerminal && (
        <View style={[styles.mapToolbar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={styles.mapToolBtn} onPress={cancelDrawing}>
            <Ionicons name="close" size={16} color="#374151" />
            <Text style={styles.mapToolBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── DRAWING BANNER ── */}
      {drawing && (
        <View style={[styles.drawBanner, { top: insets.top + 64 }, selectedWaypointIdx !== null && styles.drawBannerSelected]}>
          <Ionicons
            name={selectedWaypointIdx !== null ? "git-branch-outline" : "pencil"}
            size={14}
            color={selectedWaypointIdx !== null ? "#1e40af" : "#92400e"}
          />
          <Text style={[styles.drawBannerText, selectedWaypointIdx !== null && styles.drawBannerTextSelected]}>
            {selectedWaypointIdx !== null
              ? `Point ${selectedWaypointIdx + 1} selected — tap map to resume from here`
              : waypoints.length === 0
                ? "Tap map to start drawing route"
                : `${waypoints.length} point${waypoints.length !== 1 ? "s" : ""} — tap a point to edit from there`}
          </Text>
        </View>
      )}

      {/* ── COLOR PICKER (while drawing) ── */}
      {drawing && (
        <View style={[styles.colorPickerRow, { bottom: insets.bottom + 96 }]}>
          {ROUTE_COLORS.map(c => (
            <TouchableOpacity key={c} onPress={() => setRouteColor(c)}
              style={[styles.colorDot, { backgroundColor: c }, routeColor === c && styles.colorDotActive]} />
          ))}
        </View>
      )}

      {/* ── STOPOVER FAB (while drawing) ── */}
      {drawing && (
        <TouchableOpacity style={[styles.stopoverFab, { bottom: insets.bottom + 96 }]} onPress={() => setShowStopoverModal(true)}>
          <Ionicons name="git-branch-outline" size={16} color="#1a4a52" />
          <Text style={styles.stopoverFabText}>Stopover</Text>
          {stopoverIds.length > 0 && (
            <View style={styles.stopoverBadge}><Text style={styles.stopoverBadgeText}>{stopoverIds.length}</Text></View>
          )}
        </TouchableOpacity>
      )}

      {/* ── MAP TOOLBAR (while drawing) ── */}
      {drawing && (
        <View style={[styles.mapToolbar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={styles.mapToolBtn} onPress={cancelDrawing}>
            <Ionicons name="close" size={16} color="#374151" />
            <Text style={styles.mapToolBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.mapToolBtn, waypointsHistory.length === 0 && { opacity: 0.4 }]} onPress={handleUndo} disabled={waypointsHistory.length === 0}>
            <Ionicons name="arrow-undo" size={16} color="#374151" />
            <Text style={styles.mapToolBtnText}>Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mapToolBtn, styles.mapToolBtnClear, waypoints.length === 0 && { opacity: 0.4 }]}
            onPress={clearWaypoints}
            disabled={waypoints.length === 0}
          >
            <Ionicons name="trash-outline" size={16} color="#dc2626" />
            <Text style={[styles.mapToolBtnText, { color: "#dc2626" }]}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mapToolBtn, styles.mapToolBtnPrimary, waypoints.length < 2 && { opacity: 0.5 }]}
            onPress={() => setShowSaveModal(true)}
            disabled={waypoints.length < 2}
          >
            <Ionicons name="save" size={16} color="#fff" />
            <Text style={[styles.mapToolBtnText, { color: "#fff" }]}>Save</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── VIEW-ONLY BANNER ── */}
      {viewingRoute && !drawing && (
        <View style={[styles.viewBanner, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={[styles.viewBannerColorBar, { backgroundColor: viewingRoute.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.viewBannerTitle} numberOfLines={1}>{viewingRoute.name}</Text>
            <Text style={styles.viewBannerSub}>
              {viewingRoute.waypoints.length} waypoints · {viewingRoute.drivers.length} driver{viewingRoute.drivers.length !== 1 ? "s" : ""} assigned
            </Text>
          </View>
          <TouchableOpacity style={styles.viewBannerClose} onPress={() => setViewingRoute(null)}>
            <Ionicons name="close" size={18} color="#374151" />
            <Text style={styles.viewBannerCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── TERMINAL CHOICE MODAL ── */}
      <Modal visible={showTerminalChoiceModal} transparent animationType="slide" onRequestClose={() => setShowTerminalChoiceModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: sheetMaxHeight, paddingBottom: sheetBottomPad }]}>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Where does this route depart from?</Text>
              <Text style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
                Every route needs a terminal — place a new one, or reuse one you've already set up.
              </Text>
              <TouchableOpacity style={styles.choiceCard} onPress={choosePlaceNewTerminal}>
                <Ionicons name="add-circle" size={22} color="#1a4a52" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.choiceCardTitle}>Place New Terminal</Text>
                  <Text style={styles.choiceCardSub}>Tap a new spot on the map</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
              </TouchableOpacity>
              {getExistingTerminals().length > 0 && (
                <TouchableOpacity style={styles.choiceCard} onPress={chooseUseExistingTerminal}>
                  <Ionicons name="flag" size={22} color="#1a4a52" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.choiceCardTitle}>Use Existing Terminal</Text>
                    <Text style={styles.choiceCardSub}>
                      {getExistingTerminals().length} terminal{getExistingTerminals().length !== 1 ? "s" : ""} already placed
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => setShowTerminalChoiceModal(false)}
                style={{
                  marginTop: 12,
                  width: "100%",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingVertical: 14,
                  borderRadius: 12,
                  borderWidth: 1.5,
                  borderColor: "#d1d5db",
                  backgroundColor: "#f3f4f6",
                }}
              >
                <Ionicons name="close" size={16} color="#111827" />
                <Text style={{ fontSize: 15, fontWeight: "800", color: "#111827" }}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── EXISTING TERMINAL PICKER MODAL ── */}
      <Modal visible={showExistingTerminalModal} transparent animationType="slide" onRequestClose={() => setShowExistingTerminalModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: "75%", paddingBottom: sheetBottomPad }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Choose a Terminal</Text>
            <FlatList
              style={{ flexShrink: 1 }}
              data={getExistingTerminals()}
              keyExtractor={t => String(t.id)}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.routeListItem} onPress={() => selectExistingTerminal(item)}>
                  <View style={styles.terminalListIcon}>
                    <Ionicons name="flag" size={14} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeListName}>{item.name}</Text>
                    <Text style={styles.routeListMeta}>Used by: {item.routeNames.join(", ")}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={[styles.modalCancel, styles.modalCancelStandalone]} onPress={() => setShowExistingTerminalModal(false)}>
              <Text style={styles.modalCancelText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── STOPOVER PICKER MODAL ── */}
      <Modal visible={showStopoverModal} transparent animationType="slide" onRequestClose={() => setShowStopoverModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: "75%", paddingBottom: sheetBottomPad }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Stopover Terminals</Text>
            <Text style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
              Select other terminals this route also stops at along the way.
            </Text>
            <FlatList
              style={{ flexShrink: 1 }}
              data={getExistingTerminals().filter(t => t.id !== editingRoute?.terminal_id)}
              keyExtractor={t => String(t.id)}
              renderItem={({ item }) => {
                const checked = stopoverIds.includes(item.id);
                return (
                  <TouchableOpacity style={styles.routeListItem} onPress={() => toggleStopover(item.id)}>
                    <Ionicons name={checked ? "checkbox" : "square-outline"} size={20} color={checked ? "#1a4a52" : "#9ca3af"} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={styles.routeListName}>{item.name}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", paddingVertical: 20 }}>
                  No other terminals yet.
                </Text>
              }
            />
            <TouchableOpacity style={[styles.modalConfirm, styles.modalCancelStandalone]} onPress={() => setShowStopoverModal(false)}>
              <Text style={styles.modalConfirmText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── TERMINAL NAME MODAL ── */}
      <Modal visible={showTerminalNameModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: sheetMaxHeight, paddingBottom: sheetBottomPad }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Name this Terminal</Text>
            <Text style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
              This is where jeepneys for this route will depart from.
            </Text>
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.fieldLabel}>Terminal Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Xevera Terminal"
                placeholderTextColor="#9ca3af"
                value={pendingTerminalName}
                onChangeText={setPendingTerminalName}
                autoFocus
              />
            </View>
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.fieldLabel}>Vehicle Type</Text>
              <View style={styles.nameModeToggle}>
                {VEHICLE_TYPES.map(vt => (
                  <TouchableOpacity key={vt}
                    style={[styles.nameModeBtn, terminalVehicleType === vt && styles.nameModeBtnActive]}
                    onPress={() => setTerminalVehicleType(vt)}
                  >
                    <Text style={[styles.nameModeBtnText, terminalVehicleType === vt && styles.nameModeBtnTextActive]}>{vt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setShowTerminalNameModal(false); setTerminalPoint(null); }}>
                <Text style={styles.modalCancelText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={confirmTerminal}>
                <Text style={styles.modalConfirmText}>Confirm</Text>
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ── SAVE MODAL ── */}
      <Modal visible={showSaveModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: sheetMaxHeight, paddingBottom: sheetBottomPad }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{editingRoute ? "Update Route" : "Save Route"}</Text>
            <Text style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
              {waypoints.length} waypoints · color:
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: routeColor, marginLeft: 6 }} />
            </Text>
            {!!terminalName && (
              <Text style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
                Terminal: <Text style={{ fontWeight: "800", color: "#1a4a52" }}>{terminalName}</Text>
              </Text>
            )}

            {/* Name mode toggle */}
            <View style={styles.nameModeToggle}>
              <TouchableOpacity
                style={[styles.nameModeBtn, nameMode === "from-to" && styles.nameModeBtnActive]}
                onPress={() => setNameMode("from-to")}
              >
                <Text style={[styles.nameModeBtnText, nameMode === "from-to" && styles.nameModeBtnTextActive]}>From → To</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.nameModeBtn, nameMode === "custom" && styles.nameModeBtnActive]}
                onPress={() => setNameMode("custom")}
              >
                <Text style={[styles.nameModeBtnText, nameMode === "custom" && styles.nameModeBtnTextActive]}>Custom Name</Text>
              </TouchableOpacity>
            </View>

            {nameMode === "from-to" ? (
              <>
                <View style={{ marginBottom: 12 }}>
                  <Text style={styles.fieldLabel}>From *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Xevera"
                    placeholderTextColor="#9ca3af"
                    value={fromLocation}
                    onChangeText={setFromLocation}
                    autoFocus
                  />
                </View>
                <View style={{ marginBottom: 16 }}>
                  <Text style={styles.fieldLabel}>To *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Astro"
                    placeholderTextColor="#9ca3af"
                    value={toLocation}
                    onChangeText={setToLocation}
                  />
                </View>
              </>
            ) : (
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.fieldLabel}>Route Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Circular Loop - San Fernando"
                  placeholderTextColor="#9ca3af"
                  value={customRouteName}
                  onChangeText={setCustomRouteName}
                  autoFocus
                />
              </View>
            )}
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.fieldLabel}>Description (optional)</Text>
              <TextInput
                style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
                placeholder="e.g. Passes via MacArthur Highway, stops at HAU"
                placeholderTextColor="#9ca3af"
                value={description}
                onChangeText={setDescription}
                multiline
              />
            </View>
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.fieldLabel}>Route Direction</Text>
              <Text style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>
                Vice versa: the same jeep drives this road both ways (A→B then B→A).
                One way: it only ever travels this drawn direction.
              </Text>
              <View style={styles.nameModeToggle}>
                <TouchableOpacity
                  style={[styles.nameModeBtn, directionType === "one_way" && styles.nameModeBtnActive]}
                  onPress={() => setDirectionType("one_way")}
                >
                  <Text style={[styles.nameModeBtnText, directionType === "one_way" && styles.nameModeBtnTextActive]}>One Way</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.nameModeBtn, directionType === "vice_versa" && styles.nameModeBtnActive]}
                  onPress={() => setDirectionType("vice_versa")}
                >
                  <Text style={[styles.nameModeBtnText, directionType === "vice_versa" && styles.nameModeBtnTextActive]}>Vice Versa</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowSaveModal(false)}>
                <Text style={styles.modalCancelText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, mapSaving && { opacity: 0.6 }]}
                onPress={handleSaveRoute}
                disabled={mapSaving}
              >
                {mapSaving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalConfirmText}>Save</Text>}
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ── ROUTE LIST MODAL ── */}
      <Modal visible={showRouteList} transparent animationType="slide" onRequestClose={() => setShowRouteList(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: "75%", paddingBottom: sheetBottomPad }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Association Routes</Text>
            {routes.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 32, gap: 8 }}>
                <Ionicons name="map-outline" size={36} color="#d1d5db" />
                <Text style={{ fontSize: 15, fontWeight: "800", color: "#374151" }}>No routes yet</Text>
                <Text style={{ fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
                  Tap Draw to start drawing your first route on the map.
                </Text>
              </View>
            ) : (
              <FlatList
                style={{ flexShrink: 1 }}
                data={routes}
                keyExtractor={r => String(r.id)}
                renderItem={({ item: route }) => (
                  <View style={styles.routeListItem}>
                    <View style={styles.routeListTopRow}>
                      <View style={[styles.routeListColor, { backgroundColor: route.color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.routeListName}>{route.name}</Text>
                        <Text style={styles.routeListMeta}>
                          {route.drivers.length} driver{route.drivers.length !== 1 ? "s" : ""} assigned
                        </Text>
                      </View>
                    </View>
                    <View style={styles.routeListActions}>
                      <TouchableOpacity style={[styles.routeListBtn, { backgroundColor: "#eff6ff" }]} onPress={() => startViewRoute(route)} activeOpacity={0.8}>
                        <Ionicons name="eye" size={15} color="#0369a1" />
                        <Text style={[styles.routeListBtnText, { color: "#0369a1" }]}>View</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.routeListBtn} onPress={() => startEditRoute(route)} activeOpacity={0.8}>
                        <Ionicons name="pencil" size={15} color="#6b7280" />
                        <Text style={[styles.routeListBtnText, { color: "#6b7280" }]}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.routeListBtn, { backgroundColor: "#fef2f2" }]} onPress={() => handleDeleteRoute(route)} activeOpacity={0.8}>
                        <Ionicons name="trash" size={15} color="#dc2626" />
                        <Text style={[styles.routeListBtnText, { color: "#dc2626" }]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
            )}
            <TouchableOpacity style={[styles.modalCancel, styles.modalCancelStandalone]} onPress={() => setShowRouteList(false)}>
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── ASSIGN DRIVER MODAL ── */}
      <Modal visible={showAssignModal} transparent animationType="slide" onRequestClose={() => setShowAssignModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: "80%", paddingBottom: sheetBottomPad }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Assign Driver</Text>
            {assignRoute && (
              <Text style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
                Route: <Text style={{ fontWeight: "800", color: "#1a4a52" }}>{assignRoute.name}</Text>
              </Text>
            )}

            {approvedDrivers.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
                <Ionicons name="people-outline" size={36} color="#d1d5db" />
                <Text style={{ fontSize: 14, fontWeight: "800", color: "#374151" }}>No approved drivers</Text>
                <Text style={{ fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
                  Approve driver applications first before assigning routes.
                </Text>
              </View>
            ) : (
              <FlatList
                style={{ flexShrink: 1 }}
                data={approvedDrivers}
                keyExtractor={d => String(d.subject_id)}
                renderItem={({ item: member }) => {
                  const assignedRouteId = getAssignedRouteId(member.subject_id);
                  const isAssignedHere  = assignRoute ? assignedRouteId === assignRoute.id : false;
                  const isAssignedElsewhere = assignedRouteId !== null && !isAssignedHere;

                  return (
                    <View style={styles.assignRow}>
                      <View style={styles.assignAvatar}>
                        <Text style={styles.assignAvatarText}>
                          {member.subject_name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.assignDriverName}>{member.subject_name}</Text>
                        <Text style={styles.assignDriverSub}>
                          {member.subject_detail} · {member.operator_name}
                        </Text>
                        {isAssignedElsewhere && (
                          <Text style={{ fontSize: 10, color: "#d97706", fontWeight: "700" }}>
                            Assigned to another route
                          </Text>
                        )}
                      </View>
                      {isAssignedHere ? (
                        <TouchableOpacity style={styles.unassignBtn}
                          onPress={() => handleUnassignDriver(member.subject_id)}>
                          <Text style={styles.unassignBtnText}>Unassign</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={[styles.assignBtn2, isAssignedElsewhere && { opacity: 0.5 }]}
                          disabled={isAssignedElsewhere}
                          onPress={() => assignRoute && handleAssignDriver(member, assignRoute)}
                        >
                          <Text style={styles.assignBtnText2}>Assign</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }}
              />
            )}

            <TouchableOpacity style={[styles.modalCancel, styles.modalCancelStandalone]} onPress={() => setShowAssignModal(false)}>
              <Text style={styles.modalCancelText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── ROUTE LIBRARY MODAL ── */}
      <Modal visible={showLibraryModal} transparent animationType="slide" onRequestClose={() => setShowLibraryModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: "85%", paddingBottom: sheetBottomPad }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Route Library</Text>
            <Text style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
              Select a route to pre-fill the canvas, then save it as your own.
            </Text>

            {/* Search bar */}
            <View style={styles.librarySearchRow}>
              <Ionicons name="search" size={16} color="#9ca3af" />
              <TextInput
                style={styles.librarySearchInput}
                placeholder="Search by name or location…"
                placeholderTextColor="#9ca3af"
                value={librarySearch}
                onChangeText={setLibrarySearch}
                autoCorrect={false}
              />
              {!!librarySearch && (
                <TouchableOpacity onPress={() => setLibrarySearch("")} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={16} color="#9ca3af" />
                </TouchableOpacity>
              )}
            </View>

            {libraryLoading ? (
              <View style={{ paddingVertical: 40, alignItems: "center" }}>
                <ActivityIndicator color="#1a4a52" size="large" />
              </View>
            ) : (() => {
              const q = librarySearch.trim().toLowerCase();
              const filtered = libraryRoutes.filter(r =>
                !q ||
                r.name.toLowerCase().includes(q) ||
                (r.from_location?.toLowerCase().includes(q)) ||
                (r.to_location?.toLowerCase().includes(q))
              );
              return filtered.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 32, gap: 8 }}>
                  <Ionicons name="map-outline" size={36} color="#d1d5db" />
                  <Text style={{ fontSize: 15, fontWeight: "800", color: "#374151" }}>
                    {q ? "No matches found" : "No routes in library yet"}
                  </Text>
                  <Text style={{ fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
                    {q ? "Try a different search term." : "Draw a route and save it — it will appear here."}
                  </Text>
                </View>
              ) : (
                <FlatList
                  style={{ flexShrink: 1 }}
                  data={filtered}
                  keyExtractor={r => String(r.id)}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item: route }) => (
                    <TouchableOpacity style={styles.libraryItem} onPress={() => startFromTemplate(route)}>
                      <View style={[styles.libraryItemColor, { backgroundColor: route.color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.libraryItemName} numberOfLines={1}>{route.name}</Text>
                        <Text style={styles.libraryItemMeta} numberOfLines={1}>
                          {route.waypoint_count} pts{route.contributor ? ` · ${route.contributor}` : ""}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
                    </TouchableOpacity>
                  )}
                />
              );
            })()}

            <TouchableOpacity style={[styles.modalCancel, styles.modalCancelStandalone]} onPress={() => setShowLibraryModal(false)}>
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  map:       { flex: 1 },
  toast:     { position: "absolute", top: 100, left: 20, right: 20, zIndex: 99, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, padding: 12 },
  toastText: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "700" },

  toolbar:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  toolbarTitle:  { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  toolbarSub:    { fontSize: 12, color: "#6b7280", marginTop: 2 },
  toolbarBtns:   { flexDirection: "row", gap: 8 },
  toolbarBtn:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: "#f3f4f6" },
  toolbarBtnText:{ fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  toolbarBtnPrimary: { backgroundColor: "#1a4a52" },

  routeInfoBar:  { position: "absolute", top: 80, left: 16, right: 16, backgroundColor: "rgba(255,255,255,0.97)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8, elevation: 3 },
  routeInfoCloseBtn:  { flexDirection: "row", alignItems: "center", gap: 3 },
  routeInfoCloseText: { fontSize: 12, fontWeight: "700", color: "#9ca3af" },
  routeColorDot: { width: 12, height: 12, borderRadius: 6 },
  routeInfoName: { flex: 1, fontSize: 13, fontWeight: "800", color: "#1a4a52" },
  routeInfoDrivers:{ fontSize: 12, color: "#6b7280" },
  assignBtn:     { flexDirection: "row", alignItems: "center", gap: 4 },
  assignBtnText: { fontSize: 12, fontWeight: "700", color: "#0369a1" },

  drawBanner:             { position: "absolute", top: 80, left: 16, right: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#fef9c3", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1.5, borderColor: "#d97706" },
  drawBannerSelected:     { backgroundColor: "#eff6ff", borderColor: "#3b82f6" },
  drawBannerText:         { fontSize: 13, fontWeight: "700", color: "#92400e" },
  drawBannerTextSelected: { color: "#1e40af" },

  colorPickerRow: { position: "absolute", bottom: 110, left: 16, flexDirection: "row", gap: 8 },
  colorDot:       { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "transparent" },
  colorDotActive: { borderColor: "#1a4a52", transform: [{ scale: 1.2 }] },

  stopoverFab: {
    position: "absolute", bottom: 110, right: 16, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#fff", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  stopoverFabText:  { fontSize: 12, fontWeight: "700", color: "#1a4a52" },
  stopoverBadge:    { backgroundColor: "#9333ea", borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  stopoverBadgeText:{ fontSize: 10, fontWeight: "800", color: "#fff" },

  choiceCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#f9fafb", borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1.5, borderColor: "#e5e7eb",
  },
  choiceCardTitle: { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  choiceCardSub:   { fontSize: 12, color: "#6b7280", marginTop: 2 },
  terminalListIcon:{ width: 30, height: 30, borderRadius: 15, backgroundColor: "#1a4a52", alignItems: "center", justifyContent: "center" },

  mapToolbar:        { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, backgroundColor: "rgba(255,255,255,0.97)" },
  mapToolBtn:        { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#f3f4f6", borderRadius: 12, paddingVertical: 12 },
  mapToolBtnPrimary: { backgroundColor: "#1a4a52" },
  mapToolBtnClear:   { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#dc2626" },
  mapToolBtnText:    { fontSize: 13, fontWeight: "700", color: "#374151" },

  waypointDot:     { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#fff" },
  waypointDotText: { fontSize: 10, fontWeight: "800", color: "#fff" },
  driverMarker:    { backgroundColor: "#fff", borderRadius: 20, padding: 8, borderWidth: 2.5, elevation: 3 },
  terminalMarker:  { backgroundColor: "#1a4a52", borderRadius: 16, padding: 6, borderWidth: 2, borderColor: "#fff", elevation: 4 },

  modalOverlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:      { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHandle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },
  modalTitle:      { fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  modalActions:    { flexDirection: "row", gap: 10, marginTop: 8 },
  modalCancel:     { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  modalCancelText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  // `modalCancel`/`modalConfirm`'s `flex: 1` is meant for the two-button `modalActions`
  // row (splits width 50/50). Reused standalone (the only child, in a plain auto-height
  // column) that same `flex: 1` collapses to zero height instead — an auto-sized parent
  // has no leftover main-axis space to grow into, so `flexBasis: 0%` just wins. This
  // override cancels the flex growth and takes full width another way instead.
  modalCancelStandalone: { flex: 0, flexBasis: "auto", width: "100%", marginTop: 12 },
  modalConfirm:    { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: "#1a4a52", alignItems: "center" },
  modalConfirmText:{ fontSize: 14, fontWeight: "800", color: "#fff" },
  fieldLabel:      { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#f9fafb" },

  routeListItem:  { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6", gap: 10 },
  routeListTopRow:{ flexDirection: "row", alignItems: "center", gap: 10 },
  routeListColor: { width: 10, height: 40, borderRadius: 5 },
  routeListName:  { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  routeListMeta:  { fontSize: 12, color: "#6b7280", marginTop: 2 },
  routeListActions:  { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  routeListBtnText:  { fontSize: 12, fontWeight: "700" },
  routeListBtn:   { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, borderRadius: 8, paddingHorizontal: 10, backgroundColor: "#f3f4f6", justifyContent: "center" },

  assignRow:       { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f9fafb", gap: 10 },
  assignAvatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1a4a52", alignItems: "center", justifyContent: "center" },
  assignAvatarText:{ fontSize: 12, fontWeight: "900", color: "#fff" },
  assignDriverName:{ fontSize: 14, fontWeight: "700", color: "#111827" },
  assignDriverSub: { fontSize: 11, color: "#9ca3af" },
  assignBtn2:      { backgroundColor: "#1a4a52", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  assignBtnText2:  { fontSize: 12, fontWeight: "800", color: "#fff" },
  unassignBtn:     { backgroundColor: "#fef2f2", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: "#fecaca" },
  unassignBtnText: { fontSize: 12, fontWeight: "700", color: "#dc2626" },

  librarySearchRow:   { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f3f4f6", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  librarySearchInput: { flex: 1, fontSize: 14, color: "#111827" },
  libraryItem:        { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  libraryItemColor:   { width: 10, height: 40, borderRadius: 5 },
  libraryItemName:    { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  libraryItemMeta:    { fontSize: 12, color: "#6b7280", marginTop: 2 },

  nameModeToggle:        { flexDirection: "row", backgroundColor: "#f3f4f6", borderRadius: 10, padding: 3, marginBottom: 16 },
  nameModeBtn:           { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  nameModeBtnActive:     { backgroundColor: "#fff", elevation: 2, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  nameModeBtnText:       { fontSize: 13, fontWeight: "700", color: "#9ca3af" },
  nameModeBtnTextActive: { color: "#1a4a52" },

  viewBanner:         { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 14, backgroundColor: "rgba(255,255,255,0.97)", borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  viewBannerColorBar: { width: 6, height: 44, borderRadius: 3 },
  viewBannerTitle:    { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  viewBannerSub:      { fontSize: 12, color: "#6b7280", marginTop: 2 },
  viewBannerClose:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "#f3f4f6" },
  viewBannerCloseText:{ fontSize: 12, fontWeight: "700", color: "#374151" },
});