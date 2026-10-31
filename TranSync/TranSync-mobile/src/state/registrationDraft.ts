// Per-role, in-memory registration drafts — a plain module (not a Context
// provider), since each role's registration flow is a single linear stack
// of screens within one navigation stack and never needs to be read outside
// it. Two jobs:
//
// 1. Multi-step persistence: each redesigned registration screen (Commuter
//    2-step, Operator 3-step, Association 3-step) writes every field here on
//    change and reads it back on mount — this is what actually fixes the
//    "pressing Back wipes typed information" bug. Root cause (confirmed by
//    direct code reading, not assumed): every field previously lived in
//    local `useState` only; `router.back()` unmounts the screen entirely
//    (not just hides it), so a popped-then-repushed screen remounts with
//    every `useState` back at its default. Nothing previously read a draft
//    back on mount at all. Now every step's `useState` initializer pulls
//    from here first, so backing out and returning restores what was typed.
//
// 2. Handoff into the Student/PWD/Senior verification wizards: those wizard
//    screens (student-verification.tsx etc.) pre-fill their own Last/First/
//    Middle Name inputs from the commuter draft, same as before this
//    rewrite — left fully editable there, since a physical ID can format a
//    name slightly differently from how the commuter typed it here.
//
// Cleared once each role's final submit actually succeeds, so a later fresh
// registration attempt never accidentally reuses a stale draft.

export type CommuterDraft = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  password: string;
  phone_verified: boolean;
  // Step 2 — fare profile & discount status. Purely a UI choice/intent at
  // this point; the actual discount only ever activates through that
  // category's own OCR/liveness verification wizard (auto-pass, or admin
  // review) — selecting it here never grants anything by itself.
  discount_type: "default" | "student" | "disabled" | "elderly";
};

export type OperatorDraft = {
  // Step 1 — account & profile
  full_name: string;
  email: string;
  phone: string;
  password: string;
  phone_verified: boolean;
  // Step 2 — business & fleet setup
  entity_type: "individual" | "business";
  business_name: string;
  business_phone: string;
  vehicle_type: "Jeepney" | "UV Express" | "Bus" | "";
  plate_number: string;
  vehicle_number: string;
  seating_capacity: string; // free-typed, validated per vehicle type on submit; blank for Bus (capacity comes later from its seat layout, never collected at registration — see Do Not Break rule #22/#43)
  association_id: number | null; // null = "Independent" — no association application submitted
  // Step 3 — identity & compliance verification (documents handled as
  // separate File objects on the screen itself, not stored in this draft)
};

export type AssociationDraft = {
  // Step 1 — authorized representative contact
  rep_first_name: string;
  rep_last_name: string;
  rep_position: string;
  contact_email: string;
  contact_phone: string;
  password: string;
  phone_verified: boolean;
  // Step 2 — association profile
  name: string;
  address: string;
  coverage_area: string;
  estimated_fleet_size: string; // free-typed, parsed to int on submit
  // Step 3 — organizational verification (documents handled as separate
  // File objects on the screen itself, not stored in this draft)
};

let commuterDraft: CommuterDraft | null = null;
let operatorDraft: OperatorDraft | null = null;
let associationDraft: AssociationDraft | null = null;

export function getCommuterDraft(): CommuterDraft | null {
  return commuterDraft;
}
export function setCommuterDraft(next: Partial<CommuterDraft>) {
  commuterDraft = { ...(commuterDraft ?? BLANK_COMMUTER_DRAFT), ...next };
}
export function clearCommuterDraft() {
  commuterDraft = null;
}

export function getOperatorDraft(): OperatorDraft | null {
  return operatorDraft;
}
export function setOperatorDraft(next: Partial<OperatorDraft>) {
  operatorDraft = { ...(operatorDraft ?? BLANK_OPERATOR_DRAFT), ...next };
}
export function clearOperatorDraft() {
  operatorDraft = null;
}

export function getAssociationDraft(): AssociationDraft | null {
  return associationDraft;
}
export function setAssociationDraft(next: Partial<AssociationDraft>) {
  associationDraft = { ...(associationDraft ?? BLANK_ASSOCIATION_DRAFT), ...next };
}
export function clearAssociationDraft() {
  associationDraft = null;
}

export const BLANK_COMMUTER_DRAFT: CommuterDraft = {
  first_name: "", last_name: "", email: "", phone: "", password: "",
  phone_verified: false, discount_type: "default",
};

export const BLANK_OPERATOR_DRAFT: OperatorDraft = {
  full_name: "", email: "", phone: "", password: "", phone_verified: false,
  entity_type: "individual", business_name: "", business_phone: "",
  vehicle_type: "", plate_number: "", vehicle_number: "", seating_capacity: "",
  association_id: null,
};

export const BLANK_ASSOCIATION_DRAFT: AssociationDraft = {
  rep_first_name: "", rep_last_name: "", rep_position: "",
  contact_email: "", contact_phone: "", password: "", phone_verified: false,
  name: "", address: "", coverage_area: "", estimated_fleet_size: "",
};

// ── Legacy handoff shape, kept for the Student/PWD/Senior wizards ──────────
// The wizards (student-verification.tsx, pwd-verification.tsx,
// senior-verification.tsx) read this exact shape via getDraft() to pre-fill
// their own Last/First/Middle Name inputs and to know an in-progress
// commuter registration exists. middle_name/suffix/date_of_birth are no
// longer collected on the redesigned Step 1 (see CommuterDraft above) — kept
// here only as always-empty/optional so the wizards' existing pre-fill code
// (`draft?.middle_name ?? ""`) keeps working unchanged.
export type RegistrationDraft = {
  email: string;
  phone: string;
  password: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  date_of_birth: string;
  terms_accepted: true;
};

export function getDraft(): RegistrationDraft | null {
  if (!commuterDraft) return null;
  return {
    email: commuterDraft.email,
    phone: commuterDraft.phone,
    password: commuterDraft.password,
    first_name: commuterDraft.first_name,
    middle_name: "",
    last_name: commuterDraft.last_name,
    suffix: "",
    date_of_birth: "",
    terms_accepted: true,
  };
}
export function clearDraft() {
  clearCommuterDraft();
}
