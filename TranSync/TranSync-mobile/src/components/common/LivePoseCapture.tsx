import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import { CameraView, type PermissionResponse } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import API_BASE from "../../config/api";

// Shared live pose-capture control, used by all four ID-verification wizards
// (Student/PWD/Senior registration + renewal + category-switch — previously
// each had its own byte-identical copy of this UI built around a blind 3-2-1
// countdown timer, no check that the commuter actually turned their head
// until the photos were uploaded and checked afterward).
//
// This version keeps the camera session continuous but replaces the timer
// with a real-time poll loop: roughly once a second while a pose is active,
// it snaps a mid-quality frame and checks it against real AWS Rekognition
// via transync-backend/api/auth/check_pose_frame.php (a thin wrapper around
// the same rekognitionDetectFaces() the server's own authoritative
// checkPoseChallenge() liveness check already uses). Two consecutive polls
// confirming the pose (not one — avoids a single flaky/lucky read locking in
// prematurely) auto-accepts that exact confirmed frame as the pose's photo,
// no separate "recapture" step. A true on-device tracker (react-native-
// vision-camera + Nitro + an ML Kit face-detector) was attempted first, but
// hit a reproducible native crash in the library's own minimal documented
// example on real hardware — a confirmed upstream bug, not fixable in this
// project — so this polling approach was adopted instead.
//
// IMPORTANT: this component's live pose check is UX only. The authoritative
// pass/fail decision remains checkPoseChallenge() in
// transync-backend/config/student_verification.php, run server-side against
// the final submitted stills at registration/renewal/switch time — this
// component (and check_pose_frame.php) never gate an actual account
// creation or verification outcome, they only make the capture experience
// feel real-time instead of a blind timer.

export type FacePhase = "idle" | "center" | "left" | "right" | "review";

const FACE_PROMPTS: Record<Exclude<FacePhase, "idle" | "review">, string> = {
  center: "Look straight at the camera",
  left: "Now turn your head to the LEFT",
  right: "Now turn your head to the RIGHT",
};

// Mirrors config/rekognition.php's POSE_MIN_YAW_DEGREES (=15.0) — a UX-only
// client-side copy for live feedback, NOT the authoritative check (that
// stays server-side, see the comment above). No shared-config mechanism
// exists between this PHP backend and this RN app, so if the backend
// constant ever changes, this one needs a matching manual edit.
const POSE_MIN_YAW_DEGREES = 15.0;
const POLL_INTERVAL_MS = 1000;
const CONFIRM_STREAK = 2;
const MANUAL_FALLBACK_AFTER_POLLS = 8;

// Same left/right yaw sign convention already established server-side
// (confirmed live: a real captured LEFT turn reads as a positive yaw, a
// real RIGHT turn reads as negative) — center is just "close to zero".
function isPoseInRange(phase: "center" | "left" | "right", yaw: number): boolean {
  if (phase === "center") return Math.abs(yaw) < POSE_MIN_YAW_DEGREES;
  if (phase === "left") return yaw > POSE_MIN_YAW_DEGREES;
  return yaw < -POSE_MIN_YAW_DEGREES;
}

export default function LivePoseCapture({
  permission,
  requestPermission,
  cameraRef,
  phase,
  selfieCenterUri,
  selfieLeftUri,
  selfieRightUri,
  onStart,
  onCaptured,
}: {
  permission: PermissionResponse | null;
  requestPermission: () => void;
  cameraRef: React.RefObject<CameraView | null>;
  phase: FacePhase;
  selfieCenterUri: string | null;
  selfieLeftUri: string | null;
  selfieRightUri: string | null;
  onStart: () => void;
  onCaptured: (pose: "center" | "left" | "right", uri: string) => void;
}) {
  const [liveMessage, setLiveMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [pollCount, setPollCount] = useState(0);
  const streakRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    if (phase !== "center" && phase !== "left" && phase !== "right") return;
    streakRef.current = 0;
    setStreakDisplay(0);
    setPollCount(0);
    setLiveMessage(FACE_PROMPTS[phase]);

    const currentPhase = phase;
    const timer = setInterval(() => {
      pollOnce(currentPhase);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const pollOnce = async (currentPhase: "center" | "left" | "right") => {
    if (busyRef.current || !cameraRef.current) return;
    busyRef.current = true;
    setChecking(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      if (!photo?.uri) return;

      const fd = new FormData();
      fd.append("frame", { uri: photo.uri, name: "frame.jpg", type: "image/jpeg" } as any);
      const res = await fetch(`${API_BASE}/auth/check_pose_frame.php`, { method: "POST", body: fd });
      const data = await res.json();
      setPollCount((c) => c + 1);

      if (!data.success || !data.face_found || data.yaw == null) {
        streakRef.current = 0;
        setStreakDisplay(0);
        setLiveMessage("Can't see your face clearly — check lighting and hold steady");
        return;
      }

      if (isPoseInRange(currentPhase, data.yaw)) {
        streakRef.current += 1;
        setStreakDisplay(streakRef.current);
        if (streakRef.current >= CONFIRM_STREAK) {
          streakRef.current = 0;
          setStreakDisplay(0);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onCaptured(currentPhase, photo.uri);
          return;
        }
        setLiveMessage("Hold it...");
      } else {
        streakRef.current = 0;
        setStreakDisplay(0);
        setLiveMessage(FACE_PROMPTS[currentPhase]);
      }
    } catch {
      // Network hiccup — just skip this poll, the next one retries automatically.
    } finally {
      // takePictureAsync() pauses the live preview as part of its native
      // capture pipeline (confirmed via a real black-screen repro on-device)
      // — since this loop calls it roughly once a second while the camera
      // stays mounted, the preview must be explicitly resumed every time or
      // it never recovers between polls. Safe to call unconditionally,
      // regardless of which branch above returned.
      cameraRef.current?.resumePreview?.();
      busyRef.current = false;
      setChecking(false);
    }
  };

  const captureManually = async () => {
    if (!cameraRef.current || phase === "idle" || phase === "review") return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      if (photo?.uri) onCaptured(phase, photo.uri);
    } catch {
      // Leaves the pose uncaptured — the review step's "Retake All" is the recovery path.
    } finally {
      cameraRef.current?.resumePreview?.();
    }
  };

  if (phase === "review") {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Facial Verification Captured</Text>
        <Text style={styles.cardHint}>Check that all three came out clearly, or retake the whole sequence.</Text>
        <View style={styles.reviewGrid}>
          <ReviewThumb label="Center" uri={selfieCenterUri} />
          <ReviewThumb label="Left" uri={selfieLeftUri} />
          <ReviewThumb label="Right" uri={selfieRightUri} />
        </View>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#1a4a52" />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Camera access needed</Text>
        <TouchableOpacity style={styles.retakeBtn} onPress={requestPermission}>
          <Text style={styles.retakeText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === "idle") {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ready for Facial Verification</Text>
        <Text style={styles.cardHint}>
          We'll check three quick poses live — looking straight ahead, then turned left, then turned right. Get into position, then tap Start when you're ready.
        </Text>
        <View style={styles.cameraWrap}>
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="front" />
        </View>
        <TouchableOpacity style={styles.shutterBtn} onPress={onStart} activeOpacity={0.85}>
          <Ionicons name="videocam" size={20} color="#fff" />
          <Text style={styles.shutterText}>Start Capture</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const showManualFallback = pollCount >= MANUAL_FALLBACK_AFTER_POLLS;
  const guideColor = streakDisplay > 0 ? "#a8d832" : "#e5e7eb";

  return (
    <View style={styles.card}>
      <View style={styles.promptRow}>
        {phase !== "center" && (
          <Ionicons
            name={phase === "left" ? "chevron-back" : "chevron-forward"}
            size={20}
            color="#1a4a52"
          />
        )}
        <Text style={styles.cardTitle}>{liveMessage || FACE_PROMPTS[phase]}</Text>
      </View>
      <View style={styles.cameraWrap}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="front" />
        <View style={[styles.guideOval, { borderColor: guideColor }]} pointerEvents="none" />
        {checking && (
          <View style={styles.checkingBadge}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.streakDots}>
        {Array.from({ length: CONFIRM_STREAK }).map((_, i) => (
          <View key={i} style={[styles.streakDot, i < streakDisplay && styles.streakDotActive]} />
        ))}
      </View>
      <View style={styles.facePhaseDots}>
        {(["center", "left", "right"] as const).map((p) => (
          <View key={p} style={[styles.facePhaseDot, p === phase && styles.facePhaseDotActive]} />
        ))}
      </View>
      {showManualFallback && (
        <TouchableOpacity style={styles.retakeBtn} onPress={captureManually}>
          <Text style={styles.retakeText}>Trouble with auto-detection? Tap to capture manually</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ReviewThumb({ label, uri }: { label: string; uri: string | null }) {
  if (!uri) return null;
  return (
    <View style={styles.reviewThumbWrap}>
      <Image source={{ uri }} style={styles.reviewThumb} />
      <Text style={styles.reviewThumbLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1.5, borderColor: "#e5e7eb", padding: 18, gap: 14 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#1a4a52" },
  cardHint: { fontSize: 13, color: "#6b7280", lineHeight: 19 },
  promptRow: { flexDirection: "row", alignItems: "center", gap: 6 },

  cameraWrap: { width: "100%", height: 260, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  shutterBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#1a4a52", borderRadius: 12, paddingVertical: 14,
  },
  shutterText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  guideOval: {
    position: "absolute", alignSelf: "center", top: "15%",
    width: "55%", height: "70%", borderRadius: 999, borderWidth: 3,
  },
  checkingBadge: {
    position: "absolute", top: 10, right: 10,
    backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 16, padding: 6,
  },

  streakDots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  streakDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#e5e7eb" },
  streakDotActive: { backgroundColor: "#a8d832" },

  facePhaseDots: { flexDirection: "row", justifyContent: "center", gap: 8 },
  facePhaseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#e5e7eb" },
  facePhaseDotActive: { backgroundColor: "#1a4a52", width: 22 },

  retakeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  retakeText: { color: "#1a4a52", fontWeight: "700", fontSize: 13, textAlign: "center" },

  reviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  reviewThumbWrap: { width: "30%", gap: 4 },
  reviewThumb: { width: "100%", aspectRatio: 1, borderRadius: 10, backgroundColor: "#f3f4f6" },
  reviewThumbLabel: { fontSize: 11, color: "#6b7280", textAlign: "center" },
});
