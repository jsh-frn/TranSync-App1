import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useJsApiLoader, Autocomplete } from "@react-google-maps/api";
import TranSyncLogo from "../assets/TranSync_Logo.png";
import API_BASE from "../config/admin_api.js";
import { authFetch, clearAdminSession } from "../config/apiClient.js";
import RouteMapDrawer from "../components/RouteMapDrawer.jsx";

const ROUTE_COLORS = [
  "#1a4a52", "#0369a1", "#7c3aed", "#dc2626",
  "#d97706", "#16a34a", "#db2777", "#0891b2",
];
const VEHICLE_TYPES = ["Jeepney", "UV Express", "Bus"];
const TYPE_COLORS = {
  "Jeepney":    { border: "#16a34a", text: "#16a34a", bg: "#dcfce7" },
  "UV Express": { border: "#0891b2", text: "#0891b2", bg: "#cffafe" },
  "Bus":        { border: "#9333ea", text: "#9333ea", bg: "#f3e8ff" },
};

const NAV = [
  { label: "Overview",              path: "/overview",              icon: "grid"  },
  { label: "User Management",       path: "/user-management",       icon: "users" },
  { label: "Verify Users",          path: "/verify-users",          icon: "check" },
  { label: "Terminal",              path: "/terminal-management",   icon: "map"   },
  { label: "Route Library",         path: "/route-library",         icon: "book"  },
  { label: "Route & Terminal Management", path: "/route-terminal-management", icon: "flag" },
  { label: "System Wallet", path: "/system-wallet", icon: "cash" },
  { label: "LTFRB Fare Guide", path: "/ltfrb-fare-guide", icon: "pdf" },
  { label: "Settings", path: "/settings", icon: "settings" },
];

const GMAPS_KEY = "AIzaSyC5M8jDBgCE6L3tCC1JploVMqZisOjDk-0";
const GMAPS_LIBRARIES = ["places"];

// Step in the creation wizard
const STEP = { OWNER: "owner", TERMINAL_CHOICE: "terminal_choice", TERMINAL_PICK: "terminal_pick", TERMINAL_PLACE: "terminal_place", DRAW: "draw" };

export default function RouteTerminalManagement() {
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [routes,      setRoutes]      = useState([]); // owned routes only (operator_id or association_id set)
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [search,      setSearch]      = useState("");
  const [toast,       setToast]       = useState(null);
  const navigate = useNavigate();

  const [operators,    setOperators]    = useState([]);
  const [associations, setAssociations] = useState([]);
  const [allTerminals, setAllTerminals] = useState([]); // flattened from get_terminals.php

  const [showModal, setShowModal] = useState(false);
  const [modalKey,  setModalKey]  = useState(0);
  const [step,      setStep]      = useState(STEP.OWNER);
  const [editingRoute, setEditingRoute] = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [fullscreen,setFullscreen]= useState(false);
  const [flyToTarget, setFlyToTarget] = useState(null);

  const [ownerKind, setOwnerKind] = useState("association"); // 'operator' | 'association'
  const [ownerId,   setOwnerId]   = useState(null);

  const [terminalId,   setTerminalId]   = useState(null); // existing terminal being reused
  const [terminalPt,   setTerminalPt]   = useState(null); // {latitude, longitude} for a new terminal
  const [terminalName, setTerminalName] = useState("");
  const [terminalVT,   setTerminalVT]   = useState("Jeepney");

  const [form, setForm] = useState({ name: "", from_location: "", to_location: "", description: "", direction_type: "one_way", color: "#1a4a52" });
  const [waypoints,    setWaypoints]    = useState([]);
  const [stopoverIds,  setStopoverIds]  = useState([]);

  const placesACRef    = useRef(null);
  const searchInputRef = useRef(null);
  const { isLoaded, loadError } = useJsApiLoader({ googleMapsApiKey: GMAPS_KEY, libraries: GMAPS_LIBRARIES });

  useEffect(() => {
    if (!showModal) {
      document.querySelectorAll(".pac-container").forEach((el) => { el.style.display = "none"; });
      if (searchInputRef.current) searchInputRef.current.value = "";
    }
  }, [showModal]);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [libRes, opRes, assocRes, termRes] = await Promise.all([
        authFetch(`${API_BASE}/routes/get_route_library.php`),
        authFetch(`${API_BASE}/system/users.php?type=operator`),
        authFetch(`${API_BASE}/system/users.php?type=association`),
        fetch(`${API_BASE}/routes/get_terminals.php`), // public endpoint, no auth needed
      ]);
      if (libRes.status === 401) { clearAdminSession(); navigate("/"); return; }

      const libData   = await libRes.json();
      const opData    = await opRes.json();
      const assocData = await assocRes.json();
      const termData  = await termRes.json();

      const owned = (libData.routes ?? []).filter(r => r.operator_id || r.association_id);
      setRoutes(owned);
      setOperators(Array.isArray(opData) ? opData : []);
      setAssociations(Array.isArray(assocData) ? assocData : []);
      setAllTerminals(termData.success ? termData.terminals ?? [] : []);
    } catch {
      setError("Failed to load data. Make sure XAMPP is running.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handlePlaceChanged = () => {
    const place = placesACRef.current?.getPlace();
    const loc = place?.geometry?.location;
    if (loc?.lat && loc?.lng) setFlyToTarget({ lat: loc.lat(), lng: loc.lng(), ts: Date.now() });
  };

  // ── Wizard state resets ──────────────────────────────────────────────────────
  const resetWizard = () => {
    setOwnerKind("association");
    setOwnerId(null);
    setTerminalId(null);
    setTerminalPt(null);
    setTerminalName("");
    setTerminalVT("Jeepney");
    setForm({ name: "", from_location: "", to_location: "", description: "", direction_type: "one_way", color: ROUTE_COLORS[0] });
    setWaypoints([]);
    setStopoverIds([]);
    setFlyToTarget(null);
    setFullscreen(false);
  };

  const openAdd = () => {
    setEditingRoute(null);
    resetWizard();
    setStep(STEP.OWNER);
    setModalKey((k) => k + 1);
    setShowModal(true);
  };

  const openEdit = (route) => {
    setEditingRoute(route);
    setOwnerKind(route.association_id ? "association" : "operator");
    setOwnerId(route.association_id || route.operator_id || null);
    setTerminalId(null);
    setTerminalPt(null);
    setTerminalName("");
    setForm({
      name: route.name ?? "", from_location: route.from_location ?? "", to_location: route.to_location ?? "",
      description: route.description ?? "", direction_type: route.direction_type ?? "one_way", color: route.color ?? "#1a4a52",
    });
    setWaypoints(route.waypoints ?? []);
    setStopoverIds([]); // route library payload doesn't carry stopovers; edit still works, just won't prefill them
    setFlyToTarget(null);
    setFullscreen(false);
    setStep(STEP.DRAW); // editing an existing owned route already has a terminal — skip straight to drawing
    setModalKey((k) => k + 1);
    setShowModal(true);
  };

  // Terminals belonging to the currently selected owner (cross-referenced via the
  // owned-routes list, since get_terminals.php doesn't carry owner ids directly)
  const ownedTerminals = (() => {
    if (!ownerId) return [];
    const ownedRouteIds = new Set(
      routes.filter(r => (ownerKind === "association" ? r.association_id : r.operator_id) === ownerId).map(r => r.id)
    );
    return allTerminals.filter(t => t.routes.some(r => ownedRouteIds.has(r.route_id)));
  })();

  // ── Delete (soft) ────────────────────────────────────────────────────────────
  const handleDelete = async (route) => {
    if (!window.confirm(`Delete "${route.name}"? This deactivates it — it stops appearing to commuters.`)) return;
    try {
      const res = await authFetch(`${API_BASE}/routes/admin_library.php`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route_id: route.id }),
      });
      const data = await res.json();
      if (data.success) {
        setRoutes((prev) => prev.filter((r) => r.id !== route.id));
        showToast("Route deactivated.");
      } else {
        showToast(data.message || "Delete failed.", "error");
      }
    } catch {
      showToast("Failed to connect to server.", "error");
    }
  };

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const nameVal = form.name.trim();
    const fromVal = form.from_location.trim();
    const toVal   = form.to_location.trim();
    const resolvedName = nameVal || (fromVal && toVal ? `${fromVal} → ${toVal}` : "");
    if (!resolvedName) { showToast("Enter a route name, or fill both From and To fields.", "error"); return; }
    if (waypoints.length < 2) { showToast("Draw at least 2 waypoints on the map.", "error"); return; }
    if (!editingRoute && !terminalId && !terminalPt) { showToast("Place or choose a terminal first.", "error"); return; }

    setSaving(true);
    try {
      const payload = {
        operator_id:    ownerKind === "operator"    ? ownerId : 0,
        association_id: ownerKind === "association" ? ownerId : null,
        name: resolvedName,
        from_location: fromVal,
        to_location: toVal,
        description: form.description,
        direction_type: form.direction_type,
        color: form.color,
        waypoints,
        stopover_terminal_ids: stopoverIds,
        ...(editingRoute ? { route_id: editingRoute.id } : {}),
        ...(terminalId
          ? { terminal_id: terminalId }
          : terminalPt
            ? { terminal_name: terminalName, terminal_lat: terminalPt.latitude, terminal_lng: terminalPt.longitude, terminal_vehicle_type: terminalVT }
            : {}),
      };
      const res = await authFetch(`${API_BASE}/routes/save_route.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        fetchAll();
        showToast(editingRoute ? "Route updated." : "Route created.");
      } else {
        showToast(data.message || "Save failed.", "error");
      }
    } catch {
      showToast("Failed to connect to server.", "error");
    } finally {
      setSaving(false);
    }
  };

  const filtered = routes.filter((r) => {
    const q = search.toLowerCase();
    return !q || r.name?.toLowerCase().includes(q) || r.from_location?.toLowerCase().includes(q) || r.to_location?.toLowerCase().includes(q) || r.contributor?.toLowerCase().includes(q);
  });

  const handleLogout = () => { clearAdminSession(); navigate("/"); };

  const ownerName = ownerKind === "operator"
    ? operators.find(o => o.id === ownerId)?.name
    : associations.find(a => a.id === ownerId)?.name;

  return (
    <div className="flex min-h-screen bg-[#f0f0eb]" style={{ fontFamily: "'Segoe UI', sans-serif" }}>

      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 ${toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>
          {toast.message}
        </div>
      )}

      {sidebarOpen && (
        <>
          <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
          <aside className="w-64 sm:w-56 bg-white flex flex-col justify-between py-6 px-4 shadow-md shrink-0 fixed inset-y-0 left-0 z-40 overflow-y-auto md:static md:z-auto">
          <div>
            <div className="flex flex-col items-center mb-8">
              <img src={TranSyncLogo} alt="TranSync" className="w-20 h-20 object-contain mb-2" />
              <h1 className="font-black text-[#1a4a52] text-xl leading-none">
                Tran<span style={{ color: "#a8d832" }}>S</span>ync
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">Admin Panel</p>
            </div>
            <nav className="space-y-2">
              {NAV.map((item) => {
                const isActive = window.location.pathname === item.path;
                return (
                  <button key={item.label} onClick={() => navigate(item.path)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-all ${isActive ? "text-[#1a2a10] font-semibold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}
                    style={isActive ? { backgroundColor: "#a8d832" } : {}}>
                    {item.icon === "grid"  && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>}
                    {item.icon === "users" && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
                    {item.icon === "check" && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                    {item.icon === "map"   && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>}
                    {item.icon === "book"  && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>}
                    {item.icon === "flag"  && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21V4m0 2h13l-2 4 2 4H3" /></svg>}
                    {item.icon === "cash"  && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
                    {item.icon === "pdf"   && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                    {item.icon === "settings" && <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-red-500 border border-red-200 hover:bg-red-50 transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            Log out
          </button>
          </aside>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 sm:px-8 py-4 sm:py-6 flex flex-wrap items-center justify-between gap-3" style={{ backgroundColor: "#1a4a52" }}>
          <div className="flex items-center gap-3 sm:gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-white hover:text-[#a8d832] transition-colors shrink-0">
              {sidebarOpen
                ? <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                : <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>}
            </button>
            <div>
              <h2 className="text-white font-black text-xl sm:text-2xl">Route &amp; Terminal Management</h2>
              <p className="text-slate-300 text-sm mt-0.5">Pin terminals and draw live, owned routes — same flow as an association</p>
            </div>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90"
            style={{ backgroundColor: "#a8d832", color: "#1a2a10" }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Route
          </button>
        </div>

        <div className="flex-1 p-4 sm:p-8 space-y-5 overflow-x-hidden">
          <div className="bg-white rounded-xl shadow-sm px-5 py-4">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, location, or owner..."
                className="w-full bg-slate-100 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20 transition-all" />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-400 gap-2">Loading routes...</div>
            ) : error ? (
              <div className="text-center py-16 text-red-400 text-sm">{error}</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-180">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Route</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Path</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Type</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Owner</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-16 text-slate-400 text-sm">No owned routes yet. Tap "New Route" to create one.</td></tr>
                  ) : (
                    filtered.map((r) => {
                      const tc = TYPE_COLORS[r.vehicle_type] || { border: "#64748b", text: "#64748b", bg: "#f1f5f9" };
                      return (
                        <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-3 h-10 rounded-full shrink-0" style={{ backgroundColor: r.color ?? "#1a4a52" }} />
                              <span className="font-bold text-slate-700">{r.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {r.from_location && r.to_location ? (
                              <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                                <span>{r.from_location}</span>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                                <span>{r.to_location}</span>
                              </div>
                            ) : <span className="text-xs text-slate-400 italic">{r.name}</span>}
                          </td>
                          <td className="px-6 py-4">
                            {r.vehicle_type ? (
                              <span className="px-3 py-1 rounded-full text-xs font-medium border" style={{ borderColor: tc.border, color: tc.text, backgroundColor: tc.bg }}>{r.vehicle_type}</span>
                            ) : <span className="text-xs text-slate-400 italic">—</span>}
                          </td>
                          <td className="px-6 py-4 text-slate-500 text-xs">{r.contributor ?? "—"}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1">
                              <button onClick={() => openEdit(r)} className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors text-xs font-semibold">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => handleDelete(r)} className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors text-xs font-semibold">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>
            )}
          </div>
          {!loading && !error && <p className="text-xs text-slate-400 text-right">{filtered.length} route{filtered.length !== 1 ? "s" : ""} found</p>}
        </div>
      </div>

      {/* ── WIZARD MODAL ── */}
      {showModal && (
        <div className={`fixed inset-0 z-50 flex ${fullscreen ? "" : "items-center justify-center bg-black/40 p-0 sm:p-4"}`}>
          <div className={`bg-white flex flex-col w-full shadow-2xl ${fullscreen ? "h-full rounded-none" : "h-screen sm:h-[90vh] max-w-5xl sm:rounded-2xl"}`}>

            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2 shrink-0">
              <h3 className="text-lg font-black text-[#1a4a52]">{editingRoute ? "Edit Route" : "New Route"}</h3>
              <div className="flex items-center gap-2">
                {step === STEP.DRAW && (
                  <button onClick={() => setFullscreen((f) => !f)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-sm font-semibold">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" /></svg>
                    {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
                  </button>
                )}
                <button onClick={() => setShowModal(false)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-sm font-semibold">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  Close
                </button>
              </div>
            </div>

            {/* ── STEP: choose owner ── */}
            {step === STEP.OWNER && (
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
                <p className="text-sm text-slate-500">Who does this route belong to?</p>
                <div className="flex gap-3">
                  <button onClick={() => { setOwnerKind("association"); setOwnerId(null); }}
                    className={`flex-1 py-3 rounded-xl border-2 text-sm font-bold ${ownerKind === "association" ? "border-[#1a4a52] bg-[#1a4a52]/5 text-[#1a4a52]" : "border-slate-200 text-slate-500"}`}>
                    Association
                  </button>
                  <button onClick={() => { setOwnerKind("operator"); setOwnerId(null); }}
                    className={`flex-1 py-3 rounded-xl border-2 text-sm font-bold ${ownerKind === "operator" ? "border-[#1a4a52] bg-[#1a4a52]/5 text-[#1a4a52]" : "border-slate-200 text-slate-500"}`}>
                    Operator
                  </button>
                </div>
                <select value={ownerId ?? ""} onChange={(e) => setOwnerId(Number(e.target.value) || null)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20 bg-white">
                  <option value="">Select {ownerKind}…</option>
                  {(ownerKind === "operator" ? operators : associations).map(o => (
                    <option key={o.id} value={o.id}>{o.name}{o.role ? ` — ${o.role}` : ""}</option>
                  ))}
                </select>
                <button disabled={!ownerId} onClick={() => setStep(STEP.TERMINAL_CHOICE)}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: "#1a4a52" }}>
                  Next: Terminal
                </button>
              </div>
            )}

            {/* ── STEP: place new vs use existing terminal ── */}
            {step === STEP.TERMINAL_CHOICE && (
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-3">
                <p className="text-sm text-slate-500 mb-2">Where does this route depart from?</p>
                <button onClick={() => setStep(STEP.TERMINAL_PLACE)}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-slate-200 hover:border-[#1a4a52] transition-colors text-left">
                  <span className="text-sm font-bold text-slate-700">Place New Terminal</span>
                </button>
                {ownedTerminals.length > 0 && (
                  <button onClick={() => setStep(STEP.TERMINAL_PICK)}
                    className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-slate-200 hover:border-[#1a4a52] transition-colors text-left">
                    <span className="text-sm font-bold text-slate-700">Use Existing Terminal</span>
                    <span className="text-xs text-slate-400 ml-auto">{ownedTerminals.length} available</span>
                  </button>
                )}
                <button onClick={() => setStep(STEP.OWNER)} className="text-xs text-slate-400 hover:text-slate-600 mt-2">← Back</button>
              </div>
            )}

            {/* ── STEP: pick an existing terminal ── */}
            {step === STEP.TERMINAL_PICK && (
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-2">
                {ownedTerminals.map(t => (
                  <button key={t.terminal_id} onClick={() => { setTerminalId(t.terminal_id); setTerminalPt(null); setStep(STEP.DRAW); }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-[#1a4a52] transition-colors text-left">
                    <div className="w-8 h-8 rounded-full bg-[#1a4a52] flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21V4m0 2h13l-2 4 2 4H3" /></svg>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-700">{t.terminal_name}</p>
                      <p className="text-xs text-slate-400">Used by: {t.routes.map(r => r.route_name).join(", ")}</p>
                    </div>
                  </button>
                ))}
                <button onClick={() => setStep(STEP.TERMINAL_CHOICE)} className="text-xs text-slate-400 hover:text-slate-600 mt-2">← Back</button>
              </div>
            )}

            {/* ── STEP: place new terminal on map ── */}
            {step === STEP.TERMINAL_PLACE && (
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="flex-1 min-h-0">
                  <RouteMapDrawer
                    key={`term-${modalKey}`}
                    waypoints={[]}
                    onChange={() => {}}
                    isLoaded={isLoaded}
                    loadError={loadError}
                    terminalMode
                    terminalPoint={terminalPt}
                    onTerminalChange={setTerminalPt}
                  />
                </div>
                <div className="px-6 py-4 border-t border-slate-100 space-y-3 shrink-0">
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" value={terminalName} onChange={(e) => setTerminalName(e.target.value)}
                      placeholder="Terminal name (e.g. Xevera Terminal)"
                      className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20" />
                    <select value={terminalVT} onChange={(e) => setTerminalVT(e.target.value)}
                      className="border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20 bg-white">
                      {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setStep(STEP.TERMINAL_CHOICE)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600">Back</button>
                    <button
                      disabled={!terminalPt || !terminalName.trim()}
                      onClick={() => setStep(STEP.DRAW)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: "#1a4a52" }}>
                      Next: Draw Route
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP: draw route + details ── */}
            {step === STEP.DRAW && (
              <div className="flex flex-col md:flex-row flex-1 overflow-y-auto md:overflow-hidden min-h-0">
                <div className="w-full md:w-80 md:shrink-0 border-b md:border-b-0 md:border-r border-slate-100 md:overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
                  {!editingRoute && (
                    <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
                      Owner: <strong>{ownerName}</strong> · Terminal: <strong>{terminalId ? ownedTerminals.find(t => t.terminal_id === terminalId)?.terminal_name : terminalName}</strong>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Navigate Map</label>
                    <div className="relative">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      {isLoaded ? (
                        <Autocomplete onLoad={(ac) => { placesACRef.current = ac; }} onPlaceChanged={handlePlaceChanged} options={{ componentRestrictions: { country: "ph" }, fields: ["geometry", "name"] }}>
                          <input ref={searchInputRef} type="text" placeholder="Search places in Philippines…"
                            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#4285F4]/20" />
                        </Autocomplete>
                      ) : (
                        <input type="text" disabled placeholder="Loading search…" className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-300 bg-slate-50" />
                      )}
                    </div>
                  </div>

                  <div className="border-t border-slate-100" />

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Route Name</label>
                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Circular Loop - San Fernando"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">From</label>
                      <input type="text" value={form.from_location} onChange={(e) => setForm({ ...form, from_location: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">To</label>
                      <input type="text" value={form.to_location} onChange={(e) => setForm({ ...form, to_location: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Description (optional)</label>
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={3} placeholder="e.g. Passes via MacArthur Highway, stops at HAU"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20" />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Route Direction</label>
                    <p className="text-xs text-slate-400 mb-1.5">
                      Vice versa: the same jeep drives this road both ways (A→B then B→A). One way: it only ever travels this drawn direction.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setForm({ ...form, direction_type: "one_way" })}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 ${form.direction_type === "one_way" ? "border-[#1a4a52] bg-[#1a4a52]/5 text-[#1a4a52]" : "border-slate-200 text-slate-500"}`}>
                        One Way
                      </button>
                      <button onClick={() => setForm({ ...form, direction_type: "vice_versa" })}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 ${form.direction_type === "vice_versa" ? "border-[#1a4a52] bg-[#1a4a52]/5 text-[#1a4a52]" : "border-slate-200 text-slate-500"}`}>
                        Vice Versa
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Route Color</label>
                    <div className="flex gap-2 flex-wrap">
                      {ROUTE_COLORS.map((c) => (
                        <button key={c} onClick={() => setForm({ ...form, color: c })}
                          className="w-7 h-7 rounded-full border-2 transition-transform"
                          style={{ backgroundColor: c, borderColor: form.color === c ? "#1a4a52" : "transparent", transform: form.color === c ? "scale(1.2)" : "scale(1)" }} />
                      ))}
                    </div>
                  </div>

                  {ownedTerminals.length > 0 && (
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Stopover Terminals</label>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {ownedTerminals.filter(t => t.terminal_id !== terminalId).map(t => {
                          const checked = stopoverIds.includes(t.terminal_id);
                          return (
                            <label key={t.terminal_id} className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                              <input type="checkbox" checked={checked} onChange={() => {
                                setStopoverIds(prev => checked ? prev.filter(id => id !== t.terminal_id) : [...prev, t.terminal_id]);
                              }} />
                              {t.terminal_name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-lg text-xs text-slate-500">
                    {waypoints.length === 0 ? "No waypoints drawn yet — click on the map to start." : `${waypoints.length} waypoint${waypoints.length !== 1 ? "s" : ""} drawn.`}
                  </div>
                </div>

                <div className="flex-1 min-w-0 h-96 md:h-full shrink-0">
                  <RouteMapDrawer
                    key={modalKey}
                    waypoints={waypoints}
                    onChange={setWaypoints}
                    color={form.color}
                    flyToTarget={flyToTarget}
                    isLoaded={isLoaded}
                    loadError={loadError}
                    terminalPoint={terminalPt ?? (terminalId ? { latitude: ownedTerminals.find(t => t.terminal_id === terminalId)?.latitude, longitude: ownedTerminals.find(t => t.terminal_id === terminalId)?.longitude } : null)}
                    stopoverPoints={stopoverIds.map(id => {
                      const t = ownedTerminals.find(et => et.terminal_id === id);
                      return t ? { latitude: t.latitude, longitude: t.longitude, name: t.terminal_name } : null;
                    }).filter(Boolean)}
                  />
                </div>
              </div>
            )}

            {step === STEP.DRAW && (
              <div className="px-6 py-4 border-t border-slate-100 flex gap-3 shrink-0">
                <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ backgroundColor: "#1a4a52" }}>
                  {saving ? "Saving…" : editingRoute ? "Update Route" : "Create Route"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
