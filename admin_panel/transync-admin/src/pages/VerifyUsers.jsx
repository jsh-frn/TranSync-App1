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

export default function VerifyUsers() {
  const [sidebarOpen,   setSidebarOpen]   = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [activeTab,     setActiveTab]     = useState("commuter");
  const [users,         setUsers]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [toast,         setToast]         = useState(null);
  const [preview,       setPreview]       = useState(null);
  const [formView,      setFormView]      = useState(null);
  const [rejectModal,   setRejectModal]   = useState(null); // {id, name} while open
  const [rejectReason,  setRejectReason]  = useState("");
  const navigate = useNavigate();

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchUsers = async (type) => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`${API_BASE}/auth/verify.php?type=${type}`);
      if (res.status === 401) { clearAdminSession(); navigate("/"); return; }
      if (!res.ok) { setError(`Server error (${res.status}).`); return; }
      const data = await res.json();
      if (data.error) setError(data.message || "Server error.");
      else setUsers(data);
    } catch (err) {
      setError(`Fetch failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(activeTab); }, [activeTab]);

  const handleAction = async (id, action, reason) => {
    setActionLoading(`${id}-${action}`);
    try {
      const res  = await authFetch(`${API_BASE}/auth/verify.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id, type: activeTab, action, reason }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Action failed.", "error"); return; }
      setUsers((prev) => prev.filter((u) => u.id !== id));
      showToast(data.message, action === "approve" ? "success" : "error");
    } catch {
      showToast("Action failed. Try again.", "error");
    } finally {
      setActionLoading(null);
    }
  };

  // Commuter/Operator rejections require a typed reason (see verify.php) —
  // opens a confirm modal instead of rejecting immediately. Association
  // rejections stay a direct one-click action (out of scope, see the
  // rejection_reason migration note).
  const startReject = (user) => {
    if (activeTab === "association") { handleAction(user.id, "reject"); return; }
    setRejectReason("");
    setRejectModal(user);
  };

  const confirmReject = () => {
    if (!rejectModal || !rejectReason.trim()) return;
    handleAction(rejectModal.id, "reject", rejectReason.trim());
    setRejectModal(null);
  };

  const handleLogout = () => {
    clearAdminSession();
    navigate("/");
  };

  const getHeaders = () => {
    if (activeTab === "commuter")    return ["User", "Email", "Category", "Document", "Date Registered", "Actions"];
    if (activeTab === "operator")    return ["User", "Email", "Type", "Documents", "Date Registered", "Actions"];
    if (activeTab === "association") return ["Association", "Email", "Phone", "Address", "Document", "Date Registered", "Actions"];
    return [];
  };

  return (
    <div className="flex min-h-screen bg-[#f0f0eb]" style={{ fontFamily: "'Segoe UI', sans-serif" }}>

      {/* ── TOAST ── */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 ${toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>
          {toast.type === "success"
            ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>}
          {toast.message}
        </div>
      )}

      {/* ── DOCUMENT PREVIEW MODAL ── */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 sm:p-6" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between flex-wrap gap-3 px-4 sm:px-6 py-4 border-b border-slate-100">
              <div>
                <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Document Preview</p>
                <h3 className="font-bold text-slate-700 text-base">{preview.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <a href={preview.url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#1a4a52] text-white hover:opacity-90 transition-all">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  Open in new tab
                </a>
                <button onClick={() => setPreview(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  Close
                </button>
              </div>
            </div>
            <div className="p-5 bg-slate-50 flex items-center justify-center min-h-64">
              <img src={preview.url} alt={preview.title}
                className="max-h-480px w-auto rounded-lg object-contain shadow-sm"
                onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }} />
              <div className="hidden flex-col items-center gap-2 text-slate-400 py-10">
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <p className="text-sm font-medium">Cannot preview this file</p>
                <a href={preview.url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline">Open directly</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── APPLICATION FORM MODAL ── */}
      {formView && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 sm:p-6" onClick={() => setFormView(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Application Form</p>
                <h3 className="font-bold text-slate-700 text-base">{formView.claimed_name || formView.name}</h3>
              </div>
              <button onClick={() => setFormView(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                Close
              </button>
            </div>
            <div className="p-6 space-y-4">
              <FormRow label="Last Name" value={formView.last_name} />
              <FormRow label="First Name" value={formView.first_name} />
              <FormRow label="Middle Name" value={formView.middle_name} />

              {formView.role === "student" && (
                <>
                  <FormRow label="School Name" value={formView.school_name} />
                  <FormRow label="Academic Year" value={formView.academic_year} />
                  <FormRow label="Semester" value={formView.semester} />
                  <FormRow label="Student ID Number" value={formView.student_id_number} />
                  <FormRow label="ID Type" value={formView.id_type === "k12" ? "K-12" : formView.id_type === "college" ? "College" : formView.id_type} />
                </>
              )}
              {formView.role === "disabled" && (
                <>
                  <FormRow label="PWD ID Number" value={formView.id_number} />
                  <FormRow label="Issuing LGU" value={formView.issuing_lgu} />
                  <FormRow label="Validity Date" value={formView.validity_date} />
                </>
              )}
              {formView.role === "elderly" && (
                <>
                  <FormRow label="Senior Citizen ID Number" value={formView.id_number} />
                  <FormRow label="Issuing LGU" value={formView.issuing_lgu} />
                  <FormRow label="Date Issued" value={formView.date_issued} />
                  <FormRow label="Birthdate" value={formView.birthdate} />
                </>
              )}

              <div className="pt-3 border-t border-slate-100 space-y-4">
                <FormRow label="Face Match Score" value={formView.face_match_score !== null && formView.face_match_score !== undefined ? `${Number(formView.face_match_score).toFixed(1)}%` : null} />
                <FormRow label="Verification Result" value={formView.verification_detail_status} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── REJECT REASON MODAL ── */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 sm:p-6" onClick={() => setRejectModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-red-50 px-6 pt-6 pb-4">
              <h3 className="text-lg font-black text-slate-800">Reject {rejectModal.name}</h3>
              <p className="text-sm text-slate-500 mt-0.5">Explain why this application is being rejected — the applicant's record will keep this as the basis for the decision.</p>
            </div>
            <div className="px-6 py-5">
              <textarea
                autoFocus
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. ID photo doesn't match the typed school name..."
                rows={4}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-200 resize-none"
              />
              <div className="flex gap-3 mt-5">
                <button onClick={() => setRejectModal(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">
                  Cancel
                </button>
                <button onClick={confirmReject} disabled={!rejectReason.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                  Confirm Reject
                </button>
              </div>
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
            <h2 className="text-white font-black text-xl sm:text-2xl">Verify Users</h2>
            <p className="text-slate-300 text-sm mt-0.5">Approve or reject pending account verifications</p>
          </div>
        </div>

        <div className="flex-1 p-4 sm:p-8 space-y-5 overflow-x-hidden">

          {/* Tabs */}
          <div className="flex gap-2 flex-wrap">
            {TABS.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === tab.key ? "text-[#1a2a10] shadow-sm" : "bg-white text-slate-500 hover:bg-slate-50 border border-slate-200"}`}
                style={activeTab === tab.key ? { backgroundColor: "#a8d832" } : {}}>
                {tab.label}
              </button>
            ))}
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
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={getHeaders().length} className="text-center py-16">
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          <p className="text-sm font-medium">All caught up!</p>
                          <p className="text-xs">No pending verifications for {activeTab}s.</p>
                        </div>
                      </td>
                    </tr>

                  ) : activeTab === "association" ? (
                    /* ── ASSOCIATION ROWS ── */
                    users.map((assoc) => (
                      <tr key={assoc.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        {/* Name */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                              <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                              </svg>
                            </div>
                            <span className="font-bold text-slate-700">{assoc.name}</span>
                          </div>
                        </td>
                        {/* Email */}
                        <td className="px-6 py-4 text-slate-500">{assoc.email}</td>
                        {/* Phone */}
                        <td className="px-6 py-4 text-slate-500">{assoc.phone || "—"}</td>
                        {/* Address */}
                        <td className="px-6 py-4">
                          <span className="px-3 py-1 rounded-full text-xs font-medium border"
                            style={{ borderColor: "#0f766e", color: "#0f766e" }}>
                            {assoc.address || "—"}
                          </span>
                        </td>
                        {/* Documents */}
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1.5">
                            {assoc.document_url
                              ? <DocButton label="Registration Cert." onClick={() => setPreview({ url: assoc.document_url, title: "Registration/Accreditation Document (SEC/CDA)" })} color="teal" />
                              : <NoDoc label="No registration certificate" />}
                            {assoc.supporting_document_url
                              ? <DocButton label="Board Resolution" onClick={() => setPreview({ url: assoc.supporting_document_url, title: "Board Resolution / Authorization Letter" })} color="blue" />
                              : <NoDoc label="No Board Resolution" />}
                            {assoc.rep_government_id_url
                              ? <DocButton label="Rep's ID" onClick={() => setPreview({ url: assoc.rep_government_id_url, title: "Authorized Representative's Government ID" })} color="purple" />
                              : <NoDoc label="No representative ID" />}
                          </div>
                        </td>
                        {/* Date */}
                        <td className="px-6 py-4 text-slate-400">{assoc.date_added}</td>
                        {/* Actions */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <ActionButton label="Approve" type="approve" loading={actionLoading === `${assoc.id}-approve`} onClick={() => handleAction(assoc.id, "approve")} />
                            <ActionButton label="Reject"  type="reject"  loading={actionLoading === `${assoc.id}-reject`}  onClick={() => startReject(assoc)}  />
                          </div>
                        </td>
                      </tr>
                    ))

                  ) : (
                    /* ── COMMUTER / OPERATOR ROWS ── */
                    users.map((user) => {
                      const roleColor = ROLE_COLORS[user.role] || { border: "#64748b", text: "#64748b" };
                      return (
                        <tr key={user.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center shrink-0">
                                <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              </div>
                              <span className="font-bold text-slate-700">{user.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-slate-500">{user.email}</td>
                          <td className="px-6 py-4">
                            <span className="px-3 py-1 rounded-full text-xs font-medium border capitalize"
                              style={{ borderColor: roleColor.border, color: roleColor.text }}>
                              {user.role}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {activeTab === "commuter" ? (
                              user.id_front_path ? (
                                // Auto-verification pipeline (Student/PWD/Senior) captured a
                                // full document set — show the ID/Enrollment documents plus a
                                // button to view everything the applicant typed on the
                                // application form, so the admin has a real basis to cross-
                                // examine against. Deliberately never shows the applicant's
                                // facial-liveness selfies here (see verify.php) — those aren't
                                // part of the admin's review basis.
                                <div className="flex flex-col gap-1.5">
                                  <div className="text-xs text-slate-500 mb-0.5 max-w-55">
                                    <span className="font-semibold text-slate-600">{user.claimed_name || "—"}</span>
                                    {user.claimed_id_number && <> · ID# {user.claimed_id_number}</>}
                                    {user.face_match_score !== null && user.face_match_score !== undefined && (
                                      <> · Face Match: <span className={Number(user.face_match_score) < 50 ? "text-red-500 font-semibold" : Number(user.face_match_score) < 80 ? "text-amber-500 font-semibold" : "text-green-600 font-semibold"}>{Number(user.face_match_score).toFixed(1)}%</span></>
                                    )}
                                  </div>
                                  <DocButton label="Application Form" onClick={() => setFormView(user)} color="purple" />
                                  <DocButton label="ID — Front" onClick={() => setPreview({ url: user.id_front_path, title: "ID — Front" })} color="teal" />
                                  {user.id_back_path && <DocButton label="ID — Back" onClick={() => setPreview({ url: user.id_back_path, title: "ID — Back" })} color="teal" />}
                                  {user.enrollment_form_path && <DocButton label="Enrollment Form" onClick={() => setPreview({ url: user.enrollment_form_path, title: "Enrollment Form / COE" })} color="blue" />}
                                </div>
                              ) : user.document_url ? (
                                <DocButton label="Valid ID" onClick={() => setPreview({ url: user.document_url, title: "Valid ID / Discount Document" })} />
                              ) : (
                                <NoDoc />
                              )
                            ) : activeTab === "operator" ? (
                              <div className="flex flex-col gap-1.5">
                                {/* registration_document_url is deprecated in place (migration
                                    054) — still shown for any legacy operator that has one; new
                                    operators instead have the two documents below. */}
                                {user.registration_document_url && (
                                  <DocButton label="Registration Doc (legacy)" onClick={() => setPreview({ url: user.registration_document_url, title: "Valid ID / Business Permit" })} color="teal" />
                                )}
                                {user.drivers_license_url
                                  ? <DocButton label="Driver's License" onClick={() => setPreview({ url: user.drivers_license_url, title: "Driver's License" })} color="teal" />
                                  : !user.registration_document_url && <NoDoc label="No Driver's License" />}
                                {user.vehicle_or_cr_url
                                  ? <DocButton label="Vehicle OR/CR" onClick={() => setPreview({ url: user.vehicle_or_cr_url, title: "Vehicle OR/CR" })} color="blue" />
                                  : !user.registration_document_url && <NoDoc label="No Vehicle OR/CR" />}
                                {user.cpc_document_url && (
                                  <DocButton label="CPC Document" onClick={() => setPreview({ url: user.cpc_document_url, title: "Certificate of Public Convenience (CPC)" })} color="blue" />
                                )}
                                {user.ltfrb_document_url && (
                                  <DocButton label="LTFRB Document" onClick={() => setPreview({ url: user.ltfrb_document_url, title: "LTFRB Case Number Document" })} color="purple" />
                                )}
                              </div>
                            ) : (
                              user.document_url
                                ? <DocButton label="Association Document" onClick={() => setPreview({ url: user.document_url, title: "Association Document" })} />
                                : <NoDoc />
                            )}
                          </td>
                          <td className="px-6 py-4 text-slate-400">{user.date_added}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <ActionButton label="Approve" type="approve" loading={actionLoading === `${user.id}-approve`} onClick={() => handleAction(user.id, "approve")} />
                              <ActionButton label="Reject"  type="reject"  loading={actionLoading === `${user.id}-reject`}  onClick={() => startReject(user)}  />
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
              {users.length} pending verification{users.length !== 1 ? "s" : ""} for {activeTab}s
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ActionButton({ label, type, loading, onClick }) {
  const isApprove = type === "approve";
  return (
    <button onClick={onClick} disabled={loading}
      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${isApprove ? "bg-green-100 text-green-600 hover:bg-green-200" : "bg-red-100 text-red-500 hover:bg-red-200"}`}>
      {loading
        ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
        : isApprove
          ? <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>}
      {label}
    </button>
  );
}

function DocButton({ label, onClick, color = "blue" }) {
  const colors = {
    blue:   "bg-blue-50 text-blue-600 hover:bg-blue-100",
    purple: "bg-purple-50 text-purple-600 hover:bg-purple-100",
    teal:   "bg-teal-50 text-teal-600 hover:bg-teal-100",
  };
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${colors[color] || colors.blue}`}>
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
      {label}
    </button>
  );
}

function NoDoc({ label = "No document uploaded" }) {
  return <span className="text-xs text-slate-400 italic">{label}</span>;
}

function FormRow({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">{label}</span>
      <span className="text-sm text-slate-700 font-medium text-right">{value}</span>
    </div>
  );
}