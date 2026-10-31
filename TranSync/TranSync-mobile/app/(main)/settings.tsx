import { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, Alert, Switch, ActivityIndicator, TextInput,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useUser } from "../../src/context/UserContext";
import API_BASE from "../../src/config/api";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";
import MaskedPhoneField from "../../src/components/common/MaskedPhoneField";
import { PolicySheet, TcSection } from "../../src/components/registration/TermsGate";
import { COMMUTER_TERMS, PRIVACY_POLICY, CANCELLATION_POLICY } from "../../src/constants/registrationTerms";
import {
  getNotifyBookingConfirmed, setNotifyBookingConfirmed,
  getNotifyBoardingTrip, setNotifyBoardingTrip,
  getNotifyCancelRefund, setNotifyCancelRefund,
  getNotifyVerificationStatus, setNotifyVerificationStatus,
} from "../../src/state/settingsPrefs";

// Pushed from Profile → "Settings" (previously a dead stub). Five sections
// per the approved spec: Account Information (Name/Email/Phone, one
// password-gated edit), Notifications (in-app display preferences only —
// this app has no push infra, see CLAUDE.md), Privacy & Security (Change
// Password + static security/session info), Terms & Policies (read-only
// viewers reusing the same content shown at registration/booking time), and
// Delete Account (permanent soft-delete — see migration 046 /
// commuter/delete_account.php, replacing last pass's reversible
// Deactivation in this UI; deactivate_account.php is left dormant per this
// codebase's deprecate-in-place convention).

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshUser } = useUser();

  // Change Password modal
  const [pwModalVisible, setPwModalVisible] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  // Alternative to Current Password — verify ownership via an OTP sent to
  // this commuter's own on-file phone number instead (for when Current
  // Password itself is what's been forgotten).
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

  // Edit Personal Info modal (Name + Email + Phone together). Suffix dropped
  // (no longer collected at registration, see the registration redesign —
  // kept consistent here rather than showing a field for something that no
  // account can ever have going forward). Phone is no longer a plain
  // TextInput — see pendingNewPhone below and MaskedPhoneField.
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [infoPassword, setInfoPassword] = useState("");
  const [firstName, setFirstName]   = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName]     = useState("");
  const [infoEmail, setInfoEmail]   = useState("");
  // Set only once a new number has actually been OTP-verified via
  // MaskedPhoneField — null means "not changing the phone number."
  const [pendingNewPhone, setPendingNewPhone] = useState<string | null>(null);
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoError, setInfoError]   = useState("");

  // Notifications (in-app display preferences)
  const [notifyBookingConfirmed, setNotifyBookingConfirmedState] = useState(true);
  const [notifyBoardingTrip,     setNotifyBoardingTripState]     = useState(true);
  const [notifyCancelRefund,     setNotifyCancelRefundState]     = useState(true);
  const [notifyVerification,     setNotifyVerificationState]     = useState(true);

  // Terms & Policies viewers
  const [showTerms, setShowTerms]           = useState(false);
  const [showPrivacy, setShowPrivacy]       = useState(false);
  const [showCancellation, setShowCancellation] = useState(false);

  // Delete Account
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useFocusEffect(useCallback(() => {
    getNotifyBookingConfirmed().then(setNotifyBookingConfirmedState);
    getNotifyBoardingTrip().then(setNotifyBoardingTripState);
    getNotifyCancelRefund().then(setNotifyCancelRefundState);
    getNotifyVerificationStatus().then(setNotifyVerificationState);
  }, []));

  const openPwModal = () => {
    setCurrentPw(""); setNewPw(""); setConfirmPw(""); setPwError("");
    setPwViaOtp(false); setPwOtpSent(false); setPwOtpVerified(false); setPwOtp(""); setPwOtpCooldown(0);
    setPwModalVisible(true);
  };

  const handleSendPwOtp = async () => {
    setPwError("");
    setPwOtpSending(true);
    try {
      const res = await fetch(`${API_BASE}/auth/send_phone_otp.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: (user?.phone ?? "").replace(/\D/g, ""), purpose: "self_verify" }),
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
        body: JSON.stringify({ phone: (user?.phone ?? "").replace(/\D/g, ""), otp: pwOtp }),
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
      const res = await fetch(`${API_BASE}/commuter/change_password.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commuter_id: user!.id,
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
      Alert.alert("Password Changed", "Your password has been updated.");
    } catch {
      setPwError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setPwSaving(false);
    }
  };

  const openInfoModal = () => {
    setFirstName(user?.first_name ?? "");
    setMiddleName(user?.middle_name ?? "");
    setLastName(user?.last_name ?? "");
    setInfoEmail(user?.email ?? "");
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
    const nameChanged =
      firstName.trim() !== (user?.first_name ?? "") ||
      middleName.trim() !== (user?.middle_name ?? "") ||
      lastName.trim() !== (user?.last_name ?? "");
    const emailChanged = infoEmail.trim() && infoEmail.trim() !== user?.email;
    const phoneChanged = pendingNewPhone !== null;

    if (!nameChanged && !emailChanged && !phoneChanged) {
      setInfoError("Change your name, email, or phone before saving.");
      return;
    }
    if (nameChanged && (!firstName.trim() || !lastName.trim())) {
      setInfoError("First and last name are required.");
      return;
    }

    setInfoSaving(true);
    try {
      const res = await fetch(`${API_BASE}/commuter/update_contact.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commuter_id: user!.id,
          password: infoPassword,
          ...(nameChanged ? {
            first_name: firstName.trim(),
            middle_name: middleName.trim(),
            last_name: lastName.trim(),
          } : {}),
          ...(emailChanged ? { email: infoEmail.trim() } : {}),
          ...(phoneChanged ? { phone: pendingNewPhone } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setInfoError(data.message || "Couldn't update your information.");
        return;
      }
      await refreshUser();
      setInfoModalVisible(false);
      Alert.alert("Updated", "Your account information has been updated.");
    } catch {
      setInfoError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setInfoSaving(false);
    }
  };

  const toggleNotifyBookingConfirmed = async (v: boolean) => { setNotifyBookingConfirmedState(v); await setNotifyBookingConfirmed(v); };
  const toggleNotifyBoardingTrip     = async (v: boolean) => { setNotifyBoardingTripState(v); await setNotifyBoardingTrip(v); };
  const toggleNotifyCancelRefund     = async (v: boolean) => { setNotifyCancelRefundState(v); await setNotifyCancelRefund(v); };
  const toggleNotifyVerification     = async (v: boolean) => { setNotifyVerificationState(v); await setNotifyVerificationStatus(v); };

  const confirmDelete = () => {
    Alert.alert(
      "Delete Account?",
      "This action is permanent and cannot be undone. Your personal information will be permanently removed and you will no longer be able to log in with this account.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Continue", style: "destructive", onPress: () => { setDeletePassword(""); setDeleteError(""); setDeleteModalVisible(true); } },
      ]
    );
  };

  const handleDelete = async () => {
    setDeleteError("");
    if (!deletePassword) {
      setDeleteError("Enter your password to confirm.");
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/commuter/delete_account.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commuter_id: user!.id, password: deletePassword }),
      });
      const data = await res.json();
      if (!data.success) {
        setDeleteError(data.message || "Couldn't delete your account.");
        return;
      }
      setDeleteModalVisible(false);
      await AsyncStorage.multiRemove(["user", "role"]);
      router.replace("/(auth)/login");
    } catch {
      setDeleteError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setDeleting(false);
    }
  };

  if (!user) return null;

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
          <MenuRow icon="person-outline" label="Edit Personal Info" onPress={openInfoModal} last />
        </View>

        {/* ── DISCOUNT ELIGIBILITY (Core Flow 2b) ── */}
        {/* Only shown for a Default commuter with no submission already in
            flight (see commuter/get_profile.php's can_apply_category) —
            hidden the moment they hold any category or have a pending
            review, so this never overlaps with Profile's own "Renew
            Verification"/"Change Discount Type" actions (a different,
            narrower feature — switching FROM an expired category). */}
        {!!user?.can_apply_category && (
          <>
            <Text style={s.sectionLabel}>Discount Eligibility</Text>
            <View style={s.card}>
              <MenuRow icon="school-outline" label="Apply for Student Discount" onPress={() => router.push("/(auth)/student-verification?mode=renew" as any)} />
              <MenuRow icon="accessibility-outline" label="Apply for PWD Discount" onPress={() => router.push("/(auth)/pwd-verification?mode=renew" as any)} />
              <MenuRow icon="body-outline" label="Apply for Senior Citizen Discount" onPress={() => router.push("/(auth)/senior-verification?mode=apply" as any)} last />
            </View>
          </>
        )}

        {/* ── 2. NOTIFICATIONS ── */}
        <Text style={s.sectionLabel}>Notifications</Text>
        <View style={s.card}>
          <SwitchRow
            label="Booking Confirmation"
            sub="Show new booking confirmations in Recent Activity."
            value={notifyBookingConfirmed}
            onValueChange={toggleNotifyBookingConfirmed}
          />
          <SwitchRow
            label="Boarding / Trip Reminders"
            sub="Show completed-trip updates in Recent Activity."
            value={notifyBoardingTrip}
            onValueChange={toggleNotifyBoardingTrip}
          />
          <SwitchRow
            label="Cancellation & Refund Updates"
            sub="Show cancellations, refunds, and no-shows in Recent Activity."
            value={notifyCancelRefund}
            onValueChange={toggleNotifyCancelRefund}
          />
          <SwitchRow
            label="Verification Status Updates"
            sub="Show a banner on Home when your verification status changes."
            value={notifyVerification}
            onValueChange={toggleNotifyVerification}
            last
          />
        </View>
        <Text style={s.sectionNote}>
          These control what appears inside the app only — TranSync doesn't send push notifications.
        </Text>

        {/* ── 3. PRIVACY & SECURITY ── */}
        <Text style={s.sectionLabel}>Privacy & Security</Text>
        <View style={s.card}>
          <MenuRow icon="key-outline" label="Change Password" onPress={openPwModal} />
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
          <MenuRow icon="lock-closed-outline" label="Privacy Policy" onPress={() => setShowPrivacy(true)} />
          <MenuRow icon="receipt-outline" label="Cancellation & Refund Policy" onPress={() => setShowCancellation(true)} last />
        </View>

        {/* ── 5. DELETE ACCOUNT ── */}
        <Text style={s.sectionLabel}>Delete Account</Text>
        <View style={s.dangerCard}>
          <Text style={s.dangerText}>
            Deleting your account is permanent. Your personal information will be removed and you
            will not be able to log back in with this account. This cannot be undone.
          </Text>
          <TouchableOpacity style={s.dangerBtn} onPress={confirmDelete} activeOpacity={0.85}>
            <Ionicons name="trash-outline" size={16} color="#dc2626" />
            <Text style={s.dangerBtnText}>Delete My Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── CHANGE PASSWORD MODAL ── */}
      <Modal visible={pwModalVisible} transparent animationType="slide" onRequestClose={() => setPwModalVisible(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
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
                      <Text style={s.otpHint}>We'll send a code to your registered number, {user?.phone || "your phone"}.</Text>
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

      {/* ── EDIT PERSONAL INFO MODAL ── */}
      <Modal visible={infoModalVisible} transparent animationType="slide" onRequestClose={() => setInfoModalVisible(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
              <View style={s.handle} />
              <Text style={s.sheetTitle}>Edit Personal Info</Text>

              {!!infoError && <Text style={s.errorText}>{infoError}</Text>}

              <Text style={s.fieldLabel}>First Name</Text>
              <TextInput style={s.input} value={firstName} onChangeText={setFirstName} placeholder="First name" placeholderTextColor="#9ca3af" />
              <Text style={s.fieldLabel}>Middle Name (optional)</Text>
              <TextInput style={s.input} value={middleName} onChangeText={setMiddleName} placeholder="Middle name" placeholderTextColor="#9ca3af" />
              <Text style={s.fieldLabel}>Last Name</Text>
              <TextInput style={s.input} value={lastName} onChangeText={setLastName} placeholder="Last name" placeholderTextColor="#9ca3af" />

              <Text style={s.fieldLabel}>Email</Text>
              <TextInput
                style={s.input}
                value={infoEmail}
                onChangeText={setInfoEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email address"
                placeholderTextColor="#9ca3af"
              />
              <MaskedPhoneField currentPhone={user?.phone ?? ""} onPendingNewPhoneChange={setPendingNewPhone} />
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

      {/* ── TERMS & POLICIES VIEWERS ── */}
      <PolicySheet visible={showTerms} title="Terms & Conditions" onClose={() => setShowTerms(false)}>
        {COMMUTER_TERMS.map((sec) => <TcSection key={sec.title} title={sec.title}>{sec.body}</TcSection>)}
      </PolicySheet>
      <PolicySheet visible={showPrivacy} title="Privacy Policy" onClose={() => setShowPrivacy(false)}>
        {PRIVACY_POLICY.map((sec) => <TcSection key={sec.title} title={sec.title}>{sec.body}</TcSection>)}
      </PolicySheet>
      <PolicySheet visible={showCancellation} title="Cancellation & Refund Policy" onClose={() => setShowCancellation(false)}>
        {CANCELLATION_POLICY.map((sec) => <TcSection key={sec.title} title={sec.title}>{sec.body}</TcSection>)}
      </PolicySheet>

      {/* ── DELETE ACCOUNT MODAL ── */}
      <Modal visible={deleteModalVisible} transparent animationType="slide" onRequestClose={() => setDeleteModalVisible(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <KeyboardAwareForm keyboardShouldPersistTaps="handled">
              <View style={s.handle} />
              <Text style={s.sheetTitle}>Confirm Account Deletion</Text>
              <Text style={s.sheetSub}>
                This is permanent. Enter your password to delete your account.
              </Text>

              {!!deleteError && <Text style={s.errorText}>{deleteError}</Text>}

              <Text style={s.fieldLabel}>Password</Text>
              <TextInput
                style={s.input}
                value={deletePassword}
                onChangeText={setDeletePassword}
                secureTextEntry
                placeholder="Your password"
                placeholderTextColor="#9ca3af"
              />

              <TouchableOpacity
                style={[s.dangerConfirmBtn, deleting && s.saveBtnDisabled]}
                onPress={handleDelete}
                disabled={deleting}
                activeOpacity={0.85}
              >
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Delete Account</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setDeleteModalVisible(false)} disabled={deleting}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </KeyboardAwareForm>
          </View>
        </View>
      </Modal>
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
  label, sub, value, onValueChange, last = false,
}: {
  label: string; sub: string; value: boolean; onValueChange: (v: boolean) => void; last?: boolean;
}) {
  return (
    <View style={[s.switchRow, !last && s.infoBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={s.switchLabel}>{label}</Text>
        <Text style={s.switchSub}>{sub}</Text>
      </View>
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
  backBtn: { flexDirection: "row", alignItems: "center", gap: 3, height: 32, borderRadius: 16, paddingHorizontal: 10, backgroundColor: "#f1f5f9", justifyContent: "center" },
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

  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  switchLabel: { fontSize: 14, fontWeight: "700", color: "#374151" },
  switchSub: { fontSize: 12, color: "#9ca3af", marginTop: 2, lineHeight: 16 },

  infoStaticRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  infoStaticTitle: { fontSize: 13, fontWeight: "700", color: "#374151" },
  infoStaticBody: { fontSize: 12, color: "#9ca3af", marginTop: 2, lineHeight: 16 },

  dangerCard: {
    backgroundColor: "#fef2f2", borderWidth: 1.5, borderColor: "#fecaca",
    borderRadius: 16, padding: 16, marginBottom: 24, gap: 12,
  },
  dangerText: { fontSize: 12, color: "#991b1b", lineHeight: 17 },
  dangerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#fff", borderRadius: 12, paddingVertical: 12,
    borderWidth: 1.5, borderColor: "#dc2626",
  },
  dangerBtnText: { fontSize: 14, fontWeight: "800", color: "#dc2626" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "85%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", alignSelf: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: "900", color: "#1a4a52", marginBottom: 4 },
  sheetSub: { fontSize: 13, color: "#6b7280", marginBottom: 12 },

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
  dangerConfirmBtn: { backgroundColor: "#dc2626", borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 20 },

  cancelBtn: { paddingVertical: 14, alignItems: "center", marginTop: 4, marginBottom: 8 },
  cancelBtnText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
});
