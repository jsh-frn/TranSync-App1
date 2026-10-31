import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Shared Terms & Conditions / Privacy Policy consent gate for the three
// registration screens (Commuter/Operator/Association) — factored out of
// PassengerForm.tsx's existing PolicySheet/TcSection pattern (booking-time
// T&Cs), the only Terms UI that already existed anywhere in this app,
// rather than duplicating that same modal shell three more times. Visual
// behavior is identical: a checkbox + label, two blue link-styled `Text`
// buttons opening independent slide-up modals, one per document.

export type TcSectionData = { title: string; body: string };

export default function TermsGate({
  accepted, onAcceptedChange, termsTitle, termsSections, privacySections,
}: {
  accepted: boolean;
  onAcceptedChange: (v: boolean) => void;
  termsTitle: string;
  termsSections: TcSectionData[];
  privacySections: TcSectionData[];
}) {
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  return (
    <View>
      <TouchableOpacity style={s.termsRow} onPress={() => onAcceptedChange(!accepted)} activeOpacity={0.8}>
        <View style={[s.checkbox, accepted && s.checkboxChecked]}>
          {accepted && <Ionicons name="checkmark" size={13} color="#fff" />}
        </View>
        <Text style={s.termsTxt}>I have read and agree to the {termsTitle} and Privacy Policy.</Text>
      </TouchableOpacity>

      <View style={s.policyLinksRow}>
        <Text style={s.policyLinksLabel}>View </Text>
        <TouchableOpacity onPress={() => setShowTerms(true)} activeOpacity={0.7}>
          <Text style={s.policyLinkTxt}>{termsTitle}</Text>
        </TouchableOpacity>
        <Text style={s.policyLinksLabel}> and </Text>
        <TouchableOpacity onPress={() => setShowPrivacy(true)} activeOpacity={0.7}>
          <Text style={s.policyLinkTxt}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>

      <PolicySheet visible={showTerms} title={termsTitle} onClose={() => setShowTerms(false)}>
        {termsSections.map((sec) => (
          <TcSection key={sec.title} title={sec.title}>{sec.body}</TcSection>
        ))}
      </PolicySheet>

      <PolicySheet visible={showPrivacy} title="Privacy Policy" onClose={() => setShowPrivacy(false)}>
        {privacySections.map((sec) => (
          <TcSection key={sec.title} title={sec.title}>{sec.body}</TcSection>
        ))}
      </PolicySheet>
    </View>
  );
}

// Exported so Settings can reuse it directly as a read-only Terms/Privacy/
// Cancellation Policy viewer (Core Flow 2b) instead of a third near-
// identical copy — PassengerForm.tsx keeps its own local copy untouched.
export function PolicySheet({
  visible, title, onClose, children,
}: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.headerTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={s.headerCloseBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={18} color="#1a4a52" />
              <Text style={s.headerCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            {children}
          </ScrollView>
          <View style={[s.footer, { paddingBottom: 16 + insets.bottom }]}>
            {/* No `flex` on this button — it's a lone child in a plain column
                footer, not a row with a sibling to share width with. See the
                identical bug (and fix) already documented in
                (operator)/quota.tsx and (operator)/trips.tsx: a `flex: N`
                shorthand here would collapse this Text to zero height. */}
            <TouchableOpacity style={s.doneBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={s.doneBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Exported alongside PolicySheet — Settings composes its own
// <PolicySheet><TcSection>...</TcSection></PolicySheet> for each policy.
export function TcSection({ title, children }: { title: string; children: string }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionBody}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  termsRow:        { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 20 },
  checkbox:        { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: "#9ca3af", alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxChecked: { backgroundColor: "#1a4a52", borderColor: "#1a4a52" },
  termsTxt:        { fontSize: 12, color: "#6b7280", flex: 1, lineHeight: 18 },

  policyLinksRow:   { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 8, marginLeft: 30 },
  policyLinksLabel: { fontSize: 12, color: "#9ca3af" },
  policyLinkTxt:    { fontSize: 12, color: "#2563eb", fontWeight: "800" },

  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:       { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, height: "82%" },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  headerTitle: { fontSize: 17, fontWeight: "900", color: "#1a4a52" },
  headerCloseBtn:  { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 4, paddingLeft: 8 },
  headerCloseText: { fontSize: 13, fontWeight: "700", color: "#1a4a52" },

  section:     { marginBottom: 18 },
  sectionTitle:{ fontSize: 13, fontWeight: "800", color: "#1a4a52", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 },
  sectionBody: { fontSize: 13, color: "#374151", lineHeight: 20 },

  footer:      { padding: 16, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  doneBtn:     { alignItems: "center", justifyContent: "center", backgroundColor: "#1a4a52", borderRadius: 14, paddingVertical: 15 },
  doneBtnTxt:  { fontSize: 15, fontWeight: "800", color: "#fff" },
});
