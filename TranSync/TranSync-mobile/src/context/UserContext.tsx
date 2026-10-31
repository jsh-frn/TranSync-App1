import {
  createContext, useContext, useState, useCallback, useEffect, useRef,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import API_BASE from "../config/api";
import { getNotifyVerificationStatus } from "../state/settingsPrefs";

// Single shared source of the logged-in commuter's own profile — mirrors
// BookingsContext's reasoning (Core Flow 9a): every screen that read
// is_verified/category/status/rejected_at straight off the AsyncStorage
// "user" blob only ever saw whatever was true at login time, so an admin
// verifying (or rejecting) the commuter mid-session never showed up
// anywhere until logout/login. refreshUser() re-fetches the authoritative
// fields from commuter/get_profile.php, merges them into the cached object
// (never wholesale-replaces it — fields the endpoint doesn't return, like
// any future additions, are preserved), and persists the merge back to
// AsyncStorage so a screen that reads AsyncStorage directly on next mount
// also sees it. No websocket/push infra exists in this app — "live" here
// means each screen calls refreshUser() on focus (the same pattern
// BookingsContext's refreshUpcoming()/refreshHistory() already use).

export interface StoredUser {
  id: number;
  name: string;
  email: string;
  phone: string;
  category: string;
  is_verified: number;
  status: string;
  rejected_at: string | null;
  rejection_reason?: string | null;
  created_at?: string;
  avatar_url?: string | null;
  student_verification_expired?: boolean;
  pwd_verification_expired?: boolean;
  // Additive fields for the "Change Discount Type" feature (Profile screen)
  // — deliberately separate from `category`/`is_verified` above, which stay
  // the fare-calculation-downgraded values every other screen already
  // depends on unchanged. raw_category is the commuter's actual stored
  // category, undowngraded, so Profile can show "Student (Expired)" instead
  // of "Standard" once lapsed.
  raw_category?: string;
  discount_expires_at?: string | null;
  can_switch_category?: boolean;
  // Settings' "Discount Eligibility" section (Core Flow 2b) — true only for
  // a Default commuter with no pending submission. Distinct from
  // can_switch_category (renewal/switch of an EXPIRED category) — a
  // first-time applicant has nothing to switch from.
  can_apply_category?: boolean;
  [key: string]: any;
}

interface UserContextValue {
  user: StoredUser | null;
  refreshUser: () => Promise<void>;
  // Settings → Notifications → "Verification status updates" (Core Flow 2b).
  // No push infra exists in this app, so this is the honest in-app
  // equivalent: a one-time banner surfaced the moment a refreshUser() poll
  // or focus-refetch actually detects a change, not a fake toggle that does
  // nothing. null when there's nothing to show.
  verificationStatusAlert: string | null;
  dismissVerificationStatusAlert: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [verificationStatusAlert, setVerificationStatusAlert] = useState<string | null>(null);

  // Baseline for the diff below — undefined until the first successful
  // fetch, so app-open hydration (comparing a fresh fetch against the stale
  // AsyncStorage cache from login time) never itself counts as a "change."
  const prevFetchedRef = useRef<{ is_verified: number; rejected_at: string | null } | undefined>(undefined);

  const refreshUser = useCallback(async () => {
    const raw = await AsyncStorage.getItem("user");
    const current: StoredUser | null = raw ? JSON.parse(raw) : null;
    // Paint from cache immediately — the network reconciliation below can
    // take a moment, and there's no reason to show a blank/default state
    // (or an unverified flash) while it's in flight when a perfectly good
    // cached value already exists.
    if (current) setUser(current);
    if (!current?.id) return;
    try {
      const res  = await fetch(`${API_BASE}/commuter/get_profile.php?commuter_id=${current.id}`);
      const data = await res.json();
      if (data?.success && data.user) {
        const merged: StoredUser = { ...current, ...data.user };
        await AsyncStorage.setItem("user", JSON.stringify(merged));
        setUser(merged);

        const prev = prevFetchedRef.current;
        const next = { is_verified: (data.user.is_verified as number) ?? 0, rejected_at: data.user.rejected_at ?? null };
        if (prev && (prev.is_verified !== next.is_verified || prev.rejected_at !== next.rejected_at)) {
          const notifyEnabled = await getNotifyVerificationStatus();
          if (notifyEnabled) {
            if (next.rejected_at && !prev.rejected_at) {
              setVerificationStatusAlert("Your verification was rejected. Check your Profile for details.");
            } else if (next.is_verified === 1 && prev.is_verified !== 1) {
              setVerificationStatusAlert("Your account has been verified!");
            } else if (next.is_verified !== 1 && prev.is_verified === 1) {
              setVerificationStatusAlert("Your verification status has changed. Check your Profile for details.");
            }
          }
        }
        prevFetchedRef.current = next;
      }
    } catch {
      // Network failure — the cached value set above stays shown.
    }
  }, []);

  const dismissVerificationStatusAlert = useCallback(() => setVerificationStatusAlert(null), []);

  // Hydrate immediately on mount so a freshly-opened app doesn't wait for
  // the first screen to explicitly call refreshUser() itself.
  useEffect(() => { refreshUser(); }, [refreshUser]);

  const value: UserContextValue = { user, refreshUser, verificationStatusAlert, dismissVerificationStatusAlert };
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser() must be used within a UserProvider");
  return ctx;
}
