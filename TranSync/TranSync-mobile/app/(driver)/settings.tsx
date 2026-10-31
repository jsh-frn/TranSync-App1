import { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, Alert, Switch, ActivityIndicator, TextInput,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE from "../../src/config/api";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";
import MaskedPhoneField from "../../src/components/common/MaskedPhoneField";
import { PolicySheet, TcSection } from "../../src/components/registration/TermsGate";
import { DRIVER_TERMS, PRIVACY_POLICY } from "../../src/constants/registrationTerms";
import {
  getDrvNotifyTripAssignment, setDrvNotifyTripAssignment,
  getDrvNotifyScheduleChanges, setDrvNotifyScheduleChanges,
  getDrvNotifyVehicleAssignment, setDrvNotifyVehicleAssignment,
  getDrvNotifyAssocAnnouncements, setDrvNotifyAssocAnnouncements,
  getDrvNotifyQrBoarding, setDrvNotifyQrBoarding,
  getDrvNotifySystemAnnouncements, setDrvNotifySystemAnnouncements,
} from "../../src/state/settingsPrefs";

// Pushed from the driver dashboard's Settings tab → "Account Settings".
// Four sections — no account-closure action anywhere (a driver is
// connected to associations/operators/vehicles/trips/bookings/earnings/
// transactions; no self-service closure endpoint exists in this app, and
// none is invented here). Vehicle assignment stays fully read-only
// everywhere in this screen — it's shown on the Settings tab, never
// editable here, and continues to be controlled entirely by the operator.

type Drv = { id: number; name: string; email: string; phone: string };

export default function DriverSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [drv, setDrv] = useState<Drv | null>(null);

  // Edit Account Info modal
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  // Set only once a new number has actually been OTP-verified via
  // MaskedPhoneField — null means "not changing the phone number."
  const [pendingNewPhone, setPendingNewPhone] = useState<string | null>(null);
  const [infoPassword, setInfoPassword] = useState("");
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoError, setInfoError]   = useState("");

  // Change Password modal
  const [pwModalVisible, setPwModalVisible] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  // Alternative to Current Password — verify ownership via an OTP sent to
  // this driver's own on-file phone number instead. Sent with
  // purpose="self_verify" (not "password_reset") since a driver's own
  // phone is intentionally excluded from the password_reset lookup scope
  // (see config/account_lookup.php) — this context already knows exactly
  // which driver this is (via get_profile.php), so no lookup is needed.
  const [pwViaOtp, setPwViaOtp] = useState(false);
  const [pwOtpSent, setPwOtpSent] = useState(false);
  const [pwOtpVerified, setPwOtpVerified] = useState(false);
  const [pwOtp, setPwOtp] = useState("");
  const [pwOtpSending, setPwOtpSending] = useState(false);
  const [pwOtpVerifying, setPwOtpVerifying] = useState(false);
  const [pwOtpCooldown, setPwOtpCooldown] = useState(0);

  useEffect(() => {
    if (pwOtpCooldown <= 0) return;
    const t = setInterval(() => setPwOtpCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [pwOtpCooldown]);

  // Notifications — inert local preferences (no activity-log surface
  // exists yet for any of these on the driver side either).
  const [notifTripAssignment, setNotifTripAssignmentState]     = useState(true);
  const [notifScheduleChanges, setNotifScheduleChangesState]   = useState(true);
  const [notifVehicleAssignment, setNotifVehicleAssignmentState] = useState(true);
  const [notifAssocAnnouncements, setNotifAssocAnnouncementsState] = useState(true);
  const [notifQrBoarding, setNotifQrBoardingState]             = useState(true);
  const [notifSystemAnnouncements, setNotifSystemAnnouncementsState] = useState(true);

  // Terms & Policies viewers
  const [showTerms, setShowTerms]     = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const loadDrv = useCallback(async () => {
    const raw = await AsyncStorage.getItem("user");
    const current: Drv | null = raw ? JSON.parse(raw) : null;
    if (current) setDrv(current);
    if (!current?.id) return;
    try {
      const res  = await fetch(`${API_BASE}/drivers/get_profile.php?driver_id=${current.id}`);
      const data = await res.json();
      if (data?.success && data.driver) {
        const merged = { ...current, ...data.driver };
        await AsyncStorage.setItem("user", JSON.stringify(merged));
        setDrv(merged);
      }
    } catch {
      // Cached value stays shown.
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadDrv();
    getDrvNotifyTripAssignment().then(setNotifTripAssignmentState);
    getDrvNotifyScheduleChanges().then(setNotifScheduleChangesState);
    getDrvNotifyVehicleAssignment().then(setNotifVehicleAssignmentState);
    getDrvNotifyAssocAnnouncements().then(setNotifAssocAnnouncementsState);
    getDrvNotifyQrBoarding().then(setNotifQrBoardingState);
    getDrvNotifySystemAnnouncements().then(setNotifSystemAnnouncementsState);
  }, [loadDrv]));

  const openInfoModal = () => {
    setName(drv?.name ?? "");
    setEmail(drv?.email ?? "");
    setPendingNewPhone(null);
    setInfoPassword("");
    setInfoError("");
    setInfoModalVisible(true);
  };

  const handleSaveInfo = async () => {
    setInfoError("");
    if (!infoPassword) {
      setInfoError("Enter your password to confirm this change.");
      return;
    }
    const nameChanged  = name.trim() && name.trim() !== drv?.name;
    const emailChanged = email.trim() && email.trim() !== drv?.email;
    const phoneChanged = pendingNewPhone !== null;
    if (!nameChanged && !emailChanged && !phoneChanged) {
      setInfoError("Change your name, email, or phone before saving.");
      return;
    }
    setInfoSaving(true);
    try {
      const res = await fetch(`${API_BASE}/drivers/update_profile.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driver_id: drv!.id,
          password: infoPassword,
          ...(nameChanged ? { name: name.trim() } : {}),
          ...(emailChanged ? { email: email.trim() } : {}),
          ...(phoneChanged ? { phone: pendingNewPhone } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setInfoError(data.message || "Couldn't update account information.");
        return;
      }
      await loadDrv();
      setInfoModalVisible(false);
      Alert.alert("Updated", "Your account information has been updated.");
    } catch {
      setInfoError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setInfoSaving(false);
    }
  };

  const handleSendPwOtp = async () => {
    setPwError("");
    setPwOtpSending(true);
    try {
      const res = await fetch(`${API_BASE}/auth/send_phone_otp.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: (drv?.phone ?? "").replace(/\D/g, ""), purpose: "self_verify" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwError(data.message || "Failed to send verification code.");
      } else {
        setPwOtp("");
        setPwOtpSent(true);
        setPwOtpCooldown(60);
      }
    } catch {
      setPwError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setPwOtpSending(false);
    }
  };

  const handleVerifyPwOtp = async () => {
    setPwError("");
    if (pwOtp.length !== 6) { setPwError("Enter the 6-digit code sent to your phone."); return; }
    setPwOtpVerifying(true);
    try {
      const res = await fetch(`${API_BASE}/auth/verify_phone_otp.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: (drv?.phone ?? "").replace(/\D/g, ""), otp: pwOtp }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPwError(data.message || "Incorrect or expired code.");
      } else {
        setPwOtpVerified(true);
      }
    } catch {
      setPwError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setPwOtpVerifying(false);
    }
  };

  const handleChangePassword = async () => {
    setPwError("");
    if (!newPw || !confirmPw || (!pwViaOtp && !currentPw)) {
      setPwError("All fields are required.");
      return;
    }
    if (pwViaOtp && !pwOtpVerified) {
      setPwError("Please verify your phone number first.");
      return;
    }
    if (newPw.length < 6) {
      setPwError("New password must be at least 6 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("New password and confirmation don't match.");
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch(`${API_BASE}/drivers/change_password.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driver_id: drv!.id,
          new_password: newPw,
          ...(pwViaOtp ? { via_otp: true } : { current_password: currentPw }),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setPwError(data.message || "Couldn't change password.");
        return;
      }
      setPwModalVisible(false);
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setPwViaOtp(false); setPwOtpSent(false); setPwOtpVerified(false); setPwOtp("");
      Alert.alert("Password Changed", "Your password has been updated.");
    } catch {
      setPwError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setPwSaving(false);
    }
  };

  if (!drv) return null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1a4a52" />
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {/* ── 1. ACCOUNT INFORMATION ── */}
        <Text style={s.sectionLabel}>Account Information</Text>
        <View style={s.card}>
          <MenuRow icon="person-outline" label="Edit Account Info" onPress={openInfoModal} />
          <View style={[s.staticRow, s.infoBorder]}>
            <Text style={s.staticLabel}>Driver ID</Text>
            <Text style={s.staticValue}>#{drv.id}</Text>
          </View>
        </View>

        {/* ── 2. NOTIFICATIONS ── */}
        <Text style={s.sectionLabel}>Notifications</Text>
        <View style={s.card}>
          <SwitchRow label="Trip Assignment" value={notifTripAssignment}
            onValueChange={(v) => { setNotifTripAssignmentState(v); setDrvNotifyTripAssignment(v); }} />
          <SwitchRow label="Schedule Changes" value={notifScheduleChanges}
            onValueChange={(v) => { setNotifScheduleChangesState(v); setDrvNotifyScheduleChanges(v); }} />
          <SwitchRow label="Vehicle Assignment Changes" value={notifVehicleAssignment}
            onValueChange={(v) => { setNotifVehicleAssignmentState(v); setDrvNotifyVehicleAssignment(v); }} />
          <SwitchRow label="Association Announcements" value={notifAssocAnnouncements}
            onValueChange={(v) => { setNotifAssocAnnouncementsState(v); setDrvNotifyAssocAnnouncements(v); }} />
          <SwitchRow label="QR / Boarding-Related" value={notifQrBoarding}
            onValueChange={(v) => { setNotifQrBoardingState(v); setDrvNotifyQrBoarding(v); }} />
          <SwitchRow label="Important System Notifications" value={notifSystemAnnouncements}
            onValueChange={(v) => { setNotifSystemAnnouncementsState(v); setDrvNotifySystemAnnouncements(v); }} last />
        </View>
        <Text style={s.sectionNote}>
          These are saved as your preferences, but TranSync doesn't send push notifications — nothing
          is delivered outside the app yet.
        </Text>

        {/* ── 3. PRIVACY & SECURITY ── */}
        <Text style={s.sectionLabel}>Privacy & Security</Text>
        <View style={s.card}>
          <MenuRow icon="key-outline" label="Change Password" onPress={() => {
            setPwError(""); setCurrentPw(""); setNewPw(""); setConfirmPw("");
            setPwViaOtp(false); setPwOtpSent(false); setPwOtpVerified(false); setPwOtp(""); setPwOtpCooldown(0);
            setPwModalVisible(true);
          }} />
          <InfoStaticRow
            icon="shield-checkmark-outline"
            title="Account Security"
            body="Your password is encrypted and never visible to anyone, including TranSync staff."
          />
          <InfoStaticRow
            icon="phone-portrait-outline"
            title="Active Sessions"
            body="Session management by device isn't available yet — logging out from a device only affects that device."
            last
          />
        </View>

        {/* ── 4. TERMS & POLICIES ── */}
        <Text style={s.sectionLabel}>Terms & Policies</Text>
        <View style={s.card}>
          <MenuRow icon="document-text-outline" label="Terms & Conditions" onPress={() => setShowTerms(true)} />
          <MenuRow icon="lock-closed-outline" label="Privacy Policy" onPress={() => setShowPrivacy(true)} last />
        </View>
      </ScrollView>

      {/* ── EDIT ACCOUNT INFO MODAL ── */}
      <Modal visible={infoModalVisible} transparent animationType="slide" onRequestClose={() => setInfoModalVisible(false)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
              <View style={s.handle} />
              <Text style={s.sheetTitle}>Edit Account Info</Text>

              {!!infoError && <Text style={s.errorText}>{infoError}</Text>}

              <Text style={s.fieldLabel}>Full Name</Text>
              <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor="#9ca3af" />
              <Text style={s.fieldLabel}>Email</Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email address"
                placeholderTextColor="#9ca3af"
              />
              <MaskedPhoneField currentPhone={drv?.phone ?? ""} onPendingNewPhoneChange={setPendingNewPhone} />
              <Text style={s.fieldLabel}>Current Password (to confirm)</Text>
              <TextInput
                style={s.input}
                value={infoPassword}
                onChangeText={setInfoPassword}
                secureTextEntry
                placeholder="Current password"
                placeholderTextColor="#9ca3af"
              />

              <TouchableOpacity
                style={[s.saveBtn, infoSaving && s.saveBtnDisabled]}
                onPress={handleSaveInfo}
                disabled={infoSaving}
                activeOpacity={0.85}
              >
                {infoSaving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setInfoModalVisible(false)} disabled={infoSaving}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ── CHANGE PASSWORD MODAL ── */}
      <Modal visible={pwModalVisible} transparent animationType="slide" onRequestClose={() => setPwModalVisible(false)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
              <View style={s.handle} />
              <Text style={s.sheetTitle}>Change Password</Text>

              {!!pwError && <Text style={s.errorText}>{pwError}</Text>}

              {!pwViaOtp ? (
                <>
                  <Text style={s.fieldLabel}>Current Password</Text>
                  <TextInput
                    style={s.input}
                    value={currentPw}
                    onChangeText={setCurrentPw}
                    secureTextEntry
                    placeholder="Current password"
                    placeholderTextColor="#9ca3af"
                  />
                  <TouchableOpacity onPress={() => setPwViaOtp(true)}>
                    <Text style={s.otpToggleLink}>Forgot your current password? Verify via OTP instead.</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={s.otpBox}>
                  <Text style={s.fieldLabel}>Verify via OTP</Text>
                  {pwOtpVerified ? (
                    <View style={s.otpVerifiedRow}>
                      <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
                      <Text style={s.otpVerifiedText}>Phone number verified</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={s.otpHint}>We'll send a code to your registered number, {drv?.phone || "your phone"}.</Text>
                      {!pwOtpSent ? (
                        <TouchableOpacity
                          style={[s.otpActionBtn, pwOtpSending && s.saveBtnDisabled]}
                          onPress={handleSendPwOtp}
                          disabled={pwOtpSending}
                        >
                          {pwOtpSending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.otpActionBtnText}>Send Code</Text>}
                        </TouchableOpacity>
                      ) : (
                        <>
                          <TextInput
                            style={s.otpInput}
                            value={pwOtp}
                            onChangeText={(v) => setPwOtp(v.replace(/\D/g, "").slice(0, 6))}
                            keyboardType="number-pad"
                            placeholder="6-digit code"
                            placeholderTextColor="#9ca3af"
                            maxLength={6}
                          />
                          <TouchableOpacity
                            style={[s.otpActionBtn, (pwOtpVerifying || pwOtp.length !== 6) && s.saveBtnDisabled]}
                            onPress={handleVerifyPwOtp}
                            disabled={pwOtpVerifying || pwOtp.length !== 6}
                          >
                            {pwOtpVerifying ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.otpActionBtnText}>Verify</Text>}
                          </TouchableOpacity>
                          <TouchableOpacity onPress={handleSendPwOtp} disabled={pwOtpSending || pwOtpCooldown > 0}>
                            <Text style={[s.otpToggleLink, (pwOtpSending || pwOtpCooldown > 0) && { opacity: 0.5 }]}>
                              {pwOtpCooldown > 0 ? `Resend code (${pwOtpCooldown}s)` : "Resend code"}
                            </Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </>
                  )}
                  <TouchableOpacity onPress={() => { setPwViaOtp(false); setPwOtpSent(false); setPwOtpVerified(false); setPwOtp(""); }}>
                    <Text style={s.otpToggleLink}>Use Current Password instead</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={s.fieldLabel}>New Password</Text>
              <TextInput
                style={s.input}
                value={newPw}
                onChangeText={setNewPw}
                secureTextEntry
                placeholder="At least 6 characters"
                placeholderTextColor="#9ca3af"
              />
              <Text style={s.fieldLabel}>Confirm New Password</Text>
              <TextInput
                style={s.input}
                value={confirmPw}
                onChangeText={setConfirmPw}
                secureTextEntry
                placeholder="Re-enter new password"
                placeholderTextColor="#9ca3af"
              />

              <TouchableOpacity
                style={[s.saveBtn, (pwSaving || (pwViaOtp && !pwOtpVerified)) && s.saveBtnDisabled]}
                onPress={handleChangePassword}
                disabled={pwSaving || (pwViaOtp && !pwOtpVerified)}
                activeOpacity={0.85}
              >
                {pwSaving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save Password</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setPwModalVisible(false)} disabled={pwSaving}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>

      {/* ── TERMS & POLICIES VIEWERS ── */}
      <PolicySheet visible={showTerms} title="Terms & Conditions" onClose={() => setShowTerms(false)}>
        {DRIVER_TERMS.map((sec) => <TcSection key={sec.title} title={sec.title}>{sec.body}</TcSection>)}
      </PolicySheet>
      <PolicySheet visible={showPrivacy} title="Privacy Policy" onClose={() => setShowPrivacy(false)}>
        {PRIVACY_POLICY.map((sec) => <TcSection key={sec.title} title={sec.title}>{sec.body}</TcSection>)}
      </PolicySheet>
    </View>
  );
}

function MenuRow({
  icon, label, onPress, last = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; last?: boolean;
}) {
  return (
    <TouchableOpacity style={[s.menuRow, !last && s.infoBorder]} onPress={onPress} activeOpacity={0.7}>
      <View style={s.infoIconWrap}>
        <Ionicons name={icon} size={18} color="#6b7280" />
      </View>
      <Text style={s.menuLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
    </TouchableOpacity>
  );
}

function SwitchRow({
  label, value, onValueChange, last = false,
}: {
  label: string; value: boolean; onValueChange: (v: boolean) => void; last?: boolean;
}) {
  return (
    <View style={[s.switchRow, !last && s.infoBorder]}>
      <Text style={s.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: "#e5e7eb", true: "#a8d832" }}
        thumbColor={value ? "#1a4a52" : "#f4f3f4"}
      />
    </View>
  );
}

function InfoStaticRow({
  icon, title, body, last = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; body: string; last?: boolean;
}) {
  return (
    <View style={[s.infoStaticRow, !last && s.infoBorder]}>
      <View style={s.infoIconWrap}>
        <Ionicons name={icon} size={18} color="#6b7280" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.infoStaticTitle}>{title}</Text>
        <Text style={s.infoStaticBody}>{body}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#f9fafb" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 32, borderRadius: 16, paddingHorizontal: 10, backgroundColor: "#f1f5f9", justifyContent: "center" },
  backBtnText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: "#1a4a52" },

  sectionLabel: { fontSize: 12, fontWeight: "800", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  sectionNote:  { fontSize: 11, color: "#9ca3af", marginTop: -14, marginBottom: 20, paddingHorizontal: 4, lineHeight: 15 },

  card: {
    backgroundColor: "#fff", borderRadius: 16, marginBottom: 20,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    overflow: "hidden",
  },
  infoBorder: { borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  infoIconWrap: { width: 28, alignItems: "center" },

  menuRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, paddingHorizontal: 16 },
  menuLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: "#374151" },

  staticRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 16 },
  staticLabel: { fontSize: 14, fontWeight: "600", color: "#374151" },
  staticValue: { fontSize: 13, fontWeight: "800", color: "#1a4a52" },

  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  switchLabel: { flex: 1, fontSize: 14, fontWeight: "700", color: "#374151" },

  infoStaticRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  infoStaticTitle: { fontSize: 13, fontWeight: "700", color: "#374151" },
  infoStaticBody: { fontSize: 12, color: "#9ca3af", marginTop: 2, lineHeight: 16 },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "85%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },

  errorText: { fontSize: 12, fontWeight: "700", color: "#dc2626", backgroundColor: "#fef2f2", padding: 10, borderRadius: 10, marginBottom: 12 },

  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: "#1a4a52",
  },

  otpToggleLink: { fontSize: 12, fontWeight: "700", color: "#1a4a52", marginTop: 8 },
  otpBox: { backgroundColor: "#f9fafb", borderRadius: 12, padding: 12, marginTop: 12, gap: 4 },
  otpHint: { fontSize: 12, color: "#6b7280", marginBottom: 8, lineHeight: 16 },
  otpActionBtn: { backgroundColor: "#1a4a52", borderRadius: 10, paddingVertical: 11, alignItems: "center", marginBottom: 8 },
  otpActionBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  otpInput: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 16, letterSpacing: 4,
    color: "#1a4a52", backgroundColor: "#fff", marginBottom: 8,
  },
  otpVerifiedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  otpVerifiedText: { fontSize: 13, fontWeight: "700", color: "#16a34a" },

  saveBtn: { backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 15, fontWeight: "800", color: "#fff" },

  cancelBtn: { paddingVertical: 14, alignItems: "center", marginTop: 4, marginBottom: 8 },
  cancelBtnText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
});
