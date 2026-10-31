import API_BASE from "../config/api";

// What the logged-in commuter's account already knows, for pre-filling the
// discount application wizards (Student / PWD / Senior Citizen / category
// switch) so they don't retype it. Every value is still editable in the wizard
// — a physical ID can format a name slightly differently from the account.
export type ProfileAutofill = {
  firstName:  string;
  middleName: string;
  lastName:   string;
  birthdate:  string; // YYYY-MM-DD, or "" when the account has none
};

// Returns null if the profile can't be fetched — autofill is a convenience and
// must never block or break the wizard, which simply stays blank as before.
//
// Names are only returned when the account stores them as separate first/last
// fields. An older account with just a single free-text `name` gets nothing
// rather than a guess: splitting "Juan Miguel Santos" can't tell a two-word
// first name from a middle name, and a wrongly-filled name is worse than a
// blank one (the ID's printed name is cross-checked against it).
export async function fetchProfileAutofill(commuterId: number): Promise<ProfileAutofill | null> {
  try {
    const res  = await fetch(`${API_BASE}/commuter/get_profile.php?commuter_id=${commuterId}`);
    const data = await res.json();
    const u = data?.success ? data.user : null;
    if (!u) return null;

    const first = String(u.first_name ?? "").trim();
    const last  = String(u.last_name ?? "").trim();
    const hasStructuredName = first !== "" && last !== "";
    const dob = typeof u.date_of_birth === "string" && /^\d{4}-\d{2}-\d{2}$/.test(u.date_of_birth) ? u.date_of_birth : "";

    return {
      firstName:  hasStructuredName ? first : "",
      middleName: hasStructuredName ? String(u.middle_name ?? "").trim() : "",
      lastName:   hasStructuredName ? last : "",
      birthdate:  dob,
    };
  } catch {
    return null;
  }
}
