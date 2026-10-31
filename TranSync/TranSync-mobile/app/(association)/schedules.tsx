import { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, RefreshControl, Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import { formatTime12h } from "../../src/utils/time";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";
import TimeField from "../../src/components/common/TimeField";

// ─── Types ────────────────────────────────────────────────────────────────────

type BusRoute = { id: number; from_location: string; to_location: string; vehicle_type: string | null };
type ServiceType = { id: number; name: string };

// UV Express daily operating window + recurrence (Core Flow 8b — the
// association-published "UV schedule" an operator activates instead of the
// operator manually creating individual book-ahead slots).
type OperatingHours = {
  id:              number;
  route_id:        number;
  route_name:      string | null;
  from_location:   string;
  to_location:     string;
  start_time:      string; // "HH:MM"
  end_time:        string; // "HH:MM"
  recurrence_type: "daily" | "weekly";
  weekdays:        number[] | null; // 0=Sun..6=Sat
  status:          "active" | "inactive";
};

// Jeepney's operating hours are purely informational — no recurrence, no
// booking window to enforce (Jeepney has no scheduled-slot booking flow).
// Commuters see it by tapping a jeepney driver marker on the map; drivers
// see it on their Dispatch tab. See routes/get_jeepney_operating_hours.php.
type JeepneyHours = {
  id:              number;
  route_id:        number;
  route_name:      string | null;
  from_location:   string;
  to_location:     string;
  start_time:      string; // "HH:MM"
  end_time:        string; // "HH:MM"
  status:          "active" | "inactive";
};

type Schedule = {
  id:                number;
  route_id:          number;
  route_name:        string | null;
  from_location:     string;
  to_location:       string;
  service_type_id:   number;
  service_type_name: string;
  boarding_time:     string; // "HH:MM"
  departure_time:    string; // "HH:MM"
  recurrence_type:   "daily" | "weekly";
  weekdays:          number[] | null; // 0=Sun..6=Sat
  status:            "active" | "inactive";
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatWeekdays(days: number[] | null): string {
  if (!days || days.length === 0) return "";
  if (days.length === 7) return "Every day";
  return days.map(d => WEEKDAY_LABELS[d]).join(", ");
}

// UI-only convenience presets over the existing recurrence_type/weekdays
// fields (0=Sun..6=Sat) — no backend/schema change needed, since "Weekdays"
// and "Weekends" are just specific weekly weekday sets and "Every Day" is
// the existing 'daily' recurrence_type.
type RecurrencePreset = "every_day" | "weekdays" | "weekends" | "custom";
const RECURRENCE_PRESETS: { key: RecurrencePreset; label: string }[] = [
  { key: "every_day", label: "Every Day" },
  { key: "weekdays",  label: "Weekdays" },
  { key: "weekends",  label: "Weekends" },
  { key: "custom",    label: "Custom" },
];

function detectRecurrencePreset(recurrence: "daily" | "weekly", weekdays: number[]): RecurrencePreset {
  if (recurrence === "daily") return "every_day";
  const sorted = [...weekdays].sort((a, b) => a - b).join(",");
  if (sorted === "1,2,3,4,5") return "weekdays";
  if (sorted === "0,6") return "weekends";
  return "custom";
}

function applyRecurrencePreset(
  preset: RecurrencePreset,
  setRecurrence: (r: "daily" | "weekly") => void,
  setSelWeekdays: (d: number[]) => void,
) {
  if (preset === "every_day") { setRecurrence("daily"); setSelWeekdays([]); return; }
  setRecurrence("weekly");
  if (preset === "weekdays") setSelWeekdays([1, 2, 3, 4, 5]);
  else if (preset === "weekends") setSelWeekdays([0, 6]);
  else setSelWeekdays([]); // "Custom" — operator picks manually below
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function SchedulesScreen() {
  const insets = useSafeAreaInsets();

  const [associationId, setAssociationId] = useState<number | null>(null);
  const [routes,         setRoutes]        = useState<BusRoute[]>([]);
  const [classes,        setClasses]       = useState<ServiceType[]>([]);
  const [schedules,      setSchedules]     = useState<Schedule[]>([]);
  const [loading,        setLoading]       = useState(true);
  const [refreshing,     setRefreshing]    = useState(false);
  const [toast,          setToast]         = useState("");

  const [activeTab, setActiveTab] = useState<"bus" | "uv" | "jeepney">("bus");

  // UV Express operating hours
  const [uvRoutes,       setUvRoutes]       = useState<BusRoute[]>([]);
  const [operatingHours, setOperatingHours] = useState<OperatingHours[]>([]);
  const [showOH,         setShowOH]         = useState(false);
  const [editingOH,      setEditingOH]      = useState<OperatingHours | null>(null);
  const [ohRouteId,      setOhRouteId]      = useState<number | null>(null);
  const [ohAllDay,       setOhAllDay]       = useState(false);
  const [ohStart,        setOhStart]        = useState("");
  const [ohEnd,          setOhEnd]          = useState("");
  const [ohRecurrence,   setOhRecurrence]   = useState<"daily" | "weekly">("daily");
  const [ohWeekdays,     setOhWeekdays]     = useState<number[]>([]);
  const [ohSubmitting,   setOhSubmitting]   = useState(false);

  // Jeepney operating hours (informational only — no recurrence)
  const [jeepneyRoutes,  setJeepneyRoutes]  = useState<BusRoute[]>([]);
  const [jeepneyHours,   setJeepneyHours]   = useState<JeepneyHours[]>([]);
  const [showJH,         setShowJH]         = useState(false);
  const [editingJH,      setEditingJH]      = useState<JeepneyHours | null>(null);
  const [jhRouteId,      setJhRouteId]      = useState<number | null>(null);
  const [jhAllDay,       setJhAllDay]       = useState(false);
  const [jhStart,        setJhStart]        = useState("");
  const [jhEnd,          setJhEnd]          = useState("");
  const [jhSubmitting,   setJhSubmitting]   = useState(false);

  // Add/Edit-schedule modal — shared form, editingSchedule set = PUT, null = POST
  const [showAdd,        setShowAdd]       = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [selRouteId,     setSelRouteId]    = useState<number | null>(null);
  const [selClassId,     setSelClassId]    = useState<number | null>(null);
  const [boardingTime,   setBoardingTime]  = useState("");
  const [departureTime,  setDepartureTime] = useState("");
  const [recurrence,     setRecurrence]    = useState<"daily" | "weekly">("daily");
  const [selWeekdays,    setSelWeekdays]   = useState<number[]>([]);
  const [submitting,     setSubmitting]    = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) return;
      const u = JSON.parse(raw);
      setAssociationId(u.id);
      loadAll(u.id);
    })();
  }, []);

  const loadAll = async (assocId: number, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [routesRes, classesRes, schedRes, ohRes, jhRes] = await Promise.all([
        fetch(`${API_BASE}/routes/get_association_routes.php?association_id=${assocId}`),
        fetch(`${API_BASE}/associations/service_types.php?association_id=${assocId}`),
        fetch(`${API_BASE}/associations/bus_schedules.php?association_id=${assocId}`),
        fetch(`${API_BASE}/associations/uv_operating_hours.php?association_id=${assocId}`),
        fetch(`${API_BASE}/associations/jeepney_operating_hours.php?association_id=${assocId}`),
      ]);
      const routesData = await routesRes.json();
      const classesData = await classesRes.json();
      const schedData   = await schedRes.json();
      const ohData      = await ohRes.json();
      const jhData      = await jhRes.json();
      const allRoutes: BusRoute[] = Array.isArray(routesData.routes) ? routesData.routes : [];
      setRoutes(allRoutes.filter(r => r.vehicle_type === "Bus"));
      setUvRoutes(allRoutes.filter(r => r.vehicle_type === "UV Express"));
      setJeepneyRoutes(allRoutes.filter(r => r.vehicle_type === "Jeepney"));
      setClasses(Array.isArray(classesData.service_types) ? classesData.service_types : []);
      setSchedules(Array.isArray(schedData.schedules) ? schedData.schedules : []);
      setOperatingHours(Array.isArray(ohData.operating_hours) ? ohData.operating_hours : []);
      setJeepneyHours(Array.isArray(jhData.operating_hours) ? jhData.operating_hours : []);
    } catch { /* keep prior state on network failure */ }
    finally { setLoading(false); setRefreshing(false); }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const openAdd = () => {
    setEditingSchedule(null);
    setSelRouteId(routes[0]?.id ?? null);
    setSelClassId(classes[0]?.id ?? null);
    setBoardingTime("");
    setDepartureTime("");
    setRecurrence("daily");
    setSelWeekdays([]);
    setShowAdd(true);
  };

  const openEdit = (sched: Schedule) => {
    setEditingSchedule(sched);
    setSelRouteId(sched.route_id);
    setSelClassId(sched.service_type_id);
    setBoardingTime(sched.boarding_time);
    setDepartureTime(sched.departure_time);
    setRecurrence(sched.recurrence_type);
    setSelWeekdays(sched.weekdays ?? []);
    setShowAdd(true);
  };

  const toggleWeekday = (d: number) => {
    setSelWeekdays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  };

  const validTime = (t: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t.trim());
  // Comparing "5:00" >= "21:00" as raw strings is true (byte-by-byte: '5' >
  // '2') — the HH:MM format allows a non-zero-padded hour, so any ordering
  // check must compare actual minutes-since-midnight, not the strings.
  const timeToMinutes = (t: string) => {
    const [h, m] = t.trim().split(":").map(Number);
    return h * 60 + m;
  };

  const handleSubmit = async () => {
    if (!associationId) return;
    if (!selRouteId) { showToast("Select a route."); return; }
    if (!selClassId) { showToast("Select a class."); return; }
    if (!validTime(boardingTime)) { showToast("Select a boarding time."); return; }
    if (!validTime(departureTime)) { showToast("Select a departure time."); return; }
    if (recurrence === "weekly" && selWeekdays.length === 0) { showToast("Select at least one day of the week."); return; }

    setSubmitting(true);
    try {
      const res  = await fetch(`${API_BASE}/associations/bus_schedules.php`, {
        method: editingSchedule ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingSchedule ? { id: editingSchedule.id } : {}),
          association_id:   associationId,
          route_id:         selRouteId,
          service_type_id:  selClassId,
          boarding_time:    boardingTime.trim(),
          departure_time:   departureTime.trim(),
          recurrence_type:  recurrence,
          weekdays:         recurrence === "weekly" ? selWeekdays : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowAdd(false);
        setEditingSchedule(null);
        loadAll(associationId);
        showToast(editingSchedule ? "Schedule updated!" : "Schedule created!");
      } else {
        showToast(data.message ?? `Failed to ${editingSchedule ? "update" : "create"} schedule.`);
      }
    } catch { showToast("Network error."); }
    finally { setSubmitting(false); }
  };

  const handleToggleStatus = async (sched: Schedule) => {
    if (!associationId) return;
    const next = sched.status === "active" ? "inactive" : "active";
    try {
      await fetch(`${API_BASE}/associations/bus_schedules.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sched.id, association_id: associationId, status: next }),
      });
      setSchedules(prev => prev.map(s => s.id === sched.id ? { ...s, status: next } : s));
      showToast(`Schedule marked ${next}.`);
    } catch { showToast("Failed to update status."); }
  };

  const handleDelete = (sched: Schedule) => {
    Alert.alert(
      "Delete Schedule",
      `Delete the ${formatTime12h(sched.boarding_time)} boarding / ${formatTime12h(sched.departure_time)} departure schedule for "${sched.from_location} → ${sched.to_location}"?\nOperators will no longer be able to create new trips from it.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
          if (!associationId) return;
          try {
            await fetch(`${API_BASE}/associations/bus_schedules.php`, {
              method: "DELETE", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: sched.id, association_id: associationId }),
            });
            setSchedules(prev => prev.filter(s => s.id !== sched.id));
            showToast("Schedule deleted.");
          } catch { showToast("Failed to delete schedule."); }
        }},
      ]
    );
  };

  // ── UV Express operating hours ─────────────────────────────────────────────
  const openAddOH = (route: BusRoute) => {
    setEditingOH(null);
    setOhRouteId(route.id);
    setOhAllDay(false);
    setOhStart("");
    setOhEnd("");
    setOhRecurrence("daily");
    setOhWeekdays([]);
    setShowOH(true);
  };

  const openEditOH = (oh: OperatingHours) => {
    setEditingOH(oh);
    setOhRouteId(oh.route_id);
    setOhAllDay(oh.start_time === "00:00" && oh.end_time === "23:59");
    setOhStart(oh.start_time);
    setOhEnd(oh.end_time);
    setOhRecurrence(oh.recurrence_type);
    setOhWeekdays(oh.weekdays ?? []);
    setShowOH(true);
  };

  const toggleOhWeekday = (d: number) => {
    setOhWeekdays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  };

  const handleSubmitOH = async () => {
    if (!associationId || !ohRouteId) return;
    // "24 Hours" bypasses manual entry entirely — 12:00 AM to 11:59 PM.
    const start = ohAllDay ? "00:00" : ohStart.trim();
    const end   = ohAllDay ? "23:59" : ohEnd.trim();
    if (!ohAllDay) {
      if (!validTime(start)) { showToast("Select an operations start time."); return; }
      if (!validTime(end)) { showToast("Select an operations end time."); return; }
      // UV Express runs 24 hours, so an overnight window (e.g. 11:00 PM -> 2:00
      // AM the next day) is valid — only a zero-duration window is rejected.
      if (timeToMinutes(start) === timeToMinutes(end)) { showToast("Start time and end time cannot be the same."); return; }
    }
    if (ohRecurrence === "weekly" && ohWeekdays.length === 0) { showToast("Select at least one day of the week."); return; }

    setOhSubmitting(true);
    try {
      const res  = await fetch(`${API_BASE}/associations/uv_operating_hours.php`, {
        method: editingOH ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingOH ? { id: editingOH.id } : {}),
          association_id:  associationId,
          route_id:        ohRouteId,
          start_time:      start,
          end_time:        end,
          recurrence_type: ohRecurrence,
          weekdays:        ohRecurrence === "weekly" ? ohWeekdays : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowOH(false);
        setEditingOH(null);
        loadAll(associationId);
        showToast(editingOH ? "Operating hours updated!" : "Operating hours set!");
      } else {
        showToast(data.message ?? `Failed to ${editingOH ? "update" : "set"} operating hours.`);
      }
    } catch { showToast("Network error."); }
    finally { setOhSubmitting(false); }
  };

  const handleToggleOH = async (oh: OperatingHours) => {
    if (!associationId) return;
    const next = oh.status === "active" ? "inactive" : "active";
    try {
      await fetch(`${API_BASE}/associations/uv_operating_hours.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: oh.id, association_id: associationId, status: next }),
      });
      setOperatingHours(prev => prev.map(h => h.id === oh.id ? { ...h, status: next } : h));
      showToast(`Operating hours marked ${next}.`);
    } catch { showToast("Failed to update status."); }
  };

  const handleDeleteOH = (oh: OperatingHours) => {
    Alert.alert(
      "Remove Operating Hours",
      `Remove the ${formatTime12h(oh.start_time)}–${formatTime12h(oh.end_time)} operating window for "${oh.from_location} → ${oh.to_location}"?\nThe route will have no booking-time restriction afterward.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: async () => {
          if (!associationId) return;
          try {
            await fetch(`${API_BASE}/associations/uv_operating_hours.php`, {
              method: "DELETE", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: oh.id, association_id: associationId }),
            });
            setOperatingHours(prev => prev.filter(h => h.id !== oh.id));
            showToast("Operating hours removed.");
          } catch { showToast("Failed to remove operating hours."); }
        }},
      ]
    );
  };

  // Routes that don't have an operating-hours row yet — offered in "Set Hours"
  const uvRoutesWithoutHours = uvRoutes.filter(r => !operatingHours.some(h => h.route_id === r.id));

  // ── Jeepney operating hours (informational only) ───────────────────────────
  const openAddJH = (route: BusRoute) => {
    setEditingJH(null);
    setJhRouteId(route.id);
    setJhAllDay(false);
    setJhStart("");
    setJhEnd("");
    setShowJH(true);
  };

  const openEditJH = (jh: JeepneyHours) => {
    setEditingJH(jh);
    setJhRouteId(jh.route_id);
    setJhAllDay(jh.start_time === "00:00" && jh.end_time === "23:59");
    setJhStart(jh.start_time);
    setJhEnd(jh.end_time);
    setShowJH(true);
  };

  const handleSubmitJH = async () => {
    if (!associationId || !jhRouteId) return;
    // "24 Hours" bypasses manual entry entirely — 12:00 AM to 11:59 PM.
    const start = jhAllDay ? "00:00" : jhStart.trim();
    const end   = jhAllDay ? "23:59" : jhEnd.trim();
    if (!jhAllDay) {
      if (!validTime(start)) { showToast("Select an operations start time."); return; }
      if (!validTime(end)) { showToast("Select an operations end time."); return; }
      if (timeToMinutes(start) === timeToMinutes(end)) { showToast("Start time and end time cannot be the same."); return; }
    }

    setJhSubmitting(true);
    try {
      const res  = await fetch(`${API_BASE}/associations/jeepney_operating_hours.php`, {
        method: editingJH ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingJH ? { id: editingJH.id } : {}),
          association_id: associationId,
          route_id:       jhRouteId,
          start_time:     start,
          end_time:       end,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowJH(false);
        setEditingJH(null);
        loadAll(associationId);
        showToast(editingJH ? "Operating hours updated!" : "Operating hours set!");
      } else {
        showToast(data.message ?? `Failed to ${editingJH ? "update" : "set"} operating hours.`);
      }
    } catch { showToast("Network error."); }
    finally { setJhSubmitting(false); }
  };

  const handleToggleJH = async (jh: JeepneyHours) => {
    if (!associationId) return;
    const next = jh.status === "active" ? "inactive" : "active";
    try {
      await fetch(`${API_BASE}/associations/jeepney_operating_hours.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: jh.id, association_id: associationId, status: next }),
      });
      setJeepneyHours(prev => prev.map(h => h.id === jh.id ? { ...h, status: next } : h));
      showToast(`Operating hours marked ${next}.`);
    } catch { showToast("Failed to update status."); }
  };

  const handleDeleteJH = (jh: JeepneyHours) => {
    Alert.alert(
      "Remove Operating Hours",
      `Remove the ${formatTime12h(jh.start_time)}–${formatTime12h(jh.end_time)} operating hours for "${jh.from_location} → ${jh.to_location}"?\nCommuters and drivers will no longer see published hours for this route.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: async () => {
          if (!associationId) return;
          try {
            await fetch(`${API_BASE}/associations/jeepney_operating_hours.php`, {
              method: "DELETE", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: jh.id, association_id: associationId }),
            });
            setJeepneyHours(prev => prev.filter(h => h.id !== jh.id));
            showToast("Operating hours removed.");
          } catch { showToast("Failed to remove operating hours."); }
        }},
      ]
    );
  };

  // Routes that don't have operating hours published yet — offered in "Set Hours"
  const jeepneyRoutesWithoutHours = jeepneyRoutes.filter(r => !jeepneyHours.some(h => h.route_id === r.id));

  // ── Render ───────────────────────────────────────────────────────────────────
  // No association_type gate anymore — an association can publish Bus routes
  // alongside Jeepney/UV Express ones, so this screen is always reachable;
  // the empty states below already handle "no Bus routes/classes yet."

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {toast !== "" && (
        <View style={[s.toast, { top: insets.top + 80 }]}>
          <Ionicons name="checkmark-circle" size={14} color="#a8d832" />
          <Text style={s.toastText}>{toast}</Text>
        </View>
      )}

      <View style={s.header}>
        <View style={s.headerIcon}>
          <Ionicons name="calendar-outline" size={20} color="#2563eb" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Schedules</Text>
          <Text style={s.headerSub}>
            {activeTab === "bus"
              ? "Recurring trip templates for your operators"
              : activeTab === "uv"
                ? "Daily booking window for your UV Express routes"
                : "Daily operating hours shown to commuters and drivers"}
          </Text>
        </View>
        {activeTab === "bus" && (
          <TouchableOpacity style={s.addBtn} onPress={openAdd}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={s.addBtnText}>New</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.tabRow}>
        <TouchableOpacity
          style={[s.tabBtn, activeTab === "bus" && s.tabBtnActive]}
          onPress={() => setActiveTab("bus")}
        >
          <Text style={[s.tabBtnText, activeTab === "bus" && s.tabBtnTextActive]}>Bus Schedules</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, activeTab === "uv" && s.tabBtnActive]}
          onPress={() => setActiveTab("uv")}
        >
          <Text style={[s.tabBtnText, activeTab === "uv" && s.tabBtnTextActive]}>UV Operating Hours</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, activeTab === "jeepney" && s.tabBtnActive]}
          onPress={() => setActiveTab("jeepney")}
        >
          <Text style={[s.tabBtnText, activeTab === "jeepney" && s.tabBtnTextActive]}>Jeepney Hours</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => associationId && loadAll(associationId, true)}
              colors={["#2563eb"]}
              tintColor="#2563eb"
            />
          }
        >
          {activeTab === "bus" && (<>
          <Text style={s.inputHint}>
            A schedule sets the route, class, boarding time, and departure time. Operators in
            your association still pick a vehicle + driver and a specific date to actually
            schedule a bookable trip from it.
          </Text>

          {schedules.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
              <Text style={s.emptyTitle}>No schedules yet</Text>
              <Text style={s.emptySub}>
                {routes.length === 0
                  ? "Create a Bus route first (Routes tab), then add a schedule here."
                  : classes.length === 0
                    ? "Add a class first (Fares tab → Classes), then add a schedule here."
                    : "Tap \"New\" to create your first recurring schedule."}
              </Text>
            </View>
          ) : (
            schedules.map(sched => (
              <View key={sched.id} style={s.card}>
                <View style={[s.cardBar, { backgroundColor: "#2563eb" }]} />
                <View style={s.cardBody}>

                  <View style={s.ptpRow}>
                    <View style={s.ptpStop}>
                      <View style={[s.ptpDot, { backgroundColor: "#2563eb" }]} />
                      <Text style={s.ptpText} numberOfLines={2}>{sched.from_location}</Text>
                    </View>
                    <View style={s.ptpMid}>
                      <View style={s.ptpLine} />
                      <Ionicons name="arrow-forward-circle" size={22} color="#a8d832" />
                      <View style={s.ptpLine} />
                    </View>
                    <View style={s.ptpStop}>
                      <View style={[s.ptpDot, { backgroundColor: "#a8d832" }]} />
                      <Text style={s.ptpTextDest} numberOfLines={2}>{sched.to_location}</Text>
                    </View>
                  </View>

                  <View style={s.metaRow}>
                    <View style={s.classChip}>
                      <Ionicons name="ribbon" size={12} color="#2563eb" />
                      <Text style={s.classChipText}>{sched.service_type_name}</Text>
                    </View>
                    <View style={s.recurChip}>
                      <Ionicons name={sched.recurrence_type === "daily" ? "repeat" : "calendar"} size={12} color="#6b7280" />
                      <Text style={s.recurChipText}>
                        {sched.recurrence_type === "daily" ? "Every day" : formatWeekdays(sched.weekdays)}
                      </Text>
                    </View>
                  </View>

                  <View style={s.timeRow}>
                    <View style={s.timeBox}>
                      <Text style={s.timeTag}>BOARDING</Text>
                      <Text style={s.timeValue}>{formatTime12h(sched.boarding_time)}</Text>
                    </View>
                    <Ionicons name="arrow-forward" size={14} color="#d1d5db" />
                    <View style={s.timeBox}>
                      <Text style={s.timeTag}>DEPARTURE</Text>
                      <Text style={s.timeValue}>{formatTime12h(sched.departure_time)}</Text>
                    </View>
                  </View>

                  <View style={s.cardFooter}>
                    <TouchableOpacity
                      style={[s.statusBtn, { backgroundColor: sched.status === "active" ? "#f0fdf4" : "#fef2f2" }]}
                      onPress={() => handleToggleStatus(sched)}
                      activeOpacity={0.8}
                    >
                      <View style={[s.statusDot, { backgroundColor: sched.status === "active" ? "#16a34a" : "#dc2626" }]} />
                      <Text style={[s.statusText, { color: sched.status === "active" ? "#16a34a" : "#dc2626" }]}>
                        {sched.status === "active" ? "Active — operators can use this" : "Inactive — hidden from operators"}
                      </Text>
                      <Ionicons name="swap-horizontal-outline" size={12} color={sched.status === "active" ? "#16a34a" : "#dc2626"} />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.editBtn} onPress={() => openEdit(sched)} activeOpacity={0.8}>
                      <Ionicons name="create-outline" size={15} color="#2563eb" />
                      <Text style={s.editBtnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.deleteBtn} onPress={() => handleDelete(sched)} activeOpacity={0.8}>
                      <Ionicons name="trash-outline" size={15} color="#ef4444" />
                      <Text style={s.deleteBtnText}>Delete</Text>
                    </TouchableOpacity>
                  </View>

                </View>
              </View>
            ))
          )}
          </>)}

          {activeTab === "uv" && (<>
          <Text style={s.inputHint}>
            Set a daily start-of-operations / end-of-operations window per UV Express route.
            Commuters can only book (scheduled slot or live walk-up) inside that window; a route
            with no hours set has no restriction.
          </Text>

          {uvRoutes.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="time-outline" size={48} color="#d1d5db" />
              <Text style={s.emptyTitle}>No UV Express routes yet</Text>
              <Text style={s.emptySub}>Create a UV Express route first (Routes tab), then set its operating hours here.</Text>
            </View>
          ) : (
            <>
              {operatingHours.map(oh => (
                <View key={oh.id} style={s.card}>
                  <View style={[s.cardBar, { backgroundColor: "#7c3aed" }]} />
                  <View style={s.cardBody}>

                    <View style={s.ptpRow}>
                      <View style={s.ptpStop}>
                        <View style={[s.ptpDot, { backgroundColor: "#7c3aed" }]} />
                        <Text style={[s.ptpText, { color: "#7c3aed" }]} numberOfLines={2}>{oh.from_location}</Text>
                      </View>
                      <View style={s.ptpMid}>
                        <View style={s.ptpLine} />
                        <Ionicons name="arrow-forward-circle" size={22} color="#a8d832" />
                        <View style={s.ptpLine} />
                      </View>
                      <View style={s.ptpStop}>
                        <View style={[s.ptpDot, { backgroundColor: "#a8d832" }]} />
                        <Text style={s.ptpTextDest} numberOfLines={2}>{oh.to_location}</Text>
                      </View>
                    </View>

                    <View style={s.metaRow}>
                      <View style={[s.recurChip, { backgroundColor: "#faf5ff" }]}>
                        <Ionicons name={oh.recurrence_type === "daily" ? "repeat" : "calendar"} size={12} color="#7c3aed" />
                        <Text style={[s.recurChipText, { color: "#7c3aed" }]}>
                          {oh.recurrence_type === "daily" ? "Every day" : formatWeekdays(oh.weekdays)}
                        </Text>
                      </View>
                    </View>

                    <View style={s.timeRow}>
                      <View style={s.timeBox}>
                        <Text style={s.timeTag}>OPERATIONS START</Text>
                        <Text style={s.timeValue}>{formatTime12h(oh.start_time)}</Text>
                      </View>
                      <Ionicons name="arrow-forward" size={14} color="#d1d5db" />
                      <View style={s.timeBox}>
                        <Text style={s.timeTag}>OPERATIONS END</Text>
                        <Text style={s.timeValue}>
                          {formatTime12h(oh.end_time)}
                          {oh.end_time < oh.start_time ? " (+1 day)" : ""}
                        </Text>
                      </View>
                    </View>

                    <View style={s.cardFooter}>
                      <TouchableOpacity
                        style={[s.statusBtn, { backgroundColor: oh.status === "active" ? "#f0fdf4" : "#fef2f2" }]}
                        onPress={() => handleToggleOH(oh)}
                        activeOpacity={0.8}
                      >
                        <View style={[s.statusDot, { backgroundColor: oh.status === "active" ? "#16a34a" : "#dc2626" }]} />
                        <Text style={[s.statusText, { color: oh.status === "active" ? "#16a34a" : "#dc2626" }]}>
                          {oh.status === "active" ? "Active — enforced for commuters" : "Inactive — no restriction"}
                        </Text>
                        <Ionicons name="swap-horizontal-outline" size={12} color={oh.status === "active" ? "#16a34a" : "#dc2626"} />
                      </TouchableOpacity>
                      <TouchableOpacity style={s.editBtn} onPress={() => openEditOH(oh)} activeOpacity={0.8}>
                        <Ionicons name="create-outline" size={15} color="#2563eb" />
                        <Text style={s.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.deleteBtn} onPress={() => handleDeleteOH(oh)} activeOpacity={0.8}>
                        <Ionicons name="trash-outline" size={15} color="#ef4444" />
                        <Text style={s.deleteBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </View>

                  </View>
                </View>
              ))}

              {uvRoutesWithoutHours.map(route => (
                <View key={route.id} style={s.noHoursCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.noHoursRouteText}>{route.from_location} → {route.to_location}</Text>
                    <Text style={s.noHoursSub}>No operating hours set — bookable any time.</Text>
                  </View>
                  <TouchableOpacity style={s.setHoursBtn} onPress={() => openAddOH(route)}>
                    <Ionicons name="add" size={14} color="#fff" />
                    <Text style={s.setHoursBtnText}>Set Hours</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
          </>)}

          {activeTab === "jeepney" && (<>
          <Text style={s.inputHint}>
            Set daily operating hours per Jeepney route for commuters and drivers to see. This is
            purely informational — Jeepney fares stay cash, off-app, and nothing here restricts when
            a commuter can ride or a driver can dispatch.
          </Text>

          {jeepneyRoutes.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="time-outline" size={48} color="#d1d5db" />
              <Text style={s.emptyTitle}>No Jeepney routes yet</Text>
              <Text style={s.emptySub}>Create a Jeepney route first (Routes tab), then set its operating hours here.</Text>
            </View>
          ) : (
            <>
              {jeepneyHours.map(jh => (
                <View key={jh.id} style={s.card}>
                  <View style={[s.cardBar, { backgroundColor: "#16a34a" }]} />
                  <View style={s.cardBody}>

                    <View style={s.ptpRow}>
                      <View style={s.ptpStop}>
                        <View style={[s.ptpDot, { backgroundColor: "#16a34a" }]} />
                        <Text style={[s.ptpText, { color: "#16a34a" }]} numberOfLines={2}>{jh.from_location}</Text>
                      </View>
                      <View style={s.ptpMid}>
                        <View style={s.ptpLine} />
                        <Ionicons name="arrow-forward-circle" size={22} color="#a8d832" />
                        <View style={s.ptpLine} />
                      </View>
                      <View style={s.ptpStop}>
                        <View style={[s.ptpDot, { backgroundColor: "#a8d832" }]} />
                        <Text style={s.ptpTextDest} numberOfLines={2}>{jh.to_location}</Text>
                      </View>
                    </View>

                    <View style={s.timeRow}>
                      <View style={s.timeBox}>
                        <Text style={s.timeTag}>OPERATIONS START</Text>
                        <Text style={s.timeValue}>{formatTime12h(jh.start_time)}</Text>
                      </View>
                      <Ionicons name="arrow-forward" size={14} color="#d1d5db" />
                      <View style={s.timeBox}>
                        <Text style={s.timeTag}>OPERATIONS END</Text>
                        <Text style={s.timeValue}>
                          {formatTime12h(jh.end_time)}
                          {jh.end_time < jh.start_time ? " (+1 day)" : ""}
                        </Text>
                      </View>
                    </View>

                    <View style={s.cardFooter}>
                      <TouchableOpacity
                        style={[s.statusBtn, { backgroundColor: jh.status === "active" ? "#f0fdf4" : "#fef2f2" }]}
                        onPress={() => handleToggleJH(jh)}
                        activeOpacity={0.8}
                      >
                        <View style={[s.statusDot, { backgroundColor: jh.status === "active" ? "#16a34a" : "#dc2626" }]} />
                        <Text style={[s.statusText, { color: jh.status === "active" ? "#16a34a" : "#dc2626" }]}>
                          {jh.status === "active" ? "Active — visible to commuters & drivers" : "Inactive — hidden"}
                        </Text>
                        <Ionicons name="swap-horizontal-outline" size={12} color={jh.status === "active" ? "#16a34a" : "#dc2626"} />
                      </TouchableOpacity>
                      <TouchableOpacity style={s.editBtn} onPress={() => openEditJH(jh)} activeOpacity={0.8}>
                        <Ionicons name="create-outline" size={15} color="#2563eb" />
                        <Text style={s.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.deleteBtn} onPress={() => handleDeleteJH(jh)} activeOpacity={0.8}>
                        <Ionicons name="trash-outline" size={15} color="#ef4444" />
                        <Text style={s.deleteBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </View>

                  </View>
                </View>
              ))}

              {jeepneyRoutesWithoutHours.map(route => (
                <View key={route.id} style={s.noHoursCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.noHoursRouteText}>{route.from_location} → {route.to_location}</Text>
                    <Text style={s.noHoursSub}>No operating hours set yet.</Text>
                  </View>
                  <TouchableOpacity style={[s.setHoursBtn, { backgroundColor: "#16a34a" }]} onPress={() => openAddJH(route)}>
                    <Ionicons name="add" size={14} color="#fff" />
                    <Text style={s.setHoursBtnText}>Set Hours</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
          </>)}
        </ScrollView>
      )}

      {/* ══ ADD/EDIT SCHEDULE MODAL ══ */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => { setShowAdd(false); setEditingSchedule(null); }}>
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <View style={s.handle} />
            <KeyboardAwareForm showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={s.sheetTitle}>{editingSchedule ? "Edit Schedule" : "New Schedule"}</Text>

              <Text style={s.fieldLabel}>Route</Text>
              {routes.length === 0 ? (
                <Text style={s.inputHint}>No Bus routes yet — create one in the Routes tab first.</Text>
              ) : (
                <View style={s.pickerWrap}>
                  {routes.map(r => (
                    <TouchableOpacity
                      key={r.id}
                      style={[s.pickerRow, selRouteId === r.id && s.pickerRowActive]}
                      onPress={() => setSelRouteId(r.id)}
                    >
                      <Text style={[s.pickerRowText, selRouteId === r.id && s.pickerRowTextActive]}>
                        {r.from_location} → {r.to_location}
                      </Text>
                      {selRouteId === r.id && <Ionicons name="checkmark-circle" size={18} color="#2563eb" />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={s.fieldLabel}>Class</Text>
              {classes.length === 0 ? (
                <Text style={s.inputHint}>No classes yet — add one in the Fares tab → Classes first.</Text>
              ) : (
                <View style={s.pickerWrap}>
                  {classes.map(c => (
                    <TouchableOpacity
                      key={c.id}
                      style={[s.pickerRow, selClassId === c.id && s.pickerRowActive]}
                      onPress={() => setSelClassId(c.id)}
                    >
                      <Text style={[s.pickerRowText, selClassId === c.id && s.pickerRowTextActive]}>{c.name}</Text>
                      {selClassId === c.id && <Ionicons name="checkmark-circle" size={18} color="#2563eb" />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <TimeField label="Boarding Time" value={boardingTime} onChange={setBoardingTime} />
                </View>
                <View style={{ flex: 1 }}>
                  <TimeField label="Departure Time" value={departureTime} onChange={setDepartureTime} />
                </View>
              </View>

              <Text style={s.fieldLabel}>Recurrence</Text>
              <View style={s.nameModeToggle}>
                {RECURRENCE_PRESETS.map((preset) => {
                  const active = detectRecurrencePreset(recurrence, selWeekdays) === preset.key;
                  return (
                    <TouchableOpacity
                      key={preset.key}
                      style={[s.nameModeBtn, active && s.nameModeBtnActive]}
                      onPress={() => applyRecurrencePreset(preset.key, setRecurrence, setSelWeekdays)}
                    >
                      <Text style={[s.nameModeBtnText, active && s.nameModeBtnTextActive]}>{preset.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {recurrence === "weekly" && (
                <View style={s.weekdayRow}>
                  {WEEKDAY_LABELS.map((label, idx) => {
                    const checked = selWeekdays.includes(idx);
                    return (
                      <TouchableOpacity
                        key={idx}
                        style={[s.weekdayChip, checked && s.weekdayChipActive]}
                        onPress={() => toggleWeekday(idx)}
                      >
                        <Text style={[s.weekdayChipText, checked && s.weekdayChipTextActive]}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <View style={[s.sheetActions, { marginTop: 20 }]}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => { setShowAdd(false); setEditingSchedule(null); }}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.saveBtn, { backgroundColor: "#2563eb" }, submitting && { opacity: 0.6 }]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.saveBtnText}>{editingSchedule ? "Save Changes" : "Create Schedule"}</Text>}
                </TouchableOpacity>
              </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ══ SET/EDIT UV OPERATING HOURS MODAL ══ */}
      <Modal visible={showOH} transparent animationType="slide" onRequestClose={() => { setShowOH(false); setEditingOH(null); }}>
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={s.handle} />
            <Text style={s.sheetTitle}>{editingOH ? "Edit Operating Hours" : "Set Operating Hours"}</Text>
            {(() => {
              const route = editingOH
                ? { from_location: editingOH.from_location, to_location: editingOH.to_location }
                : uvRoutes.find(r => r.id === ohRouteId);
              return route ? (
                <Text style={s.inputHint}>
                  Route: <Text style={{ fontWeight: "800", color: "#374151" }}>{route.from_location} → {route.to_location}</Text>
                </Text>
              ) : null;
            })()}

            <Text style={s.fieldLabel}>Operating Hours</Text>
            <View style={s.nameModeToggle}>
              <TouchableOpacity
                style={[s.nameModeBtn, ohAllDay && { backgroundColor: "#7c3aed" }]}
                onPress={() => setOhAllDay(true)}
              >
                <Text style={[s.nameModeBtnText, ohAllDay && s.nameModeBtnTextActive]}>24 Hours</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.nameModeBtn, !ohAllDay && { backgroundColor: "#7c3aed" }]}
                onPress={() => setOhAllDay(false)}
              >
                <Text style={[s.nameModeBtnText, !ohAllDay && s.nameModeBtnTextActive]}>Set Specific Hours</Text>
              </TouchableOpacity>
            </View>

            {ohAllDay ? (
              <Text style={s.inputHint}>Bookable all day — 12:00 AM to 11:59 PM.</Text>
            ) : (
              <>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TimeField label="Operations Start" value={ohStart} onChange={setOhStart} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TimeField label="Operations End" value={ohEnd} onChange={setOhEnd} />
                  </View>
                </View>
                <Text style={s.inputHint}>Commuters can only book within this window.</Text>
              </>
            )}

            <Text style={s.fieldLabel}>Recurrence</Text>
            <View style={s.nameModeToggle}>
              <TouchableOpacity
                style={[s.nameModeBtn, ohRecurrence === "daily" && { backgroundColor: "#7c3aed" }]}
                onPress={() => setOhRecurrence("daily")}
              >
                <Text style={[s.nameModeBtnText, ohRecurrence === "daily" && s.nameModeBtnTextActive]}>Daily</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.nameModeBtn, ohRecurrence === "weekly" && { backgroundColor: "#7c3aed" }]}
                onPress={() => setOhRecurrence("weekly")}
              >
                <Text style={[s.nameModeBtnText, ohRecurrence === "weekly" && s.nameModeBtnTextActive]}>Specific Days</Text>
              </TouchableOpacity>
            </View>

            {ohRecurrence === "weekly" && (
              <View style={s.weekdayRow}>
                {WEEKDAY_LABELS.map((label, idx) => {
                  const checked = ohWeekdays.includes(idx);
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[s.weekdayChip, checked && { borderColor: "#7c3aed", backgroundColor: "#7c3aed" }]}
                      onPress={() => toggleOhWeekday(idx)}
                    >
                      <Text style={[s.weekdayChipText, checked && s.weekdayChipTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <View style={[s.sheetActions, { marginTop: 12 }]}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setShowOH(false); setEditingOH(null); }}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, { backgroundColor: "#7c3aed" }, ohSubmitting && { opacity: 0.6 }]}
                onPress={handleSubmitOH}
                disabled={ohSubmitting}
              >
                {ohSubmitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.saveBtnText}>{editingOH ? "Save Changes" : "Set Hours"}</Text>}
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ══ SET/EDIT JEEPNEY OPERATING HOURS MODAL ══ */}
      <Modal visible={showJH} transparent animationType="slide" onRequestClose={() => { setShowJH(false); setEditingJH(null); }}>
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={s.handle} />
            <Text style={s.sheetTitle}>{editingJH ? "Edit Operating Hours" : "Set Operating Hours"}</Text>
            {(() => {
              const route = editingJH
                ? { from_location: editingJH.from_location, to_location: editingJH.to_location }
                : jeepneyRoutes.find(r => r.id === jhRouteId);
              return route ? (
                <Text style={s.inputHint}>
                  Route: <Text style={{ fontWeight: "800", color: "#374151" }}>{route.from_location} → {route.to_location}</Text>
                </Text>
              ) : null;
            })()}

            <Text style={s.fieldLabel}>Operating Hours</Text>
            <View style={s.nameModeToggle}>
              <TouchableOpacity
                style={[s.nameModeBtn, jhAllDay && { backgroundColor: "#16a34a" }]}
                onPress={() => setJhAllDay(true)}
              >
                <Text style={[s.nameModeBtnText, jhAllDay && s.nameModeBtnTextActive]}>24 Hours</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.nameModeBtn, !jhAllDay && { backgroundColor: "#16a34a" }]}
                onPress={() => setJhAllDay(false)}
              >
                <Text style={[s.nameModeBtnText, !jhAllDay && s.nameModeBtnTextActive]}>Set Specific Hours</Text>
              </TouchableOpacity>
            </View>

            {jhAllDay ? (
              <Text style={s.inputHint}>Runs all day — 12:00 AM to 11:59 PM.</Text>
            ) : (
              <>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TimeField label="Operations Start" value={jhStart} onChange={setJhStart} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TimeField label="Operations End" value={jhEnd} onChange={setJhEnd} />
                  </View>
                </View>
                <Text style={s.inputHint}>Shown to commuters and drivers only — booking and dispatch are unaffected.</Text>
              </>
            )}

            <View style={[s.sheetActions, { marginTop: 12 }]}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setShowJH(false); setEditingJH(null); }}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, { backgroundColor: "#16a34a" }, jhSubmitting && { opacity: 0.6 }]}
                onPress={handleSubmitJH}
                disabled={jhSubmitting}
              >
                {jhSubmitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.saveBtnText}>{editingJH ? "Save Changes" : "Set Hours"}</Text>}
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f9fafb" },

  toast:     { position: "absolute", top: 100, left: 20, right: 20, zIndex: 99, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, padding: 12 },
  toastText: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "700" },

  header:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#eff6ff" },
  headerIcon:  { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#eff6ff" },
  headerTitle: { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  headerSub:   { fontSize: 12, fontWeight: "600", color: "#6b7280", marginTop: 1 },
  addBtn:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#2563eb", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  addBtnText:  { fontSize: 13, fontWeight: "800", color: "#fff" },

  tabRow:     { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#eff6ff" },
  tabBtn:     { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, backgroundColor: "#f1f5f9" },
  tabBtnActive: { backgroundColor: "#2563eb" },
  tabBtnText: { fontSize: 12, fontWeight: "800", color: "#6b7280" },
  tabBtnTextActive: { color: "#fff" },

  noHoursCard:    { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1.5, borderColor: "#f1f5f9", padding: 14 },
  noHoursRouteText: { fontSize: 13, fontWeight: "800", color: "#374151" },
  noHoursSub:     { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  setHoursBtn:    { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#7c3aed", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  setHoursBtnText:{ fontSize: 12, fontWeight: "800", color: "#fff" },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 30 },

  scroll: { padding: 16, gap: 14, paddingBottom: 40 },

  empty:      { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#374151" },
  emptySub:   { fontSize: 13, color: "#9ca3af", textAlign: "center", paddingHorizontal: 24, lineHeight: 20 },

  card:    { flexDirection: "row", backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", borderWidth: 1.5, borderColor: "#f1f5f9", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardBar: { width: 5, alignSelf: "stretch" },
  cardBody:{ flex: 1, padding: 16, gap: 12 },

  ptpRow:    { flexDirection: "row", alignItems: "center" },
  ptpStop:   { flex: 1, alignItems: "center", gap: 5 },
  ptpDot:    { width: 10, height: 10, borderRadius: 5 },
  ptpText:   { fontSize: 13, fontWeight: "800", textAlign: "center", color: "#2563eb" },
  ptpTextDest:{ fontSize: 13, fontWeight: "800", textAlign: "center", color: "#374151" },
  ptpMid:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 4 },
  ptpLine:   { width: 14, height: 1.5, backgroundColor: "#dbeafe" },

  metaRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  classChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#eff6ff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  classChipText: { fontSize: 11, fontWeight: "800", color: "#2563eb" },
  recurChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#f8fafc", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  recurChipText: { fontSize: 11, fontWeight: "700", color: "#6b7280" },

  timeRow:   { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#f8fafc", borderRadius: 12, padding: 12, borderWidth: 1.5, borderColor: "#eff6ff" },
  timeBox:   { flex: 1, alignItems: "center" },
  timeTag:   { fontSize: 9, fontWeight: "800", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
  timeValue: { fontSize: 18, fontWeight: "900", color: "#1a4a52" },

  cardFooter: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBtn:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  statusDot:  { width: 7, height: 7, borderRadius: 4 },
  statusText: { flex: 1, fontSize: 11, fontWeight: "700" },
  editBtn:    { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, borderRadius: 10, paddingHorizontal: 10, backgroundColor: "#eff6ff", justifyContent: "center", borderWidth: 1, borderColor: "#bfdbfe" },
  deleteBtn:  { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 34, borderRadius: 10, paddingHorizontal: 10, backgroundColor: "#fef2f2", justifyContent: "center", borderWidth: 1, borderColor: "#fecaca" },
  editBtnText:   { fontSize: 12, fontWeight: "700", color: "#2563eb" },
  deleteBtnText: { fontSize: 12, fontWeight: "700", color: "#ef4444" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:   { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: "88%" },
  handle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },

  sheetTitle: { fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 12 },

  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 4 },
  input:      { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#f9fafb", marginBottom: 6 },
  inputHint:  { fontSize: 11, color: "#9ca3af", marginBottom: 14, lineHeight: 16 },

  pickerWrap: { gap: 6, marginBottom: 6 },
  pickerRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#f9fafb" },
  pickerRowActive: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  pickerRowText: { fontSize: 13, fontWeight: "700", color: "#374151" },
  pickerRowTextActive: { color: "#2563eb" },

  nameModeToggle: { flexDirection: "row", backgroundColor: "#f1f5f9", borderRadius: 12, padding: 4, marginBottom: 8 },
  nameModeBtn:    { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 9 },
  nameModeBtnActive: { backgroundColor: "#2563eb" },
  nameModeBtnText:  { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  nameModeBtnTextActive: { color: "#fff" },

  weekdayRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  weekdayChip: { width: 44, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1.5, borderColor: "#e5e7eb", backgroundColor: "#f9fafb" },
  weekdayChipActive: { borderColor: "#2563eb", backgroundColor: "#2563eb" },
  weekdayChipText: { fontSize: 11, fontWeight: "800", color: "#6b7280" },
  weekdayChipTextActive: { color: "#fff" },

  sheetActions:  { flexDirection: "row", gap: 10 },
  cancelBtn:     { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  cancelBtnText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  saveBtn:       { flex: 2, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  saveBtnText:   { fontSize: 14, fontWeight: "800", color: "#fff" },
});
