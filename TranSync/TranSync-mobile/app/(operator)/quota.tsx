import { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, RefreshControl, Alert,
  KeyboardAvoidingView, Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import { authFetch } from "../../src/config/session";
import { groupApprovedByAssociation, resolveActiveAssociation, type AssocApplication } from "../../src/utils/activeAssociation";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

// ─── Types ────────────────────────────────────────────────────────────────────

// The "Driver Quotas" tab's own subject: a peso REMITTANCE TARGET
// (driver_quotas/quota_submissions) — how much money the operator expects a
// driver to remit daily/weekly, browsed via Vehicle Type -> Route -> Driver.
// This is never a booking cap of any kind — a driver's ability to accept
// bookings is never affected by this data. A driver still only ever has one
// active target at a time (driver_quotas has UNIQUE(driver_id));
// vehicle_type/route here are purely display context resolved live from
// wherever the driver is currently assigned, not stored on the target itself.
type RemittanceTargetDriver = {
  driver_id:      number;
  driver_name:    string;
  vehicle_id:     number | null;
  plate_number:   string | null;
  quota_id:       number | null;
  quota_amount:   number | null;
  quota_frequency:"daily" | "weekly" | null;
  period_label:   string | null;
  period_total:   number | null;
  period_remaining:number | null;
  period_met:     boolean | null;
};

type Submission = {
  id:           number;
  driver_id:    number;
  driver_name:  string;
  amount:       number;
  period_type:  "daily" | "weekly";
  status:       "pending" | "confirmed" | "rejected";
  note:         string | null;
  submitted_at: string;
  reviewed_at:  string | null;
  cashed_out_at:string | null;
  quota_target: number | null;
};

// A route the operator's fleet currently runs — sourced from routes/get_routes.php
// (association-owned, Core Flow 8/13). Used by the "Driver Quotas" (remittance
// target) tab's Vehicle Type -> Route hierarchy.
type OperatorRoute = {
  id: number; name: string | null; color: string; vehicle_type: string; status: string;
};

const VEHICLE_TYPES = ["Jeepney", "UV Express", "Bus"];

type Withdrawal = {
  id:           number;
  amount:       number;
  status:       "pending" | "paid" | "rejected";
  requested_at: string;
  resolved_at:  string | null;
};

// wallet/operator_wallet.php already returns this array — every row is a
// completed ledger entry ("status" is always "completed", the backend
// derives it since wallet_transactions has no pending state of its own,
// unlike withdrawal_requests above).
type Transaction = {
  id:             number;
  type:           "debit" | "credit";
  amount:         number;
  reference_type: string;
  reference_id:   number | null;
  note:           string | null;
  balance_after:  number;
  status:         string;
  created_at:     string;
};

function txLabel(t: Transaction): string {
  if (t.note) return t.note;
  switch (t.reference_type) {
    case "remittance_fee": return "Booking Remittance";
    case "rebooking_fee":  return "Rebooking Fee Share";
    case "withdrawal":     return "Withdrawal";
    case "quota_refund":   return "Quota Refund";
    default:                return "Transaction";
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(s: string) {
  if (s === "confirmed" || s === "paid") return "#16a34a";
  if (s === "rejected")  return "#dc2626";
  return "#f59e0b";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-PH", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function QuotaScreen() {
  const insets = useSafeAreaInsets();

  const [operatorId,   setOperatorId]   = useState<number | null>(null);
  // Whether this operator currently has any Bus/UV Express vehicle context —
  // an operator can hold multiple vehicle types now, so this is derived live
  // from their actual fleet/drivers rather than one fixed operator_type.
  const [hasBusOrUv,   setHasBusOrUv]   = useState(false);
  // The active association's own id (Profile → My Associations → Switch) —
  // both quota concepts are scoped to whichever association is currently
  // active, since an operator can hold the same vehicle type approved at
  // several associations at once and each is a fully independent workspace.
  const [activeAssociationId, setActiveAssociationId] = useState<number | null>(null);
  // Vehicle types approved at the active association — drives the Driver
  // Quotas tab's category chips.
  const [vehicleTypesAvailable, setVehicleTypesAvailable] = useState<string[]>([]);

  const [submissions,  setSubmissions]  = useState<Submission[]>([]);
  const [withdrawals,  setWithdrawals]  = useState<Withdrawal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [tab,          setTab]          = useState<"quotas" | "remittance" | "wallet">("quotas");
  const [walletSubTab, setWalletSubTab] = useState<"withdrawals" | "transactions">("withdrawals");
  const [toast,        setToast]        = useState("");
  const [opBalance,    setOpBalance]    = useState(0);
  // Whatever the operator had accumulated before wallets were split per
  // association (migration 031) — frozen, never credited by anything going
  // forward, but still visible and withdrawable on its own.
  const [legacyBalance, setLegacyBalance] = useState(0);
  const [withdrawFrom,  setWithdrawFrom]  = useState<"active" | "legacy">("active");

  // Withdraw modal
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [wAmount,      setWAmount]      = useState("");
  const [withdrawing,  setWithdrawing]  = useState(false);

  // Remittance mode (Bus/UV Express operators only) — Quota vs Percentage,
  // see config/remittance.php. System always keeps a flat 5% separately.
  const [remittanceMode,   setRemittanceMode]   = useState<"quota" | "percentage">("percentage");
  const [operatorFeePct,   setOperatorFeePct]   = useState("");
  const [savingMode,       setSavingMode]       = useState(false);

  // ── Driver Quotas (Vehicle Type -> Route -> Driver -> Remittance Target) ────
  // The peso remittance-target hierarchy — see RemittanceTargetDriver above.
  // Vehicle-type chips here are ALWAYS shown (locked/disabled, never hidden,
  // if the operator isn't approved for that type yet) per the feature's own
  // spec.
  const [rtVehicleType,     setRtVehicleType]     = useState<string | null>(null);
  const [operatorRoutes,    setOperatorRoutes]    = useState<OperatorRoute[]>([]);
  const [rtSelectedRouteId, setRtSelectedRouteId] = useState<number | "unassigned" | null>(null);
  const [rtRouteName,       setRtRouteName]       = useState<string | null>(null);
  const [rtDrivers,         setRtDrivers]         = useState<RemittanceTargetDriver[]>([]);
  const [loadingRtDrivers,  setLoadingRtDrivers]  = useState(false);

  const [editDriver,   setEditDriver]   = useState<RemittanceTargetDriver | null>(null);
  const [qAmount,      setQAmount]      = useState("");
  const [qFrequency,   setQFrequency]   = useState<"daily" | "weekly">("daily");
  const [qBusy,        setQBusy]        = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) return;
      const u = JSON.parse(raw);
      setOperatorId(u.id);
      loadAll(u.id);
      loadRemittanceMode(u.id);
    })();
  }, []);

  const loadRemittanceMode = async (opId: number) => {
    try {
      const res  = await fetch(`${API_BASE}/operators/set_remittance_mode.php?operator_id=${opId}`);
      const data = await res.json();
      if (data.success) {
        setRemittanceMode(data.remittance_mode);
        setOperatorFeePct(data.operator_fee_pct != null ? String(data.operator_fee_pct) : "");
      }
    } catch (_) {}
  };

  const handleSaveRemittanceMode = async () => {
    if (!operatorId) return;
    if (remittanceMode === "percentage") {
      const trimmed = operatorFeePct.trim();
      const parsed = Number(trimmed);
      if (trimmed === "" || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        showToast("Enter a valid percentage between 0 and 100.");
        return;
      }
    }
    setSavingMode(true);
    try {
      const res  = await fetch(`${API_BASE}/operators/set_remittance_mode.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: operatorId,
          remittance_mode: remittanceMode,
          operator_fee_pct: remittanceMode === "percentage" ? Number(operatorFeePct.trim()) : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Settings saved successfully.");
        // Re-sync from the server response so the field reflects exactly
        // what was persisted (e.g. normalized decimal places), not just
        // whatever the operator happened to type.
        if (data.remittance_mode) setRemittanceMode(data.remittance_mode);
        if (data.operator_fee_pct != null) setOperatorFeePct(String(data.operator_fee_pct));
      } else {
        // Deliberately don't clear remittanceMode/operatorFeePct here — the
        // operator's typed value must survive a failed save so they don't
        // have to re-enter it.
        showToast(data.message ?? "Failed to save settings. Please try again.");
      }
    } catch {
      showToast("Network error — settings were not saved. Please try again.");
    }
    finally { setSavingMode(false); }
  };

  useFocusEffect(useCallback(() => {
    if (operatorId) {
      loadAll(operatorId);
      loadRemittanceMode(operatorId);
    }
  }, [operatorId]));

  // Default the Booking Limits category to the first vehicle type this
  // operator is actually approved for, once known — and drop the selection
  // if it falls out of scope after switching active association elsewhere.
  // Default the Driver Quotas (remittance target) category to the first
  // vehicle type this operator is actually approved for, once known — every
  // vehicle type stays selectable in the UI (locked, not hidden) even when
  // this default can't land on one yet.
  useEffect(() => {
    if (rtVehicleType && !vehicleTypesAvailable.includes(rtVehicleType)) {
      setRtVehicleType(null);
      setRtSelectedRouteId(null);
      setRtDrivers([]);
      setRtRouteName(null);
    } else if (!rtVehicleType && vehicleTypesAvailable.length > 0) {
      setRtVehicleType(vehicleTypesAvailable[0]);
    }
  }, [vehicleTypesAvailable]);

  const loadAll = async (opId: number, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const safeJson = async (url: string) => {
      try { return await (await fetch(url)).json(); } catch { return {}; }
    };

    // Resolve active association fresh on every load — the operator may have
    // switched associations elsewhere (Profile tab) since this screen last loaded.
    const statusData = await safeJson(`${API_BASE}/operators/association_status.php?operator_id=${opId}`);
    const apps: AssocApplication[] = statusData.success ? (statusData.applications ?? []) : [];
    const groups = groupApprovedByAssociation(apps);
    const active = await resolveActiveAssociation(groups);
    const activeAssocId = active?.association_id ?? null;
    setActiveAssociationId(activeAssocId);
    setVehicleTypesAvailable(active?.vehicle_types ?? []);

    // Each call is independent — one failing won't stop the others
    const [driversRaw, subsData, routesData, walletData] = await Promise.all([
      safeJson(`${API_BASE}/drivers/drivers.php?operator_id=${opId}`),
      safeJson(`${API_BASE}/quota/get_submissions.php?operator_id=${opId}`),
      safeJson(`${API_BASE}/routes/get_routes.php?operator_id=${opId}`),
      safeJson(`${API_BASE}/wallet/operator_wallet.php?operator_id=${opId}&association_id=${activeAssocId ?? ""}`),
    ]);

    setOperatorRoutes(Array.isArray(routesData.routes) ? routesData.routes : []);

    if (walletData.success) {
      setOpBalance(walletData.balance ?? 0);
      setLegacyBalance(walletData.legacy_balance ?? 0);
      setWithdrawals(walletData.withdrawals ?? []);
      setTransactions(walletData.transactions ?? []);
    }

    // Scoped to the active association — a driver whose vehicle belongs to a
    // *different* association is hidden here entirely, same as the Vehicles
    // and Drivers tabs. Unassigned drivers (no vehicle yet) stay visible,
    // since they aren't tied to any association yet.
    const rawDrivers: any[] = (Array.isArray(driversRaw) ? driversRaw : [])
      .filter((d: any) => d.vehicle_id === null || d.vehicle_association_id === activeAssocId);
    setHasBusOrUv(rawDrivers.some((d: any) => d.vehicle_type && d.vehicle_type !== "Jeepney"));

    // Submissions from a driver outside the active association are hidden
    // too — each association is meant to be a fully independent workspace.
    const activeDriverIds = new Set(rawDrivers.map((d: any) => d.id));
    setSubmissions(
      Array.isArray(subsData.submissions)
        ? subsData.submissions.filter((s: Submission) => activeDriverIds.has(s.driver_id))
        : []
    );

    // Keep an already-selected route's driver list fresh on refresh/focus,
    // for the Driver Quotas (remittance) tab.
    if (rtVehicleType && rtSelectedRouteId != null) fetchRemittanceTargets(opId, rtVehicleType, rtSelectedRouteId);

    setLoading(false);
    setRefreshing(false);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // ── Driver Quotas (remittance target) ───────────────────────────────────────

  const handleSelectRtType = (t: string) => {
    setRtVehicleType(t);
    setRtSelectedRouteId(null);
    setRtDrivers([]);
    setRtRouteName(null);
  };

  const handleSelectRtRoute = (routeId: number | "unassigned") => {
    if (rtSelectedRouteId === routeId) {
      setRtSelectedRouteId(null);
      setRtDrivers([]);
      setRtRouteName(null);
      return;
    }
    setRtSelectedRouteId(routeId);
    if (operatorId && rtVehicleType) fetchRemittanceTargets(operatorId, rtVehicleType, routeId);
  };

  const fetchRemittanceTargets = async (opId: number, vehicleType: string, routeId: number | "unassigned") => {
    setLoadingRtDrivers(true);
    try {
      const params = new URLSearchParams({ operator_id: String(opId) });
      if (routeId === "unassigned") {
        params.set("vehicle_type", vehicleType);
        if (activeAssociationId) params.set("association_id", String(activeAssociationId));
      } else {
        params.set("route_id", String(routeId));
      }
      const res  = await fetch(`${API_BASE}/quota/get_remittance_targets.php?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setRtDrivers(data.drivers ?? []);
        setRtRouteName(data.route_name ?? null);
      } else {
        setRtDrivers([]);
        setRtRouteName(null);
      }
    } catch { setRtDrivers([]); setRtRouteName(null); }
    finally { setLoadingRtDrivers(false); }
  };

  const openEdit = (driver: RemittanceTargetDriver) => {
    setEditDriver(driver);
    setQAmount(driver.quota_amount != null ? String(driver.quota_amount) : "");
    setQFrequency(driver.quota_frequency ?? "daily");
  };

  const handleSetQuota = async () => {
    if (!editDriver || !operatorId) return;
    const parsed = parseFloat(qAmount);
    if (isNaN(parsed) || parsed <= 0) { showToast("Enter a valid target amount."); return; }
    setQBusy(true);
    try {
      const res  = await fetch(`${API_BASE}/quota/set_quota.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: operatorId,
          driver_id:   editDriver.driver_id,
          amount:      parsed,
          frequency:   qFrequency,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEditDriver(null);
        showToast("Remittance target saved!");
        if (rtVehicleType && rtSelectedRouteId != null) fetchRemittanceTargets(operatorId, rtVehicleType, rtSelectedRouteId);
      } else {
        showToast(data.message ?? "Failed to set target.");
      }
    } catch { showToast("Network error."); }
    finally { setQBusy(false); }
  };

  const handleRemoveQuota = (driver: RemittanceTargetDriver) => {
    Alert.alert(
      "Remove Remittance Target",
      `Remove ${driver.driver_name}'s remittance target? Their past remittance records are kept for reporting.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: async () => {
          if (!operatorId) return;
          try {
            const res  = await fetch(`${API_BASE}/quota/remove_quota.php`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ operator_id: operatorId, driver_id: driver.driver_id }),
            });
            const data = await res.json();
            if (data.success) {
              showToast("Remittance target removed.");
              if (rtVehicleType && rtSelectedRouteId != null) fetchRemittanceTargets(operatorId, rtVehicleType, rtSelectedRouteId);
            } else {
              showToast(data.message ?? "Failed to remove target.");
            }
          } catch { showToast("Network error."); }
        }},
      ]
    );
  };

  // ── Remittance: review submission ────────────────────────────────────────────

  const handleReview = (sub: Submission, action: "confirm" | "reject") => {
    const label = action === "confirm" ? "Confirm" : "Reject";
    const msg   = action === "confirm"
      ? `Confirm ₱${sub.amount.toFixed(2)} remittance from ${sub.driver_name}?`
      : `Reject this remittance? ₱${sub.amount.toFixed(2)} will be refunded to ${sub.driver_name}.`;

    Alert.alert(label + " Remittance", msg, [
      { text: "Cancel", style: "cancel" },
      { text: label, style: action === "reject" ? "destructive" : "default", onPress: async () => {
        if (!operatorId) return;
        try {
          const res  = await fetch(`${API_BASE}/quota/review_submission.php`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ submission_id: sub.id, operator_id: operatorId, action }),
          });
          const data = await res.json();
          if (data.success) {
            showToast(`Remittance ${action === "confirm" ? "confirmed" : "rejected"}.`);
            loadAll(operatorId);
          } else {
            showToast(data.message ?? "Action failed.");
          }
        } catch { showToast("Network error."); }
      }},
    ]);
  };

  // ── Wallet: withdraw ──────────────────────────────────────────────────────────

  const handleWithdraw = async () => {
    if (!operatorId) return;
    const parsed = parseFloat(wAmount);
    if (isNaN(parsed) || parsed <= 0) { showToast("Enter a valid amount."); return; }
    const sourceBalance = withdrawFrom === "legacy" ? legacyBalance : opBalance;
    if (parsed > sourceBalance) { showToast("Amount exceeds that wallet's balance."); return; }
    setWithdrawing(true);
    try {
      const res  = await authFetch(`${API_BASE}/wallet/operator_withdraw.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id: operatorId,
          amount: parsed,
          association_id: withdrawFrom === "legacy" ? null : activeAssociationId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowWithdraw(false);
        setWAmount("");
        if (withdrawFrom === "legacy") setLegacyBalance(data.new_balance ?? legacyBalance);
        else setOpBalance(data.new_balance ?? opBalance);
        showToast("Withdrawal completed.");
        loadAll(operatorId);
      } else {
        showToast(data.message ?? "Withdrawal failed.");
      }
    } catch { showToast("Network error."); }
    finally { setWithdrawing(false); }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const pendingCount = submissions.filter(s => s.status === "pending").length;
  const rtRoutesForType = rtVehicleType
    ? operatorRoutes.filter(r => r.vehicle_type === rtVehicleType && r.status === "active")
    : [];

  if (loading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }, s.centered]}>
        <ActivityIndicator size="large" color="#1a4a52" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={[s.root, { paddingTop: insets.top }]}>

      {toast !== "" && (
        <View style={[s.toast, { top: insets.top + 80 }]}>
          <Ionicons name="checkmark-circle" size={14} color="#a8d832" />
          <Text style={s.toastText}>{toast}</Text>
        </View>
      )}

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerIcon}>
          <Ionicons name="receipt" size={20} color="#1a4a52" />
        </View>
        <View>
          <Text style={s.headerTitle}>Driver Quotas</Text>
          <Text style={s.headerSub}>Remittance targets · Submissions · Wallet</Text>
        </View>
      </View>

      {/* Top-level tab switcher */}
      <View style={s.tabRow}>
        <TouchableOpacity
          style={[s.tabBtn, tab === "quotas" && s.tabBtnActive]}
          onPress={() => setTab("quotas")}
        >
          <Text style={[s.tabBtnText, tab === "quotas" && s.tabBtnTextActive]} numberOfLines={1}>Targets</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, tab === "remittance" && s.tabBtnActive]}
          onPress={() => setTab("remittance")}
        >
          <Text style={[s.tabBtnText, tab === "remittance" && s.tabBtnTextActive]} numberOfLines={1}>
            Submissions
            {pendingCount > 0 && ` (${pendingCount})`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, tab === "wallet" && s.tabBtnActive]}
          onPress={() => setTab("wallet")}
        >
          <Text style={[s.tabBtnText, tab === "wallet" && s.tabBtnTextActive]} numberOfLines={1}>Wallet</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => operatorId && loadAll(operatorId, true)}
            colors={["#1a4a52"]} tintColor="#1a4a52"
          />
        }
      >

        {/* ── Driver Quotas tab: Vehicle Type -> Route -> Driver -> Remittance Target ──
             Vehicle-type chips are ALWAYS shown, locked (not hidden) when the
             operator has no approved membership for that type yet. This is
             NEVER a booking cap — see the separate "Limits" tab. */}
        {tab === "quotas" && (
          <>
            <View style={s.categoryRow}>
              {VEHICLE_TYPES.map(t => {
                const unlocked = vehicleTypesAvailable.includes(t);
                const active = unlocked && rtVehicleType === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[s.categoryChip, active && s.categoryChipActive, !unlocked && s.categoryChipLocked]}
                    onPress={() => unlocked && handleSelectRtType(t)}
                    activeOpacity={unlocked ? 0.85 : 1}
                    disabled={!unlocked}
                  >
                    {!unlocked && <Ionicons name="lock-closed" size={11} color="#9ca3af" style={{ marginRight: 4 }} />}
                    <Text style={[s.categoryChipText, active && s.categoryChipTextActive, !unlocked && s.categoryChipTextLocked]}>{t}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {!rtVehicleType ? (
              <View style={s.empty}>
                <Ionicons name="lock-closed-outline" size={48} color="#d1d5db" />
                <Text style={s.emptyTitle}>No approved vehicle types yet</Text>
                <Text style={s.emptySub}>Apply to an association from Profile to unlock a vehicle type here.</Text>
              </View>
            ) : (
              <>
                {rtRoutesForType.length === 0 ? (
                  <View style={s.empty}>
                    <Ionicons name="map-outline" size={40} color="#d1d5db" />
                    <Text style={s.emptyTitle}>No {rtVehicleType} routes yet</Text>
                    <Text style={s.emptySub}>Routes come from your association, or from assigning one of your vehicles to a published route (Vehicles tab).</Text>
                  </View>
                ) : (
                  <>
                    <Text style={s.sectionLabel}>Route</Text>
                    {rtRoutesForType.map(r => {
                      const active = rtSelectedRouteId === r.id;
                      return (
                        <TouchableOpacity
                          key={r.id}
                          style={[s.routeCard, active && s.routeCardActive]}
                          onPress={() => handleSelectRtRoute(r.id)}
                          activeOpacity={0.85}
                        >
                          <View style={[s.routeColorDot, { backgroundColor: r.color || "#1a4a52" }]} />
                          <Text style={s.routeCardName}>{r.name}</Text>
                          <Ionicons name={active ? "chevron-down" : "chevron-forward"} size={16} color="#9ca3af" />
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}

                {/* Always offered alongside real routes, regardless of whether
                    this vehicle type has any published route yet — a driver
                    with a vehicle but no route assignment must still have
                    somewhere to get a target set. */}
                <TouchableOpacity
                  style={[s.routeCard, rtSelectedRouteId === "unassigned" && s.routeCardActive]}
                  onPress={() => handleSelectRtRoute("unassigned")}
                  activeOpacity={0.85}
                >
                  <View style={[s.routeColorDot, { backgroundColor: "#9ca3af" }]} />
                  <Text style={s.routeCardName}>Unassigned Drivers</Text>
                  <Ionicons name={rtSelectedRouteId === "unassigned" ? "chevron-down" : "chevron-forward"} size={16} color="#9ca3af" />
                </TouchableOpacity>

                {rtSelectedRouteId != null && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={s.sectionLabel}>Drivers{rtRouteName ? ` — ${rtRouteName}` : ""}</Text>
                    {loadingRtDrivers ? (
                      <ActivityIndicator color="#1a4a52" style={{ marginVertical: 16 }} />
                    ) : rtDrivers.length === 0 ? (
                      <View style={s.empty}>
                        <Ionicons name="people-outline" size={40} color="#d1d5db" />
                        <Text style={s.emptyTitle}>No drivers here</Text>
                        <Text style={s.emptySub}>
                          {rtSelectedRouteId === "unassigned"
                            ? "Every driver of this vehicle type is currently assigned to a route."
                            : "Assign a vehicle to this route (Vehicles tab), then assign a driver to that vehicle."}
                        </Text>
                      </View>
                    ) : (
                      rtDrivers.map(driver => (
                        <View key={driver.driver_id} style={s.driverCard}>
                          <View style={s.driverTop}>
                            <View style={s.driverAvatar}>
                              <Ionicons name="person" size={18} color="#fff" />
                            </View>
                            <View style={s.driverInfo}>
                              <Text style={s.driverName}>{driver.driver_name}</Text>
                              <Text style={s.driverSub}>{driver.plate_number ?? "No vehicle"}</Text>
                            </View>
                            <TouchableOpacity
                              style={s.editQuotaBtn}
                              onPress={() => openEdit(driver)}
                              activeOpacity={0.8}
                            >
                              <Ionicons name="create-outline" size={14} color="#1a4a52" />
                              <Text style={s.editQuotaBtnText}>
                                {driver.quota_amount != null ? "Edit" : "Set"} Target
                              </Text>
                            </TouchableOpacity>
                          </View>

                          {driver.quota_amount != null ? (
                            <>
                              <View style={s.quotaDisplay}>
                                <View style={s.quotaChip}>
                                  <Text style={s.quotaChipFreq}>{driver.quota_frequency?.toUpperCase()}</Text>
                                  <Text style={s.quotaChipAmount}>₱{driver.quota_amount.toFixed(2)}</Text>
                                </View>
                              </View>
                              {driver.period_total != null && (
                                <View style={[s.meetChip, { backgroundColor: driver.period_met ? "#f0fdf4" : "#fffbeb" }]}>
                                  <Ionicons
                                    name={driver.period_met ? "checkmark-circle-outline" : "time-outline"}
                                    size={13}
                                    color={driver.period_met ? "#16a34a" : "#b45309"}
                                  />
                                  <Text style={[s.meetChipText, { color: driver.period_met ? "#16a34a" : "#b45309" }]}>
                                    {driver.period_label}: ₱{driver.period_total.toFixed(2)} / ₱{driver.quota_amount.toFixed(2)}
                                    {driver.period_met ? " — Completed" : ` — ₱${(driver.period_remaining ?? 0).toFixed(2)} left`}
                                  </Text>
                                </View>
                              )}
                              <TouchableOpacity
                                style={s.removeTargetBtn}
                                onPress={() => handleRemoveQuota(driver)}
                                activeOpacity={0.8}
                              >
                                <Ionicons name="trash-outline" size={13} color="#dc2626" />
                                <Text style={s.removeTargetBtnText}>Remove Target</Text>
                              </TouchableOpacity>
                            </>
                          ) : (
                            <Text style={s.noQuotaText}>No remittance target set</Text>
                          )}
                        </View>
                      ))
                    )}
                  </View>
                )}
              </>
            )}
          </>
        )}

        {/* Remittance mode (Bus/UV Express only) — moved here from above the tab
            row so it no longer crowds every visit to Quotas; it's only shown
            on the Submissions tab, where it's actually about how your share
            gets collected. The system always keeps a flat 5% of every booking
            separately; this only controls the operator's own cut mechanism. */}
        {tab === "remittance" && hasBusOrUv && (
          <View style={[s.modeCard, { margin: 0, marginBottom: 12 }]}>
            <Text style={s.modeTitle}>Your Cut Per Booking</Text>
            <Text style={s.modeNote}>The system already deducts 5% of the fare amount. This setting controls your own share separately.</Text>
            <View style={s.modeRow}>
              {(["quota", "percentage"] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[s.modeBtn, remittanceMode === m && s.modeBtnActive]}
                  onPress={() => setRemittanceMode(m)}
                  activeOpacity={0.85}
                >
                  <Text style={[s.modeBtnText, remittanceMode === m && s.modeBtnTextActive]}>
                    {m === "quota" ? "Quota" : "Percentage"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {remittanceMode === "quota" ? (
              <Text style={s.modeDesc}>Drivers keep the full remaining 95% automatically at boarding. You collect your share separately through the remittances drivers submit below.</Text>
            ) : (
              <>
                <Text style={s.modeDesc}>Your rate is auto-deducted from every booking alongside the system's 5%. Drivers keep whatever's left.</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <TextInput
                    style={[s.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="e.g. 7"
                    placeholderTextColor="#9ca3af"
                    keyboardType="decimal-pad"
                    value={operatorFeePct}
                    onChangeText={setOperatorFeePct}
                  />
                  <Text style={{ fontSize: 14, fontWeight: "800", color: "#374151" }}>%</Text>
                </View>
              </>
            )}
            <TouchableOpacity
              style={[s.saveBtn, s.saveModeBtn, savingMode && s.saveBtnDisabled]}
              onPress={handleSaveRemittanceMode}
              disabled={savingMode}
              activeOpacity={0.85}
            >
              {savingMode ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveBtnText}>Save</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Remittance tab: Submissions (peso cash settlement) ── */}
        {tab === "remittance" && (
          submissions.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="receipt-outline" size={48} color="#d1d5db" />
              <Text style={s.emptyTitle}>No remittances yet</Text>
              <Text style={s.emptySub}>Driver cash remittances will appear here.</Text>
            </View>
          ) : (
            submissions.map(sub => (
              <View key={sub.id} style={s.subCard}>
                <View style={s.subTop}>
                  <View>
                    <Text style={s.subDriver}>{sub.driver_name}</Text>
                    <Text style={s.subMeta}>{sub.period_type} remittance · {fmtDate(sub.submitted_at)}</Text>
                    {sub.note ? <Text style={s.subNote}>"{sub.note}"</Text> : null}
                  </View>
                  <View style={[s.statusBadge, { backgroundColor: statusColor(sub.status) + "18" }]}>
                    <View style={[s.statusDot, { backgroundColor: statusColor(sub.status) }]} />
                    <Text style={[s.statusText, { color: statusColor(sub.status) }]}>
                      {sub.status === "confirmed" && sub.cashed_out_at ? "cashed out" : sub.status}
                    </Text>
                  </View>
                </View>

                <View style={s.subAmountRow}>
                  <View>
                    <Text style={s.subAmountLabel}>SUBMITTED</Text>
                    <Text style={s.subAmount}>₱{sub.amount.toFixed(2)}</Text>
                  </View>
                  {sub.quota_target != null && (
                    <View style={s.subTargetBox}>
                      <Text style={s.subAmountLabel}>TARGET</Text>
                      <Text style={s.subTarget}>₱{sub.quota_target.toFixed(2)}</Text>
                    </View>
                  )}
                </View>

                {sub.status === "pending" && (
                  <View style={s.reviewRow}>
                    <TouchableOpacity
                      style={s.rejectBtn}
                      onPress={() => handleReview(sub, "reject")}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="close-outline" size={15} color="#dc2626" />
                      <Text style={s.rejectBtnText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.confirmBtn}
                      onPress={() => handleReview(sub, "confirm")}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="checkmark-outline" size={15} color="#fff" />
                      <Text style={s.confirmBtnText}>Confirm Receipt</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))
          )
        )}

        {/* ── Wallet tab (balance + withdraw + transaction history) ── */}
        {tab === "wallet" && (
          <>
            <View style={s.cashCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.cashLabel}>WALLET BALANCE</Text>
                <Text style={s.cashAmount} numberOfLines={1} adjustsFontSizeToFit>₱{opBalance.toFixed(2)}</Text>
                <Text style={s.cashSub}>Confirming a driver remittance credits this automatically.</Text>
              </View>
              <TouchableOpacity
                style={[s.withdrawBtn, opBalance <= 0 && { opacity: 0.4 }]}
                onPress={() => { setWithdrawFrom("active"); setShowWithdraw(true); }}
                disabled={opBalance <= 0}
                activeOpacity={0.85}
              >
                <Ionicons name="arrow-down-circle-outline" size={16} color="#fff" />
                <Text style={s.withdrawBtnText}>Withdraw</Text>
              </TouchableOpacity>
            </View>

            {legacyBalance > 0 && (
              <View style={s.legacyCard}>
                <View style={{ flex: 1 }}>
                  <Text style={s.legacyLabel}>LEGACY BALANCE</Text>
                  <Text style={s.legacyAmount}>₱{legacyBalance.toFixed(2)}</Text>
                  <Text style={s.legacySub}>From before workspace switching — not tied to this or any association.</Text>
                </View>
                <TouchableOpacity
                  style={s.legacyWithdrawBtn}
                  onPress={() => { setWithdrawFrom("legacy"); setShowWithdraw(true); }}
                  activeOpacity={0.85}
                >
                  <Text style={s.legacyWithdrawBtnText}>Withdraw</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={s.subTabRow}>
              <TouchableOpacity
                style={[s.subTabBtn, walletSubTab === "withdrawals" && s.subTabBtnActive]}
                onPress={() => setWalletSubTab("withdrawals")}
              >
                <Text style={[s.subTabBtnText, walletSubTab === "withdrawals" && s.subTabBtnTextActive]}>Withdrawals</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.subTabBtn, walletSubTab === "transactions" && s.subTabBtnActive]}
                onPress={() => setWalletSubTab("transactions")}
              >
                <Text style={[s.subTabBtnText, walletSubTab === "transactions" && s.subTabBtnTextActive]}>Transactions</Text>
              </TouchableOpacity>
            </View>

            {walletSubTab === "withdrawals" && (
              withdrawals.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name="arrow-down-circle-outline" size={48} color="#d1d5db" />
                  <Text style={s.emptyTitle}>No withdrawals yet</Text>
                  <Text style={s.emptySub}>Withdrawals you make will appear here.</Text>
                </View>
              ) : (
                // Withdrawals complete instantly now — no association/admin
                // approval step (funds are already debited the moment
                // operator_withdraw.php runs). This list is purely a
                // completed-withdrawal history. "pending" is only ever shown
                // for a legacy row created before this change.
                withdrawals.map((w) => (
                  <View key={w.id} style={s.subCard}>
                    <View style={s.subTop}>
                      <View>
                        <Text style={s.subDriver}>₱{w.amount.toFixed(2)}</Text>
                        <Text style={s.subMeta}>{fmtDate(w.requested_at)}</Text>
                      </View>
                      <View style={[s.statusBadge, { backgroundColor: statusColor(w.status) + "18" }]}>
                        <View style={[s.statusDot, { backgroundColor: statusColor(w.status) }]} />
                        <Text style={[s.statusText, { color: statusColor(w.status) }]}>
                          {w.status === "paid" ? "Completed" : w.status === "rejected" ? "Rejected" : "Pending"}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )
            )}

            {walletSubTab === "transactions" && (
              transactions.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name="swap-vertical-outline" size={48} color="#d1d5db" />
                  <Text style={s.emptyTitle}>No transactions yet</Text>
                  <Text style={s.emptySub}>Booking remittances, rebooking fee shares, and other wallet activity will appear here.</Text>
                </View>
              ) : (
                transactions.map((t) => (
                  <View key={t.id} style={s.subCard}>
                    <View style={s.subTop}>
                      <View>
                        <Text style={s.subDriver}>{txLabel(t)}</Text>
                        <Text style={s.subMeta}>Ref #{t.id} · {fmtDate(t.created_at)}</Text>
                      </View>
                      <View style={[s.statusBadge, { backgroundColor: "#f0fdf418" }]}>
                        <View style={[s.statusDot, { backgroundColor: "#16a34a" }]} />
                        <Text style={[s.statusText, { color: "#16a34a" }]}>{t.status}</Text>
                      </View>
                    </View>
                    <View style={s.subAmountRow}>
                      <View>
                        <Text style={s.subAmountLabel}>{t.type === "credit" ? "CREDITED" : "DEBITED"}</Text>
                        <Text style={[s.subAmount, { color: t.type === "credit" ? "#16a34a" : "#dc2626" }]}>
                          {t.type === "credit" ? "+" : "-"}₱{t.amount.toFixed(2)}
                        </Text>
                      </View>
                      <View style={s.subTargetBox}>
                        <Text style={s.subAmountLabel}>BALANCE AFTER</Text>
                        <Text style={s.subTarget}>₱{t.balance_after.toFixed(2)}</Text>
                      </View>
                    </View>
                  </View>
                ))
              )
            )}
          </>
        )}
      </ScrollView>

      {/* ══ WITHDRAW MODAL ══ */}
      <Modal visible={showWithdraw} transparent animationType="slide" onRequestClose={() => setShowWithdraw(false)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Withdraw{withdrawFrom === "legacy" ? " — Legacy Balance" : ""}</Text>
            <Text style={s.sheetSub}>
              Available balance: ₱{(withdrawFrom === "legacy" ? legacyBalance : opBalance).toFixed(2)}
            </Text>

            <Text style={s.fieldLabel}>Amount (₱)</Text>
            <TextInput
              style={[s.input, s.inputLarge]}
              placeholder="e.g. 500.00"
              placeholderTextColor="#9ca3af"
              value={wAmount}
              onChangeText={setWAmount}
              keyboardType="decimal-pad"
              autoFocus
            />

            <View style={s.sheetActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setShowWithdraw(false); setWAmount(""); }}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, withdrawing && { opacity: 0.6 }]}
                onPress={handleWithdraw}
                disabled={withdrawing}
              >
                {withdrawing
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.saveBtnText}>Withdraw</Text>}
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ══ SET REMITTANCE TARGET MODAL ══ */}
      <Modal visible={editDriver !== null} transparent animationType="slide" onRequestClose={() => setEditDriver(null)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={s.handle} />
            <Text style={s.sheetTitle}>
              {editDriver?.quota_amount != null ? "Edit Remittance Target" : "Set Remittance Target"}
            </Text>
            <Text style={s.sheetSub}>{editDriver?.driver_name}</Text>

            <View style={s.targetContextRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.fieldLabel}>Vehicle Type</Text>
                <Text style={s.targetContextValue}>{rtVehicleType}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.fieldLabel}>Route</Text>
                <Text style={s.targetContextValue} numberOfLines={1}>{rtRouteName ?? "—"}</Text>
              </View>
            </View>

            <Text style={s.fieldLabel}>Target Amount (₱)</Text>
            <TextInput
              style={[s.input, s.inputLarge]}
              placeholder="e.g. 500.00"
              placeholderTextColor="#9ca3af"
              value={qAmount}
              onChangeText={setQAmount}
              keyboardType="decimal-pad"
              autoFocus
            />

            <Text style={s.fieldLabel}>Frequency</Text>
            <View style={s.freqRow}>
              {(["daily", "weekly"] as const).map(f => (
                <TouchableOpacity
                  key={f}
                  style={[s.freqBtn, qFrequency === f && s.freqBtnActive]}
                  onPress={() => setQFrequency(f)}
                >
                  <Text style={[s.freqBtnText, qFrequency === f && s.freqBtnTextActive]}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.sheetActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setEditDriver(null)}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, qBusy && { opacity: 0.6 }]}
                onPress={handleSetQuota}
                disabled={qBusy}
              >
                {qBusy
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.saveBtnText}>Save Target</Text>}
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

    </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: "#f9fafb" },
  centered:{ justifyContent: "center", alignItems: "center" },
  scroll:  { padding: 16, gap: 12, paddingBottom: 40 },

  toast:     { position: "absolute", top: 100, left: 20, right: 20, zIndex: 99, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, padding: 12 },
  toastText: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "700" },

  header:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  headerIcon:  { width: 40, height: 40, borderRadius: 12, backgroundColor: "#f0fdf4", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  headerSub:   { fontSize: 12, color: "#6b7280", fontWeight: "600", marginTop: 1 },

  cashCard:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, backgroundColor: "#f0fdf4", borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1.5, borderColor: "#bbf7d0" },
  cashLabel:   { fontSize: 9, fontWeight: "800", color: "#16a34a", letterSpacing: 0.8 },
  cashAmount:  { fontSize: 26, fontWeight: "900", color: "#1a4a52", marginTop: 2 },
  cashSub:     { fontSize: 11, color: "#6b7280", fontWeight: "600" },
  withdrawBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0, backgroundColor: "#1a4a52", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  withdrawBtnText: { fontSize: 13, fontWeight: "800", color: "#fff" },

  legacyCard:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fffbeb", borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1.5, borderColor: "#fde68a", gap: 10 },
  legacyLabel: { fontSize: 9, fontWeight: "800", color: "#b45309", letterSpacing: 0.8 },
  legacyAmount:{ fontSize: 18, fontWeight: "900", color: "#92400e", marginTop: 2 },
  legacySub:   { fontSize: 10, color: "#92400e", fontWeight: "600" },
  legacyWithdrawBtn:     { borderWidth: 1.5, borderColor: "#b45309", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  legacyWithdrawBtnText: { fontSize: 12, fontWeight: "800", color: "#92400e" },

  modeCard:  { backgroundColor: "#fff", margin: 16, marginBottom: 0, padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: "#f1f5f9" },
  modeTitle: { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  modeNote:  { fontSize: 11, color: "#9ca3af", marginTop: 4, marginBottom: 10, lineHeight: 15 },
  modeRow:   { flexDirection: "row", gap: 8 },
  modeBtn:   { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center", backgroundColor: "#f9fafb" },
  modeBtnActive: { backgroundColor: "#1a4a52", borderColor: "#1a4a52" },
  modeBtnText: { fontSize: 13, fontWeight: "700", color: "#6b7280" },
  modeBtnTextActive: { color: "#fff" },
  modeDesc: { fontSize: 12, color: "#374151", marginTop: 10, lineHeight: 17 },

  tabRow:         { flexDirection: "row", backgroundColor: "#fff", paddingHorizontal: 16, paddingBottom: 12, paddingTop: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  tabBtn:         { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center" },
  tabBtnActive:   { backgroundColor: "#1a4a52" },
  tabBtnText:     { fontSize: 12, fontWeight: "700", color: "#64748b" },
  tabBtnTextActive:{ color: "#fff" },

  subTabRow:          { flexDirection: "row", gap: 8, marginBottom: 4 },
  subTabBtn:          { flex: 1, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, borderColor: "#e5e7eb", backgroundColor: "#fff", alignItems: "center" },
  subTabBtnActive:    { borderColor: "#1a4a52", backgroundColor: "#f0faf4" },
  subTabBtnText:      { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  subTabBtnTextActive:{ color: "#1a4a52" },

  categoryRow:            { flexDirection: "row", gap: 8 },
  categoryChip:           { flex: 1, flexDirection: "row", paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  categoryChipActive:     { borderColor: "#1a4a52", backgroundColor: "#1a4a52" },
  categoryChipLocked:     { backgroundColor: "#f9fafb", borderColor: "#f1f5f9" },
  categoryChipText:       { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  categoryChipTextActive: { color: "#fff" },
  categoryChipTextLocked: { color: "#9ca3af" },

  sectionLabel: { fontSize: 12, fontWeight: "800", color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },

  routeCard:       { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: "#e5e7eb" },
  routeCardActive: { borderColor: "#1a4a52", backgroundColor: "#f0faf4" },
  routeColorDot:   { width: 10, height: 10, borderRadius: 5 },
  routeCardName:   { flex: 1, fontSize: 14, fontWeight: "700", color: "#374151" },

  empty:      { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#374151" },
  emptySub:   { fontSize: 13, color: "#9ca3af", textAlign: "center", paddingHorizontal: 24 },

  subCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12, borderWidth: 1.5, borderColor: "#f1f5f9" },
  subTop:  { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  subDriver:{ fontSize: 15, fontWeight: "800", color: "#1a4a52" },
  subMeta: { fontSize: 11, color: "#6b7280", marginTop: 2 },
  subNote: { fontSize: 11, color: "#9ca3af", fontStyle: "italic", marginTop: 2 },
  subAmountRow: { flexDirection: "row", alignItems: "center", gap: 20 },
  subAmountLabel:{ fontSize: 9, fontWeight: "800", color: "#6b7280", letterSpacing: 0.8 },
  subAmount:{ fontSize: 28, fontWeight: "900", color: "#1a4a52" },
  subTargetBox: { gap: 2 },
  subTarget:{ fontSize: 16, fontWeight: "800", color: "#9ca3af" },

  meetChip:    { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  meetChipText:{ fontSize: 11, fontWeight: "800" },

  statusBadge:{ flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  statusDot:  { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: "800" },

  reviewRow:  { flexDirection: "row", gap: 8 },
  rejectBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 10, paddingVertical: 10, borderWidth: 1.5, borderColor: "#fecaca", backgroundColor: "#fef2f2" },
  rejectBtnText: { fontSize: 13, fontWeight: "700", color: "#dc2626" },
  confirmBtn: { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 10, paddingVertical: 10, backgroundColor: "#1a4a52" },
  confirmBtnText:{ fontSize: 13, fontWeight: "700", color: "#fff" },

  driverCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 10, borderWidth: 1.5, borderColor: "#f1f5f9" },
  driverTop:  { flexDirection: "row", alignItems: "center", gap: 12 },
  driverAvatar: { width: 38, height: 38, borderRadius: 10, backgroundColor: "#1a4a52", alignItems: "center", justifyContent: "center" },
  driverInfo: { flex: 1 },
  driverName: { fontSize: 14, fontWeight: "800", color: "#1a4a52" },
  driverSub:  { fontSize: 11, color: "#6b7280", marginTop: 1 },
  editQuotaBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1.5, borderColor: "#1a4a52" },
  editQuotaBtnText:{ fontSize: 12, fontWeight: "700", color: "#1a4a52" },
  removeTargetBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, alignSelf: "flex-start" },
  removeTargetBtnText:{ fontSize: 11, fontWeight: "700", color: "#dc2626" },

  targetContextRow:   { flexDirection: "row", gap: 12, marginBottom: 14 },
  targetContextValue: { fontSize: 13, fontWeight: "700", color: "#374151", backgroundColor: "#f9fafb", borderRadius: 8, borderWidth: 1.5, borderColor: "#e5e7eb", paddingHorizontal: 10, paddingVertical: 8 },

  quotaDisplay: { flexDirection: "row", alignItems: "center" },
  quotaChip:    { backgroundColor: "#f0fdf4", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  quotaChipFreq:{ fontSize: 9, fontWeight: "800", color: "#16a34a", letterSpacing: 0.8 },
  quotaChipAmount:{ fontSize: 20, fontWeight: "900", color: "#1a4a52" },
  noQuotaText:  { fontSize: 12, color: "#9ca3af", fontWeight: "600" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:   { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  handle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },
  sheetTitle:{ fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  sheetSub:  { fontSize: 13, color: "#6b7280", fontWeight: "600", marginBottom: 18 },

  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  input:      { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#f9fafb", marginBottom: 14 },
  inputLarge: { fontSize: 22, fontWeight: "800", color: "#1a4a52" },

  freqRow:          { flexDirection: "row", gap: 10, marginBottom: 20 },
  freqBtn:          { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  freqBtnActive:    { borderColor: "#1a4a52", backgroundColor: "#f0fdf4" },
  freqBtnText:      { fontSize: 13, fontWeight: "700", color: "#6b7280" },
  freqBtnTextActive:{ color: "#1a4a52" },

  sheetActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn:    { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  cancelText:   { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  saveBtn:      {
    flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: "#1a4a52", alignItems: "center",
    borderWidth: 1.5, borderColor: "#123840",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  saveBtnDisabled: { opacity: 0.5 },
  // s.saveBtn's `flex: 2` is meant for the two-button rows inside
  // `sheetActions` (a flexDirection:"row" container) where it distributes
  // width against `cancelBtn`'s flex:1. Reused standalone in a plain
  // column View (no sibling, no defined parent height), `flex: 2` sets
  // flexBasis:0% on the *vertical* axis with no free space to grow into —
  // the button's content box collapses and its Text child renders at
  // zero height (invisible), even though padding/border still paint a
  // visible bar. Override back to content-based sizing here.
  // flexBasis "auto" spelled out explicitly: `flex: 0` alone sized the button
  // to its padding only in some renderers, clipping the "Save" label.
  saveModeBtn: { flex: 0, flexBasis: "auto", marginTop: 12 },
  saveBtnText:  { fontSize: 15, fontWeight: "800", color: "#ffffff", letterSpacing: 0.3 },
});
