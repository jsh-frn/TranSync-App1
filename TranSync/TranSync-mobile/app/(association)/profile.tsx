import { useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  TextInput, Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API_BASE, { FILE_BASE } from "../../src/config/api";
import KeyboardAwareForm from "../../src/components/common/KeyboardAwareForm";
import AvatarPicker, { buildAvatarFormData } from "../../src/components/common/AvatarPicker";

type Assoc = {
  id:            number;
  name:          string;
  email:         string;
  phone:         string;
  address:       string;
  status:        string;
  avatar_url?:   string | null;
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: "Active",   color: "#16a34a", bg: "#f0fdf4" },
  pending:  { label: "Pending",  color: "#b45309", bg: "#fffbeb" },
  inactive: { label: "Inactive", color: "#dc2626", bg: "#fef2f2" },
};

export default function AssociationProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [assoc,     setAssoc]     = useState<Assoc | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [editName,  setEditName]  = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving,    setSaving]    = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Paint from the AsyncStorage snapshot immediately, then reconcile with a
  // live fetch (associations/get_profile.php) so an admin approving/
  // rejecting this association mid-session — or an edit made from Settings —
  // shows up here without a re-login. Same reasoning as commuter's
  // UserContext, just a lightweight per-screen fetch rather than a shared
  // context (no Association-equivalent of UserContext exists, and this
  // screen is the only one that currently needs it).
  const refreshAssoc = useCallback(async () => {
    const raw = await AsyncStorage.getItem("user");
    const current: Assoc | null = raw ? JSON.parse(raw) : null;
    if (current) setAssoc(current);
    setLoading(false);
    if (!current?.id) return;
    try {
      const res  = await fetch(`${API_BASE}/associations/get_profile.php?association_id=${current.id}`);
      const data = await res.json();
      if (data?.success && data.association) {
        const merged: Assoc = { ...current, ...data.association };
        await AsyncStorage.setItem("user", JSON.stringify(merged));
        setAssoc(merged);
      }
    } catch {
      // Network failure — the cached value set above stays shown.
    }
  }, []);

  useFocusEffect(useCallback(() => { refreshAssoc(); }, [refreshAssoc]));

  const startEditName = () => {
    setNameInput(assoc?.name ?? "");
    setEditName(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const cancelEditName = () => {
    setEditName(false);
    setNameInput("");
  };

  const saveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res  = await fetch(`${API_BASE}/associations/update_association.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ association_id: assoc!.id, name: trimmed }),
      });
      const json = await res.json();
      if (json.success) {
        const updated = { ...assoc!, name: trimmed };
        setAssoc(updated);
        await AsyncStorage.setItem("user", JSON.stringify(updated));
        setEditName(false);
      } else {
        Alert.alert("Error", json.message ?? "Failed to update name.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(["user", "role"]);
    router.replace("/(auth)/login");
  };

  const handleAvatarChange = async (localUri: string | null) => {
    if (!assoc) return;
    setUploadingAvatar(true);
    try {
      const fd  = buildAvatarFormData("association_id", assoc.id, localUri);
      const res = await fetch(`${API_BASE}/associations/update_avatar.php`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        const updated = { ...assoc, avatar_url: data.avatar_url };
        setAssoc(updated);
        await AsyncStorage.setItem("user", JSON.stringify(updated));
      } else {
        Alert.alert("Error", data.message || "Failed to update photo.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (loading) return (
    <View style={styles.centered}><ActivityIndicator color="#1a4a52" size="large" /></View>
  );
  if (!assoc) return null;

  const statusMeta = STATUS_META[assoc.status] ?? STATUS_META.pending;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <KeyboardAwareForm contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Avatar */}
        <View style={styles.avatarWrap}>
          <AvatarPicker
            uri={assoc.avatar_url ? FILE_BASE + assoc.avatar_url : null}
            fallbackIcon="business"
            size={80}
            uploading={uploadingAvatar}
            onChange={handleAvatarChange}
          />
          <Text style={styles.assocName}>{assoc.name}</Text>
          <View style={[styles.statusPill, { backgroundColor: statusMeta.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
            <Text style={[styles.statusText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
          </View>
        </View>

        {/* Info card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Association Details</Text>

          {/* Editable name row */}
          <View style={[styles.infoRow, styles.infoRowLast]}>
            <Ionicons name="business-outline" size={16} color="#9ca3af" />
            <Text style={styles.infoLabel}>Name</Text>
            {editName ? (
              <View style={styles.editInline}>
                <TextInput
                  ref={inputRef}
                  style={styles.nameInput}
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder="Association name"
                  placeholderTextColor="#9ca3af"
                  returnKeyType="done"
                  onSubmitEditing={saveName}
                  editable={!saving}
                />
                {nameInput.trim() !== assoc.name ? (
                  <TouchableOpacity onPress={saveName} disabled={saving} style={styles.iconBtn} activeOpacity={0.7}>
                    {saving
                      ? <ActivityIndicator size={16} color="#1a4a52" />
                      : <>
                          <Ionicons name="checkmark" size={18} color="#16a34a" />
                          <Text style={styles.iconBtnText}>Save</Text>
                        </>}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={cancelEditName} disabled={saving} style={styles.iconBtn} activeOpacity={0.7}>
                    <Ionicons name="close" size={18} color="#dc2626" />
                    <Text style={[styles.iconBtnText, { color: "#dc2626" }]}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.nameDisplay}>
                <Text style={styles.infoValue}>{assoc.name}</Text>
                <TouchableOpacity onPress={startEditName} style={styles.iconBtn} activeOpacity={0.7}>
                  <Ionicons name="pencil" size={14} color="#1a4a52" />
                  <Text style={[styles.iconBtnText, { color: "#1a4a52" }]}>Edit</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <InfoRow icon="mail-outline"     label="Email"  value={assoc.email}  />
          <InfoRow icon="call-outline"     label="Phone"  value={assoc.phone || "—"}  />
          <InfoRow icon="location-outline" label="Address" value={assoc.address || "—"} />
        </View>

        {/* Profile Actions */}
        <View style={styles.card}>
          <ActionRow
            icon="shield-checkmark-outline"
            label="Association Verification"
            onPress={() => router.push("/(association)/association-verification")}
          />
          <ActionRow
            icon="settings-outline"
            label="Settings"
            onPress={() => router.push("/(association)/settings")}
            last
          />
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={18} color="#dc2626" />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

      </KeyboardAwareForm>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color="#9ca3af" />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function ActionRow({
  icon, label, onPress, last = false,
}: { icon: any; label: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.actionRow, !last && styles.infoRowLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={16} color="#1a4a52" />
      <Text style={styles.actionLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: "#f9fafb" },
  centered:{ flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    paddingHorizontal: 20, paddingVertical: 16,
    backgroundColor: "#1a4a52",
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: "#fff" },

  content: { padding: 20, gap: 16, paddingBottom: 40 },

  avatarWrap: { alignItems: "center", gap: 10, paddingVertical: 8 },
  assocName:  { fontSize: 20, fontWeight: "900", color: "#1a4a52", textAlign: "center" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f0fdf4", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  statusDot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: "#16a34a" },
  statusText: { fontSize: 12, fontWeight: "700", color: "#16a34a" },

  card: {
    backgroundColor: "#fff", borderRadius: 16, padding: 18,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, elevation: 2, gap: 4,
  },
  cardTitle: { fontSize: 14, fontWeight: "800", color: "#1a4a52", marginBottom: 10 },

  infoRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  infoRowLast: { borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  infoLabel:   { fontSize: 13, color: "#6b7280", fontWeight: "600", width: 60 },
  infoValue:   { flex: 1, fontSize: 13, color: "#111827", fontWeight: "700", textAlign: "right" },

  actionRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  actionLabel: { flex: 1, fontSize: 14, color: "#374151", fontWeight: "700" },

  nameDisplay: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  editInline:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  nameInput: {
    flex: 1, fontSize: 13, color: "#111827", fontWeight: "700", textAlign: "right",
    borderBottomWidth: 1.5, borderBottomColor: "#1a4a52", paddingVertical: 2,
  },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 4, paddingHorizontal: 4 },
  iconBtnText: { fontSize: 12, fontWeight: "700", color: "#16a34a" },

  logoutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#fef2f2", borderRadius: 14, paddingVertical: 15,
    borderWidth: 1, borderColor: "#fecaca",
  },
  logoutText: { fontSize: 15, fontWeight: "800", color: "#dc2626" },
});