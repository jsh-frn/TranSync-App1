import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Image, Platform, Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import API_BASE from "../../src/config/api";
import { getDraft, clearDraft } from "../../src/state/registrationDraft";
import { fetchProfileAutofill } from "../../src/utils/profileAutofill";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";
import DateField from "../../src/components/registration/DateField";
import LivePoseCapture, { type FacePhase } from "../../src/components/common/LivePoseCapture";

// Every capture in this wizard is camera-only — no gallery upload — per the
// source spec's anti-forgery intent for ID photos, applied consistently to
// the facial captures too.

type IdType = "k12" | "college";
type StepKey =
  | "details" | "id_front" | "id_back" | "id_check" | "enrollment"
  | "face_capture" | "review";

// The three facial captures are one continuous camera session (a single
// CameraView, never unmounted between poses). The live pose-turn detection
// itself (poll roughly once a second against real AWS Rekognition, auto-
// accept once 2 consecutive polls confirm the pose) lives entirely in the
// shared LivePoseCapture component — see that file's own comment for why a
// true on-device tracker was tried first and abandoned after hitting a
// reproducible native crash in react-native-vision-camera's own minimal
// example. The actual pass/fail check still happens server-side afterward,
// unchanged, via checkPoseChallenge() against the three captured stills.
// "idle" is the resting state on arrival at this step (and on any retry
// back into it) — capture only starts once the commuter taps "Start
// Capture", so they get a moment to get in position instead of the camera
// firing the instant this step becomes visible.

// Steps depend on whether an Enrollment Form/COE turns out to be needed —
// decided automatically by check_student_id_ocr.php right after ID capture
// (the "id_check" step), not by asking the commuter. A pure function (not a
// component-scoped useMemo) so the id_check result handler can compute the
// post-check step list directly, without depending on a possibly-stale
// closure over the component's own `steps` variable from before the state
// update landed.
function buildSteps(needsEnrollmentForm: boolean | null): StepKey[] {
  const s: StepKey[] = ["details", "id_front", "id_back", "id_check"];
  if (needsEnrollmentForm) s.push("enrollment");
  s.push("face_capture", "review");
  return s;
}

function appendPhotoToFormData(fd: FormData, key: string, uri: string | null) {
  if (!uri) return;
  fd.append(key, { uri, name: `${key}.jpg`, type: "image/jpeg" } as any);
}

export default function StudentVerification() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  // Two entry points share this one wizard: fresh registration (draft held
  // in registrationDraft.ts, this screen creates the account on submit) and
  // ?mode=renew, which covers TWO logged-in-commuter cases sharing the same
  // backend gate (commuter_renew_student.php accepts category IN ('student',
  // 'default')): renewing an already-existing Student account whose
  // verification lapsed (reached from home.tsx's expired banner), or a
  // Default commuter applying for the Student discount for the first time
  // (reached from Settings' "Discount Eligibility" section, Core Flow 2b).
  // isFirstTimeApply distinguishes the two only for copy/navigation below —
  // the request payload and endpoint are identical either way. Read directly
  // from AsyncStorage rather than UserContext, since this route lives under
  // (auth), outside (main)'s UserProvider.
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isRenew = mode === "renew";

  const draft = useMemo(() => (isRenew ? null : getDraft()), [isRenew]);
  const [renewCommuterId, setRenewCommuterId] = useState<number | null>(null);
  const [isFirstTimeApply, setIsFirstTimeApply] = useState(false);

  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError]         = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Details form — pre-filled from the registration draft's own
  // first/middle/last name (collected once on commuter-register.tsx),
  // still fully editable here since a physical ID can format a name
  // slightly differently from how the commuter typed it at registration.
  // A renewal has no draft (isRenew above), so these start blank as before.
  const [lastName, setLastName]     = useState(draft?.last_name ?? "");
  const [firstName, setFirstName]   = useState(draft?.first_name ?? "");
  const [middleName, setMiddleName] = useState(draft?.middle_name ?? "");
  const [schoolName, setSchoolName] = useState("");
  // Academic Year is auto-detected from the server clock, not typed — see
  // fetchAcademicPeriod() below. Read-only in the UI.
  const [academicYear, setAcademicYear] = useState("");
  const [academicYearLoading, setAcademicYearLoading] = useState(false);
  const [academicYearError, setAcademicYearError]     = useState(false);
  const [studentIdNumber, setStudentIdNumber] = useState("");
  // Only collected in apply/renew mode — registration already has the
  // commuter's date_of_birth in its draft.
  const [birthdate, setBirthdate] = useState(""); // YYYY-MM-DD

  // Logged-in apply/renew: pre-fill name + birthday from the account instead of
  // making the commuter retype them. Only fills fields still empty, so it never
  // overwrites something already typed while the request was in flight.
  useEffect(() => {
    if (!renewCommuterId) return;
    fetchProfileAutofill(renewCommuterId).then((a) => {
      if (!a) return;
      setLastName((v) => v || a.lastName);
      setFirstName((v) => v || a.firstName);
      setMiddleName((v) => v || a.middleName);
      setBirthdate((v) => v || a.birthdate);
    });
  }, [renewCommuterId]);
  const [idType, setIdType] = useState<IdType | null>(null);
  // Semester (College) is no longer captured here at all — it's derived
  // purely from the server clock at submission time (see
  // config/academic_validation.php), same as the backend already does for
  // computing the current period; the wizard has nothing to ask or send.

  // Decided automatically by check_student_id_ocr.php, not asked — see the
  // "id_check" step below. null = not yet checked.
  const [needsEnrollmentForm, setNeedsEnrollmentForm] = useState<boolean | null>(null);

  // Captures
  const [idFrontUri, setIdFrontUri]         = useState<string | null>(null);
  const [idBackUri, setIdBackUri]           = useState<string | null>(null);
  const [enrollmentUri, setEnrollmentUri]   = useState<string | null>(null);
  const [selfieCenterUri, setSelfieCenterUri] = useState<string | null>(null);
  const [selfieLeftUri, setSelfieLeftUri]     = useState<string | null>(null);
  const [selfieRightUri, setSelfieRightUri]   = useState<string | null>(null);

  // Live facial-capture sequence state — see FacePhase note above.
  const [facePhase, setFacePhase] = useState<FacePhase>("idle");

  useEffect(() => {
    if (isRenew) {
      AsyncStorage.getItem("user").then((raw) => {
        const cached = raw ? JSON.parse(raw) : null;
        if (cached?.id) {
          setRenewCommuterId(cached.id);
          setIsFirstTimeApply((cached.raw_category ?? cached.category) === "default");
        } else {
          router.replace("/(auth)/login");
        }
      });
      return;
    }
    if (!draft) {
      // Wizard reached directly (e.g. deep link/back-nav after a reload) with
      // no base account fields staged — nothing to submit, send them back.
      router.replace("/(auth)/commuter-register");
    }
  }, []);

  const ready = isRenew ? !!renewCommuterId : !!draft;

  const steps = useMemo(() => buildSteps(needsEnrollmentForm), [needsEnrollmentForm]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  const goNext = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const goBack = () => {
    if (stepIndex === 0) { router.back(); return; }
    setStepIndex((i) => Math.max(i - 1, 0));
  };
  const goToStep = (key: StepKey) => {
    const idx = steps.indexOf(key);
    if (idx >= 0) setStepIndex(idx);
  };

  const stageToStep = (stage: string): StepKey | null => {
    switch (stage) {
      case "details": return "details";
      case "id_capture": return "id_front";
      case "enrollment_form": return "enrollment";
      case "ocr": return "id_front";
      case "liveness": return "face_capture";
      case "face_match": return "face_capture";
      default: return null;
    }
  };

  // Auto-fill Academic Year the moment an ID Level is picked — the single
  // source of truth for "what's the current academic period" lives
  // server-side (config/academic_validation.php) so this can never drift
  // from what the final submission actually accepts. Semester (College) is
  // no longer fetched here at all — the backend derives it independently
  // from its own clock at submission time.
  const fetchAcademicPeriod = async (type: IdType) => {
    setAcademicYearLoading(true);
    setAcademicYearError(false);
    try {
      const res = await fetch(`${API_BASE}/auth/current_academic_period.php?id_type=${type}`);
      const data = await res.json();
      if (data.success) {
        setAcademicYear(data.academic_year);
      } else {
        setAcademicYearError(true);
      }
    } catch {
      setAcademicYearError(true);
    } finally {
      setAcademicYearLoading(false);
    }
  };

  useEffect(() => {
    if (idType) fetchAcademicPeriod(idType);
  }, [idType]);

  const canContinueDetails =
    !!lastName && !!firstName && !!schoolName && !!academicYear && !!studentIdNumber && !!idType && (!isRenew || !!birthdate);

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
  // "face_capture" — including a retry after a face-mismatch popup sends
  // the commuter back here (see handleSubmit below). Capture itself only
  // starts once they tap "Start Capture" in the idle card (LivePoseCapture's
  // onStart) — it no longer fires automatically the instant this step
  // becomes visible, which gave no time to get in position first.
  useEffect(() => {
    if (step === "face_capture") setFacePhase("idle");
  }, [step]);

  // Fires automatically the moment the wizard lands on "id_check" (right
  // after ID front+back capture) — runs OCR against just those two photos
  // and decides whether an Enrollment Form/COE is needed, replacing the old
  // manual "Does your ID show a printed validity date?" question entirely.
  // Fails open (assumes sufficient, skips straight to facial capture) on
  // any network error or when the server itself couldn't run OCR — same
  // soft-skip philosophy as the rest of this pipeline: never block
  // registration on a check that couldn't run.
  useEffect(() => {
    if (step !== "id_check") return;
    (async () => {
      try {
        const fd = new FormData();
        fd.append("id_type", idType ?? "");
        fd.append("academic_year", academicYear);
        appendPhotoToFormData(fd, "id_front", idFrontUri);
        appendPhotoToFormData(fd, "id_back", idBackUri);
        const res = await fetch(`${API_BASE}/auth/check_student_id_ocr.php`, { method: "POST", body: fd });
        const data = await res.json();
        const needsForm = data.success ? !data.sufficient : false;
        setNeedsEnrollmentForm(needsForm);
        setStepIndex(buildSteps(needsForm).indexOf(needsForm ? "enrollment" : "face_capture"));
      } catch {
        setNeedsEnrollmentForm(false);
        setStepIndex(buildSteps(false).indexOf("face_capture"));
      }
    })();
  }, [step]);

  const handleSubmit = async () => {
    if (!ready) return;
    setError("");
    setSubmitting(true);
    try {
      const fd = new FormData();
      if (isRenew) {
        fd.append("commuter_id", String(renewCommuterId));
      } else {
        fd.append("email", draft!.email);
        fd.append("phone", draft!.phone);
        fd.append("password", draft!.password);
        fd.append("date_of_birth", draft!.date_of_birth);
        fd.append("terms_accepted", "1");
      }
      fd.append("last_name", lastName);
      fd.append("first_name", firstName);
      if (middleName) fd.append("middle_name", middleName);
      if (!isRenew && draft!.suffix) fd.append("suffix", draft!.suffix);
      fd.append("school_name", schoolName);
      fd.append("academic_year", academicYear);
      fd.append("student_id_number", studentIdNumber);
      fd.append("id_type", idType ?? "");
      if (isRenew) fd.append("birthdate", birthdate);

      appendPhotoToFormData(fd, "id_front", idFrontUri);
      appendPhotoToFormData(fd, "id_back", idBackUri);
      appendPhotoToFormData(fd, "enrollment_form", enrollmentUri);
      appendPhotoToFormData(fd, "selfie_center", selfieCenterUri);
      appendPhotoToFormData(fd, "selfie_left", selfieLeftUri);
      appendPhotoToFormData(fd, "selfie_right", selfieRightUri);

      const endpoint = isRenew ? "commuter_renew_student.php" : "commuter_register_student.php";
      const res = await fetch(`${API_BASE}/auth/${endpoint}`, { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.stage === "face_match") {
          // A face-match failure reaching here is always the hard-blocked
          // case (a confidently-low similarity — see
          // FACE_MATCH_HARD_REJECT_BELOW in config/rekognition.php); the
          // merely-inconclusive band lands as a "pending_review" success
          // response instead, handled further below, never here. Surfaced
          // as a popup rather than the usual inline banner, since "the
          // face doesn't belong to this ID" is a categorically different,
          // more alarming finding than a retake-and-try-again capture
          // issue — the backend's own message already includes the actual
          // similarity percentage.
          Alert.alert(
            "Face Doesn't Match",
            data.message || "Your selfie doesn't match the ID photo.",
            [{ text: "OK", onPress: () => goToStep("face_capture") }]
          );
          return;
        }
        setError(data.message || "Verification failed. Please try again.");
        const jumpTo = data.stage ? stageToStep(data.stage) : null;
        if (jumpTo === "enrollment") {
          // The final submission endpoint is the authoritative re-check —
          // it can decide an enrollment form is needed even if the earlier
          // id_check pre-check said otherwise. Compute the new step list
          // directly (buildSteps) rather than goToStep(), which would read
          // this render's still-stale `steps` closure (computed before the
          // needsEnrollmentForm update below lands) and might not contain
          // "enrollment" at all yet.
          setNeedsEnrollmentForm(true);
          setStepIndex(buildSteps(true).indexOf("enrollment"));
        } else if (jumpTo) {
          // For "face_capture": navigating back there changes `step`, which
          // the reset effect above picks up and returns to the idle "get
          // ready" state — no separate trigger needed here.
          goToStep(jumpTo);
        }
        return;
      }

      if (isRenew) {
        // This pipeline is unchanged — still a hard binary pass/fail (see
        // commuter_renew_student.php), no "outcome" field, no pending-review
        // path. Only fresh registration below now has a third possible
        // outcome. First-time application lands back on Profile with a
        // confirmation instead of home.tsx's renewal-specific banner param,
        // since that banner was purpose-built for the "your existing
        // verification lapsed and got renewed" trigger point, not this one.
        if (isFirstTimeApply) {
          Alert.alert("Verified!", data.message || "Your Student discount has been verified.", [
            { text: "OK", onPress: () => router.replace("/(main)/profile" as any) },
          ]);
        } else {
          router.replace({ pathname: "/(main)/home", params: { renewed: "1" } });
        }
      } else {
        // The account now exists either way (verified or pending_review) —
        // clear the draft regardless, then branch register-success's copy.
        clearDraft();
        if (data.outcome === "pending_review") {
          router.replace({ pathname: "/(auth)/register-success", params: { note: data.message } });
        } else {
          router.replace({ pathname: "/(auth)/register-success", params: { verified: "1" } });
        }
      }
    } catch {
      setError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) return null;

  return (
    <View style={styles.root}>
      <KeyboardAwareForm contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity style={styles.back} onPress={goBack}>
          <Ionicons name="chevron-back" size={16} color="#1a4a52" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.title}>{isFirstTimeApply ? "Apply for Student Discount" : "Student ID Verification"}</Text>
          <Text style={styles.subtitle}>Step {stepIndex + 1} of {steps.length}</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((stepIndex + 1) / steps.length) * 100}%` }]} />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="warning" size={14} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {step === "details" && (
          <DetailsStep
            {...{ lastName, setLastName, firstName, setFirstName, middleName, setMiddleName,
              schoolName, setSchoolName, academicYear, academicYearLoading, academicYearError,
              onRetryAcademicYear: () => idType && fetchAcademicPeriod(idType),
              studentIdNumber, setStudentIdNumber, idType, setIdType,
              showBirthdate: isRenew, birthdate, setBirthdate }}
          />
        )}

        {step === "id_front" && (
          <CaptureStep
            title="Capture your ID — Front"
            hint="Fit the whole front side of your Student ID inside the frame."
            facing="back"
            permission={permission} requestPermission={requestPermission}
            cameraRef={cameraRef}
            capturedUri={idFrontUri}
            onCapture={() => takePhoto(setIdFrontUri)}
            onRetake={() => setIdFrontUri(null)}
          />
        )}

        {step === "id_back" && (
          <CaptureStep
            title="Capture your ID — Back"
            hint="Fit the whole back side of your Student ID inside the frame."
            facing="back"
            permission={permission} requestPermission={requestPermission}
            cameraRef={cameraRef}
            capturedUri={idBackUri}
            onCapture={() => takePhoto(setIdBackUri)}
            onRetake={() => setIdBackUri(null)}
          />
        )}

        {step === "id_check" && (
          <View style={styles.card}>
            <ActivityIndicator color="#1a4a52" />
            <Text style={styles.cardTitle}>Checking your ID…</Text>
            <Text style={styles.cardHint}>
              We're reading your ID to confirm your academic year — if we can't find it, we'll ask for your Enrollment Form or Certificate of Enrollment next.
            </Text>
          </View>
        )}

        {step === "enrollment" && (
          <CaptureStep
            title="Capture your Enrollment Form"
            hint="We couldn't confirm your academic period on your ID, so we need this to verify you're currently enrolled."
            facing="back"
            permission={permission} requestPermission={requestPermission}
            cameraRef={cameraRef}
            capturedUri={enrollmentUri}
            onCapture={() => takePhoto(setEnrollmentUri)}
            onRetake={() => setEnrollmentUri(null)}
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
              {lastName}, {firstName} · {schoolName} · {academicYear} · ID# {studentIdNumber}
            </Text>
            <View style={styles.reviewGrid}>
              <ReviewThumb label="ID Front" uri={idFrontUri} />
              <ReviewThumb label="ID Back" uri={idBackUri} />
              {enrollmentUri && <ReviewThumb label="Enrollment" uri={enrollmentUri} />}
              <ReviewThumb label="Selfie" uri={selfieCenterUri} />
              <ReviewThumb label="Turn Left" uri={selfieLeftUri} />
              <ReviewThumb label="Turn Right" uri={selfieRightUri} />
            </View>
            <Text style={styles.reviewNote}>
              By submitting, your Student ID and face verification are checked automatically — if everything matches, {isFirstTimeApply ? "your Student discount is verified" : "your account is verified"} immediately, no admin wait.
            </Text>
          </View>
        )}

      </KeyboardAwareForm>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        {step === "details" && (
          <TouchableOpacity
            style={[styles.btnPrimary, !canContinueDetails && styles.btnDisabled]}
            disabled={!canContinueDetails}
            onPress={goNext}
          >
            <Text style={styles.btnPrimaryText}>Continue</Text>
          </TouchableOpacity>
        )}

        {(step === "id_front" || step === "id_back" || step === "enrollment") && (
          <TouchableOpacity
            style={[styles.btnPrimary, !captureFor(step, { idFrontUri, idBackUri, enrollmentUri }) && styles.btnDisabled]}
            disabled={!captureFor(step, { idFrontUri, idBackUri, enrollmentUri })}
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
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Submit for Verification</Text>}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function captureFor(step: StepKey, uris: Record<string, string | null>): string | null {
  const map: Partial<Record<StepKey, string | null>> = {
    id_front: uris.idFrontUri, id_back: uris.idBackUri, enrollment: uris.enrollmentUri,
  };
  return map[step] ?? null;
}

function DetailsStep(props: any) {
  const {
    lastName, setLastName, firstName, setFirstName, middleName, setMiddleName,
    schoolName, setSchoolName, academicYear, academicYearLoading, academicYearError, onRetryAcademicYear,
    studentIdNumber, setStudentIdNumber, idType, setIdType,
    showBirthdate, birthdate, setBirthdate,
  } = props;
  return (
    <View style={styles.card}>
      <TextField label="Last Name" value={lastName} onChangeText={setLastName} />
      <TextField label="First Name" value={firstName} onChangeText={setFirstName} />
      <TextField label="Middle Name (optional)" value={middleName} onChangeText={setMiddleName} />
      {showBirthdate && (
        <DateField label="Birthday" value={birthdate} onChange={setBirthdate} maximumDate={new Date()} defaultDate={new Date(2005, 0, 1)} required />
      )}
      <TextField label="School Name" value={schoolName} onChangeText={setSchoolName} />

      <Text style={styles.fieldLabel}>ID Level</Text>
      <View style={styles.yesNoRow}>
        <TouchableOpacity style={[styles.yesNoBtn, idType === "k12" && styles.yesNoBtnActive]} onPress={() => setIdType("k12")}>
          <Text style={[styles.yesNoText, idType === "k12" && styles.yesNoTextActive]}>K-12</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.yesNoBtn, idType === "college" && styles.yesNoBtnActive]} onPress={() => setIdType("college")}>
          <Text style={[styles.yesNoText, idType === "college" && styles.yesNoTextActive]}>College</Text>
        </TouchableOpacity>
      </View>

      {idType && (
        <View style={styles.fieldWrap}>
          <Text style={styles.fieldLabel}>Academic Year (auto-detected)</Text>
          <TouchableOpacity
            style={styles.readOnlyField}
            onPress={academicYearError ? onRetryAcademicYear : undefined}
            activeOpacity={academicYearError ? 0.7 : 1}
          >
            {academicYearLoading ? (
              <ActivityIndicator size="small" color="#1a4a52" />
            ) : academicYearError ? (
              <Text style={styles.readOnlyErrorText}>Couldn't load — tap to retry</Text>
            ) : (
              <Text style={styles.readOnlyText}>{academicYear || "—"}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <TextField label="Student ID Number" value={studentIdNumber} onChangeText={setStudentIdNumber} />
    </View>
  );
}

function TextField({ label, value, onChangeText }: { label: string; value: string; onChangeText: (v: string) => void }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholderTextColor="#9ca3af" />
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
  title, hint, facing, permission, requestPermission, cameraRef, capturedUri, onCapture, onRetake,
}: {
  title: string; hint: string; facing: "front" | "back";
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
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing={facing} />
      </View>
      <TouchableOpacity style={styles.shutterBtn} onPress={onCapture} activeOpacity={0.85}>
        <Ionicons name="camera" size={20} color="#fff" />
        <Text style={styles.shutterText}>Capture</Text>
      </TouchableOpacity>
    </View>
  );
}

// One continuous camera session for all three poses — the CameraView is
// mounted once for the whole "center → left → right" sequence and never
// torn down/rebuilt between poses, unlike the old three-separate-screens
// version. Review sub-phase shows the three results with Retake All /
// Looks Good handled by the parent's fixed footer (kept consistent with
// every other step in this wizard, rather than this component growing its
// own separate button row).
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f9fafb" },
  container: { flexGrow: 1, paddingHorizontal: 24 },
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
  readOnlyField: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#f9fafb",
    minHeight: 44, justifyContent: "center",
  },
  readOnlyText: { fontSize: 14, color: "#111827", fontWeight: "700" },
  readOnlyErrorText: { fontSize: 13, color: "#dc2626", fontWeight: "600" },

  yesNoRow: { flexDirection: "row", gap: 10 },
  yesNoBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  yesNoBtnActive: { borderColor: "#1a4a52", backgroundColor: "#f0faf4" },
  yesNoText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
  yesNoTextActive: { color: "#1a4a52" },

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
});
