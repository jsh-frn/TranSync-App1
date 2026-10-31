import { Alert } from "react-native";
import API_BASE from "../config/api";

// "Remove Discount" for a commuter whose Student/PWD verification has expired
// and who doesn't want to (or can't) renew — drops the account back to
// Standard so the expired-discount reminders stop cluttering their Home and
// Profile. It reuses the existing switch-to-Standard call
// (commuter_switch_category.php, target "default"): instant, no documents, no
// admin review, and it never touches wallet, bookings or verification history.
//
// Always asks first — this changes what fares the commuter is charged — and the
// wording says exactly what will happen and that they can apply again.
export function confirmRemoveExpiredDiscount(opts: {
  commuterId: number;
  categoryLabel: string;            // e.g. "Student", "PWD"
  onStart?: () => void;
  onFinish?: () => void;
  onRemoved: () => void | Promise<void>; // e.g. UserContext.refreshUser
}) {
  const { commuterId, categoryLabel, onStart, onFinish, onRemoved } = opts;
  Alert.alert(
    `Remove your ${categoryLabel} discount?`,
    `It has expired, so it isn't giving you a discount anymore. Removing it puts your account back on Standard fares and clears this reminder.\n\nThis takes effect immediately. You can apply for a discount again anytime from your Profile.`,
    [
      { text: "Keep It", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          onStart?.();
          try {
            const fd = new FormData();
            fd.append("commuter_id", String(commuterId));
            fd.append("target_category", "default");
            const res  = await fetch(`${API_BASE}/auth/commuter_switch_category.php`, { method: "POST", body: fd });
            const data = await res.json();
            if (!data.success) {
              Alert.alert("Couldn't remove it", data.message || "Please try again.");
              return;
            }
            await onRemoved();
            Alert.alert("Discount removed", "Your account is now on Standard fares.");
          } catch {
            Alert.alert("Connection error", "Couldn't reach the server. Please try again.");
          } finally {
            onFinish?.();
          }
        },
      },
    ]
  );
}
