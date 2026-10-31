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
  { label: "Overview",        path: "/overview",            icon: "grid"  },
  { label: "User Management", path: "/user-management",     icon: "users" },
  { label: "Verify Users",    path: "/verify-users",        icon: "check" },
  { label: "Terminal",        path: "/terminal-management", icon: "map"   },
  { label: "Route Library",   path: "/route-library",       icon: "book"  },
  { label: "Route & Terminal Management", path: "/route-terminal-management", icon: "flag" },
  { label: "System Wallet", path: "/system-wallet", icon: "cash" },
  { label: "LTFRB Fare Guide", path: "/ltfrb-fare-guide", icon: "pdf" },
  { label: "Settings", path: "/settings", icon: "settings" },
];

const EMPTY_FORM = { name: "", from_location: "", to_location: "", color: "#1a4a52", vehicle_type: "Jeepney" };

const GMAPS_KEY = "AIzaSyC5M8jDBgCE6L3tCC1JploVMqZisOjDk-0";
// Must be a stable reference outside the component — prevents useJsApiLoader from reloading
const GMAPS_LIBRARIES = ["places"];

export default function RouteLibrary() {
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [routes,      setRoutes]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [search,      setSearch]      = useState("");
  const [toast,       setToast]       = useState(null);
  const navigate = useNavigate();

  // modal
  const [showModal,     setShowModal]     = useState(false);
  const [modalKey,      setModalKey]      = useState(0);   // increments on every open to remount the map fresh
  const [editingRoute,  setEditingRoute]  = useState(null); // null = new
  const [form,          setForm]          = useState(EMPTY_FORM);
  const [waypoints,     setWaypoints]     = useState([]);
  const [saving,        setSaving]        = useState(false);
  const [fullscreen,    setFullscreen]    = useState(false);
  const [flyToTarget,   setFlyToTarget]   = useState(null);

  const placesACRef  = useRef(null);
  const searchInputRef = useRef(null);

  const { isLoaded, loadError } = useJsApiLoader({ googleMapsApiKey: GMAPS_KEY, libraries: GMAPS_LIBRARIES });

  // Hide Places dropdown and clear search input whenever the modal closes
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
  const fetchRoutes = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`${API_BASE}/routes/get_route_library.php`);
      if (res.status === 401) { clearAdminSession(); navigate("/"); return; }
      if (!res.ok) { setError(`Server error (${res.status}).`); return; }
      const data = await res.json();
      setRoutes(data.routes ?? []);
    } catch {
      setError("Failed to load route library. Make sure XAMPP is running.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRoutes(); }, []);

  const handlePlaceChanged = () => {
    const place = placesACRef.current?.getPlace();
    const loc = place?.geometry?.location;
    if (loc?.lat && loc?.lng) setFlyToTarget({ lat: loc.lat(), lng: loc.lng(), ts: Date.now() });
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = async (route) => {
    if (!window.confirm(`Remove "${route.name}" from the library?`)) return;
    try {
      const res = await authFetch(`${API_BASE}/routes/admin_library.php`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route_id: route.id }),
      });
      const data = await res.json();
      if (data.success) {
        setRoutes((prev) => prev.filter((r) => r.id !== route.id));
        showToast("Route removed from library.");
      } else {
        showToast(data.message || "Delete failed.", "error");
      }
    } catch {
      showToast("Failed to connect to server.", "error");
    }
  };

  // ── Open modals ──────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingRoute(null);
    setForm(EMPTY_FORM);
    setWaypoints([]);
    setFlyToTarget(null);
    setFullscreen(false);
    setModalKey((k) => k + 1); // remount RouteMapDrawer to clear history/selection/searchPin
    setShowModal(true);
  };

  const openEdit = (route) => {
    setEditingRoute(route);
    setForm({
      name:          route.name          ?? "",
      from_location: route.from_location ?? "",
      to_location:   route.to_location   ?? "",
      color:         route.color         ?? "#1a4a52",
      vehicle_type:  route.vehicle_type  ?? "Jeepney",
    });
    setWaypoints(route.waypoints ?? []);
    setFlyToTarget(null);
    setFullscreen(false);
    setModalKey((k) => k + 1); // remount RouteMapDrawer to clear history/selection/searchPin
    setShowModal(true);
  };


  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const nameVal = form.name.trim();
    const fromVal = form.from_location.trim();
    const toVal   = form.to_location.trim();

    // Accept either a custom name, or both From + To (auto-derive the name)
    const resolvedName = nameVal || (fromVal && toVal ? `${fromVal} → ${toVal}` : "");
    if (!resolvedName) {
      showToast("Enter a route name, or fill both From and To fields.", "error"); return;
    }
    if (waypoints.length < 2) {
      showToast("Draw at least 2 waypoints on the map.", "error"); return;
    }
    setSaving(true);
    try {
      const isEdit  = !!editingRoute;
      const method  = isEdit ? "PUT" : "POST";
      const payload = isEdit
        ? { ...form, name: resolvedName, route_id: editingRoute.id, waypoints }
        : { ...form, name: resolvedName, waypoints };

      const res = await authFetch(`${API_BASE}/routes/admin_library.php`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        fetchRoutes();
        showToast(isEdit ? "Route updated." : "Route added to library.");
      } else {
        showToast(data.message || "Save failed.", "error");
      }
    } catch {
      showToast("Failed to connect to server.", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Filter ───────────────────────────────────────────────────────────────────
  const filtered = routes.filter((r) => {
    const q = search.toLowerCase();
    return (
      !q ||
      r.name?.toLowerCase().includes(q) ||
      r.from_location?.toLowerCase().includes(q) ||
      r.to_location?.toLowerCase().includes(q) ||
      r.contributor?.toLowerCase().includes(q)
    );
  });

  const handleLogout = () => { clearAdminSession(); navigate("/"); };

  return (
    <div className="flex min-h-screen bg-[#f0f0eb]" style={{ fontFamily: "'Segoe UI', sans-serif" }}>

      {/* ── TOAST ── */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 ${
          toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"
        }`}>
          {toast.type === "success"
            ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>}
          {toast.message}
        </div>
      )}

      {/* ── SIDEBAR ── */}
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
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-all ${
                      isActive ? "text-[#1a2a10] font-semibold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    }`}
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

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <div className="px-4 sm:px-8 py-4 sm:py-6 flex flex-wrap items-center justify-between gap-3" style={{ backgroundColor: "#1a4a52" }}>
          <div className="flex items-center gap-3 sm:gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-white hover:text-[#a8d832] transition-colors shrink-0">
              {sidebarOpen
                ? <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                : <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>}
            </button>
            <div>
              <h2 className="text-white font-black text-xl sm:text-2xl">Route Library</h2>
              <p className="text-slate-300 text-sm mt-0.5">Shared route templates for all associations and operators</p>
            </div>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90"
            style={{ backgroundColor: "#a8d832", color: "#1a2a10" }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Route
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 p-4 sm:p-8 space-y-5 overflow-x-hidden">

          {/* Search */}
          <div className="bg-white rounded-xl shadow-sm px-5 py-4">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, location, or contributor..."
                className="w-full bg-slate-100 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20 transition-all" />
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Loading route library...
              </div>
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
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Waypoints</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Contributor</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-16">
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                          <p className="text-sm font-medium">{search ? "No routes match your search." : "No routes in library yet."}</p>
                          <p className="text-xs">{search ? "Try a different term." : "Add a route above or wait for associations to save their routes."}</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => {
                      const tc = TYPE_COLORS[r.vehicle_type] || { border: "#64748b", text: "#64748b", bg: "#f1f5f9" };
                      return (
                        <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">

                          {/* Route name + color swatch */}
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-3 h-10 rounded-full shrink-0" style={{ backgroundColor: r.color ?? "#1a4a52" }} />
                              <span className="font-bold text-slate-700">{r.name}</span>
                            </div>
                          </td>

                          {/* From → To */}
                          <td className="px-6 py-4">
                            {r.from_location && r.to_location ? (
                              <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                                <span>{r.from_location}</span>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                </svg>
                                <span>{r.to_location}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 italic">{r.name}</span>
                            )}
                          </td>

                          {/* Vehicle type */}
                          <td className="px-6 py-4">
                            {r.vehicle_type ? (
                              <span className="px-3 py-1 rounded-full text-xs font-medium border"
                                style={{ borderColor: tc.border, color: tc.text, backgroundColor: tc.bg }}>
                                {r.vehicle_type}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 italic">—</span>
                            )}
                          </td>

                          {/* Waypoints count */}
                          <td className="px-6 py-4 text-slate-500">{r.waypoint_count} pts</td>

                          {/* Contributor */}
                          <td className="px-6 py-4 text-slate-500 text-xs">{r.contributor ?? <span className="italic text-slate-400">Admin</span>}</td>

                          {/* Actions */}
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1">
                              <button onClick={() => openEdit(r)}
                                className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors text-xs font-semibold">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                                Edit
                              </button>
                              <button onClick={() => handleDelete(r)}
                                className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors text-xs font-semibold">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
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

          {!loading && !error && (
            <p className="text-xs text-slate-400 text-right">
              {filtered.length} route{filtered.length !== 1 ? "s" : ""} found
            </p>
          )}
        </div>
      </div>

      {/* ── ADD / EDIT MODAL ── */}
      {showModal && (
        <div className={`fixed inset-0 z-50 flex ${fullscreen ? "" : "items-center justify-center bg-black/40 p-0 sm:p-4"}`}>
          <div
            className={`bg-white flex flex-col w-full shadow-2xl ${fullscreen ? "h-full rounded-none" : "h-screen sm:h-[90vh] max-w-5xl sm:rounded-2xl"}`}
          >

            {/* Header */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2 shrink-0">
              <h3 className="text-lg font-black text-[#1a4a52]">
                {editingRoute ? "Edit Route" : "Add Route to Library"}
              </h3>
              <div className="flex items-center gap-2">
                {/* Fullscreen toggle */}
                <button
                  onClick={() => setFullscreen((f) => !f)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-sm font-semibold"
                >
                  {fullscreen ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                    </svg>
                  )}
                  {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
                </button>
                {/* Close */}
                <button onClick={() => setShowModal(false)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-sm font-semibold">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  Close
                </button>
              </div>
            </div>

            {/* Body: form left, map right (stacked on mobile) */}
            <div className="flex flex-col md:flex-row flex-1 overflow-y-auto md:overflow-hidden min-h-0">

              {/* Left — form fields */}
              <div className="w-full md:w-80 md:shrink-0 border-b md:border-b-0 md:border-r border-slate-100 md:overflow-y-auto px-4 sm:px-6 py-5 space-y-4">

                {/* Location search */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    Navigate Map
                  </label>
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    {isLoaded ? (
                      <Autocomplete
                        onLoad={(ac) => { placesACRef.current = ac; }}
                        onPlaceChanged={handlePlaceChanged}
                        options={{ componentRestrictions: { country: "ph" }, fields: ["geometry", "name"] }}
                      >
                        <input
                          ref={searchInputRef}
                          type="text"
                          placeholder="Search places in Philippines…"
                          className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4285F4]/20 focus:border-[#4285F4]"
                        />
                      </Autocomplete>
                    ) : (
                      <input
                        type="text"
                        disabled
                        placeholder="Loading search…"
                        className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-300 bg-slate-50 cursor-not-allowed"
                      />
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
                    <span>Select a result to jump the map there</span>
                    <span className="ml-auto font-semibold text-[10px] tracking-tight">
                      <span style={{ color: "#4285F4" }}>G</span>
                      <span style={{ color: "#EA4335" }}>o</span>
                      <span style={{ color: "#FBBC05" }}>o</span>
                      <span style={{ color: "#4285F4" }}>g</span>
                      <span style={{ color: "#34A853" }}>l</span>
                      <span style={{ color: "#EA4335" }}>e</span>
                    </span>
                  </p>
                </div>

                <div className="border-t border-slate-100" />

                {/* Name */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    Route Name
                    <span className="ml-1.5 normal-case font-normal text-slate-400">(or fill From + To below)</span>
                  </label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Circular Loop - San Fernando" autoFocus
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20" />
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-xs font-semibold text-slate-400">or</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>

                {/* From / To */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      From
                      <span className="ml-1.5 normal-case font-normal text-slate-400">(+ To)</span>
                    </label>
                    <input type="text" value={form.from_location} onChange={(e) => setForm({ ...form, from_location: e.target.value })}
                      placeholder="e.g. Xevera"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">To</label>
                    <input type="text" value={form.to_location} onChange={(e) => setForm({ ...form, to_location: e.target.value })}
                      placeholder="e.g. Astro"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20" />
                  </div>
                </div>

                {/* Both-filled warning — only for new routes, not edits where all fields are pre-populated */}
                {!editingRoute && form.name.trim() && form.from_location.trim() && form.to_location.trim() && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                    <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                    <span>Both filled — use only one. Clear <strong>Route Name</strong> to use From → To, or clear <strong>From / To</strong>.</span>
                  </div>
                )}

                {/* Vehicle Type */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Vehicle Type</label>
                  <select value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20 bg-white">
                    {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                {/* Color */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Route Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {ROUTE_COLORS.map((c) => (
                      <button key={c} onClick={() => setForm({ ...form, color: c })}
                        className="w-7 h-7 rounded-full border-2 transition-transform"
                        style={{
                          backgroundColor: c,
                          borderColor: form.color === c ? "#1a4a52" : "transparent",
                          transform: form.color === c ? "scale(1.2)" : "scale(1)",
                        }} />
                    ))}
                  </div>
                </div>

                {/* Waypoint count summary */}
                <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 rounded-lg text-xs text-slate-500">
                  <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
                  <span>
                    {waypoints.length === 0
                      ? "No waypoints drawn yet — click on the map to start."
                      : `${waypoints.length} waypoint${waypoints.length !== 1 ? "s" : ""} drawn.`}
                  </span>
                </div>
              </div>

              {/* Right — interactive map */}
              <div className="flex-1 min-w-0 h-96 md:h-full shrink-0">
                <RouteMapDrawer
                  key={modalKey}
                  waypoints={waypoints}
                  onChange={setWaypoints}
                  color={form.color}
                  flyToTarget={flyToTarget}
                  isLoaded={isLoaded}
                  loadError={loadError}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 shrink-0">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ backgroundColor: "#1a4a52" }}>
                {saving ? "Saving…" : editingRoute ? "Update Route" : "Add to Library"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
