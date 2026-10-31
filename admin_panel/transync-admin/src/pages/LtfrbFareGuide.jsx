import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import TranSyncLogo from "../assets/TranSync_Logo.png";

import API_BASE from "../config/admin_api.js";
import { authFetch, clearAdminSession } from "../config/apiClient.js";

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

// Fixed display order — these 9 categories are seeded once (migration 036)
// and never added to/removed from here; this page only ever replaces the
// PDF behind one of them.
const VEHICLE_ORDER = ["Jeepney", "UV Express", "Bus"];

export default function LtfrbFareGuide() {
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [guides, setGuides]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [toast, setToast]       = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const fileInputRefs = useRef({});
  const navigate = useNavigate();

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchGuides = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`${API_BASE}/reference/ltfrb_fare_guides.php?admin=1`);
      if (res.status === 401) { clearAdminSession(); navigate("/"); return; }
      if (!res.ok) { setError(`Server error (${res.status}).`); return; }
      const data = await res.json();
      if (data.success) setGuides(data.guides ?? []);
      else setError(data.message || "Failed to load fare guides.");
    } catch {
      setError("Failed to load fare guides. Make sure XAMPP is running.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGuides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    clearAdminSession();
    navigate("/");
  };

  const handlePickFile = (id) => {
    fileInputRefs.current[id]?.click();
  };

  const handleFileChosen = async (guide, e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-choosing the same file name later
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      showToast("Please choose a PDF file.", "error");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast("PDF must be smaller than 20MB.", "error");
      return;
    }

    setUploadingId(guide.id);
    try {
      const formData = new FormData();
      formData.append("id", guide.id);
      formData.append("pdf", file);

      const res = await authFetch(`${API_BASE}/reference/update_ltfrb_fare_guide.php`, {
        method: "POST",
        body: formData,
      });
      if (res.status === 401) { clearAdminSession(); navigate("/"); return; }
      const data = await res.json();
      if (data.success) {
        showToast(`Updated "${guide.label}".`);
        fetchGuides();
      } else {
        showToast(data.message || "Failed to upload PDF.", "error");
      }
    } catch {
      showToast("Network error. Try again.", "error");
    } finally {
      setUploadingId(null);
    }
  };

  const grouped = VEHICLE_ORDER.map((vt) => ({
    vehicleType: vt,
    rows: guides.filter((g) => g.vehicle_type === vt),
  })).filter((g) => g.rows.length > 0);

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
            <h2 className="text-white font-black text-xl sm:text-2xl">LTFRB Fare Guide</h2>
            <p className="text-slate-300 text-sm mt-0.5">Replace the official fare-matrix PDF shown to commuters, per vehicle type/class</p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 p-4 sm:p-8 space-y-5 overflow-x-hidden">

          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Loading fare guides...
            </div>
          ) : error ? (
            <div className="bg-white rounded-xl shadow-sm text-center py-16 text-red-400 text-sm">{error}</div>
          ) : (
            grouped.map((section) => (
              <div key={section.vehicleType} className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <p className="text-sm font-bold text-[#1a4a52]">{section.vehicleType}</p>
                </div>
                <div className="divide-y divide-slate-50">
                  {section.rows.map((guide) => (
                    <div key={guide.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700">{guide.label}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {guide.updated_at ? `Last updated ${guide.updated_at}` : "Original document — never replaced"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={guide.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                          View Current PDF
                        </a>
                        <button
                          onClick={() => handlePickFile(guide.id)}
                          disabled={uploadingId === guide.id}
                          className="px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-50"
                          style={{ backgroundColor: "#1a4a52" }}
                        >
                          {uploadingId === guide.id ? "Uploading..." : "Upload New PDF"}
                        </button>
                        <input
                          ref={(el) => { fileInputRefs.current[guide.id] = el; }}
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          onChange={(e) => handleFileChosen(guide, e)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
