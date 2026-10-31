import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import TranSyncLogo from "../assets/TranSync_Logo.png";

import API_BASE from "../config/admin_api.js";
import { authFetch, clearAdminSession } from "../config/apiClient.js";

// Keyed by the terminal's own vehicle_type (Jeepney|UV Express|Bus) — a
// terminal always has its own type regardless of its owning operator's
// (now-legacy, no-longer-fixed) operator_type.
const TYPE_COLORS = {
  "Jeepney":    { border: "#16a34a", text: "#16a34a", bg: "#dcfce7" },
  "UV Express": { border: "#0891b2", text: "#0891b2", bg: "#cffafe" },
  "Bus":        { border: "#9333ea", text: "#9333ea", bg: "#f3e8ff" },
};

const NAV = [
  { label: "Overview",            path: "/overview",            icon: "grid" },
  { label: "User Management",     path: "/user-management",     icon: "users" },
  { label: "Verify Users",        path: "/verify-users",        icon: "check" },
  { label: "Terminal",      path: "/terminal-management", icon: "map"  },
  { label: "Route Library", path: "/route-library",       icon: "book" },
  { label: "Route & Terminal Management", path: "/route-terminal-management", icon: "flag" },
  { label: "System Wallet", path: "/system-wallet", icon: "cash" },
  { label: "LTFRB Fare Guide", path: "/ltfrb-fare-guide", icon: "pdf" },
  { label: "Settings", path: "/settings", icon: "settings" },
];

export default function TerminalManagement() {
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [terminals, setTerminals]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [search, setSearch]           = useState("");
  const [toast, setToast]             = useState(null);
  const navigate                      = useNavigate();

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchTerminals = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`${API_BASE}/system/terminals.php`);
      if (res.status === 401) { clearAdminSession(); navigate("/"); return; }
      if (!res.ok) { setError(`Server error (${res.status}).`); return; }
      const data = await res.json();
      setTerminals(data);
    } catch {
      setError("Failed to load terminals. Make sure XAMPP is running.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTerminals();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this terminal?")) return;
    try {
      await authFetch(`${API_BASE}/system/terminals.php?id=${id}`, { method: "DELETE" });
      setTerminals(terminals.filter((t) => t.id !== id));
      showToast("Terminal deleted.");
    } catch {
      showToast("Failed to delete terminal.", "error");
    }
  };

  const handleLogout = () => {
    clearAdminSession();
    navigate("/");
  };

  const filtered = terminals.filter((t) =>
    t.terminal_name?.toLowerCase().includes(search.toLowerCase()) ||
    t.location?.toLowerCase().includes(search.toLowerCase()) ||
    t.operator_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex min-h-screen bg-[#f0f0eb]" style={{ fontFamily: "'Segoe UI', sans-serif" }}>

      {/* ── TOAST ── */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 ${
          toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"
        }`}>
          {toast.type === "success" ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          )}
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
                  <button
                    key={item.label}
                    onClick={() => navigate(item.path)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-all ${
                      isActive ? "text-[#1a2a10] font-semibold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    }`}
                    style={isActive ? { backgroundColor: "#a8d832" } : {}}
                  >
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
        <div className="px-4 sm:px-8 py-4 sm:py-6 flex items-center gap-3 sm:gap-4" style={{ backgroundColor: "#1a4a52" }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-white hover:text-[#a8d832] transition-colors shrink-0">
            {sidebarOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            )}
          </button>
          <div>
            <h2 className="text-white font-black text-xl sm:text-2xl">Terminal Management</h2>
            <p className="text-slate-300 text-sm mt-0.5">View and manage operator registered terminals</p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 p-4 sm:p-8 space-y-5 overflow-x-hidden">

          {/* Search */}
          <div className="bg-white rounded-xl shadow-sm px-5 py-4">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by terminal name, location, or operator..."
                className="w-full bg-slate-100 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20 transition-all"
              />
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
                Loading terminals...
              </div>
            ) : error ? (
              <div className="text-center py-16 text-red-400 text-sm">{error}</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-180">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Terminal</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Location</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Operator</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Type</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Route</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Date Added</th>
                    <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-16">
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                          </svg>
                          <p className="text-sm font-medium">No terminals registered yet.</p>
                          <p className="text-xs">Associations register terminals when drawing a route in the mobile app.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((t) => {
                      const typeColor = TYPE_COLORS[t.operator_type] || { border: "#64748b", text: "#64748b", bg: "#f1f5f9" };
                      return (
                        <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">

                          {/* Terminal */}
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: typeColor.bg }}>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: typeColor.text }}>
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              </div>
                              <span className="font-bold text-slate-700">{t.terminal_name}</span>
                            </div>
                          </td>

                          {/* Location */}
                          <td className="px-6 py-4 text-slate-500">
                            {t.location || (t.latitude && t.longitude
                              ? `${Number(t.latitude).toFixed(5)}, ${Number(t.longitude).toFixed(5)}`
                              : "—")}
                          </td>

                          {/* Operator */}
                          <td className="px-6 py-4 font-medium text-slate-600">{t.operator_name}</td>

                          {/* Type */}
                          <td className="px-6 py-4">
                            <span className="px-3 py-1 rounded-full text-xs font-medium border" style={{ borderColor: typeColor.border, color: typeColor.text }}>
                              {t.operator_type}
                            </span>
                          </td>

                          {/* Route */}
                          <td className="px-6 py-4">
                            {t.route_from && t.route_to ? (
                              <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                                <span>{t.route_from}</span>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                </svg>
                                <span>{t.route_to}</span>
                              </div>
                            ) : t.linked_route_name ? (
                              <span className="text-xs font-medium text-green-700">{t.linked_route_name}</span>
                            ) : (
                              <span className="text-xs text-slate-400 italic">—</span>
                            )}
                          </td>

                          {/* Date */}
                          <td className="px-6 py-4 text-slate-400">{t.date_added}</td>

                          {/* Actions */}
                          <td className="px-6 py-4">
                            <button
                              onClick={() => handleDelete(t.id)}
                              className="flex items-center gap-1.5 text-red-400 hover:text-red-600 transition-colors px-2 py-1 rounded hover:bg-red-50"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              <span className="text-sm font-semibold">Delete</span>
                            </button>
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
              {filtered.length} terminal{filtered.length !== 1 ? "s" : ""} found
            </p>
          )}
        </div>
      </div>
    </div>
  );
}