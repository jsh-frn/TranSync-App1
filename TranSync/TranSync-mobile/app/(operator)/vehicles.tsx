import { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import { groupApprovedByAssociation, resolveActiveAssociation, type AssocApplication } from "../../src/utils/activeAssociation";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";

type Vehicle = {
  id:                 number;
  type:               string;
  plate_number:       string;
  vehicle_number:     string | null;
  bus_number:         string | null;
  service_type_id:    number | null;
  service_type_name:  string | null;
  capacity:           number | null;
  status:             "active" | "inactive";
  driver_id:          number | null;
  driver_name:        string | null;
  // Which specific association this vehicle belongs to — an operator can
  // hold the same vehicle type approved at several associations at once, so
  // `type` alone no longer identifies which workspace a vehicle belongs to.
  association_id:     number | null;
  association_name:   string | null;
  assigned_routes:    { id: number; name: string }[];
};

type ServiceType = { id: number; name: string; description: string | null };

// A route the operator can attach to this vehicle — sourced from their own
// approved association for the vehicle's own type (routes are
// association-owned, see routes/save_route.php; Core Flow 8/13). A vehicle
// carries its own route now (migration 056), set here instead of from
// Add/Edit Driver.
type AssignableRoute = {
  id: number; name: string | null; from_location: string | null; to_location: string | null;
  vehicle_type: string; status: string;
};

// ── Seat Layout Builder + Library ───────────────────────────────────────────
// "blank" marks the aisle path itself — a non-bookable, non-selectable
// placeholder (never counted toward capacity), distinct from "aisle" which
// describes a real bookable seat next to the aisle.
type SeatType = "window" | "aisle" | "sleeper" | "driver" | "conductor" | "blank";
type BuilderSeat = {
  seat_label: string; seat_row: number; seat_col: number;
  seat_type: SeatType; is_blocked: boolean; has_active_booking?: boolean;
};
type SeatTemplate = {
  id: number; name: string | null; service_type_id: number; service_type_name: string;
  capacity: number; layout_style: string; seat_count: number; created_at: string;
};
const SEAT_TYPES: SeatType[] = ["window", "aisle", "sleeper", "driver", "conductor", "blank"];

// Pure, deterministic layout generator — the operator only reviews/edits the
// result afterward (drag/delete/move/rename via the existing builder tools).
// Always seats Driver + Conductor up front (row 0), non-bookable.
function generateLayout(style: "standard" | "sleeper", capacity: number): BuilderSeat[] {
  const seats: BuilderSeat[] = [
    { seat_label: "DRIVER", seat_row: 0, seat_col: 1, seat_type: "driver", is_blocked: false },
    { seat_label: "CONDUCTOR", seat_row: 0, seat_col: 2, seat_type: "conductor", is_blocked: false },
  ];

  if (style === "sleeper") {
    // Two berth positions per row (one each side of the aisle), each a
    // Lower-then-Upper pair — individually labeled and bookable. Column 3 is
    // always a real, non-bookable `blank` placeholder marking the aisle path
    // between the left and right berths, same convention as the standard
    // layout — the right pair shifts to columns 4/5 to make room for it.
    let remaining = capacity;
    let row = 1;
    while (remaining > 0) {
      seats.push({ seat_label: `${row}L-Lower`, seat_row: row, seat_col: 1, seat_type: "sleeper", is_blocked: false });
      remaining--;
      if (remaining > 0) { seats.push({ seat_label: `${row}L-Upper`, seat_row: row, seat_col: 2, seat_type: "sleeper", is_blocked: false }); remaining--; }
      seats.push({ seat_label: `${row}-aisle`, seat_row: row, seat_col: 3, seat_type: "blank", is_blocked: false });
      if (remaining > 0) { seats.push({ seat_label: `${row}R-Lower`, seat_row: row, seat_col: 4, seat_type: "sleeper", is_blocked: false }); remaining--; }
      if (remaining > 0) { seats.push({ seat_label: `${row}R-Upper`, seat_row: row, seat_col: 5, seat_type: "sleeper", is_blocked: false }); remaining--; }
      row++;
    }
    return seats;
  }

  // Standard: 2x2 with a center aisle, numbered front-to-back. Column 3 is
  // always left empty — a real (non-bookable, non-selectable) blank spacer
  // seat marks the aisle path itself, rather than relying on a plain gap in
  // the numbering that the grid can't tell apart from "no seat here yet."
  const letters = ["A", "B", "C", "D"];
  const seatCols = [1, 2, 4, 5]; // col 3 reserved for the aisle blank
  const fullRows = Math.floor(capacity / 4);
  const remainder = capacity % 4;

  for (let row = 1; row <= fullRows; row++) {
    for (let i = 0; i < 4; i++) {
      const col = seatCols[i];
      seats.push({
        seat_label: `${row}${letters[i]}`, seat_row: row, seat_col: col,
        seat_type: col === 1 || col === 5 ? "window" : "aisle", is_blocked: false,
      });
    }
    seats.push({ seat_label: `${row}-aisle`, seat_row: row, seat_col: 3, seat_type: "blank", is_blocked: false });
  }

  if (remainder === 2) {
    const row = fullRows + 1;
    seats.push({ seat_label: `${row}A`, seat_row: row, seat_col: 1, seat_type: "window", is_blocked: false });
    seats.push({ seat_label: `${row}-aisle`, seat_row: row, seat_col: 3, seat_type: "blank", is_blocked: false });
    seats.push({ seat_label: `${row}D`, seat_row: row, seat_col: 5, seat_type: "window", is_blocked: false });
  } else if (remainder === 1 || remainder === 3) {
    // Can't split an odd remainder cleanly across 2+2 — drop the last full
    // row back out (if any) and make that row a solid 5-seat bench instead,
    // no aisle gap: the very back row of a real bus spans the full width,
    // since the aisle has nowhere left to continue to past it.
    const benchRow = fullRows > 0 ? fullRows : 1;
    if (fullRows > 0) {
      for (let i = seats.length - 1; i >= 0; i--) {
        if (seats[i].seat_row === benchRow && seats[i].seat_type !== "driver" && seats[i].seat_type !== "conductor") {
          seats.splice(i, 1);
        }
      }
    }
    const benchLetters = ["A", "B", "C", "D", "E"];
    for (let col = 1; col <= 5; col++) {
      seats.push({
        seat_label: `${benchRow}${benchLetters[col - 1]}`, seat_row: benchRow, seat_col: col,
        seat_type: col === 1 || col === 5 ? "window" : "aisle", is_blocked: false,
      });
    }
  }

  return seats;
}

const VEHICLE_TYPES = ["Jeepney", "UV Express", "Bus"] as const;

// Seat count is a fixed pick, not a layout description — Jeepney: 12 up to
// 36, in 2s. UV Express: 9-12, any value (includes the driver's own seat).
// Bus has no upfront capacity pick at all — see the class/layout flow below.
const CAPACITY_OPTIONS: number[] = Array.from({ length: 13 }, (_, i) => 12 + i * 2);
const UV_CAPACITY_OPTIONS: number[] = Array.from({ length: 10 }, (_, i) => 9 + i);

const TYPE_ICON: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  "Jeepney":    "bus",
  "UV Express": "car",
  "Bus":        "bus-outline",
};

const TYPE_COLOR: Record<string, string> = {
  "Jeepney":    "#16a34a",
  "UV Express": "#9333ea",
  "Bus":        "#2563eb",
};

export default function VehiclesScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Seat-builder cell size: up to 5 columns + 4 gaps of 8 inside the sheet's 24px side padding.
  const seatCellW = Math.max(36, Math.min(48, Math.floor((windowWidth - 48 - 32) / 5)));

  const [user,       setUser]       = useState<any>(null);
  const [vehicles,   setVehicles]   = useState<Vehicle[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [hasAssociation, setHasAssociation] = useState(false);
  const [approvedTypes, setApprovedTypes]   = useState<string[]>([]);
  // The active association's own id — an operator can hold the same vehicle
  // type approved at several associations at once, so filtering the fleet
  // must match a vehicle's actual association_id, not just its type.
  const [activeAssociationId, setActiveAssociationId] = useState<number | null>(null);

  // Vehicle-list filter — client-side only (the fleet is already fetched in
  // full per operator_id, see fetchVehicles), updates the visible list
  // immediately on tap. Options are further scoped down to the operator's
  // active association's approved types (see fetchAssocStatus/approvedTypes)
  // — vehicles belong to the operator directly, but which types are even
  // choosable here follows whichever association is currently active.
  const [vehicleFilter, setVehicleFilter] = useState<"All" | (typeof VEHICLE_TYPES)[number]>("All");

  // If switching active association drops the currently-selected type filter
  // out of scope (e.g. filter was "Bus" but the new active association only
  // has Jeepney), fall back to "All" rather than showing an empty list with
  // no chip highlighted.
  useEffect(() => {
    if (vehicleFilter !== "All" && !approvedTypes.includes(vehicleFilter)) {
      setVehicleFilter("All");
    }
  }, [approvedTypes]);

  const [showAdd,      setShowAdd]      = useState(false);
  const [showDelete,   setShowDelete]   = useState<Vehicle | null>(null);
  const [showUnassign, setShowUnassign] = useState<Vehicle | null>(null);
  const [submitting,   setSubmitting]   = useState(false);
  const [unassigning,  setUnassigning]  = useState(false);
  const [toast,      setToast]      = useState("");
  const [formError,  setFormError]  = useState("");

  // form fields — vehicle type is now an open choice (one operator can hold
  // multiple approved vehicle types), gated to only the types they're
  // actually approved for, not derived from a single fixed account field.
  const [vVehicleType,  setVVehicleType]  = useState<string>("");
  const [vPlate,        setVPlate]        = useState("");
  const [vNumber,       setVNumber]       = useState("");
  const [vCapacityPick, setVCapacityPick] = useState<number | null>(null);
  const [vBusNumber,    setVBusNumber]    = useState("");
  const [vServiceType,  setVServiceType]  = useState<number | null>(null);
  const [vRouteId,      setVRouteId]      = useState<number | null>(null);
  // Bus only — optional. If given, the Seat Layout Builder opens right after
  // registration with this layout already generated as a draft (still
  // reviewable/editable, still requires "Save Layout" — see handleAddVehicle)
  // instead of opening empty and making the operator tap Generate themselves.
  const [vSeatCount,    setVSeatCount]    = useState("");
  const [vLayoutStyle,  setVLayoutStyle]  = useState<"standard" | "sleeper">("standard");

  // edit plate_number/vehicle_number (+ Bus's bus_number/class) via update_details
  const [editVehicle,   setEditVehicle]   = useState<Vehicle | null>(null);
  const [editPlate,     setEditPlate]     = useState("");
  const [editNumber,    setEditNumber]    = useState("");
  const [editBusNumber, setEditBusNumber] = useState("");
  const [editServiceType, setEditServiceType] = useState<number | null>(null);
  const [editRouteId,   setEditRouteId]   = useState<number | null>(null);
  const [editCapacity,  setEditCapacity]  = useState("");
  const [routeLoadError, setRouteLoadError] = useState("");
  const [editError,     setEditError]     = useState("");
  const [editSubmitting,setEditSubmitting] = useState(false);

  const [serviceTypes,     setServiceTypes]     = useState<ServiceType[]>([]);
  const [availableRoutes,  setAvailableRoutes]  = useState<AssignableRoute[]>([]);
  const [loadingRoutes,    setLoadingRoutes]    = useState(false);

  // Seat layout generator (Bus only) — pure client-side generateLayout(),
  // populates the builder for review; nothing is saved until "Save Layout".
  const [showGenerateModal, setShowGenerateModal] = useState<"standard" | "sleeper" | null>(null);
  const [generateCapacity,  setGenerateCapacity]  = useState("");

  // Seat Layout Builder — free add/move/remove/rename, saved per vehicle.
  const [builderVehicle, setBuilderVehicle] = useState<Vehicle | null>(null);
  const [builderSeats,   setBuilderSeats]   = useState<BuilderSeat[]>([]);
  const [builderLoading, setBuilderLoading] = useState(false);
  const [builderSaving,  setBuilderSaving]  = useState(false);
  const [builderError,   setBuilderError]   = useState("");
  // Generating/adding/editing seats only changes local state — nothing is
  // persisted until "Save Layout" is tapped. This tracks that so the UI can
  // make the unsaved state unmistakable (a real point of confusion: an
  // operator generated a layout, saw it in the review grid, but never tapped
  // Save Layout, so the vehicle's capacity stayed unset).
  const [builderDirty,   setBuilderDirty]   = useState(false);

  // Seat editor — mini-modal stacked on top of the builder
  const [editingSeatIdx, setEditingSeatIdx] = useState<number | null>(null);
  const [seatEditLabel,  setSeatEditLabel]  = useState("");
  const [seatEditType,   setSeatEditType]   = useState<SeatType>("window");
  const [seatEditBlocked,setSeatEditBlocked]= useState(false);
  const [seatEditRow,    setSeatEditRow]    = useState(1);
  const [seatEditCol,    setSeatEditCol]    = useState(1);

  // Seat Layout Library — named templates, applying makes an independent copy
  const [showLibrary,     setShowLibrary]     = useState(false);
  const [libraryTemplates,setLibraryTemplates]= useState<SeatTemplate[]>([]);
  const [libraryLoading,  setLibraryLoading]  = useState(false);
  const [applyingTemplateId, setApplyingTemplateId] = useState<number | null>(null);

  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateNameDraft,setTemplateNameDraft] = useState("");
  const [savingTemplate,   setSavingTemplate]    = useState(false);

  const [showClearLayout, setShowClearLayout] = useState(false);
  const [clearingLayout,  setClearingLayout]  = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("user");
      if (raw) {
        const u = JSON.parse(raw);
        setUser(u);
        fetchVehicles(u.id);
        const assocId = await fetchAssocStatus(u.id);
        fetchServiceTypes(u.id, assocId);
      }
    })();
  }, []);

  useFocusEffect(useCallback(() => {
    if (user) {
      (async () => {
        fetchVehicles(user.id);
        const assocId = await fetchAssocStatus(user.id);
        fetchServiceTypes(user.id, assocId);
      })();
    }
  }, [user]));

  // approvedTypes is scoped to the operator's currently *active* association
  // (Profile → My Associations → Switch), not every type approved anywhere —
  // switching association elsewhere and returning to this screen re-resolves
  // it via useFocusEffect, so the fleet shown here always matches whichever
  // association is active. For an operator with only one association, this
  // is identical to "every approved type," so nothing changes for them.
  const fetchAssocStatus = async (operatorId: number): Promise<number | null> => {
    try {
      const res  = await fetch(`${API_BASE}/operators/association_status.php?operator_id=${operatorId}`);
      const data = await res.json();
      const apps: AssocApplication[] = data.success ? (data.applications ?? []) : [];
      const groups = groupApprovedByAssociation(apps);
      const active = await resolveActiveAssociation(groups);
      const approved = active?.vehicle_types ?? [];
      setApprovedTypes(approved);
      setActiveAssociationId(active?.association_id ?? null);
      setHasAssociation(approved.length > 0);
      return active?.association_id ?? null;
    } catch {
      setHasAssociation(false); setApprovedTypes([]); setActiveAssociationId(null);
      return null;
    }
  };

  // Read-only — classes (Ordinary/Deluxe/Royal) belong to the operator's
  // association now; the operator can only pick from what it's defined,
  // never create/edit one itself (see associations/service_types.php).
  // Scoped to the active association — an operator Bus-approved at two
  // associations at once must only see the active one's classes here,
  // never a union of both (which class a new vehicle can register under).
  const fetchServiceTypes = async (operatorId: number, associationId: number | null) => {
    try {
      const qs  = associationId ? `&association_id=${associationId}` : "";
      const res  = await fetch(`${API_BASE}/operators/get_association_service_types.php?operator_id=${operatorId}${qs}`);
      const data = await res.json();
      if (data.success) setServiceTypes(data.service_types ?? []);
    } catch (_) {}
  };

  // Same read-only sourcing as classes above — the operator only picks from
  // routes its active association has already published for this vehicle's
  // own type, never creates/edits one itself.
  const fetchAvailableRoutes = async (associationId: number | null, type: string) => {
    setAvailableRoutes([]);
    setRouteLoadError("");
    if (!associationId || !type) {
      setRouteLoadError("This vehicle isn't linked to an association yet. Make sure you're approved for this vehicle type, then try again.");
      return;
    }
    setLoadingRoutes(true);
    try {
      const res  = await fetch(`${API_BASE}/routes/get_association_routes.php?association_id=${associationId}`);
      const data = await res.json();
      const list: AssignableRoute[] = Array.isArray(data.routes)
        ? data.routes.filter((r: any) => r.vehicle_type === type && r.status === "active")
        : [];
      setAvailableRoutes(list);
    } catch (_) {
      setRouteLoadError("Couldn't load routes. Check your connection and reopen this screen.");
    }
    finally { setLoadingRoutes(false); }
  };

  // ── SEAT LAYOUT BUILDER (Bus only) ──────────────────────────────────────────
  const openSeatBuilder = async (vehicle: Vehicle) => {
    setBuilderVehicle(vehicle);
    setBuilderError("");
    await loadBuilderSeats(vehicle.id);
  };

  const loadBuilderSeats = async (vehicleId: number) => {
    setBuilderLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/vehicles/get_seat_layout.php?vehicle_id=${vehicleId}`);
      const data = await res.json();
      setBuilderSeats(data.success ? data.seats : []);
      setBuilderDirty(false);
    } catch { setBuilderSeats([]); }
    finally { setBuilderLoading(false); }
  };

  const closeSeatBuilder = () => {
    setBuilderVehicle(null);
    setBuilderSeats([]);
    setBuilderError("");
    setBuilderDirty(false);
  };

  const nextRow = () => builderSeats.length ? Math.max(...builderSeats.map(s => s.seat_row)) + 1 : 1;

  const addSeatToBuilder = () => {
    const row = nextRow();
    const draft: BuilderSeat = { seat_label: `${row}A`, seat_row: row, seat_col: 1, seat_type: "window", is_blocked: false };
    setBuilderSeats(prev => [...prev, draft]);
    setBuilderDirty(true);
    openSeatEditor(draft, builderSeats.length);
  };

  const openSeatEditor = (seat: BuilderSeat, idx: number) => {
    setEditingSeatIdx(idx);
    setSeatEditLabel(seat.seat_label);
    setSeatEditType(seat.seat_type);
    setSeatEditBlocked(seat.is_blocked);
    setSeatEditRow(seat.seat_row);
    setSeatEditCol(seat.seat_col);
  };

  const saveSeatEdit = () => {
    if (editingSeatIdx === null) return;
    const label = seatEditLabel.trim();
    if (!label) return;
    setBuilderSeats(prev => prev.map((s, i) => i === editingSeatIdx ? {
      ...s, seat_label: label, seat_type: seatEditType, is_blocked: seatEditBlocked,
      seat_row: seatEditRow, seat_col: seatEditCol,
    } : s));
    setBuilderDirty(true);
    setEditingSeatIdx(null);
  };

  const removeSeatFromEditor = () => {
    if (editingSeatIdx === null) return;
    setBuilderSeats(prev => prev.filter((_, i) => i !== editingSeatIdx));
    setBuilderDirty(true);
    setEditingSeatIdx(null);
  };

  const handleSaveLayout = async () => {
    if (!builderVehicle) return;
    const labels = builderSeats.map(s => s.seat_label.trim());
    if (labels.some(l => !l)) { setBuilderError("Every seat needs a label."); return; }
    if (new Set(labels).size !== labels.length) { setBuilderError("Seat labels must be unique."); return; }

    setBuilderError("");
    setBuilderSaving(true);
    try {
      const res  = await fetch(`${API_BASE}/vehicles/save_seat_layout.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: builderVehicle.id, seats: builderSeats }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Seat layout saved.");
        fetchVehicles(user.id);
        closeSeatBuilder();
      } else {
        setBuilderError(data.message ?? "Failed to save layout.");
      }
    } catch { setBuilderError("Cannot connect to server."); }
    finally { setBuilderSaving(false); }
  };

  // ── 5-Seat End Bench — lets the operator explicitly apply the same back-row
  // bench pattern the generator uses automatically (2 | aisle | 3) to
  // whichever row is currently the last one in the layout, for a hand-built
  // or hand-edited layout where the generator's automatic version wasn't
  // used or no longer matches. Local-only until "Save Layout" is tapped.
  const applyBenchAtLastRow = () => {
    const passengerRows = builderSeats.filter(s => s.seat_type !== "driver" && s.seat_type !== "conductor").map(s => s.seat_row);
    if (passengerRows.length === 0) { showToast("Add some seats first."); return; }
    const lastRow = Math.max(...passengerRows);
    const rowSeats = builderSeats.filter(s => s.seat_row === lastRow);
    if (rowSeats.some(s => s.has_active_booking)) {
      showToast(`Row ${lastRow} has an active booking and can't be converted.`);
      return;
    }
    // Solid 5 across, no aisle gap — replaces any blank aisle placeholder
    // that row had, since the back bench spans the full width.
    const benchLetters = ["A", "B", "C", "D", "E"];
    const newRow: BuilderSeat[] = benchLetters.map((letter, i) => {
      const col = i + 1;
      return { seat_label: `${lastRow}${letter}`, seat_row: lastRow, seat_col: col, seat_type: col === 1 || col === 5 ? "window" : "aisle", is_blocked: false };
    });
    setBuilderSeats(prev => [...prev.filter(s => s.seat_row !== lastRow), ...newRow]);
    setBuilderDirty(true);
    showToast(`Row ${lastRow} (end of the bus) set to a 5-seat bench.`);
  };

  // ── Clear Layout (the only path back to "no layout", needed to unblock a class change) ──
  const handleClearLayout = async () => {
    if (!builderVehicle) return;
    setClearingLayout(true);
    try {
      const res  = await fetch(`${API_BASE}/vehicles/save_seat_layout.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: builderVehicle.id, seats: [] }),
      });
      const data = await res.json();
      if (data.success) {
        setShowClearLayout(false);
        await loadBuilderSeats(builderVehicle.id);
        fetchVehicles(user.id);
        showToast("Seat layout cleared.");
      } else {
        showToast(data.message ?? "Failed to clear layout.");
      }
    } catch { showToast("Cannot connect to server."); }
    finally { setClearingLayout(false); }
  };

  // ── Generate Layout (pure client-side, populates the builder for review —
  // nothing is saved until "Save Layout") ─────────────────────────────────────
  const openGenerateModal = (style: "standard" | "sleeper") => {
    setGenerateCapacity(builderVehicle?.capacity ? String(builderVehicle.capacity) : "");
    setShowGenerateModal(style);
  };

  const handleGenerate = () => {
    const capacity = parseInt(generateCapacity, 10);
    if (!capacity || capacity < 1) { showToast("Enter a valid seat count."); return; }
    const seats = generateLayout(showGenerateModal!, capacity);
    setBuilderSeats(seats);
    setBuilderDirty(true);
    const bookable = seats.filter(s => !["driver", "conductor", "blank"].includes(s.seat_type)).length;
    setShowGenerateModal(null);
    showToast(`Generated ${bookable} seats. Review and tap Save Layout when ready.`);
  };

  // ── Seat Layout Library ──────────────────────────────────────────────────────
  const openLibrary = async () => {
    if (!builderVehicle || !user) return;
    setShowLibrary(true);
    setLibraryLoading(true);
    try {
      const url = `${API_BASE}/vehicles/list_seat_templates.php?operator_id=${user.id}${builderVehicle.service_type_id ? `&service_type_id=${builderVehicle.service_type_id}` : ""}`;
      const res  = await fetch(url);
      const data = await res.json();
      setLibraryTemplates(data.success ? data.templates : []);
    } catch { setLibraryTemplates([]); }
    finally { setLibraryLoading(false); }
  };

  const applyTemplate = async (template: SeatTemplate) => {
    if (!builderVehicle) return;
    setApplyingTemplateId(template.id);
    try {
      const res  = await fetch(`${API_BASE}/vehicles/apply_seat_template.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: builderVehicle.id, template_id: template.id }),
      });
      const data = await res.json();
      if (data.success) {
        setShowLibrary(false);
        await loadBuilderSeats(builderVehicle.id);
        showToast(`Applied "${template.name ?? template.service_type_name}" (independent copy).`);
      } else {
        showToast(data.message ?? "Failed to apply template.");
      }
    } catch { showToast("Cannot connect to server."); }
    finally { setApplyingTemplateId(null); }
  };

  const deleteTemplate = async (template: SeatTemplate) => {
    try {
      const res  = await fetch(`${API_BASE}/vehicles/delete_seat_template.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: template.id }),
      });
      const data = await res.json();
      if (data.success) {
        setLibraryTemplates(prev => prev.filter(t => t.id !== template.id));
        showToast("Template deleted.");
      } else {
        showToast(data.message ?? "Failed to delete template.");
      }
    } catch { showToast("Cannot connect to server."); }
  };

  const openSaveTemplate = () => {
    if (!builderSeats.length) { showToast("Nothing to save yet — add seats first."); return; }
    setTemplateNameDraft("");
    setShowSaveTemplate(true);
  };

  const handleSaveTemplate = async () => {
    if (!builderVehicle || !templateNameDraft.trim()) return;
    setSavingTemplate(true);
    try {
      const res  = await fetch(`${API_BASE}/vehicles/save_seat_template.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: builderVehicle.id, name: templateNameDraft.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setShowSaveTemplate(false);
        showToast("Saved to your Seat Layout Library.");
      } else {
        showToast(data.message ?? "Failed to save template. Save the layout first.");
      }
    } catch { showToast("Cannot connect to server."); }
    finally { setSavingTemplate(false); }
  };

  // ── Edit plate/vehicle_number (+ Bus class/number) ──────────────────────────
  const openEditVehicle = (vehicle: Vehicle) => {
    setEditVehicle(vehicle);
    setEditPlate(vehicle.plate_number ?? "");
    setEditNumber(vehicle.vehicle_number ?? "");
    setEditBusNumber(vehicle.bus_number ?? "");
    setEditServiceType(vehicle.service_type_id);
    setEditRouteId(vehicle.assigned_routes[0]?.id ?? null);
    setEditCapacity(vehicle.type !== "Bus" && vehicle.capacity ? String(vehicle.capacity) : "");
    setEditError("");
    fetchAvailableRoutes(vehicle.association_id, vehicle.type);
  };

  const handleSaveEdit = async () => {
    if (!editVehicle) return;
    setEditError("");
    const plate = formatPlateNumber(editPlate);
    if (!PLATE_REGEX.test(plate)) {
      setEditError("Invalid plate format. Use ABC 1234 (3 letters + 3–4 digits).");
      return;
    }
    if (!editNumber.trim()) {
      setEditError("Vehicle number is required.");
      return;
    }
    if (editVehicle.type !== "Bus") {
      const cap = parseInt(editCapacity, 10);
      if (editVehicle.type === "Jeepney" && (!cap || cap < 12 || cap > 36 || cap % 2 !== 0)) {
        setEditError("Seat count must be an even number between 12 and 36.");
        return;
      }
      if (editVehicle.type === "UV Express" && (!cap || cap < 9 || cap > 18)) {
        setEditError("Seat count (including the driver) must be between 9 and 18.");
        return;
      }
    }
    setEditSubmitting(true);
    try {
      const originalRouteId = editVehicle.assigned_routes[0]?.id ?? null;
      const res = await fetch(`${API_BASE}/vehicles/vehicles.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editVehicle.id, action: "update_details",
          plate_number: plate,
          vehicle_number: editNumber.trim(),
          ...(editVehicle.type !== "Bus" ? { capacity: parseInt(editCapacity, 10) } : {}),
          bus_number: editVehicle.type === "Bus" ? editBusNumber : editVehicle.bus_number ?? "",
          service_type_id: editVehicle.type === "Bus" ? editServiceType : editVehicle.service_type_id,
          ...(editRouteId === null
            ? (originalRouteId !== null ? { unassign_route: true } : {})
            : { route_id: editRouteId }),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditVehicle(null);
        fetchVehicles(user.id);
        showToast("Vehicle updated.");
      } else {
        setEditError(data.message || "Failed to update vehicle.");
      }
    } catch { setEditError("Cannot connect to server."); }
    finally { setEditSubmitting(false); }
  };

  const fetchVehicles = async (operatorId: number) => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/vehicles/vehicles.php?operator_id=${operatorId}`);
      const data = await res.json();
      setVehicles(Array.isArray(data) ? data : []);
    } catch { setVehicles([]); }
    finally  { setLoading(false); }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const vehicleType = vVehicleType;

  const resetForm = () => {
    setVVehicleType(approvedTypes.length === 1 ? approvedTypes[0] : "");
    setVPlate(""); setVNumber(""); setVCapacityPick(null); setFormError("");
    setVBusNumber(""); setVServiceType(null); setVRouteId(null); setAvailableRoutes([]);
    setVSeatCount(""); setVLayoutStyle("standard");
  };

  const openAddVehicle = () => {
    resetForm();
    if (approvedTypes.length === 1) fetchAvailableRoutes(activeAssociationId, approvedTypes[0]);
    setShowAdd(true);
  };

  // Philippine LTO standard: 3 uppercase letters + space + 3–4 digits (e.g. ABC 1234)
  const PLATE_REGEX = /^[A-Z]{3} \d{3,4}$/;

  const formatPlateNumber = (raw: string): string => {
    const clean = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const letters = clean.replace(/[0-9]/g, "").slice(0, 3);
    const digits  = clean.replace(/[A-Z]/g, "").slice(0, 4);
    if (digits.length > 0) return `${letters} ${digits}`;
    return letters;
  };

  // ── ADD VEHICLE ──────────────────────────────────────────────────────────────
  const handleAddVehicle = async () => {
    setFormError("");
    if (!vVehicleType) { setFormError("Please select a vehicle type."); return; }
    if (!approvedTypes.includes(vVehicleType) || !activeAssociationId) {
      setFormError(`You need an approved association membership for ${vVehicleType} at your active association first.`);
      return;
    }
    if (!vPlate)  { setFormError("Plate number is required."); return; }
    if (!PLATE_REGEX.test(vPlate)) { setFormError("Invalid plate format. Use ABC 1234 (3 letters + 3–4 digits)."); return; }
    if (!vNumber.trim()) { setFormError("Vehicle number is required."); return; }
    if (vehicleType === "Bus") {
      if (!vServiceType) { setFormError("Please select a class."); return; }
    } else if (!vCapacityPick) {
      setFormError("Please select the number of seats.");
      return;
    }

    setSubmitting(true);
    try {
      const res  = await fetch(`${API_BASE}/vehicles/vehicles.php`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_id:      user.id,
          association_id:   activeAssociationId,
          type:             vehicleType,
          plate_number:     vPlate,
          vehicle_number:   vNumber.trim(),
          capacity:         vehicleType === "Bus" ? undefined : vCapacityPick,
          bus_number:       vehicleType === "Bus" ? vBusNumber : undefined,
          service_type_id:  vehicleType === "Bus" ? vServiceType : undefined,
          route_id:         vRouteId ?? undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAdd(false);
        fetchVehicles(user.id);
        showToast("Vehicle registered successfully!");
        // Bus vehicles have no capacity until a seat layout exists — chain
        // straight into the builder instead of leaving the operator to find
        // it later from the vehicle card.
        if (vehicleType === "Bus" && data.id) {
          await openSeatBuilder({
            id: data.id, type: "Bus", plate_number: vPlate, vehicle_number: vNumber.trim(),
            bus_number: vBusNumber || null, service_type_id: vServiceType,
            service_type_name: serviceTypes.find(st => st.id === vServiceType)?.name ?? null,
            capacity: null, status: "active", driver_id: null, driver_name: null,
            association_id: activeAssociationId, association_name: null, assigned_routes: [],
          });
          // If a seat count was given at registration, generate the draft
          // right away instead of leaving the builder empty for the operator
          // to tap Generate themselves — still just a draft, still requires
          // reviewing + "Save Layout" (same as tapping Generate manually).
          const seatCount = parseInt(vSeatCount, 10);
          if (seatCount > 0) {
            setBuilderSeats(generateLayout(vLayoutStyle, seatCount));
            setBuilderDirty(true);
          }
        }
        resetForm();
      } else {
        setFormError(data.message || "Failed to register vehicle.");
      }
    } catch { setFormError("Cannot connect to server."); }
    finally  { setSubmitting(false); }
  };

  // ── TOGGLE STATUS ─────────────────────────────────────────────────────────────
  const handleToggleStatus = async (vehicle: Vehicle) => {
    const newStatus = vehicle.status === "active" ? "inactive" : "active";
    try {
      await fetch(`${API_BASE}/vehicles/vehicles.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vehicle.id, status: newStatus }),
      });
      setVehicles(prev => prev.map(v => v.id === vehicle.id ? { ...v, status: newStatus } : v));
      showToast(`Vehicle marked as ${newStatus}`);
    } catch { showToast("Failed to update status."); }
  };

  // ── UNASSIGN DRIVER ───────────────────────────────────────────────────────────
  const handleUnassign = async () => {
    if (!showUnassign) return;
    setUnassigning(true);
    try {
      const res  = await fetch(`${API_BASE}/vehicles/vehicles.php`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: showUnassign.id, action: "unassign" }),
      });
      const data = await res.json();
      if (res.ok) {
        setVehicles(prev => prev.map(v => v.id === showUnassign.id ? { ...v, driver_id: null, driver_name: null } : v));
        setShowUnassign(null);
        showToast("Driver unassigned. Their account is now deactivated.");
      } else {
        showToast(data.message || "Failed to unassign driver.");
        setShowUnassign(null);
      }
    } catch { showToast("Cannot connect to server."); setShowUnassign(null); }
    finally  { setUnassigning(false); }
  };

  // ── DELETE ────────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!showDelete) return;
    try {
      await fetch(`${API_BASE}/vehicles/vehicles.php`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: showDelete.id }),
      });
      setVehicles(prev => prev.filter(v => v.id !== showDelete.id));
      setShowDelete(null);
      showToast("Vehicle removed.");
    } catch { showToast("Failed to remove vehicle."); }
  };

  const isVerified   = user?.is_verified == 1;
  const isOperational = isVerified && hasAssociation;

  // Scoped to the vehicle's own association_id matching the active
  // association — matching by type alone isn't enough once an operator can
  // hold the same vehicle type approved at several associations at once
  // (e.g. UV Express at both DAU and Angeles City JODA); only association_id
  // actually disambiguates which workspace a given vehicle belongs to. A
  // vehicle whose association doesn't match is hidden entirely here, not
  // just filterable-away.
  const activeAssocVehicles = vehicles.filter(v => v.association_id === activeAssociationId);
  const vehicleFilterOptions: ("All" | (typeof VEHICLE_TYPES)[number])[] =
    ["All", ...VEHICLE_TYPES.filter(t => approvedTypes.includes(t))];
  const vehicleFilterCounts: Record<"All" | (typeof VEHICLE_TYPES)[number], number> = {
    All:          activeAssocVehicles.length,
    "Jeepney":    activeAssocVehicles.filter(v => v.type === "Jeepney").length,
    "UV Express": activeAssocVehicles.filter(v => v.type === "UV Express").length,
    "Bus":        activeAssocVehicles.filter(v => v.type === "Bus").length,
  };
  const filteredVehicles = vehicleFilter === "All" ? activeAssocVehicles : activeAssocVehicles.filter(v => v.type === vehicleFilter);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── TOAST ── */}
      {toast !== "" && (
        <View style={[styles.toast, { top: insets.top + 56 }]}>
          <Ionicons name="checkmark-circle" size={14} color="#a8d832" />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* ── ADD VEHICLE MODAL ── */}
      <Modal visible={showAdd} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Register Vehicle</Text>
              <Text style={styles.modalSub}>Add a vehicle to your fleet</Text>

              {formError ? (
                <View style={styles.errorBox}>
                  <Ionicons name="warning" size={14} color="#dc2626" />
                  <Text style={styles.errorText}>{formError}</Text>
                </View>
              ) : null}

              {/* Vehicle type — an open choice among whichever types this
                  operator is currently approved for (an operator can hold
                  multiple vehicle-type memberships at once now). */}
              <Text style={styles.fieldLabel}>Vehicle Type</Text>
              <View style={styles.typePickRow}>
                {VEHICLE_TYPES.map((t) => {
                  const approved = approvedTypes.includes(t);
                  const active   = vVehicleType === t;
                  const color    = TYPE_COLOR[t] ?? "#1a4a52";
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.typePickItem,
                        active && { borderColor: color, backgroundColor: color + "12" },
                        !approved && styles.typePickItemDisabled,
                      ]}
                      onPress={() => {
                        if (!approved) return;
                        setVVehicleType(t);
                        setVRouteId(null);
                        fetchAvailableRoutes(activeAssociationId, t);
                      }}
                      disabled={!approved}
                      activeOpacity={0.8}
                    >
                      <Ionicons name={approved ? (TYPE_ICON[t] ?? "car") : "lock-closed"} size={15} color={active ? color : "#9ca3af"} />
                      <Text style={[styles.typePickItemText, active && { color }]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {vVehicleType !== "" && !approvedTypes.includes(vVehicleType) && (
                <Text style={styles.plateHint}>
                  You need an approved association membership for {vVehicleType} before adding this type of vehicle.
                </Text>
              )}

              {/* Plate number */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.fieldLabel}>Plate Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder="ABC 1234"
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="none"
                  value={vPlate}
                  onChangeText={(text) => setVPlate(formatPlateNumber(text))}
                />
                <Text style={styles.plateHint}>Philippine standard: 3 letters + 3–4 digits (e.g. NVA 1234)</Text>
              </View>

              {/* Vehicle number — a fleet-internal identifier, distinct from the plate */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.fieldLabel}>Vehicle Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Unit 07"
                  placeholderTextColor="#9ca3af"
                  value={vNumber}
                  onChangeText={setVNumber}
                />
              </View>

              {/* Number of seats — Jeepney/UV Express only. Bus has no upfront
                  capacity pick; seat count + layout come later via the
                  seat-map step, tied to the class chosen below. */}
              {vehicleType !== "Bus" && (
                <>
                  <Text style={styles.fieldLabel}>Number of Seats{vehicleType === "UV Express" ? " (incl. driver)" : ""}</Text>
                  <View style={styles.seatPickGrid}>
                    {(vehicleType === "UV Express" ? UV_CAPACITY_OPTIONS : CAPACITY_OPTIONS).map((n) => {
                      const active = vCapacityPick === n;
                      return (
                        <TouchableOpacity
                          key={n}
                          style={[styles.seatPickItem, active && styles.seatPickItemActive]}
                          onPress={() => setVCapacityPick(active ? null : n)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.seatPickText, active && { color: "#fff" }]}>{n}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {vehicleType === "Bus" && (
                <>
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.fieldLabel}>Bus Number (optional)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Bus 07"
                      placeholderTextColor="#9ca3af"
                      value={vBusNumber}
                      onChangeText={setVBusNumber}
                    />
                  </View>

                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.fieldLabel}>Class</Text>
                    {serviceTypes.length === 0 ? (
                      <Text style={styles.plateHint}>Your association hasn't defined any classes yet (e.g. Ordinary, Royal Class) — ask them to add one before registering a Bus.</Text>
                    ) : (
                      <View style={styles.configList}>
                        {serviceTypes.map((st) => {
                          const active = vServiceType === st.id;
                          return (
                            <TouchableOpacity
                              key={st.id}
                              style={[styles.configItem, active && styles.configItemActive]}
                              onPress={() => setVServiceType(active ? null : st.id)}
                              activeOpacity={0.8}
                            >
                              <Ionicons name="ribbon" size={14} color={active ? "#1a4a52" : "#9ca3af"} />
                              <Text style={[styles.configText, active && { color: "#1a4a52", fontWeight: "800" }]}>{st.name}</Text>
                              {active && <Ionicons name="checkmark-circle" size={16} color="#16a34a" style={{ marginLeft: "auto" }} />}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  {/* Optional — pre-fills the Seat Layout Builder's draft the
                      moment it opens after registration, instead of leaving
                      the operator to tap Generate themselves. Still just a
                      draft either way; nothing is saved until "Save Layout"
                      in the builder. */}
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.fieldLabel}>Number of Seats (optional)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 45"
                      placeholderTextColor="#9ca3af"
                      keyboardType="number-pad"
                      value={vSeatCount}
                      onChangeText={(t) => setVSeatCount(t.replace(/[^0-9]/g, ""))}
                    />
                    <Text style={styles.plateHint}>Generates a starting layout in the Seat Layout Builder right after registration — you can review and edit it before saving. Leave blank to build it manually.</Text>
                    {vSeatCount !== "" && (
                      <View style={[styles.typePickRow, { marginTop: 10 }]}>
                        {(["standard", "sleeper"] as const).map((style) => {
                          const active = vLayoutStyle === style;
                          return (
                            <TouchableOpacity
                              key={style}
                              style={[styles.typePickItem, active && { borderColor: "#1a4a52", backgroundColor: "#1a4a5212" }]}
                              onPress={() => setVLayoutStyle(style)}
                              activeOpacity={0.8}
                            >
                              <Ionicons name={style === "sleeper" ? "bed-outline" : "grid-outline"} size={15} color={active ? "#1a4a52" : "#9ca3af"} />
                              <Text style={[styles.typePickItemText, active && { color: "#1a4a52" }]}>
                                {style === "sleeper" ? "Sleeper" : "Standard"}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                </>
              )}

              {/* Route (optional) — a vehicle carries its own route now
                  (migration 056), scoped to this vehicle's own type; can
                  still be set/changed later from Edit. */}
              {vVehicleType !== "" && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.fieldLabel}>Route (optional)</Text>
                  {loadingRoutes ? (
                    <ActivityIndicator color="#1a4a52" style={{ marginVertical: 12 }} />
                  ) : availableRoutes.length === 0 ? (
                    <Text style={styles.plateHint}>No active {vVehicleType} routes published yet — you can set one later from Edit.</Text>
                  ) : (
                    <View style={styles.configList}>
                      {availableRoutes.map((r) => {
                        const active = vRouteId === r.id;
                        return (
                          <TouchableOpacity
                            key={r.id}
                            style={[styles.configItem, active && styles.configItemActive]}
                            onPress={() => setVRouteId(active ? null : r.id)}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="map" size={14} color={active ? "#1a4a52" : "#9ca3af"} />
                            <Text style={[styles.configText, active && { color: "#1a4a52", fontWeight: "800" }]}>
                              {r.name || `${r.from_location} → ${r.to_location}`}
                            </Text>
                            {active && <Ionicons name="checkmark-circle" size={16} color="#16a34a" style={{ marginLeft: "auto" }} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => { setShowAdd(false); resetForm(); }}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirm, submitting && { opacity: 0.6 }]}
                  onPress={handleAddVehicle}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.modalConfirmText}>Register</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareForm>
        </View>
      </Modal>

      {/* ── EDIT VEHICLE (vehicle_number + Bus class/number) ── */}
      <Modal visible={!!editVehicle} transparent animationType="slide" onRequestClose={() => setEditVehicle(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Edit — {editVehicle?.plate_number}</Text>

            {!!editError && (
              <View style={styles.errorBox}>
                <Ionicons name="warning" size={14} color="#dc2626" />
                <Text style={styles.errorText}>{editError}</Text>
              </View>
            )}

            <View style={{ marginBottom: 14 }}>
              <Text style={styles.fieldLabel}>Plate Number</Text>
              <TextInput
                style={styles.input} placeholder="ABC 1234" placeholderTextColor="#9ca3af"
                autoCapitalize="characters" value={editPlate} onChangeText={setEditPlate}
              />
              <Text style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>Only change this if the plate was lost, damaged, or reissued.</Text>
            </View>

            <View style={{ marginBottom: 14 }}>
              <Text style={styles.fieldLabel}>Vehicle Number</Text>
              <TextInput style={styles.input} placeholder="e.g. Unit 07" placeholderTextColor="#9ca3af" value={editNumber} onChangeText={setEditNumber} />
            </View>

            {editVehicle && editVehicle.type !== "Bus" && (
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.fieldLabel}>Seat Count</Text>
                <TextInput
                  style={styles.input} keyboardType="number-pad" placeholder={editVehicle.type === "Jeepney" ? "12–36 (even)" : "9–18 (incl. driver)"}
                  placeholderTextColor="#9ca3af" value={editCapacity} onChangeText={(t) => setEditCapacity(t.replace(/[^0-9]/g, ""))}
                />
              </View>
            )}

            {editVehicle?.type === "Bus" && (
              <>
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.fieldLabel}>Bus Number</Text>
                  <TextInput style={styles.input} placeholder="e.g. Bus 07" placeholderTextColor="#9ca3af" value={editBusNumber} onChangeText={setEditBusNumber} />
                </View>
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.fieldLabel}>Class</Text>
                  {editVehicle?.capacity ? (
                    <View style={styles.classLockedBox}>
                      <Ionicons name="lock-closed-outline" size={14} color="#92400e" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.classLockedText}>
                          Clear the seat layout first to change class.
                        </Text>
                        <TouchableOpacity
                          onPress={() => { const v = editVehicle; setEditVehicle(null); if (v) openSeatBuilder(v); }}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.classLockedLink}>Open Seat Layout Builder →</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.configList}>
                      {serviceTypes.map((st) => {
                        const active = editServiceType === st.id;
                        return (
                          <TouchableOpacity
                            key={st.id}
                            style={[styles.configItem, active && styles.configItemActive]}
                            onPress={() => setEditServiceType(st.id)}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="ribbon" size={14} color={active ? "#1a4a52" : "#9ca3af"} />
                            <Text style={[styles.configText, active && { color: "#1a4a52", fontWeight: "800" }]}>{st.name}</Text>
                            {active && <Ionicons name="checkmark-circle" size={16} color="#16a34a" style={{ marginLeft: "auto" }} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              </>
            )}

            {/* Route (optional) — same picker as registration, scoped to this
                vehicle's own type + association. */}
            <View style={{ marginBottom: 14 }}>
              <Text style={styles.fieldLabel}>Route (optional)</Text>
              {loadingRoutes ? (
                <ActivityIndicator color="#1a4a52" style={{ marginVertical: 12 }} />
              ) : availableRoutes.length === 0 ? (
                <Text style={styles.plateHint}>
                  {routeLoadError || `No active ${editVehicle?.type} routes published yet by your association.`}
                </Text>
              ) : (
                <View style={styles.configList}>
                  {availableRoutes.map((r) => {
                    const active = editRouteId === r.id;
                    return (
                      <TouchableOpacity
                        key={r.id}
                        style={[styles.configItem, active && styles.configItemActive]}
                        onPress={() => setEditRouteId(active ? null : r.id)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="map" size={14} color={active ? "#1a4a52" : "#9ca3af"} />
                        <Text style={[styles.configText, active && { color: "#1a4a52", fontWeight: "800" }]}>
                          {r.name || `${r.from_location} → ${r.to_location}`}
                        </Text>
                        {active && <Ionicons name="checkmark-circle" size={16} color="#16a34a" style={{ marginLeft: "auto" }} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setEditVehicle(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, editSubmitting && { opacity: 0.6 }]}
                onPress={handleSaveEdit}
                disabled={editSubmitting}
              >
                {editSubmitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalConfirmText}>Save</Text>}
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ── SEAT LAYOUT BUILDER (Bus only) ── */}
      <Modal visible={!!builderVehicle} transparent animationType="slide" onRequestClose={closeSeatBuilder}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: "85%", paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Seat Layout — {builderVehicle?.plate_number}</Text>
            <Text style={styles.modalSub}>{builderVehicle?.service_type_name ?? "No class assigned"}</Text>

            {builderError ? (
              <View style={styles.errorBox}>
                <Ionicons name="warning" size={14} color="#dc2626" />
                <Text style={styles.errorText}>{builderError}</Text>
              </View>
            ) : null}

            <View style={styles.builderToolbar}>
              <TouchableOpacity style={styles.builderToolBtn} onPress={addSeatToBuilder}>
                <Ionicons name="add-circle-outline" size={14} color="#1a4a52" />
                <Text style={styles.builderToolText}>Add Seat</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.builderToolBtn} onPress={() => openGenerateModal("standard")}>
                <Ionicons name="flash-outline" size={14} color="#1a4a52" />
                <Text style={styles.builderToolText}>Generate Standard</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.builderToolBtn} onPress={() => openGenerateModal("sleeper")}>
                <Ionicons name="bed-outline" size={14} color="#1a4a52" />
                <Text style={styles.builderToolText}>Generate Sleeper</Text>
              </TouchableOpacity>
              {builderSeats.length > 0 && (
                <TouchableOpacity style={styles.builderToolBtn} onPress={applyBenchAtLastRow}>
                  <Ionicons name="reorder-four-outline" size={14} color="#1a4a52" />
                  <Text style={styles.builderToolText}>5-Seat End Bench</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.builderToolBtn} onPress={openLibrary}>
                <Ionicons name="library-outline" size={14} color="#1a4a52" />
                <Text style={styles.builderToolText}>Library</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.builderToolBtn} onPress={openSaveTemplate}>
                <Ionicons name="save-outline" size={14} color="#1a4a52" />
                <Text style={styles.builderToolText}>Save as Template</Text>
              </TouchableOpacity>
              {builderSeats.length > 0 && (
                <TouchableOpacity style={[styles.builderToolBtn, { borderColor: "#dc2626" }]} onPress={() => setShowClearLayout(true)}>
                  <Ionicons name="trash-outline" size={14} color="#dc2626" />
                  <Text style={[styles.builderToolText, { color: "#dc2626" }]}>Clear Layout</Text>
                </TouchableOpacity>
              )}
            </View>

            {builderDirty && (
              <View style={styles.unsavedBanner}>
                <Ionicons name="alert-circle" size={16} color="#92400e" />
                <Text style={styles.unsavedBannerText}>
                  Unsaved — this layout hasn't been applied to the vehicle yet. Tap "Save Layout" below to keep it.
                </Text>
              </View>
            )}

            <View style={styles.seatLegendRow}>
              <LegendDot color="#fff" border="#1a4a52" label="Seat" />
              <LegendDot color="#fef9c3" border="#eab308" label="Blocked" />
              <LegendDot color="#e5e7eb" border="#6b7280" label="Driver/Conductor" />
              <LegendDot color="#fee2e2" border="#dc2626" label="Booked" />
              <LegendDot color="transparent" border="#e5e7eb" label="Aisle (path, not a seat)" />
            </View>

            {builderLoading ? (
              <ActivityIndicator color="#1a4a52" style={{ marginVertical: 24 }} />
            ) : (
              <ScrollView style={{ maxHeight: Math.round(windowHeight * 0.4) }}>
                {builderSeats.length === 0 ? (
                  <View style={{ alignItems: "center", paddingVertical: 24, gap: 6 }}>
                    <Ionicons name="grid-outline" size={36} color="#d1d5db" />
                    <Text style={{ color: "#9ca3af", fontSize: 12, textAlign: "center" }}>
                      No seats yet. Generate a Standard or Sleeper layout, add seats one at a time, or pick a saved layout from the Library.
                    </Text>
                  </View>
                ) : (
                  Object.entries(
                    builderSeats.reduce((rows: Record<number, BuilderSeat[]>, s) => {
                      (rows[s.seat_row] ??= []).push(s); return rows;
                    }, {})
                  )
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([row, rowSeats]) => (
                      <View key={row} style={styles.builderRow}>
                        {rowSeats.sort((a, b) => a.seat_col - b.seat_col).map((seat) => {
                          const idx = builderSeats.indexOf(seat);
                          const isDC = seat.seat_type === "driver" || seat.seat_type === "conductor";
                          const isBlank = seat.seat_type === "blank";
                          const bg = isBlank ? "transparent" : seat.has_active_booking ? "#fee2e2" : isDC ? "#e5e7eb" : seat.is_blocked ? "#fef9c3" : "#fff";
                          const border = isBlank ? "#e5e7eb" : seat.has_active_booking ? "#dc2626" : isDC ? "#6b7280" : seat.is_blocked ? "#eab308" : "#1a4a52";
                          const crewLabel = seat.seat_type === "driver" ? "Driver" : "Conductor";
                          return (
                            <TouchableOpacity
                              key={seat.seat_label}
                              style={[styles.builderSeat, { width: seatCellW, height: seatCellW }, isDC && styles.builderSeatCrew, isDC && { width: seatCellW * 2 - 4 }, { backgroundColor: bg, borderColor: border }, isBlank && styles.builderSeatBlank]}
                              onPress={() => openSeatEditor(seat, idx)}
                              activeOpacity={0.8}
                              accessibilityLabel={isBlank ? "Aisle spacer seat" : isDC ? `${crewLabel} seat` : `Seat ${seat.seat_label}`}
                            >
                              {isBlank
                                ? <Ionicons name="ellipsis-vertical" size={14} color="#d1d5db" />
                                : (
                                  <Text style={isDC ? styles.builderSeatCrewText : styles.builderSeatText} numberOfLines={1}>
                                    {isDC ? crewLabel : seat.seat_label}
                                  </Text>
                                )}
                              {seat.has_active_booking && <Ionicons name="lock-closed" size={9} color="#dc2626" />}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))
                )}
              </ScrollView>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={closeSeatBuilder}>
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, builderSaving && { opacity: 0.6 }]}
                onPress={handleSaveLayout}
                disabled={builderSaving}
              >
                {builderSaving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalConfirmText}>Save Layout</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── SEAT EDITOR (mini-modal stacked on the builder) ── */}
      <Modal visible={editingSeatIdx !== null} transparent animationType="fade" onRequestClose={() => setEditingSeatIdx(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmBox}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <Text style={styles.confirmTitle}>Edit Seat</Text>

            <View style={{ width: "100%", marginTop: 8 }}>
              <Text style={styles.fieldLabel}>Label</Text>
              <TextInput style={styles.input} value={seatEditLabel} onChangeText={setSeatEditLabel} autoCapitalize="characters" />

              <Text style={styles.fieldLabel}>Type</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {SEAT_TYPES.map((t) => {
                  const active = seatEditType === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.seatTypeChip, active && styles.seatTypeChipActive]}
                      onPress={() => setSeatEditType(t)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.seatTypeChipText, active && { color: "#fff" }]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ flexDirection: "row", gap: 12, marginBottom: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Row</Text>
                  <View style={styles.stepperRowSmall}>
                    <TouchableOpacity onPress={() => setSeatEditRow(r => Math.max(0, r - 1))} accessibilityLabel="Decrease row"><Ionicons name="remove" size={16} color="#1a4a52" /></TouchableOpacity>
                    <Text style={styles.stepperVal}>{seatEditRow}</Text>
                    <TouchableOpacity onPress={() => setSeatEditRow(r => r + 1)} accessibilityLabel="Increase row"><Ionicons name="add" size={16} color="#1a4a52" /></TouchableOpacity>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Column</Text>
                  <View style={styles.stepperRowSmall}>
                    <TouchableOpacity onPress={() => setSeatEditCol(c => Math.max(0, c - 1))} accessibilityLabel="Decrease column"><Ionicons name="remove" size={16} color="#1a4a52" /></TouchableOpacity>
                    <Text style={styles.stepperVal}>{seatEditCol}</Text>
                    <TouchableOpacity onPress={() => setSeatEditCol(c => c + 1)} accessibilityLabel="Increase column"><Ionicons name="add" size={16} color="#1a4a52" /></TouchableOpacity>
                  </View>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.configItem, seatEditBlocked && { borderColor: "#eab308", backgroundColor: "#fef9c3" }]}
                onPress={() => setSeatEditBlocked(b => !b)}
                activeOpacity={0.8}
              >
                <Ionicons name={seatEditBlocked ? "checkbox" : "square-outline"} size={16} color={seatEditBlocked ? "#b45309" : "#9ca3af"} />
                <Text style={[styles.configText, seatEditBlocked && { color: "#b45309", fontWeight: "800" }]}>
                  Reserved/Blocked (hidden from commuter booking)
                </Text>
              </TouchableOpacity>

              {editingSeatIdx !== null && builderSeats[editingSeatIdx]?.has_active_booking && (
                <Text style={[styles.plateHint, { color: "#dc2626", marginTop: 8 }]}>
                  This seat has an active booking — it can be repositioned or retyped, but not removed.
                </Text>
              )}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalCancel, { borderColor: "#fecaca", flexDirection: "row", gap: 6 }]}
                onPress={removeSeatFromEditor}
                disabled={editingSeatIdx !== null && !!builderSeats[editingSeatIdx]?.has_active_booking}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={14} color={editingSeatIdx !== null && builderSeats[editingSeatIdx]?.has_active_booking ? "#d1d5db" : "#dc2626"} />
                <Text style={[styles.modalCancelText, { color: editingSeatIdx !== null && builderSeats[editingSeatIdx]?.has_active_booking ? "#d1d5db" : "#dc2626" }]}>Remove</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setEditingSeatIdx(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={saveSeatEdit}>
                <Text style={styles.modalConfirmText}>Done</Text>
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ── SEAT LAYOUT LIBRARY ── */}
      <Modal visible={showLibrary} transparent animationType="slide" onRequestClose={() => setShowLibrary(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: "75%", paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Seat Layout Library</Text>
            <Text style={styles.modalSub}>Applying a template makes an independent copy for this vehicle.</Text>

            {libraryLoading ? (
              <ActivityIndicator color="#1a4a52" style={{ marginVertical: 24 }} />
            ) : libraryTemplates.length === 0 ? (
              <Text style={{ color: "#9ca3af", textAlign: "center", paddingVertical: 24 }}>
                No saved templates for this class yet.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: Math.round(windowHeight * 0.4) }}>
                {libraryTemplates.map((t) => (
                  <View key={t.id} style={styles.templateRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.templateName}>{t.name ?? `${t.service_type_name} (unnamed)`}</Text>
                      <Text style={styles.templateSub}>{t.seat_count} seats · {t.layout_style} · {t.service_type_name}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.templateApplyBtn, applyingTemplateId === t.id && { opacity: 0.6 }]}
                      onPress={() => applyTemplate(t)}
                      disabled={applyingTemplateId === t.id}
                    >
                      {applyingTemplateId === t.id
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={styles.templateApplyText}>Apply</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.templateDeleteBtn} onPress={() => deleteTemplate(t)} activeOpacity={0.8}>
                      <Ionicons name="trash-outline" size={14} color="#dc2626" />
                      <Text style={styles.templateDeleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity style={[styles.modalCancel, { marginTop: 16 }]} onPress={() => setShowLibrary(false)}>
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── CLEAR LAYOUT CONFIRM ── */}
      <Modal visible={showClearLayout} transparent animationType="fade" onRequestClose={() => setShowClearLayout(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmBox}>
            <View style={styles.confirmIconWrap}>
              <Ionicons name="trash" size={28} color="#dc2626" />
            </View>
            <Text style={styles.confirmTitle}>Clear Seat Layout?</Text>
            <Text style={styles.confirmSub}>
              Removes every seat from {builderVehicle?.plate_number}. Needed if you want to change this vehicle's class.
              Seats with an active booking can't be cleared.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowClearLayout(false)} disabled={clearingLayout}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, { backgroundColor: "#dc2626" }, clearingLayout && { opacity: 0.6 }]}
                onPress={handleClearLayout}
                disabled={clearingLayout}
              >
                {clearingLayout
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalConfirmText}>Clear Layout</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── SAVE AS TEMPLATE ── */}
      <Modal visible={showSaveTemplate} transparent animationType="fade" onRequestClose={() => setShowSaveTemplate(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmBox}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <Text style={styles.confirmTitle}>Save as Template</Text>
            <Text style={styles.confirmSub}>Saves the layout as it's currently shown in the builder.</Text>
            <TextInput
              style={[styles.input, { width: "100%" }]}
              placeholder="e.g. Royal Class 40-Seater"
              placeholderTextColor="#9ca3af"
              value={templateNameDraft}
              onChangeText={setTemplateNameDraft}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowSaveTemplate(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, (savingTemplate || !templateNameDraft.trim()) && { opacity: 0.6 }]}
                onPress={handleSaveTemplate}
                disabled={savingTemplate || !templateNameDraft.trim()}
              >
                {savingTemplate
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalConfirmText}>Save</Text>}
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ── GENERATE LAYOUT (Standard 2x2 / Sleeper Lower+Upper, purely client-side) ── */}
      <Modal visible={!!showGenerateModal} transparent animationType="slide" onRequestClose={() => setShowGenerateModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              Generate {showGenerateModal === "sleeper" ? "Sleeper" : "Standard"} Layout
            </Text>
            <Text style={styles.modalSub}>
              {showGenerateModal === "sleeper"
                ? "Two stacked Lower/Upper berths per position, individually bookable."
                : "2×2 seating with a center aisle. An odd leftover becomes a 5-seat bench row."}
              {" "}Driver and Conductor seats are added automatically. This replaces the current layout in the builder — nothing is saved until you tap Save Layout there.
            </Text>

            <View style={{ marginBottom: 14 }}>
              <Text style={styles.fieldLabel}>Passenger Seat Count</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 55"
                placeholderTextColor="#9ca3af"
                keyboardType="number-pad"
                value={generateCapacity}
                onChangeText={(t) => setGenerateCapacity(t.replace(/[^0-9]/g, ""))}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowGenerateModal(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleGenerate}>
                <Text style={styles.modalConfirmText}>Generate</Text>
              </TouchableOpacity>
            </View>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ── UNASSIGN CONFIRM ── */}
      <Modal visible={!!showUnassign} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.confirmBox}>
            <View style={[styles.confirmIconWrap, { backgroundColor: "#fffbeb" }]}>
              <Ionicons name="person-remove" size={28} color="#d97706" />
            </View>
            <Text style={styles.confirmTitle}>Unassign Driver?</Text>
            <Text style={styles.confirmSub}>
              Remove {showUnassign?.driver_name} from {showUnassign?.plate_number}?{"\n"}
              Their account will be deactivated until a new vehicle is assigned.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowUnassign(null)} disabled={unassigning}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, { backgroundColor: "#d97706" }, unassigning && { opacity: 0.6 }]}
                onPress={handleUnassign}
                disabled={unassigning}
              >
                {unassigning
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalConfirmText}>Unassign</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── DELETE CONFIRM ── */}
      <Modal visible={!!showDelete} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.confirmBox}>
            <View style={styles.confirmIconWrap}>
              <Ionicons name="trash" size={28} color="#dc2626" />
            </View>
            <Text style={styles.confirmTitle}>Remove Vehicle?</Text>
            <Text style={styles.confirmSub}>
              {showDelete?.plate_number} will be removed from your fleet.
              {showDelete?.driver_name ? `\n${showDelete.driver_name} will be unassigned.` : ""}
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowDelete(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalConfirm, { backgroundColor: "#dc2626" }]} onPress={handleDelete}>
                <Text style={styles.modalConfirmText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="car" size={22} color="#1a4a52" />
          <View>
            <Text style={styles.headerTitle}>Vehicles</Text>
            <Text style={styles.headerSub}>{vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""} in fleet</Text>
          </View>
        </View>
        {isOperational && (
          <TouchableOpacity style={styles.addBtn} onPress={openAddVehicle} activeOpacity={0.85}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {!isOperational && (
        <View style={styles.lockBanner}>
          <Ionicons name="lock-closed" size={13} color="#92400e" />
          <Text style={styles.lockBannerText}>
            {!isVerified
              ? "Vehicle management is locked until your account is verified."
              : "Vehicle management is locked until your association approves your account."}
          </Text>
        </View>
      )}

      {!loading && vehicles.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.typeFilterRow}
          contentContainerStyle={styles.typeFilterRowContent}
        >
          {vehicleFilterOptions.map((t) => {
            const active = vehicleFilter === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.typeFilterChip, active && styles.typeFilterChipActive]}
                onPress={() => setVehicleFilter(t)}
                activeOpacity={0.8}
              >
                <Text style={[styles.typeFilterChipText, active && styles.typeFilterChipTextActive]}>
                  {t} ({vehicleFilterCounts[t]})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color="#1a4a52" size="large" /></View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {vehicles.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="car-outline" size={48} color="#d1d5db" style={{ marginBottom: 4 }} />
              <Text style={styles.emptyText}>No vehicles yet</Text>
              <Text style={styles.emptySub}>
                {isOperational ? "Tap + Add to register your first vehicle" : "Complete verification and association approval to add vehicles"}
              </Text>
            </View>
          ) : filteredVehicles.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="car-outline" size={48} color="#d1d5db" style={{ marginBottom: 4 }} />
              <Text style={styles.emptyText}>No {vehicleFilter} vehicles</Text>
              <Text style={styles.emptySub}>Try a different filter</Text>
            </View>
          ) : (
            filteredVehicles.map(vehicle => {
              const color = TYPE_COLOR[vehicle.type] ?? "#1a4a52";
              return (
                <View key={vehicle.id} style={styles.vehicleCard}>
                  {/* Color accent bar */}
                  <View style={[styles.vehicleAccent, { backgroundColor: color }]} />

                  <View style={styles.vehicleMain}>
                    {/* Icon + plate */}
                    <View style={styles.vehicleTopRow}>
                      <View style={[styles.vehicleIcon, { backgroundColor: color + "18" }]}>
                        <Ionicons name={TYPE_ICON[vehicle.type] ?? "car"} size={20} color={color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.vehiclePlate}>{vehicle.plate_number}</Text>
                        <Text style={[styles.vehicleType, { color }]}>
                          {vehicle.type}{vehicle.vehicle_number ? ` · ${vehicle.vehicle_number}` : ""}
                        </Text>
                      </View>
                      <TouchableOpacity style={styles.deleteBtn} onPress={() => openEditVehicle(vehicle)} activeOpacity={0.8}>
                        <Ionicons name="create-outline" size={15} color="#6b7280" />
                        <Text style={styles.deleteBtnText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.deleteBtn} onPress={() => setShowDelete(vehicle)} activeOpacity={0.8}>
                        <Ionicons name="trash-outline" size={15} color="#ef4444" />
                        <Text style={[styles.deleteBtnText, { color: "#ef4444" }]}>Delete</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Details row */}
                    <View style={styles.vehicleDetails}>
                      <View style={styles.detailChip}>
                        <Ionicons name="people-outline" size={11} color="#6b7280" />
                        <Text style={styles.detailChipText}>{vehicle.capacity ? `${vehicle.capacity} seats` : "Seats not set"}</Text>
                      </View>

                      {vehicle.bus_number && (
                        <View style={styles.detailChip}>
                          <Ionicons name="pricetag-outline" size={11} color="#6b7280" />
                          <Text style={styles.detailChipText}>{vehicle.bus_number}</Text>
                        </View>
                      )}

                      {vehicle.service_type_name && (
                        <View style={[styles.detailChip, { backgroundColor: "#f0faf4" }]}>
                          <Ionicons name="ribbon-outline" size={11} color="#1a4a52" />
                          <Text style={[styles.detailChipText, { color: "#1a4a52" }]}>{vehicle.service_type_name}</Text>
                        </View>
                      )}

                      {vehicle.assigned_routes.length > 0 && (
                        <View style={[styles.detailChip, { backgroundColor: "#eef2ff" }]}>
                          <Ionicons name="map-outline" size={11} color="#4338ca" />
                          <Text style={[styles.detailChipText, { color: "#4338ca" }]} numberOfLines={1}>
                            {vehicle.assigned_routes.map(r => r.name).join(", ")}
                          </Text>
                        </View>
                      )}

                      {vehicle.type === "Bus" && (
                        <TouchableOpacity
                          style={[styles.detailChip, { backgroundColor: "#eff6ff" }]}
                          onPress={() => openSeatBuilder(vehicle)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="grid-outline" size={11} color="#2563eb" />
                          <Text style={[styles.detailChipText, { color: "#2563eb" }]}>
                            {vehicle.capacity ? "Seat Layout" : "Build Seat Layout"}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {vehicle.driver_name ? (
                        <>
                          <View style={styles.detailChip}>
                            <Ionicons name="person" size={11} color="#6b7280" />
                            <Text style={styles.detailChipText} numberOfLines={1}>{vehicle.driver_name}</Text>
                          </View>
                          <TouchableOpacity
                            style={[styles.detailChip, { backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a" }]}
                            onPress={() => setShowUnassign(vehicle)}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="person-remove-outline" size={11} color="#d97706" />
                            <Text style={[styles.detailChipText, { color: "#d97706" }]}>Unassign</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <View style={[styles.detailChip, { backgroundColor: "#fef9c3" }]}>
                          <Ionicons name="person-outline" size={11} color="#b45309" />
                          <Text style={[styles.detailChipText, { color: "#b45309" }]}>Unassigned</Text>
                        </View>
                      )}

                      <TouchableOpacity
                        style={[styles.statusBadge, { backgroundColor: vehicle.status === "active" ? "#f0fdf4" : "#fef2f2" }]}
                        onPress={() => handleToggleStatus(vehicle)}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.statusDot, { backgroundColor: vehicle.status === "active" ? "#16a34a" : "#dc2626" }]} />
                        <Text style={[styles.statusText, { color: vehicle.status === "active" ? "#16a34a" : "#dc2626" }]}>
                          {vehicle.status === "active" ? "Active" : "Inactive"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

function LegendDot({ color, border, label }: { color: string; border: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: color, borderWidth: 1.5, borderColor: border }} />
      <Text style={{ fontSize: 10, color: "#6b7280", fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#f9fafb" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  toast:       { position: "absolute", top: 60, left: 20, right: 20, zIndex: 99, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1a4a52", borderRadius: 12, padding: 12 },
  toastText:   { color: "#fff", fontSize: 13, fontWeight: "700", flex: 1 },

  header:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 12 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle:    { fontSize: 22, fontWeight: "900", color: "#1a4a52" },
  headerSub:      { fontSize: 12, color: "#6b7280", marginTop: 2 },
  addBtn:         { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#1a4a52", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  addBtnText:     { color: "#fff", fontSize: 13, fontWeight: "800" },
  lockBanner:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fef9c3", borderRadius: 12, margin: 20, marginTop: 0, padding: 12, borderWidth: 1, borderColor: "#fde68a" },
  lockBannerText: { flex: 1, fontSize: 12, color: "#92400e", fontWeight: "600" },

  typeFilterRow:        { flexGrow: 0, paddingBottom: 12 },
  typeFilterRowContent: { flexDirection: "row", gap: 8, paddingHorizontal: 20 },
  typeFilterChip:       { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: "#fff" },
  typeFilterChipActive: { borderColor: "#1a4a52", backgroundColor: "#1a4a52" },
  typeFilterChipText:       { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  typeFilterChipTextActive: { color: "#fff" },

  list:      { flex: 1 },
  empty:     { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: "800", color: "#374151" },
  emptySub:  { fontSize: 12, color: "#9ca3af", textAlign: "center" },

  vehicleCard:    { flexDirection: "row", backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  vehicleAccent:  { width: 5 },
  vehicleMain:    { flex: 1, padding: 14, gap: 10 },
  vehicleTopRow:  { flexDirection: "row", alignItems: "center", gap: 12 },
  vehicleIcon:    { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  vehiclePlate:   { fontSize: 16, fontWeight: "900", color: "#1a4a52", letterSpacing: 0.5 },
  vehicleType:    { fontSize: 11, fontWeight: "700", marginTop: 1 },
  deleteBtn:      { flexDirection: "row", alignItems: "center", gap: 3, padding: 6 },
  deleteBtnText:  { fontSize: 11.5, fontWeight: "700", color: "#6b7280" },

  vehicleDetails: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  detailChip:     { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f3f4f6", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  detailChipText: { fontSize: 11, color: "#6b7280", fontWeight: "600" },
  statusBadge:    { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusDot:      { width: 6, height: 6, borderRadius: 3 },
  statusText:     { fontSize: 11, fontWeight: "800" },

  // modal
  modalOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet:       { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHandle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 20 },
  modalTitle:       { fontSize: 20, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  modalSub:         { fontSize: 13, color: "#6b7280", marginBottom: 20 },
  errorBox:         { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca", borderRadius: 12, padding: 12, marginBottom: 14 },
  errorText:        { flex: 1, color: "#dc2626", fontSize: 13 },
  fieldLabel:       { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },
  input:            { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#f9fafb", marginBottom: 6 },
  plateHint:        { fontSize: 11, color: "#9ca3af", marginBottom: 8 },
  modalActions:     { flexDirection: "row", gap: 10, marginTop: 16 },
  modalCancel:      { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  modalCancelText:  { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  modalConfirm:     { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: "#1a4a52", alignItems: "center" },
  modalConfirmText: { fontSize: 14, fontWeight: "800", color: "#fff" },
  confirmBox:       { backgroundColor: "#fff", borderRadius: 20, margin: 32, padding: 24, alignItems: "center", gap: 8 },
  confirmIconWrap:  { width: 64, height: 64, borderRadius: 32, backgroundColor: "#fef2f2", alignItems: "center", justifyContent: "center" },
  confirmTitle:     { fontSize: 18, fontWeight: "900", color: "#1a4a52" },
  confirmSub:       { fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 8 },

  // vehicle type read-only display
  typePickRow:  { flexDirection: "row", gap: 8, marginBottom: 6 },
  typePickItem: { flex: 1, alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12, backgroundColor: "#f9fafb", paddingVertical: 10 },
  typePickItemDisabled: { opacity: 0.5 },
  typePickItemText: { fontSize: 11, fontWeight: "700", color: "#9ca3af" },

  // seat config list
  configList:      { gap: 8, marginBottom: 14 },
  configItem:      { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", backgroundColor: "#f9fafb" },
  configItemActive:{ borderColor: "#1a4a52", backgroundColor: "#f0fdf4" },
  configText:      { fontSize: 13, color: "#6b7280", fontWeight: "600", flex: 1 },

  seatPickGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  seatPickItem:      { width: 56, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: "#e5e7eb", backgroundColor: "#f9fafb", alignItems: "center" },
  seatPickItemActive:{ borderColor: "#1a4a52", backgroundColor: "#1a4a52" },
  seatPickText:      { fontSize: 14, fontWeight: "800", color: "#374151" },

  classLockedBox:  { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a", borderRadius: 12, padding: 12 },
  classLockedText: { fontSize: 12, color: "#92400e", fontWeight: "600" },
  classLockedLink: { fontSize: 12, color: "#1a4a52", fontWeight: "800", marginTop: 4, textDecorationLine: "underline" },

  // Seat Layout Builder
  builderToolbar:   { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  builderToolBtn:   { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: "#1a4a52", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  builderToolText:  { fontSize: 11, fontWeight: "700", color: "#1a4a52" },
  seatLegendRow:    { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12, backgroundColor: "#f9fafb", borderRadius: 10, padding: 10 },
  unsavedBanner:     { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a", borderRadius: 10, padding: 10, marginBottom: 12 },
  unsavedBannerText: { flex: 1, fontSize: 12, color: "#92400e", fontWeight: "600" },
  builderRow:       { flexDirection: "row", gap: 8, marginBottom: 8 },
  builderSeat:      { width: 48, height: 48, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center", gap: 1 },
  builderSeatText:  { fontSize: 10, fontWeight: "800", color: "#1a4a52" },
  builderSeatBlank: { borderStyle: "dashed" },
  // Driver/Conductor cells widen (height stays equal to a regular seat) so
  // "Driver"/"Conductor" renders on one centered line instead of wrapping —
  // the narrow 48px seat-sized box was too tight for either word.
  builderSeatCrew:      { width: 92 },
  builderSeatCrewText:  { fontSize: 11, fontWeight: "500", color: "#4b5563", textAlign: "center" },

  seatTypeChip:      { borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  seatTypeChipActive:{ borderColor: "#1a4a52", backgroundColor: "#1a4a52" },
  seatTypeChipText:  { fontSize: 11, fontWeight: "700", color: "#6b7280", textTransform: "capitalize" },

  stepperRowSmall: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  stepperVal:      { fontSize: 14, fontWeight: "800", color: "#1a4a52" },

  templateRow:        { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  templateName:       { fontSize: 13, fontWeight: "700", color: "#374151" },
  templateSub:        { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  templateApplyBtn:   { backgroundColor: "#1a4a52", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  templateApplyText:  { fontSize: 12, fontWeight: "800", color: "#fff" },
  templateDeleteBtn:  { flexDirection: "row", alignItems: "center", gap: 3, padding: 6 },
  templateDeleteText: { fontSize: 11.5, fontWeight: "700", color: "#dc2626" },
});
