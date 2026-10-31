import { Stack } from "expo-router";
import { BookingsProvider } from "../../src/context/BookingsContext";
import { UserProvider } from "../../src/context/UserContext";

// Outer Stack for the whole Commuter section — wraps the (tabs) group (home/
// map/book/wallet/profile, see (tabs)/_layout.tsx) as one screen alongside
// every "pushed" detail screen (settings, verification-status,
// booking-history, ltfrb-fare-guide, category-switch, select-rebook-trip,
// active-trip, scan, wallet-history) as its Stack siblings. No explicit
// Stack.Screen list needed — same auto-discovery pattern the root
// app/_layout.tsx already uses.
//
// Providers live here (not inside (tabs)/_layout.tsx) since screens like
// settings.tsx also read useUser()/useBookings() and are no longer
// descendants of the Tabs navigator.

export default function MainLayout() {
  return (
    <UserProvider>
      <BookingsProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </BookingsProvider>
    </UserProvider>
  );
}
