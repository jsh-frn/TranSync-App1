import { KeyboardAwareScrollView, KeyboardAwareScrollViewProps } from "react-native-keyboard-aware-scroll-view";

// Drop-in replacement for `ScrollView` on any screen/modal holding a form —
// automatically scrolls the currently-focused TextInput (or any other
// focusable control) above the on-screen keyboard, on both iOS and Android,
// and reverts the scroll position when the keyboard dismisses. Never nest
// this inside a `KeyboardAvoidingView` — the two fight over the same offset
// and produce jumpy/over-corrected scrolling; this component already
// handles both platforms on its own.
//
// Centralizing the config here (rather than repeating these props at every
// call site) is what keeps keyboard behavior consistent app-wide — see
// TranSync/TranSync-mobile/app.json's `android.softwareKeyboardLayoutMode:
// "pan"`, which this component's own Android offset math assumes (native
// window resize would otherwise double-compensate against it).
export default function KeyboardAwareForm(props: KeyboardAwareScrollViewProps) {
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps="handled"
      enableOnAndroid
      enableAutomaticScroll
      extraScrollHeight={20}
      keyboardOpeningTime={0}
      {...props}
    />
  );
}
