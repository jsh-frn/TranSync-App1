import { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  Modal, ActivityIndicator, Alert, Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

// Shared avatar-with-upload control, used by all four self-managed roles
// (Commuter/Driver/Operator/Association Profile screens) — each of those
// screens already renders an initials/icon circle at roughly this size and
// wires it to its own role-specific update_avatar.php + user-state merge,
// so this component only owns the picking UI (tap → camera/gallery/remove
// action sheet) and the fallback rendering, not persistence.
export default function AvatarPicker({
  uri,
  fallbackText,
  fallbackIcon,
  size = 80,
  backgroundColor = "#1a4a52",
  uploading = false,
  onChange,
}: {
  uri: string | null | undefined;
  fallbackText?: string;
  fallbackIcon?: IoniconsName;
  size?: number;
  backgroundColor?: string;
  uploading?: boolean;
  onChange: (localUri: string | null) => void;
}) {
  const [showSheet, setShowSheet] = useState(false);

  const pickFrom = async (source: "camera" | "library") => {
    setShowSheet(false);
    const perm = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert(
        "Permission needed",
        source === "camera"
          ? "Camera access is required to take a photo."
          : "Photo library access is required to choose a photo."
      );
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    };
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled && result.assets?.[0]?.uri) {
      onChange(result.assets[0].uri);
    }
  };

  const handleRemove = () => {
    setShowSheet(false);
    Alert.alert("Remove Photo", "Remove your profile photo?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => onChange(null) },
    ]);
  };

  return (
    <View style={{ width: size, height: size }}>
      <TouchableOpacity
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor },
        ]}
        activeOpacity={0.85}
        onPress={() => setShowSheet(true)}
        disabled={uploading}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        ) : fallbackText ? (
          <Text style={[styles.fallbackText, { fontSize: size * 0.35 }]}>{fallbackText}</Text>
        ) : (
          <Ionicons name={fallbackIcon ?? "person"} size={size * 0.45} color="#fff" />
        )}

        {uploading && (
          <View style={styles.uploadingOverlay}>
            <ActivityIndicator color="#fff" size="small" />
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.cameraBadge}
        activeOpacity={0.8}
        onPress={() => setShowSheet(true)}
        disabled={uploading}
        accessibilityLabel="Change profile photo"
      >
        <Ionicons name="camera" size={14} color="#fff" />
      </TouchableOpacity>

      <Modal visible={showSheet} transparent animationType="fade" onRequestClose={() => setShowSheet(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowSheet(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Profile Photo</Text>
            <TouchableOpacity style={styles.option} onPress={() => pickFrom("camera")} activeOpacity={0.7}>
              <Ionicons name="camera-outline" size={18} color="#1a4a52" />
              <Text style={styles.optionText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.option} onPress={() => pickFrom("library")} activeOpacity={0.7}>
              <Ionicons name="images-outline" size={18} color="#1a4a52" />
              <Text style={styles.optionText}>Choose from Library</Text>
            </TouchableOpacity>
            {uri && (
              <TouchableOpacity style={styles.option} onPress={handleRemove} activeOpacity={0.7}>
                <Ionicons name="trash-outline" size={18} color="#dc2626" />
                <Text style={[styles.optionText, { color: "#dc2626" }]}>Remove Photo</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.cancel} onPress={() => setShowSheet(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// Builds the multipart FormData body update_avatar.php endpoints expect —
// shared so all four screens send an identical shape. `localUri === null`
// means "remove"; a `file://...` (or web blob) uri means "upload this."
export function buildAvatarFormData(idField: string, idValue: number, localUri: string | null): FormData {
  const fd = new FormData();
  fd.append(idField, String(idValue));
  if (localUri === null) {
    fd.append("remove", "1");
  } else {
    const filename = localUri.split("/").pop() || "avatar.jpg";
    const ext = filename.split(".").pop()?.toLowerCase();
    const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    fd.append("avatar", { uri: localUri, name: filename, type } as any);
  }
  return fd;
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center", justifyContent: "center", overflow: "hidden",
    shadowColor: "#1a4a52", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 5,
  },
  fallbackText: { fontWeight: "900", color: "#fff" },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center",
  },
  cameraBadge: {
    position: "absolute", right: -2, bottom: -2,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "#a8d832", alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
  },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: Platform.OS === "ios" ? 34 : 24,
  },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: "#1a4a52", marginBottom: 12, textAlign: "center" },
  option: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f1f5f9",
  },
  optionText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  cancel: { paddingVertical: 14, alignItems: "center", marginTop: 4 },
  cancelText: { fontSize: 14, fontWeight: "700", color: "#6b7280" },
});
