import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import TranSyncLogo from "../assets/TranSync_Logo.png";

import API_BASE from "../config/admin_api.js";
import { authFetch, clearAdminSession } from "../config/apiClient.js";

const REFERENCE_LABELS = {
  remittance_fee: "Bus/UV remittance",
  subscription:   "Jeepney quota",
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

export default function SystemWallet() {
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [balance, setBalance]         = useState(0);
  const [byReference, setByReference] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [toast, setToast]             = useState(null);
  const navigate                      = useNavigate();

  // subscription rate editor
  const [rateFrequency, setRateFrequency] = useState("monthly");
  const [rateAmount, setRateAmount]       = useState("");
  const [rateUpdatedAt, setRateUpdatedAt] = useState(null);
  const [savingRate, setSavingRate]       = useState(false);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchWallet = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`${API_BASE}/system/system_wallet.php`);
      if (res.status === 401) { clearAdminSession(); navigate("/"); return; }
      if (!res.ok) { setError(`Server error (${res.status}).`); return; }
      const data = await res.json();
      if (data.success) {
        setBalance(data.balance);
        setByReference(data.by_reference ?? []);
        setTransactions(data.transactions ?? []);
      }
    } catch {
      setError("Failed to load system wallet. Make sure XAMPP is running.");
    } finally {
      setLoading(false);
    }
  };

  const fetchRate = async () => {
    try {
      const res  = await authFetch(`${API_BASE}/system/subscription_rate.php`);
      const data = await res.json();
      if (data.success && data.rate) {
        setRateFrequency(data.rate.frequency);
        setRateAmount(String(data.rate.amount));
        setRateUpdatedAt(data.rate.updated_at);
      }
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    fetchWallet();
    fetchRate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveRate = async () => {
    const amount = parseFloat(rateAmount);
    if (isNaN(amount) || amount <= 0) { showToast("Enter a valid amount.", "error"); return; }
    setSavingRate(true);
    try {
      const res  = await authFetch(`${API_BASE}/system/subscription_rate.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency: rateFrequency, amount }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Quota rate updated.");
        fetchRate();
      } else {
        showToast(data.message || "Failed to update rate.", "error");
      }
    } catch {
      showToast("Network error.", "error");
    } finally {
      setSavingRate(false);
    }
  };

  const handleLogout = () => {
    clearAdminSession();
    navigate("/");
  };

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
            <h2 className="text-white font-black text-xl sm:text-2xl">System Wallet</h2>
            <p className="text-slate-300 text-sm mt-0.5">Platform revenue from Bus/UV remittance and Jeepney quotas</p>
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
              Loading system wallet...
            </div>
          ) : error ? (
            <div className="bg-white rounded-xl shadow-sm text-center py-16 text-red-400 text-sm">{error}</div>
          ) : (
            <>
              {/* Balance + breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="bg-white rounded-xl shadow-sm p-6 md:col-span-1">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Balance</p>
                  <p className="text-3xl font-black text-[#1a4a52] mt-2">₱{Number(balance).toFixed(2)}</p>
                  <p className="text-xs text-slate-400 mt-1">Ledger-only — no withdrawal action exists yet</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-6 md:col-span-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">By Source</p>
                  {byReference.length === 0 ? (
                    <p className="text-sm text-slate-400">No revenue recorded yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {byReference.map((r) => (
                        <div key={r.reference_type} className="flex items-center justify-between border border-slate-100 rounded-lg px-4 py-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-700">{REFERENCE_LABELS[r.reference_type] ?? r.reference_type}</p>
                            <p className="text-xs text-slate-400">{r.count} entr{r.count !== 1 ? "ies" : "y"}</p>
                          </div>
                          <p className="text-lg font-black text-[#1a4a52]">₱{Number(r.total).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quota rate editor */}
              <div className="bg-white rounded-xl shadow-sm p-6">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Jeepney Driver Quota Rate</p>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Frequency</label>
                    <select
                      value={rateFrequency}
                      onChange={(e) => setRateFrequency(e.target.value)}
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Amount (₱)</label>
                    <input
                      type="number"
                      value={rateAmount}
                      onChange={(e) => setRateAmount(e.target.value)}
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 w-32"
                    />
                  </div>
                  <button
                    onClick={handleSaveRate}
                    disabled={savingRate}
                    className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
                    style={{ backgroundColor: "#1a4a52" }}
                  >
                    {savingRate ? "Saving..." : "Save Rate"}
                  </button>
                  {rateUpdatedAt && <p className="text-xs text-slate-400">Last updated {rateUpdatedAt}</p>}
                </div>
              </div>

              {/* Transactions */}
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-180">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Source</th>
                      <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Amount</th>
                      <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Note</th>
                      <th className="text-left px-6 py-4 text-slate-400 font-semibold text-xs uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-16 text-slate-400 text-sm">No transactions yet.</td>
                      </tr>
                    ) : (
                      transactions.map((t, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-medium text-slate-600">{REFERENCE_LABELS[t.reference_type] ?? t.reference_type}</td>
                          <td className="px-6 py-4 font-semibold text-[#1a4a52]">₱{Number(t.amount).toFixed(2)}</td>
                          <td className="px-6 py-4 text-slate-500">{t.note}</td>
                          <td className="px-6 py-4 text-slate-400 text-xs">{t.created_at}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
