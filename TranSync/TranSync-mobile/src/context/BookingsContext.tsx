import {
  createContext, useContext, useState, useCallback, useEffect, useRef, useMemo,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchCommuterReservations, deriveBookingActivity } from "../services/bookingService";
import type { CommuterReservation, BookingActivityEntry } from "../types/booking";

// Single shared source of a commuter's bookings, read by every screen that
// needs them (book.tsx's "My Upcoming Bookings", home.tsx's "Recent
// Activity", and the Booking History screen) instead of each one holding its
// own independently-fetched copy — that per-screen duplication was the root
// cause of the three views drifting out of sync with each other. No
// websocket/push infra exists in this app, so "live" here means: instant
// local update the moment an action succeeds (addOptimistic /
// applyLocalStatusChange), plus a refetch whenever a screen using this
// context regains focus (the same useFocusEffect pattern wallet.tsx already
// uses) — not a background push.

// A scanned ('boarded') ticket has been used, so it is no longer "upcoming".
const ACTIVE_BOARDING_STATUSES = new Set(["reserved"]);

interface BookingsContextValue {
  commuterId: number | null;
  upcoming: CommuterReservation[];
  history: CommuterReservation[];
  activity: BookingActivityEntry[];
  upcomingLoading: boolean;
  historyLoading: boolean;
  refreshUpcoming: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshAll: () => Promise<void>;
  addOptimistic: (booking: CommuterReservation) => void;
  applyLocalStatusChange: (id: number, patch: Partial<CommuterReservation>) => void;
}

const BookingsContext = createContext<BookingsContextValue | null>(null);

export function BookingsProvider({ children }: { children: ReactNode }) {
  const [commuterId, setCommuterId]           = useState<number | null>(null);
  const [upcoming, setUpcoming]               = useState<CommuterReservation[]>([]);
  const [history, setHistory]                 = useState<CommuterReservation[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const commuterIdRef = useRef<number | null>(null);

  // Sequence guards against a stale-response race: "Book Another Trip"/"Back
  // to Home" kick off a refreshAll() the instant a booking succeeds, but
  // don't await it. If the commuter books again (on the same trip or any
  // other) before that fetch resolves, addOptimistic() correctly adds the
  // new booking — but the earlier, now-outdated fetch was already in flight
  // and reflects the world *before* that second booking existed. Without a
  // guard, that stale response lands afterward and silently overwrites
  // (clobbers) the optimistically-added second booking, making it vanish
  // from "My Upcoming Bookings" even though it's really in the database
  // (confirmed live: both reservations exist and are returned correctly by
  // get_commuter_reservations.php — this was purely a client-side race).
  // Bumping the sequence on every local mutation invalidates any older
  // in-flight fetch so its response is ignored when it finally arrives.
  const upcomingSeq = useRef(0);
  const historySeq  = useRef(0);

  useEffect(() => {
    AsyncStorage.getItem("user").then((raw) => {
      const user = raw ? JSON.parse(raw) : null;
      if (user?.id) {
        commuterIdRef.current = user.id;
        setCommuterId(user.id);
      }
    });
  }, []);

  const refreshUpcoming = useCallback(async () => {
    const id = commuterIdRef.current;
    if (!id) return;
    const mySeq = ++upcomingSeq.current;
    setUpcomingLoading(true);
    try {
      const data = await fetchCommuterReservations(id, "upcoming");
      // Only apply if nothing newer (a fresher refresh or a local
      // optimistic mutation) has happened since this fetch started —
      // otherwise this stale response would clobber more current state.
      if (mySeq === upcomingSeq.current) setUpcoming(data);
    } finally {
      setUpcomingLoading(false);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    const id = commuterIdRef.current;
    if (!id) return;
    const mySeq = ++historySeq.current;
    setHistoryLoading(true);
    try {
      const data = await fetchCommuterReservations(id, "all");
      if (mySeq === historySeq.current) setHistory(data);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshUpcoming(), refreshHistory()]);
  }, [refreshUpcoming, refreshHistory]);

  useEffect(() => {
    if (commuterId) refreshAll();
  }, [commuterId, refreshAll]);

  // Called the instant a booking succeeds, so it shows up in "My Upcoming
  // Bookings" without waiting for a refetch or a "Book Another Trip" tap.
  const addOptimistic = useCallback((booking: CommuterReservation) => {
    // Invalidate any refreshUpcoming()/refreshHistory() call already in
    // flight — it was kicked off before this booking existed, so its
    // eventual response must not be allowed to overwrite this newer state.
    upcomingSeq.current++;
    historySeq.current++;
    setUpcoming((prev) => [booking, ...prev.filter((b) => b.id !== booking.id)]);
    setHistory((prev) => [booking, ...prev.filter((b) => b.id !== booking.id)]);
  }, []);

  // Called the instant a cancel/refund succeeds — drops the booking out of
  // Upcoming immediately (it's no longer active) and reflects the new status
  // in History/Recent Activity without waiting for a refetch.
  const applyLocalStatusChange = useCallback((id: number, patch: Partial<CommuterReservation>) => {
    upcomingSeq.current++;
    historySeq.current++;
    setUpcoming((prev) =>
      prev
        .map((b) => (b.id === id ? { ...b, ...patch } : b))
        .filter((b) => ACTIVE_BOARDING_STATUSES.has(b.boarding_status))
    );
    setHistory((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const activity = useMemo(() => deriveBookingActivity(history), [history]);

  const value: BookingsContextValue = {
    commuterId, upcoming, history, activity, upcomingLoading, historyLoading,
    refreshUpcoming, refreshHistory, refreshAll, addOptimistic, applyLocalStatusChange,
  };

  return <BookingsContext.Provider value={value}>{children}</BookingsContext.Provider>;
}

export function useBookings(): BookingsContextValue {
  const ctx = useContext(BookingsContext);
  if (!ctx) throw new Error("useBookings() must be used within a BookingsProvider");
  return ctx;
}
