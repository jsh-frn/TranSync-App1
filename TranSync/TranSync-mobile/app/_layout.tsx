import React, { useEffect } from "react";
import { Text, TextInput } from "react-native";
import { Stack, useRouter, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Cap the system font-scale so a phone set to a large text size can't blow up
// fixed-height buttons/tabs/chips and push content off screen (looks fine on an
// emulator at default scale, breaks on real devices). Text stays scalable, just
// bounded. React 19 ignores defaultProps on function components, so wrap the
// components' render instead. Guarded — any failure leaves Text/TextInput as-is.
const FONT_SCALE_CAP = 1.3;
function capFontScale(Comp: any) {
  try {
    if (!Comp || typeof Comp.render !== "function" || Comp.__fontCapped) return;
    const origRender = Comp.render;
    Comp.render = function (...args: any[]) {
      const el = origRender.apply(this, args);
      if (!React.isValidElement(el)) return el;
      const props: any = (el as any).props ?? {};
      if (props.maxFontSizeMultiplier != null) return el;
      return React.cloneElement(el as any, { maxFontSizeMultiplier: FONT_SCALE_CAP });
    };
    Comp.__fontCapped = true;
  } catch {
    // leave untouched
  }
}
capFontScale(Text);
capFontScale(TextInput);

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // This is meant for cold-start session restore only — redirecting the
    // user from the app's bare entry point to their role's home screen. It
    // must never fire once the user is already navigated somewhere in the
    // app: a real bug (found live, reported as "Back on Settings goes to
    // Home instead of the previous screen") was this effect force-replacing
    // the current screen with role-home any time RootLayout happened to
    // re-run — on web specifically, a back-navigation can remount layouts
    // without a true cold start, so this fired mid-session and clobbered
    // whatever screen router.back() had just correctly landed on. Guarding
    // on pathname being the true entry point ("/" or empty) makes this
    // effect a no-op for every other in-app navigation, including back().
    if (pathname && pathname !== "/") return;

    // Small delay to let the Stack fully mount before redirecting
    const checkAuth = async () => {
      try {
        const user = await AsyncStorage.getItem("user");
        const role = await AsyncStorage.getItem("role");

        if (user && role === "commuter") {
          router.replace("/(main)/home");
        } else if (user && role === "operator") {
          router.replace("/(operator)/dashboard");
        } else if (user && role === "driver") {
          router.replace("/(driver)/dashboard");
        } else if (user && role === "association") {
          router.replace("/(association)/dashboard");
        }
      } catch {
        // Let app load normally
      }
    };

    const timeout = setTimeout(checkAuth, 300);
    return () => clearTimeout(timeout);
  }, [pathname]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}