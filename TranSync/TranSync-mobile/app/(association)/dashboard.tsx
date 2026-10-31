import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import { DocumentViewerModal, type ViewerDocument } from "../../src/components/DocumentViewerModal";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

type Application = {
  id:               number;
  operator_id:      number;
  operator_name:    string;
  vehicle_type:     "Jeepney" | "UV Express" | "Bus";
  operator_phone:   string;
  operator_email:   string;
  status:           "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  created_at:       string;
  reviewed_at:      string | null;
  [key: string]: any; // doc_*_url fields, present per vehicle_type
};

// One upload field per named document, matching the LTO/LTFRB checklist —
// only the fields relevant to the application's own vehicle_type are non-null.
const DOC_LABELS: Record<string, string> = {
  doc_lto_cr_url:             "LTO Certificate of Registration (CR)",
  doc_capacity_spec_url:      "Capacity Specification",
  doc_engine_cert_url:        "Engine Certificate",
  doc_lto_stencil_url:        "LTO Stencil",
  doc_model_proof_url:        "Model Proof",
  doc_terminal_route_map_url: "Terminal Route Map",
  doc_garage_proof_url:       "Garage Proof",
  doc_speed_limiter_url:      "Speed Limiter Paper",
  doc_gps_cert_url:           "GPS Certificate",
  doc_pami_policy_url:        "PAMI Policy",
  doc_fare_matrix_url:        "Fare Matrix",
};

type FilterTab = "pending" | "approved" | "rejected";

type Stats = {
  pending:  number;
  approved: number;
  rejected: number;
};

export default function AssociationDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [assoc,       setAssoc]       = useState<any>(null);
  const [apps,        setApps]        = useState<Application[]>([]);
  const [stats,       setStats]       = useState<Stats>({ pending: 0, approved: 0, rejected: 0 });
  const [filter,      setFilter]      = useState<FilterTab>("pending");
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  // review modal
  const [reviewing,   setReviewing]   = useState<Application | null>(null);
  const [action,      setAction]      = useState<"approve" | "reject" | null>(null);
  const [reason,      setReason]      = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [toast,       setToast]       = useState("");

  // In-app document viewer (zoom + swipe between an application's uploaded
  // documents) — replaces Linking.openURL, which kicked the reviewer out to
  // an external browser with no zoom and no way to move between documents.
  const [viewerIndex,   setViewerIndex]   = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);

  // Every document this application actually has a URL for — the operator's
  // registration-time document first, then whichever of the vehicle-type
  // checklist fields are populated (DOC_LABELS' own order). Fields that
  // don't apply to this vehicle_type are simply absent from the DB response
  // (never null-but-required), so no placeholder entry is needed for those —
  // only a document that *was* submitted but fails to load gets the
  // in-viewer "couldn't load" placeholder (see DocumentViewerModal).
  const reviewDocuments: ViewerDocument[] = reviewing
    ? [
        // registration_document_url is deprecated in place (migration 054) —
        // still shown for any legacy operator that has one; new operators
        // instead have the two specific documents below.
        ...(reviewing.registration_document_url
          ? [{ label: "Registration Document", url: reviewing.registration_document_url }]
          : []),
        ...(reviewing.drivers_license_url
          ? [{ label: "Driver's License", url: reviewing.drivers_license_url }]
          : []),
        ...(reviewing.vehicle_or_cr_url
          ? [{ label: "Vehicle OR/CR", url: reviewing.vehicle_or_cr_url }]
          : []),
        ...Object.entries(DOC_LABELS)
          .filter(([key]) => reviewing[key])
          .map(([key, label]) => ({ label, url: reviewing[key] as string })),
      ]
    : [];

  function openDocumentViewer(url: string) {
    const idx = reviewDocuments.findIndex((d) => d.url === url);
    setViewerIndex(Math.max(0, idx));
    setViewerVisible(true);
  }

  // ── load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) { router.replace("/(auth)/login"); return; }
      const a = JSON.parse(raw);
      setAssoc(a);

      const res  = await fetch(`${API_BASE}/associations/pending_operator_applications.php?association_id=${a.id}`);
      const data = await res.json();
      if (data.success) {
        setApps(data.applications ?? []);
        setStats(data.stats ?? { pending: 0, approved: 0, rejected: 0 });
      }
    } catch (_) {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── review submit ──────────────────────────────────────────────────────────
  const handleReview = async () => {
    if (!reviewing || !action) return;
    if (action === "reject" && !reason.trim()) {
      showToast("Please provide a rejection reason."); return;
    }
    setSubmitting(true);
    try {
      const res  = await fetch(`${API_BASE}/associations/review_operator_application.php`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          application_id:   reviewing.id,
          association_id:   assoc.id,
          action,
          rejection_reason: action === "reject" ? reason.trim() : null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(action === "approve" ? "Application approved!" : "Application rejected.");
        setReviewing(null);
        setAction(null);
        setReason("");
        load();
      } else {
        showToast(data.message || "Something went wrong.");
      }
    } catch {
      showToast("Cannot connect to server.");
    } finally {
      setSubmitting(false);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // ── filtered list ──────────────────────────────────────────────────────────
  const filtered = apps.filter((a) => a.status === filter);

  // ── loading state ──────────────────────────────────────────────────────────
  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator color="#1a4a52" size="large" />
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Applications</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {assoc?.name ?? "Association"}
          </Text>
        </View>
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingBadgeText}>{stats.pending}</Text>
          <Text style={styles.pendingBadgeLabel}>pending</Text>
        </View>
      </View>

      {/* ── STATS ROW ───────────────────────────────────────────────────────── */}
      <View style={styles.statsRow}>
        <StatCard label="Pending"  value={stats.pending}  color="#d97706" bg="#fffbeb" />
        <StatCard label="Approved" value={stats.approved} color="#16a34a" bg="#f0fdf4" />
        <StatCard label="Rejected" value={stats.rejected} color="#dc2626" bg="#fef2f2" />
      </View>

      {/* ── FILTER TABS ─────────────────────────────────────────────────────── */}
      <View style={styles.filterRow}>
        {(["pending", "approved", "rejected"] as FilterTab[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── LIST ────────────────────────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#1a4a52" />
        }
      >
        {filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          filtered.map((app) => (
            <ApplicationCard
              key={app.id}
              app={app}
              onReview={() => { setReviewing(app); setAction(null); setReason(""); }}
            />
          ))
        )}
      </ScrollView>

      {/* ── REVIEW MODAL ────────────────────────────────────────────────────── */}
      <Modal
        visible={!!reviewing}
        transparent
        animationType="slide"
        onRequestClose={() => setReviewing(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>

            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Review Application</Text>
              <TouchableOpacity onPress={() => setReviewing(null)} style={styles.closeBtn} activeOpacity={0.7}>
                <Ionicons name="close" size={18} color="#374151" />
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>

            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            {reviewing && (
              <>
                {/* Operator info */}
                <View style={styles.modalSubject}>
                  <View style={[styles.modalSubjectIcon, { backgroundColor: "#f0faf4" }]}>
                    <Ionicons name="business" size={20} color="#1a4a52" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalSubjectName}>{reviewing.operator_name}</Text>
                    <Text style={styles.modalSubjectDetail}>
                      {reviewing.vehicle_type} · {reviewing.operator_phone}
                    </Text>
                    <Text style={styles.modalSubjectOp}>{reviewing.operator_email}</Text>
                  </View>
                </View>

                {/* Documents — the operator's registration-time document (submitted at
                    signup, verified separately by the admin) plus the LTO/LTFRB
                    checklist specific to this application's vehicle_type. Showing
                    everything the operator submitted, not just the vehicle-type set. */}
                <Text style={styles.modalSectionLabel}>Documents</Text>
                <View style={styles.docRow}>
                  {reviewing.registration_document_url && (
                    <TouchableOpacity
                      style={styles.docBtn}
                      onPress={() => openDocumentViewer(reviewing.registration_document_url)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="document-text-outline" size={16} color="#1a4a52" />
                      <Text style={styles.docBtnText}>View Registration Document</Text>
                    </TouchableOpacity>
                  )}
                  {reviewing.drivers_license_url && (
                    <TouchableOpacity
                      style={styles.docBtn}
                      onPress={() => openDocumentViewer(reviewing.drivers_license_url)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="card-outline" size={16} color="#1a4a52" />
                      <Text style={styles.docBtnText}>View Driver's License</Text>
                    </TouchableOpacity>
                  )}
                  {reviewing.vehicle_or_cr_url && (
                    <TouchableOpacity
                      style={styles.docBtn}
                      onPress={() => openDocumentViewer(reviewing.vehicle_or_cr_url)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="car-outline" size={16} color="#1a4a52" />
                      <Text style={styles.docBtnText}>View Vehicle OR/CR</Text>
                    </TouchableOpacity>
                  )}
                  {Object.entries(DOC_LABELS)
                    .filter(([key]) => reviewing[key])
                    .map(([key, label]) => (
                      <TouchableOpacity
                        key={key}
                        style={styles.docBtn}
                        onPress={() => openDocumentViewer(reviewing[key])}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="document-text-outline" size={16} color="#1a4a52" />
                        <Text style={styles.docBtnText}>View {label}</Text>
                      </TouchableOpacity>
                    ))}
                </View>

                {/* Action selector */}
                <Text style={styles.modalSectionLabel}>Decision</Text>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, action === "approve" && styles.actionBtnApprove]}
                    onPress={() => { setAction("approve"); setReason(""); }}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={action === "approve" ? "#fff" : "#16a34a"}
                    />
                    <Text style={[styles.actionBtnText, action === "approve" && { color: "#fff" }]}>
                      Approve
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, action === "reject" && styles.actionBtnReject]}
                    onPress={() => setAction("reject")}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={action === "reject" ? "#fff" : "#dc2626"}
                    />
                    <Text style={[styles.actionBtnText, action === "reject" && { color: "#fff" }]}>
                      Reject
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Rejection reason */}
                {action === "reject" && (
                  <View style={styles.reasonWrap}>
                    <Text style={styles.modalSectionLabel}>Reason for rejection *</Text>
                    <TextInput
                      style={styles.reasonInput}
                      placeholder="e.g. Incomplete documents, expired license…"
                      placeholderTextColor="#9ca3af"
                      multiline
                      numberOfLines={3}
                      value={reason}
                      onChangeText={setReason}
                    />
                  </View>
                )}

                {/* Submit */}
                <TouchableOpacity
                  style={[
                    styles.modalSubmit,
                    !action && styles.modalSubmitDisabled,
                    action === "approve" && styles.modalSubmitApprove,
                    action === "reject"  && styles.modalSubmitReject,
                    submitting && { opacity: 0.7 },
                  ]}
                  onPress={handleReview}
                  disabled={!action || submitting}
                  activeOpacity={0.85}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" />
                    : (
                      <View style={styles.modalSubmitInner}>
                        <Ionicons
                          name={action === "approve" ? "checkmark-circle" : action === "reject" ? "close-circle" : "ellipse-outline"}
                          size={18}
                          color="#fff"
                        />
                        <Text style={styles.modalSubmitText}>
                          {action === "approve" ? "Confirm Approval"
                           : action === "reject"  ? "Confirm Rejection"
                           : "Select a decision above"}
                        </Text>
                      </View>
                    )}
                </TouchableOpacity>
              </>
            )}
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ── DOCUMENT VIEWER — zoom + swipe between this application's own
          uploaded documents, opened from the "View X" buttons above ── */}
      <DocumentViewerModal
        visible={viewerVisible}
        documents={reviewDocuments}
        initialIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
      />

      {/* ── TOAST ───────────────────────────────────────────────────────────── */}
      {!!toast && (
        <View style={[styles.toast, { bottom: insets.bottom + 90 }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color, bg }: {
  label: string; value: number; color: string; bg: string;
}) {
  return (
    <View style={[styles.statCard, { backgroundColor: bg }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color }]}>{label}</Text>
    </View>
  );
}

function ApplicationCard({ app, onReview }: { app: Application; onReview: () => void }) {
  const isPending  = app.status === "pending";
  const isApproved = app.status === "approved";

  const statusColor = isPending ? "#d97706" : isApproved ? "#16a34a" : "#dc2626";
  const statusBg    = isPending ? "#fffbeb" : isApproved ? "#f0fdf4" : "#fef2f2";
  const statusLabel = isPending ? "Pending"  : isApproved ? "Approved" : "Rejected";

  const date = new Date(app.created_at).toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <View style={styles.card}>
      {/* Top row */}
      <View style={styles.cardTop}>
        <View style={[styles.cardTypeIcon, { backgroundColor: "#f0faf4" }]}>
          <Ionicons name="business" size={18} color="#1a4a52" />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{app.operator_name}</Text>
          <Text style={styles.cardDetail}>{app.vehicle_type} · {app.operator_phone}</Text>
        </View>

        <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* Date */}
      <View style={styles.cardMeta}>
        <View style={styles.cardMetaItem}>
          <Ionicons name="calendar-outline" size={12} color="#9ca3af" />
          <Text style={styles.cardMetaText}>{date}</Text>
        </View>
      </View>

      {/* Rejection reason */}
      {app.status === "rejected" && app.rejection_reason && (
        <View style={styles.rejectionBox}>
          <Ionicons name="information-circle-outline" size={13} color="#dc2626" />
          <Text style={styles.rejectionText}>{app.rejection_reason}</Text>
        </View>
      )}

      {/* Review button — only for pending */}
      {isPending && (
        <TouchableOpacity style={styles.reviewBtn} onPress={onReview} activeOpacity={0.8}>
          <Ionicons name="checkmark-done-outline" size={15} color="#1a4a52" />
          <Text style={styles.reviewBtnText}>Review Application</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function EmptyState({ filter }: { filter: FilterTab }) {
  const icons: Record<FilterTab, IoniconsName> = {
    pending:  "time-outline",
    approved: "checkmark-circle-outline",
    rejected: "close-circle-outline",
  };
  const messages: Record<FilterTab, string> = {
    pending:  "No pending applications.\nNew operator applications will appear here.",
    approved: "No approved applications yet.",
    rejected: "No rejected applications.",
  };
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name={icons[filter]} size={48} color="#d1d5db" />
      <Text style={styles.emptyText}>{messages[filter]}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: "#f9fafb" },
  centered:{ flex: 1, alignItems: "center", justifyContent: "center" },

  // header
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 16, backgroundColor: "#1a4a52",
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },
  headerSub:   { fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2, maxWidth: 220 },
  pendingBadge: { alignItems: "center", backgroundColor: "#a8d832", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
  pendingBadgeText:  { fontSize: 20, fontWeight: "900", color: "#1a2a10" },
  pendingBadgeLabel: { fontSize: 10, fontWeight: "700", color: "#1a2a10" },

  // stats
  statsRow: { flexDirection: "row", gap: 10, padding: 16, paddingBottom: 0 },
  statCard:  { flex: 1, borderRadius: 12, padding: 14, alignItems: "center", gap: 2 },
  statValue: { fontSize: 22, fontWeight: "900" },
  statLabel: { fontSize: 11, fontWeight: "700" },

  // filter
  filterRow: {
    flexDirection: "row", gap: 8,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  filterTab: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    backgroundColor: "#fff", alignItems: "center",
    borderWidth: 1.5, borderColor: "#e5e7eb",
  },
  filterTabActive:     { backgroundColor: "#1a4a52", borderColor: "#1a4a52" },
  filterTabText:       { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  filterTabTextActive: { color: "#fff" },

  // list
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },

  // card
  card: {
    backgroundColor: "#fff", borderRadius: 16, padding: 16,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
    gap: 10,
  },
  cardTop:      { flexDirection: "row", alignItems: "center", gap: 12 },
  cardTypeIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardName:     { fontSize: 15, fontWeight: "800", color: "#111827" },
  cardDetail:   { fontSize: 12, color: "#6b7280", marginTop: 1 },
  statusPill:   { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText:   { fontSize: 11, fontWeight: "800" },
  cardMeta:     { flexDirection: "row", gap: 14 },
  cardMetaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardMetaText: { fontSize: 12, color: "#9ca3af" },
  rejectionBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 6,
    backgroundColor: "#fef2f2", borderRadius: 8, padding: 10,
  },
  rejectionText: { flex: 1, fontSize: 12, color: "#dc2626" },
  reviewBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#f0faf4", borderRadius: 10, paddingVertical: 10,
    borderWidth: 1.5, borderColor: "#1a4a52",
  },
  reviewBtnText: { fontSize: 13, fontWeight: "800", color: "#1a4a52" },

  // empty
  emptyWrap: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: "#9ca3af", textAlign: "center", lineHeight: 20 },

  // modal
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, gap: 16,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle:  { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  closeBtn:     { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingLeft: 8 },
  closeBtnText: { fontSize: 13, fontWeight: "700", color: "#374151" },
  modalSubject: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#f9fafb", borderRadius: 14, padding: 14,
  },
  modalSubjectIcon:   { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  modalSubjectName:   { fontSize: 15, fontWeight: "800", color: "#111827" },
  modalSubjectDetail: { fontSize: 12, color: "#6b7280", marginTop: 1 },
  modalSubjectOp:     { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  modalSectionLabel:  { fontSize: 11, fontWeight: "800", color: "#9ca3af", letterSpacing: 1, textTransform: "uppercase" },
  docRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  docBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: "#f0faf4", borderWidth: 1.5, borderColor: "#1a4a52",
  },
  docBtnDisabled: { backgroundColor: "#f9fafb", borderColor: "#e5e7eb" },
  docBtnText: { fontSize: 12.5, fontWeight: "700", color: "#1a4a52" },
  actionRow:     { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
  },
  actionBtnApprove: { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  actionBtnReject:  { backgroundColor: "#dc2626", borderColor: "#dc2626" },
  actionBtnText:    { fontSize: 14, fontWeight: "800", color: "#374151" },
  reasonWrap:  { gap: 8 },
  reasonInput: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    color: "#111827", backgroundColor: "#f9fafb",
    minHeight: 80, textAlignVertical: "top",
  },
  modalSubmit:         { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  modalSubmitDisabled: { backgroundColor: "#d1d5db" },
  modalSubmitApprove:  { backgroundColor: "#16a34a" },
  modalSubmitReject:   { backgroundColor: "#dc2626" },
  modalSubmitInner:    { flexDirection: "row", alignItems: "center", gap: 8 },
  modalSubmitText:     { fontSize: 15, fontWeight: "800", color: "#fff" },

  // toast
  toast: {
    position: "absolute", bottom: 90, alignSelf: "center",
    backgroundColor: "#1a4a52", borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  toastText: { fontSize: 13, fontWeight: "700", color: "#fff" },
});