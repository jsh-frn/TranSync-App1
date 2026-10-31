import AsyncStorage from "@react-native-async-storage/async-storage";

// An operator can hold multiple approved vehicle-type memberships, each
// mapping to exactly one association (Core Flow 8 — this invariant is
// unchanged: an operator can never be approved for the same vehicle type at
// two different associations at once). This module groups those per-type
// applications by association so the operator can pick which association is
// their "active workspace" — the group with the most vehicle types isn't
// special, this is purely about which association's data other screens
// (Vehicles/Drivers/Trips/Fare) filter down to by default.

export type VehicleType = "Jeepney" | "UV Express" | "Bus";

export type AssocApplication = {
  id: number;
  association_id: number;
  association_name: string;
  vehicle_type: VehicleType;
  status: "pending" | "approved" | "rejected" | "removed";
  rejection_reason: string | null;
  // "Finish adding your vehicle" reminder from the registration wizard's
  // Step 2 (see migration 055) — only meaningful once status='approved' and
  // vehicle_added is still false.
  intended_plate_number?:   string | null;
  intended_vehicle_number?: string | null;
  intended_capacity?:       number | null;
  vehicle_added?:           boolean;
};

export type AssociationGroup = {
  association_id: number;
  association_name: string;
  // approved vehicle types only — a pending/rejected type at this
  // association doesn't make it "switchable" or affect what's shown once
  // it's active, only approved types ever gate real data access elsewhere.
  vehicle_types: VehicleType[];
};

// Groups approved applications by association, sorted by name for a stable,
// predictable default (see resolveActiveAssociation below).
export function groupApprovedByAssociation(applications: AssocApplication[]): AssociationGroup[] {
  const map = new Map<number, AssociationGroup>();
  for (const a of applications) {
    if (a.status !== "approved") continue;
    const existing = map.get(a.association_id);
    if (existing) {
      if (!existing.vehicle_types.includes(a.vehicle_type)) existing.vehicle_types.push(a.vehicle_type);
    } else {
      map.set(a.association_id, {
        association_id: a.association_id,
        association_name: a.association_name,
        vehicle_types: [a.vehicle_type],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.association_name.localeCompare(b.association_name));
}

// Unscoped, matching this app's existing "user"/"role" AsyncStorage
// convention (see the four logout handlers, all plain AsyncStorage.multiRemove
// calls, no per-user key namespacing) — always cleared on operator logout.
export const ACTIVE_ASSOCIATION_STORAGE_KEY = "active_association_id";

export async function getActiveAssociationId(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_ASSOCIATION_STORAGE_KEY);
  return raw ? Number(raw) : null;
}

export async function setActiveAssociationId(associationId: number): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_ASSOCIATION_STORAGE_KEY, String(associationId));
}

// Resolves which association is active among the operator's approved
// groups: the previously-chosen one if it's still valid, otherwise the
// first group alphabetically (persisted as the new default so it's stable
// across screens within the same session). Returns null if the operator
// has no approved association at all yet.
export async function resolveActiveAssociation(groups: AssociationGroup[]): Promise<AssociationGroup | null> {
  if (groups.length === 0) return null;
  const storedId = await getActiveAssociationId();
  const stored = groups.find(g => g.association_id === storedId);
  if (stored) return stored;
  await setActiveAssociationId(groups[0].association_id);
  return groups[0];
}
