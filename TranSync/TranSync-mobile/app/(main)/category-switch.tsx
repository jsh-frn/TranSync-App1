import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Image, Alert, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import { useUser } from "../../src/context/UserContext";
import { fetchProfileAutofill } from "../../src/utils/profileAutofill";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";
import LivePoseCapture, { type FacePhase } from "../../src/components/common/LivePoseCapture";

// Reached only from profile.tsx's "Change Discount Type" action, itself
// only ever shown once the commuter's CURRENT discount category has
// expired (see get_profile.php's can_switch_category). Lives under (main),
// not (auth) like student-verification.tsx, since this flow only ever runs
// for an already-logged-in commuter — reads the account id straight from
// UserContext instead of manually re-reading AsyncStorage.
//
// Structurally mirrors student-verification.tsx's wizard shape (same
// camera-only capture convention, same live-poll facial liveness capture
// via the shared LivePoseCapture component), but simpler: no id_check/
// enrollment steps (those are Student-only concepts — there's no
// auto-detected "second document needed" step here), and a genuinely
// different result model — commuter_switch_category.php can return THREE
// outcomes (verified / pending_review / rejected) instead of Student's two
// (verified / rejected), so submission handling branches three ways below.

type Target = "disabled" | "elderly";
type StepKey = "details" | "id_front" | "id_back" | "face_capture" | "review";
const STEPS: StepKey[] = ["details", "id_front", "id_back", "face_capture", "review"];

const TARGET_LABEL: Record<Target, string> = { disabled: "PWD", elderly: "Senior Citizen" };
const TARGET_ID_LABEL: Record<Target, string> = { disabled: "PWD ID Number", elderly: "Senior Citizen ID Number" };

function appendPhotoToFormData(fd: FormData, key: string, uri: string | null) {
  if (!uri) return;
  fd.append(key, { uri, name: `${key}.jpg`, type: "image/jpeg" } as any);
}

// Extracts a local Y-M-D string from the Date object's own local getters —
// deliberately NOT toISOString().slice(0,10), which converts through UTC
// first and silently lands on the previous calendar day in any timezone
// ahead of UTC (this app's own target timezone, Philippines, is UTC+8). See
// (operator)/trips.tsx's identical helper and Do Not Break rule #60.
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatDisplayDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}
const TODAY_DATE = new Date();
// A blank Birthdate picker defaults to today, which would make the commuter
// scroll back 60+ years on the native spinner — start it somewhere already
// plausible for this discount's own eligibility floor instead.
const SIXTY_FIVE_YEARS_AGO = new Date(TODAY_DATE.getFullYear() - 65, TODAY_DATE.getMonth(), TODAY_DATE.getDate());
// Without an explicit minimumDate, Android's native date picker defaults its
// scrollable floor to the Unix epoch (Jan 1, 1970) and can't be scrolled
// past it — a real bug that blocked registering anyone born before 1970.
const MIN_BIRTHDATE = new Date(TODAY_DATE.getFullYear() - 120, TODAY_DATE.getMonth(), TODAY_DATE.getDate());

export default function CategorySwitch() {
  const router = useRouter();
  const { user, refreshUser } = useUser();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const { target: targetParam } = useLocalSearchParams<{ target?: string }>();
  const target: Target = targetParam === "elderly" ? "elderly" : "disabled";

  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Set once a submission actually lands as "pending_review" — a distinct,
  // non-error confirmation state (see the review step's render below), not
  // part of the normal step flow since there's nothing further to do.
  const [pendingReviewMsg, setPendingReviewMsg] = useState<string | null>(null);

  const [lastName, setLastName]     = useState("");
  const [firstName, setFirstName]   = useState("");
  const [middleName, setMiddleName] = useState("");
  const [idNumber, setIdNumber]     = useState("");
  const [birthdate, setBirthdate]   = useState(""); // Senior Citizen only, YYYY-MM-DD
  const [issuingLgu, setIssuingLgu] = useState(""); // Senior Citizen + PWD
  const [dateIssued, setDateIssued] = useState(""); // Senior Citizen only, YYYY-MM-DD
  const [validityDate, setValidityDate] = useState(""); // PWD only, YYYY-MM-DD

  // Pre-fill name (and, for Senior Citizen, birthday) from the account instead
  // of making the commuter retype them. Only fills fields still empty, so it
  // never overwrites something already typed while the request was in flight.
  // The birthday is Senior-only here — the PWD flow doesn't collect one.
  useEffect(() => {
    if (!user?.id) return;
    fetchProfileAutofill(user.id).then((a) => {
      if (!a) return;
      setLastName((v) => v || a.lastName);
      setFirstName((v) => v || a.firstName);
      setMiddleName((v) => v || a.middleName);
      if (target === "elderly") setBirthdate((v) => v || a.birthdate);
    });
  }, [user?.id, target]);

  const [idFrontUri, setIdFrontUri]           = useState<string | null>(null);
  const [idBackUri, setIdBackUri]             = useState<string | null>(null);
  const [selfieCenterUri, setSelfieCenterUri] = useState<string | null>(null);
  const [selfieLeftUri, setSelfieLeftUri]     = useState<string | null>(null);
  const [selfieRightUri, setSelfieRightUri]   = useState<string | null>(null);

  const [facePhase, setFacePhase] = useState<FacePhase>("idle");

  const step = STEPS[Math.min(stepIndex, STEPS.length - 1)];

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => {
    if (stepIndex === 0) { router.back(); return; }
    setStepIndex((i) => Math.max(i - 1, 0));
  };
  const goToStep = (key: StepKey) => {
    const idx = STEPS.indexOf(key);
    if (idx >= 0) setStepIndex(idx);
  };

  const stageToStep = (stage: string): StepKey | null => {
    switch (stage) {
      case "account":  return "details";
      case "details":  return "details";
      case "id_capture": return "id_front";
      case "ocr":      return "id_front";
      case "liveness": return "face_capture";
      case "face_match": return "face_capture";
      default: return null;
    }
  };

  const canContinueDetails =
    !!lastName && !!firstName && !!idNumber &&
    (target !== "elderly" || (!!birthdate && !!issuingLgu.trim() && !!dateIssued)) &&
    (target !== "disabled" || (!!issuingLgu.trim() && !!validityDate));

  const takePhoto = async (onCaptured: (uri: string) => void) => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) onCaptured(photo.uri);
    } catch {
      setError("Couldn't capture photo. Please try again.");
    }
  };

  const startFaceCapture = () => {
    setError("");
    setSelfieCenterUri(null);
    setSelfieLeftUri(null);
    setSelfieRightUri(null);
    setFacePhase("center");
  };

  const handlePoseCaptured = (pose: "center" | "left" | "right", uri: string) => {
    if (pose === "center") { setSelfieCenterUri(uri); setFacePhase("left"); }
    else if (pose === "left") { setSelfieLeftUri(uri); setFacePhase("right"); }
    else { setSelfieRightUri(uri); setFacePhase("review"); }
  };

  // Resets to the "get ready" idle state every time the wizard lands on
  // "face_capture" — including a retry after a face-mismatch popup. The
  // capture sequence itself only starts once the commuter taps "Start
  // Capture" (LivePoseCapture's onStart), not automatically on arrival.
  useEffect(() => {
    if (step === "face_capture") setFacePhase("idle");
  }, [step]);

  const handleSubmit = async () => {
    if (!user?.id) return;
    setError("");
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("commuter_id", String(user.id));
      fd.append("target_category", target);
      fd.append("last_name", lastName);
      fd.append("first_name", firstName);
      if (middleName) fd.append("middle_name", middleName);
      fd.append("id_number", idNumber);
      if (target === "elderly") {
        fd.append("birthdate", birthdate);
        fd.append("issuing_lgu", issuingLgu);
        fd.append("date_issued", dateIssued);
      }
      if (target === "disabled") {
        fd.append("issuing_lgu", issuingLgu);
        fd.append("validity_date", validityDate);
      }

      appendPhotoToFormData(fd, "id_front", idFrontUri);
      appendPhotoToFormData(fd, "id_back", idBackUri);
      appendPhotoToFormData(fd, "selfie_center", selfieCenterUri);
      appendPhotoToFormData(fd, "selfie_left", selfieLeftUri);
      appendPhotoToFormData(fd, "selfie_right", selfieRightUri);

      const res = await fetch(`${API_BASE}/auth/commuter_switch_category.php`, { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.stage === "face_match") {
          // Always the hard-blocked case here (a confidently-low
          // similarity — see FACE_MATCH_HARD_REJECT_BELOW) — the merely
          // inconclusive band lands as a "pending_review" success instead
          // (handled below), never here. The backend's message already
          // includes the actual similarity percentage.
          Alert.alert(
            "Face Doesn't Match",
            data.message || "Your selfie doesn't match the ID photo.",
            [{ text: "OK", onPress: () => goToStep("face_capture") }]
          );
          return;
        }
        setError(data.message || "Verification failed. Please try again.");
        const jumpTo = data.stage ? stageToStep(data.stage) : null;
        if (jumpTo) goToStep(jumpTo);
        return;
      }

      await refreshUser();
      if (data.outcome === "pending_review") {
        // Not an error — a third, genuinely different outcome from
        // Student's binary pass/fail: the automated checks were
        // inconclusive, so this now sits in the admin's existing
        // VerifyUsers pending queue. Shown as its own confirmation state
        // rather than navigating straight back, since "submitted for
        // review" reads very differently from "verified."
        setPendingReviewMsg(data.message || "Your submission has been sent to an admin for manual review.");
      } else {
        router.replace("/(main)/profile");
      }
    } catch {
      setError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!user?.id) return null;

  if (pendingReviewMsg) {
    return (
      <View style={styles.root}>
        <View style={styles.pendingWrap}>
          <Ionicons name="time" size={48} color="#b45309" />
          <Text style={styles.pendingTitle}>Submitted for Review</Text>
          <Text style={styles.pendingText}>{pendingReviewMsg}</Text>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => router.replace("/(main)/profile")}>
            <Text style={styles.btnPrimaryText}>Back to Profile</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeyboardAwareForm contentContainerStyle={styles.container}>
        <TouchableOpacity style={styles.back} onPress={goBack}>
          <Ionicons name="chevron-back" size={16} color="#1a4a52" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.title}>Switch to {TARGET_LABEL[target]}</Text>
          <Text style={styles.subtitle}>Step {stepIndex + 1} of {STEPS.length}</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((stepIndex + 1) / STEPS.length) * 100}%` }]} />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="warning" size={14} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {step === "details" && (
          <View style={styles.card}>
            <TextField label="Last Name" value={lastName} onChangeText={setLastName} />
            <TextField label="First Name" value={firstName} onChangeText={setFirstName} />
            <TextField label="Middle Name (optional)" value={middleName} onChangeText={setMiddleName} />
            <TextField label={TARGET_ID_LABEL[target]} value={idNumber} onChangeText={setIdNumber} />
            {target === "elderly" && (
              <>
                <TextField label="Issuing LGU" value={issuingLgu} onChangeText={setIssuingLgu} placeholder="e.g. City of San Fernando" />
                <DateField label="Date Issued" value={dateIssued} onChange={setDateIssued} maximumDate={TODAY_DATE} />
                <DateField label="Birthdate" value={birthdate} onChange={setBirthdate} maximumDate={TODAY_DATE} minimumDate={MIN_BIRTHDATE} defaultDate={SIXTY_FIVE_YEARS_AGO} />
              </>
            )}
            {target === "disabled" && (
              <>
                <TextField label="Issuing LGU" value={issuingLgu} onChangeText={setIssuingLgu} placeholder="e.g. City of San Fernando" />
                <DateField label="Validity Date" value={validityDate} onChange={setValidityDate} />
              </>
            )}
          </View>
        )}

        {step === "id_front" && (
          <CaptureStep
            title={`Capture your ${TARGET_LABEL[target]} ID — Front`}
            hint="Fit the whole front side of your ID inside the frame."
            permission={permission} requestPermission={requestPermission}
            cameraRef={cameraRef}
            capturedUri={idFrontUri}
            onCapture={() => takePhoto(setIdFrontUri)}
            onRetake={() => setIdFrontUri(null)}
          />
        )}

        {step === "id_back" && (
          <CaptureStep
            title={`Capture your ${TARGET_LABEL[target]} ID — Back`}
            hint="Fit the whole back side of your ID inside the frame."
            permission={permission} requestPermission={requestPermission}
            cameraRef={cameraRef}
            capturedUri={idBackUri}
            onCapture={() => takePhoto(setIdBackUri)}
            onRetake={() => setIdBackUri(null)}
          />
        )}

        {step === "face_capture" && (
          <LivePoseCapture
            permission={permission}
            requestPermission={requestPermission}
            cameraRef={cameraRef}
            phase={facePhase}
            selfieCenterUri={selfieCenterUri}
            selfieLeftUri={selfieLeftUri}
            selfieRightUri={selfieRightUri}
            onStart={startFaceCapture}
            onCaptured={handlePoseCaptured}
          />
        )}

        {step === "review" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Review &amp; Submit</Text>
            <Text style={styles.cardHint}>
              {lastName}, {firstName} · {TARGET_LABEL[target]} ID# {idNumber}
              {target === "elderly" ? ` · ${formatDisplayDate(birthdate)}` : ""}
            </Text>
            {target === "elderly" && (
              <Text style={styles.cardHint}>Issued by {issuingLgu} on {formatDisplayDate(dateIssued)}</Text>
            )}
            {target === "disabled" && (
              <Text style={styles.cardHint}>Issued by {issuingLgu} · Valid until {formatDisplayDate(validityDate)}</Text>
            )}
            <View style={styles.reviewGrid}>
              <ReviewThumb label="ID Front" uri={idFrontUri} />
              <ReviewThumb label="ID Back" uri={idBackUri} />
              <ReviewThumb label="Selfie" uri={selfieCenterUri} />
              <ReviewThumb label="Turn Left" uri={selfieLeftUri} />
              <ReviewThumb label="Turn Right" uri={selfieRightUri} />
            </View>
            <Text style={styles.reviewNote}>
              We'll check your ID and selfie automatically. If everything matches, you're switched immediately — if we can't confirm something, an admin will review it and you'll be notified.
            </Text>
          </View>
        )}
      </KeyboardAwareForm>

      <View style={styles.footer}>
        {step === "details" && (
          <TouchableOpacity
            style={[styles.btnPrimary, !canContinueDetails && styles.btnDisabled]}
            disabled={!canContinueDetails}
            onPress={goNext}
          >
            <Text style={styles.btnPrimaryText}>Continue</Text>
          </TouchableOpacity>
        )}

        {(step === "id_front" || step === "id_back") && (
          <TouchableOpacity
            style={[styles.btnPrimary, !(step === "id_front" ? idFrontUri : idBackUri) && styles.btnDisabled]}
            disabled={!(step === "id_front" ? idFrontUri : idBackUri)}
            onPress={goNext}
          >
            <Text style={styles.btnPrimaryText}>Continue</Text>
          </TouchableOpacity>
        )}

        {step === "face_capture" && facePhase === "review" && (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity style={[styles.btnPrimary, styles.btnSecondary, { flex: 1 }]} onPress={startFaceCapture}>
              <Text style={[styles.btnPrimaryText, styles.btnSecondaryText]}>Retake All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, { flex: 1 }, !(selfieCenterUri && selfieLeftUri && selfieRightUri) && styles.btnDisabled]}
              disabled={!(selfieCenterUri && selfieLeftUri && selfieRightUri)}
              onPress={goNext}
            >
              <Text style={styles.btnPrimaryText}>Looks Good</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === "review" && (
          <TouchableOpacity style={[styles.btnPrimary, submitting && styles.btnDisabled]} disabled={submitting} onPress={handleSubmit}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Submit</Text>}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function TextField({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#9ca3af" />
    </View>
  );
}

// Native date picker (@react-native-community/datetimepicker) — Android
// shows its own modal dialog and auto-dismisses on pick; iOS renders an
// inline spinner that stays open until "Done" is tapped, so only iOS needs
// the extra dismiss control.
function DateField({
  label, value, onChange, maximumDate, minimumDate, defaultDate,
}: {
  label: string; value: string; onChange: (v: string) => void;
  maximumDate?: Date; minimumDate?: Date; defaultDate?: Date;
}) {
  const [show, setShow] = useState(false);
  const pickerValue = value ? new Date(`${value}T00:00:00`) : (defaultDate ?? maximumDate ?? new Date());

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShow(false);
    if (event.type === "dismissed") return;
    if (selected) onChange(formatLocalDate(selected));
  };

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity style={styles.input} onPress={() => setShow(true)} activeOpacity={0.7}>
        <Text style={{ fontSize: 14, color: value ? "#111827" : "#9ca3af" }}>
          {value ? formatDisplayDate(value) : "Select date"}
        </Text>
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={pickerValue}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          maximumDate={maximumDate}
          minimumDate={minimumDate}
          onChange={handleChange}
        />
      )}
      {Platform.OS === "ios" && show && (
        <TouchableOpacity style={styles.dateDoneBtn} onPress={() => setShow(false)}>
          <Text style={styles.dateDoneText}>Done</Text>
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

function CaptureStep({
  title, hint, permission, requestPermission, cameraRef, capturedUri, onCapture, onRetake,
}: {
  title: string; hint: string;
  permission: any; requestPermission: () => void; cameraRef: React.RefObject<CameraView | null>;
  capturedUri: string | null; onCapture: () => void; onRetake: () => void;
}) {
  if (capturedUri) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Image source={{ uri: capturedUri }} style={styles.capturePreview} resizeMode="cover" />
        <TouchableOpacity style={styles.retakeBtn} onPress={onRetake}>
          <Ionicons name="refresh" size={14} color="#1a4a52" />
          <Text style={styles.retakeText}>Retake</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!permission) {
    return <View style={styles.card}><ActivityIndicator color="#1a4a52" /></View>;
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

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardHint}>{hint}</Text>
      <View style={styles.cameraWrap}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back" />
      </View>
      <TouchableOpacity style={styles.shutterBtn} onPress={onCapture} activeOpacity={0.85}>
        <Ionicons name="camera" size={20} color="#fff" />
        <Text style={styles.shutterText}>Capture</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f9fafb" },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 64, paddingBottom: 24 },
  back: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 20 },
  backText: { fontSize: 14, color: "#1a4a52", fontWeight: "700" },
  header: { marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#6b7280" },

  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "#e5e7eb", marginBottom: 20, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: "#a8d832" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16,
  },
  errorText: { flex: 1, color: "#dc2626", fontSize: 13 },

  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1.5, borderColor: "#e5e7eb", padding: 18, gap: 14 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#1a4a52" },
  cardHint: { fontSize: 13, color: "#6b7280", lineHeight: 19 },

  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151" },
  input: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: "#111827", backgroundColor: "#fff",
  },
  dateDoneBtn: { alignSelf: "flex-end", paddingVertical: 6, paddingHorizontal: 4 },
  dateDoneText: { color: "#1a4a52", fontWeight: "700", fontSize: 13 },

  cameraWrap: { width: "100%", height: 260, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  shutterBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#1a4a52", borderRadius: 12, paddingVertical: 14,
  },
  shutterText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  capturePreview: { width: "100%", height: 220, borderRadius: 12 },
  retakeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  retakeText: { color: "#1a4a52", fontWeight: "700", fontSize: 13 },

  reviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  reviewThumbWrap: { width: "30%", gap: 4 },
  reviewThumb: { width: "100%", aspectRatio: 1, borderRadius: 10, backgroundColor: "#f3f4f6" },
  reviewThumbLabel: { fontSize: 11, color: "#6b7280", textAlign: "center" },
  reviewNote: { fontSize: 12, color: "#92400e", backgroundColor: "#fffbeb", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#fde68a" },

  footer: { padding: 20, borderTopWidth: 1, borderTopColor: "#e5e7eb", backgroundColor: "#fff" },
  btnPrimary: { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  btnSecondary: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#1a4a52" },
  btnSecondaryText: { color: "#1a4a52" },
  btnDisabled: { opacity: 0.5 },
  btnPrimaryText: { fontSize: 15, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },

  pendingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 14 },
  pendingTitle: { fontSize: 20, fontWeight: "900", color: "#1a4a52" },
  pendingText: { fontSize: 14, color: "#6b7280", textAlign: "center", lineHeight: 20, marginBottom: 10 },
});
