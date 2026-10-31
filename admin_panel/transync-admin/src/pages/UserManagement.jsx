import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import TranSyncLogo from "../assets/TranSync_Logo.png";
import API_BASE from "../config/admin_api.js";
import { authFetch, clearAdminSession } from "../config/apiClient.js";

const NAV = [
  { label: "Overview",        path: "/overview",            icon: "grid"  },
  { label: "User Management", path: "/user-management",     icon: "users" },
  { label: "Verify Users",    path: "/verify-users",        icon: "check" },
  { label: "Terminal",        path: "/terminal-management", icon: "map"   },
  { label: "Route Library",  path: "/route-library",       icon: "book"  },
  { label: "Route & Terminal Management", path: "/route-terminal-management", icon: "flag" },
  { label: "System Wallet", path: "/system-wallet", icon: "cash" },
  { label: "LTFRB Fare Guide", path: "/ltfrb-fare-guide", icon: "pdf" },
  { label: "Settings", path: "/settings", icon: "settings" },
];

const ROLE_COLORS = {
  default:      { border: "#64748b", text: "#64748b" },
  student:      { border: "#2563eb", text: "#2563eb" },
  disabled:     { border: "#7c3aed", text: "#7c3aed" },
  elderly:      { border: "#ea580c", text: "#ea580c" },
  "Jeepney Op": { border: "#16a34a", text: "#16a34a" },
  "UV Op":      { border: "#0891b2", text: "#0891b2" },
  "Bus Op":     { border: "#9333ea", text: "#9333ea" },
};

const TABS = [
  { key: "commuter",    label: "Commuters"    },
  { key: "operator",    label: "Operators"    },
  { key: "association", label: "Associations" },
];

const STATUS_STYLES = {
  active:   "bg-green-100 text-green-600",
  inactive: "bg-red-100 text-red-500",
  pending:  "bg-yellow-100 text-yellow-600",
};

// is_verified alone can't distinguish a genuinely still-pending applicant
// from one the admin already rejected — both are is_verified=0. rejected_at
// being set is what actually means "rejected" (see verify.php's reject
// action and the rejection_reason migration note).
function verificationState(user) {
  if (user.is_verified == 1) return "verified";
  if (user.rejected_at) return "rejected";
  // A Standard (default) commuter needs no verification, so they read as
  // Default — unless a discount application is actually awaiting review
  // (category stays 'default' while one is pending).
  if (user.role === "default" && !Number(user.has_pending_discount)) return "default";
  return "pending";
}

export default function UserManagement() {
  const [sidebarOpen,   setSidebarOpen]   = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [activeTab,     setActiveTab]     = useState("commuter");
  const [users,         setUsers]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");
  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState("All");
  const [confirmModal,  setConfirmModal]  = useState(null);
  const [deleting,      setDeleting]      = useState(false);
  const [toast,         setToast]         = useState(null);
  const [reasonView,    setReasonView]    = useState(null); // {name, rejected_at, rejection_reason} while open
  const navigate = useNavigate();

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchUsers = async (type) => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`${API_BASE}/system/users.php?type=${type}`);
      if (res.status === 401) { clearAdminSession(); navigate("/"); return; }
      if (!res.ok) { setError(`Server error (${res.status}).`); return; }
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      setError(`Failed to load: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(activeTab); }, [activeTab]);

  const handleDeleteConfirm = async () => {
    if (!confirmModal) return;
    setDeleting(true);
    try {
      await authFetch(`${API_BASE}/system/users.php?id=${confirmModal.id}&type=${activeTab}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.id !== confirmModal.id));
      showToast(`${confirmModal.name} has been removed.`, "success");
    } catch {
      showToast("Failed to delete. Please try again.", "error");
    } finally {
      setDeleting(false);
      setConfirmModal(null);
    }
  };

  const handleLogout = () => {
    clearAdminSession();
    navigate("/");
  };

  const filtered = users.filter((u) => {
    const s = search.toLowerCase();
    const matchSearch =
      u.name?.toLowerCase().includes(s)   ||
      u.email?.toLowerCase().includes(s)  ||
      u.role?.toLowerCase().includes(s)   ||
      u.address?.toLowerCase().includes(s);
    const matchStatus =
      statusFilter === "All" ||
      u.status?.toLowerCase() === statusFilter.toLowerCase();
    return matchSearch && matchStatus;
  });

  const getHeaders = () => {
    if (activeTab === "association")
      return ["Association", "Email", "Phone", "Address", "Status", "Date Added", "Actions"];
    return ["User", "Email", "Role", "Status", "Verified", "Date Added", "Actions"];
  };

  return (
    <div className="flex min-h-screen bg-[#f0f0eb]" style={{ fontFamily: "'Segoe UI', sans-serif" }}>

      {/* ── TOAST ── */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 ${toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>
          {toast.type === "success"
            ? <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            : <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>}
          {toast.message}
        </div>
      )}

      {/* ── DELETE MODAL ── */}
      {confirmModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-red-50 px-6 pt-6 pb-4 flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-black text-slate-800">
                  Remove {activeTab === "association" ? "Association" : "User"}
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">This action cannot be undone.</p>
              </div>
              <button onClick={() => setConfirmModal(null)} disabled={deleting}
                className="flex items-center gap-1 text-slate-400 hover:text-slate-600 transition-colors mt-0.5 disabled:opacity-40">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                <span className="text-sm font-semibold">Close</span>
              </button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-slate-600 mb-4">
                You are about to permanently remove the following {activeTab === "association" ? "association" : "user"}:
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  {activeTab === "association"
                    ? <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                    : <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                </div>
                <div>
                  <p className="font-bold text-slate-700 text-sm">{confirmModal.name}</p>
                  <p className="text-xs text-slate-400">{confirmModal.email}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setConfirmModal(null)} disabled={deleting}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleDeleteConfirm} disabled={deleting}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {deleting
                    ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                  {deleting ? "Removing..." : "Remove"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── REJECTION REASON MODAL ── */}
      {reasonView && (
        <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={() => setReasonView(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-red-50 px-6 pt-6 pb-4">
              <h3 className="text-lg font-black text-slate-800">Rejection Reason</h3>
              <p className="text-sm text-slate-500 mt-0.5">{reasonView.name}</p>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {reasonView.rejection_reason || "No reason was recorded for this rejection."}
              </p>
              <button onClick={() => setReasonView(null)}
                className="w-full mt-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">
                Close
              </button>
            </div>
          </div>
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
              <h1 className="font-black text-[#1a4a52] text-xl leading-none">Tran<span style={{ color: "#a8d832" }}>S</span>ync</h1>
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

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 sm:px-8 py-4 sm:py-6 flex items-center gap-3 sm:gap-4" style={{ backgroundColor: "#1a4a52" }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-white hover:text-[#a8d832] transition-colors shrink-0">
            {sidebarOpen
              ? <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              : <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>}
          </button>
          <div>
            <h2 className="text-white font-black text-xl sm:text-2xl">User Management</h2>
            <p className="text-slate-300 text-sm mt-0.5">Manage commuter, operator, and association accounts</p>
          </div>
        </div>

        <div className="flex-1 p-4 sm:p-8 space-y-5 overflow-x-hidden">

          {/* Tabs */}
          <div className="flex gap-2 flex-wrap">
            {TABS.map((tab) => (
              <button key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSearch(""); setStatusFilter("All"); }}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === tab.key ? "text-[#1a2a10] shadow-sm" : "bg-white text-slate-500 hover:bg-slate-50 border border-slate-200"}`}
                style={activeTab === tab.key ? { backgroundColor: "#a8d832" } : {}}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="bg-white rounded-xl shadow-sm px-5 py-4">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={activeTab === "association" ? "Search by name, email, or address..." : "Search by name, email, or role..."}
                className="w-full bg-slate-100 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20 transition-all" />
            </div>
          </div>

          {/* Status filter */}
          <div className="flex justify-end">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1a4a52]/20">
              <option value="All">Status (All)</option>
              {activeTab === "association" ? (
                <>
                  <option value="pending">Pending</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </>
              ) : (
                <>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </>
              )}
            </select>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                Loading...
              </div>
            ) : error ? (
              <div className="text-center py-16 text-red-400 text-sm font-medium">{error}</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-180">
                <thead>
                  <tr className="border-b border-slate-100">
                    {getHeaders().map((h) => (
                      <th key={h} className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={getHeaders().length} className="text-center py-12 text-slate-400 text-sm">No {activeTab}s found.</td></tr>

                  ) : activeTab === "association" ? (
                    filtered.map((assoc) => (
                      <tr key={assoc.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                              <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                            </div>
                            <span className="font-bold text-slate-700">{assoc.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-500">{assoc.email}</td>
                        <td className="px-6 py-4 text-slate-500">{assoc.phone || "—"}</td>
                        <td className="px-6 py-4">
                          <span className="px-3 py-1 rounded-full text-xs font-medium border" style={{ borderColor: "#0f766e", color: "#0f766e" }}>
                            {assoc.address || "—"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[assoc.status] || STATUS_STYLES.inactive}`}>
                            {assoc.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-400">{assoc.date_added}</td>
                        <td className="px-6 py-4">
                          <button onClick={() => setConfirmModal({ id: assoc.id, name: assoc.name, email: assoc.email })}
                            className="flex items-center gap-1.5 text-red-400 hover:text-red-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            <span className="text-sm font-semibold">Remove</span>
                          </button>
                        </td>
                      </tr>
                    ))

                  ) : (
                    filtered.map((user) => {
                      const roleColor = ROLE_COLORS[user.role] || { border: "#64748b", text: "#64748b" };
                      return (
                        <tr key={user.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                                <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              </div>
                              <span className="font-bold text-slate-700">{user.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-slate-500">{user.email}</td>
                          <td className="px-6 py-4">
                            <span className="px-3 py-1 rounded-full text-xs font-medium border capitalize" style={{ borderColor: roleColor.border, color: roleColor.text }}>
                              {user.role}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[user.status] || STATUS_STYLES.inactive}`}>
                              {user.status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {(() => {
                              const state = verificationState(user);
                              if (state === "default") {
                                return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">Default</span>;
                              }
                              if (state === "verified") {
                                return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-600">Verified</span>;
                              }
                              if (state === "rejected") {
                                // Clickable — Verified/Pending stay view-only, there's
                                // nothing further to show for those.
                                return (
                                  <button onClick={() => setReasonView(user)}
                                    className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-600 hover:bg-red-200 transition-all cursor-pointer">
                                    Rejected
                                  </button>
                                );
                              }
                              return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-600">Pending</span>;
                            })()}
                          </td>
                          <td className="px-6 py-4 text-slate-400">{user.date_added}</td>
                          <td className="px-6 py-4">
                            <button onClick={() => setConfirmModal({ id: user.id, name: user.name, email: user.email, role: user.role })}
                              className="flex items-center gap-1.5 text-red-400 hover:text-red-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              <span className="text-sm font-semibold">Remove</span>
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
              Showing {filtered.length} of {users.length} {activeTab}s
            </p>
          )}
        </div>
      </div>
    </div>
  );
}