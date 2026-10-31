import { useState, useEffect } from "react";
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

export interface ViewerDocument {
  label: string;
  url: string;
}

interface Props {
  visible: boolean;
  documents: ViewerDocument[];
  initialIndex: number;
  onClose: () => void;
}

// Full-screen document viewer — replaces Linking.openURL (which kicked the
// reviewer out to an external browser with no zoom and no way to move
// between an application's other uploaded documents).
//
// Zoom is built on react-native-gesture-handler + react-native-reanimated
// (both already installed for expo-router; GestureHandlerRootView already
// wraps the app in app/_layout.tsx) rather than ScrollView's
// minimumZoomScale/maximumZoomScale — those are iOS-only props, Android's
// ScrollView has no built-in pinch-zoom at all, and this app targets both.
// Navigation between documents is explicit prev/next buttons (+ dots)
// rather than a swipeable pager, so there's no gesture conflict between
// "swipe to next document" and "pan while zoomed in" to reason about.
export function DocumentViewerModal({ visible, documents, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);

  // Re-sync to whichever thumbnail was tapped each time the viewer opens.
  useEffect(() => { if (visible) setIndex(initialIndex); }, [visible, initialIndex]);

  if (!documents.length) return null;
  const clampedIndex = Math.min(index, documents.length - 1);
  const current = documents[clampedIndex];

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.7}>
            <Ionicons name="close" size={22} color="#fff" />
            <Text style={s.closeBtnText}>Close</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{current?.label}</Text>
            {documents.length > 1 && (
              <Text style={s.counter}>{clampedIndex + 1} of {documents.length}</Text>
            )}
          </View>
        </View>

        {/* key resets pan/zoom state whenever the document changes */}
        <ZoomImage key={current.url} url={current.url} />

        {documents.length > 1 && (
          <>
            <View style={s.navRow} pointerEvents="box-none">
              <TouchableOpacity
                style={[s.navBtn, clampedIndex === 0 && s.navBtnDisabled]}
                disabled={clampedIndex === 0}
                onPress={() => setIndex(clampedIndex - 1)}
                accessibilityLabel="Previous document"
              >
                <Ionicons name="chevron-back" size={22} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.navBtn, clampedIndex === documents.length - 1 && s.navBtnDisabled]}
                disabled={clampedIndex === documents.length - 1}
                onPress={() => setIndex(clampedIndex + 1)}
                accessibilityLabel="Next document"
              >
                <Ionicons name="chevron-forward" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={s.dotsRow}>
              {documents.map((_, i) => (
                <View key={i} style={[s.dot, i === clampedIndex && s.dotActive]} />
              ))}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const MAX_SCALE = 5;

function ZoomImage({ url }: { url: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const { width, height } = useWindowDimensions();

  const scale      = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX     = useSharedValue(0);
  const savedY     = useSharedValue(0);

  function resetZoom() {
    "worklet";
    scale.value      = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedX.value      = 0;
    savedY.value      = 0;
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, MAX_SCALE));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) resetZoom();
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        resetZoom();
      } else {
        const next = 2.5;
        scale.value      = withTiming(next);
        savedScale.value = next;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={s.imageWrap}>
      {status === "error" ? (
        <View style={s.placeholder}>
          <Ionicons name="alert-circle-outline" size={48} color="#f87171" />
          <Text style={s.placeholderTitle}>Couldn't load this document</Text>
          <Text style={s.placeholderSub}>It may be missing or failed to upload.</Text>
        </View>
      ) : (
        <GestureDetector gesture={composed}>
          <Animated.View style={[{ width, height: height * 0.8 }, animatedStyle]}>
            {status === "loading" && (
              <ActivityIndicator size="large" color="#fff" style={s.loadingSpinner} />
            )}
            <Image
              source={{ uri: url }}
              style={[s.image, { opacity: status === "loaded" ? 1 : 0 }]}
              resizeMode="contain"
              onLoad={() => setStatus("loaded")}
              onError={() => setStatus("error")}
            />
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingTop: 54, paddingBottom: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  closeBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  closeBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  title:    { fontSize: 15, fontWeight: "800", color: "#fff" },
  counter:  { fontSize: 12, color: "#d1d5db", marginTop: 2 },

  imageWrap: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image:     { width: "100%", height: "100%" },
  loadingSpinner: { position: "absolute", alignSelf: "center", top: "45%" },

  placeholder:      { alignItems: "center", justifyContent: "center", padding: 32, gap: 6 },
  placeholderTitle: { fontSize: 15, fontWeight: "800", color: "#fff", marginTop: 8 },
  placeholderSub:   { fontSize: 12.5, color: "#9ca3af", textAlign: "center" },

  navRow: {
    position: "absolute", top: "50%", left: 0, right: 0,
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 8, marginTop: -22,
  },
  navBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  navBtnDisabled: { opacity: 0.25 },

  dotsRow: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6,
    paddingVertical: 16, backgroundColor: "rgba(0,0,0,0.6)",
  },
  dot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotActive: { backgroundColor: "#fff", width: 8, height: 8, borderRadius: 4 },
});
