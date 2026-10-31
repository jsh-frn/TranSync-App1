import { useState, useEffect, useCallback } from "react";
import API_BASE from "../config/admin_api.js";
import { authFetch } from "../config/apiClient.js";

// Driver emergency (SOS) alerts, sent from the driver app's EMERGENCY button
// (drivers/send_emergency.php). Rendered at the very top of Overview,
// independent of the stats loading state below it, so an emergency is never
// hidden behind a slow or failed dashboard fetch. Polls every 15s.
const POLL_MS = 15000;

// Alert ids already announced this browser session (sound / desktop
// notification) — so returning to Overview doesn't re-beep for the same alert.
const SEEN_KEY = "emergencySeenIds";
const readSeen  = () => { try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]"); } catch { return []; } };
const writeSeen = (ids) => { try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(ids)); } catch { /* ignore */ } };

// Three short beeps via the Web Audio API — no audio file needed. Browsers only
// allow sound after the page has had a user interaction, which a logged-in
// admin always has (the login click), so this normally plays; if a browser
// blocks it, the alert box + flashing tab title still show.
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.25);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* sound is a bonus, never an error */ }
}

const fmtTime = (s) =>
  new Date(s.replace(" ", "T")).toLocaleString("en-PH", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

const vehicleLabel = (a) =>
  [a.plate_number, a.vehicle_number, a.vehicle_type].filter(Boolean).join(" • ") || "No vehicle assigned";

function AlertRow({ a, onResolve, resolving }) {
  const hasLoc = a.latitude !== null && a.longitude !== null;
  const isActive = a.status === "active";
  return (
    <div className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 ${
      isActive ? "border-red-200 bg-white" : "border-slate-100 bg-slate-50"
    }`}>
      <div className="min-w-0 space-y-1">
        <p className="font-black text-[#1a4a52] break-words">
          {a.driver_name}
          {a.driver_phone && <span className="font-semibold text-slate-500"> · {a.driver_phone}</span>}
        </p>
        <p className="text-sm text-slate-600 break-words">{vehicleLabel(a)}</p>
        <p className="text-sm text-slate-500 break-words">
          Operator: {a.operator_name || "—"}
          {a.operator_phone && ` · ${a.operator_phone}`}
        </p>
        <p className="text-xs text-slate-400">{fmtTime(a.created_at)}</p>
        {a.message && <p className="text-sm text-slate-700 break-words pt-1">"{a.message}"</p>}
        <p className="text-sm pt-1">
          {hasLoc ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`}
              target="_blank" rel="noopener noreferrer"
              className="font-semibold text-blue-600 hover:underline"
            >
              Open location in Maps ↗
            </a>
          ) : (
            <span className="text-amber-700">Location unavailable — contact the driver or operator.</span>
          )}
        </p>
      </div>
      {isActive && (
        <button
          onClick={() => onResolve(a)}
          disabled={resolving}
          className="shrink-0 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          {resolving ? "Resolving…" : "Mark Resolved"}
        </button>
      )}
    </div>
  );
}

export default function EmergencyAlerts() {
  const [alerts, setAlerts]           = useState([]);
  const [showResolved, setShowResolved] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  const [toast, setToast]             = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/system/emergency_alerts.php`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) setAlerts(data.alerts ?? []);
    } catch { /* keep the last data on a failed poll */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const handleResolve = async (a) => {
    if (!window.confirm(`Mark ${a.driver_name}'s emergency as resolved? Only do this once they're safe and it's handled.`)) return;
    setResolvingId(a.id);
    try {
      const res = await authFetch(`${API_BASE}/system/emergency_alerts.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: a.id }),
      });
      const data = await res.json();
      if (data.success) { showToast("Alert marked as resolved."); load(); }
      else showToast(data.message || "Couldn't resolve the alert.", "error");
    } catch {
      showToast("Network error.", "error");
    } finally {
      setResolvingId(null);
    }
  };

  const active   = alerts.filter((a) => a.status === "active");
  const resolved = alerts.filter((a) => a.status === "resolved");

  const [notifPerm, setNotifPerm] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  // Announce each NEW active alert once per session: beep + (if the admin
  // enabled them) a desktop notification, which shows even when this tab is in
  // the background.
  useEffect(() => {
    const seen = readSeen();
    const fresh = active.filter((a) => !seen.includes(a.id));
    if (fresh.length === 0) return;
    writeSeen([...seen, ...fresh.map((a) => a.id)]);
    beep();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Emergency alert", {
          body: fresh.length === 1
            ? `${fresh[0].driver_name} sent an emergency alert.`
            : `${fresh.length} drivers sent emergency alerts.`,
          requireInteraction: true,
        });
      } catch { /* some browsers only allow this via a service worker */ }
    }
  }, [alerts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flash the browser tab title while any alert is unresolved, so it's noticed
  // from another tab too.
  useEffect(() => {
    if (active.length === 0) return;
    const original = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? `EMERGENCY (${active.length}) - TranSync Admin` : original;
    }, 1000);
    return () => { clearInterval(t); document.title = original; };
  }, [active.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {toast && (
        <div className={`fixed top-5 left-4 right-4 sm:left-auto sm:right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold ${
          toast.type === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"
        }`}>
          {toast.message}
        </div>
      )}

      {active.length > 0 ? (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <h3 className="font-black text-red-700 text-lg">Active Emergency Alerts ({active.length})</h3>
          </div>
          {active.map((a) => (
            <AlertRow key={a.id} a={a} onResolve={handleResolve} resolving={resolvingId === a.id} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">No active emergency alerts.</p>
      )}

      {notifPerm === "default" && (
        <button
          onClick={() => Notification.requestPermission().then(setNotifPerm)}
          className="text-xs font-semibold text-blue-600 hover:underline py-1"
        >
          Enable desktop notifications for emergencies
        </button>
      )}

      {resolved.length > 0 && (
        <div>
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 py-2"
          >
            {showResolved ? "▾" : "▸"} Recently resolved ({resolved.length})
          </button>
          {showResolved && (
            <div className="space-y-2 mt-1">
              {resolved.map((a) => <AlertRow key={a.id} a={a} onResolve={handleResolve} resolving={false} />)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
