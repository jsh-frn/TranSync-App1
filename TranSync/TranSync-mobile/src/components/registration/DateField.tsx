import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";

// Shared date-of-birth picker for the registration screens — same
// native-picker pattern already used by student/pwd/senior-verification.tsx
// for Birthdate/Date Issued (Android shows its own modal and auto-dismisses
// on pick; iOS renders an inline spinner that stays open until "Done").
// Extracted here since Commuter and Operator registration both need a Date
// of Birth field with identical behavior — the verification wizards keep
// their own existing local copies untouched (not worth migrating already-
// working code just to share this).

export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDisplayDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

export default function DateField({
  label, value, onChange, maximumDate, minimumDate, defaultDate, required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  maximumDate?: Date; minimumDate?: Date; defaultDate?: Date; required?: boolean;
}) {
  const [show, setShow] = useState(false);
  const pickerValue = value ? new Date(`${value}T00:00:00`) : (defaultDate ?? maximumDate ?? new Date());

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShow(false);
    if (event.type === "dismissed") return;
    if (selected) onChange(formatLocalDate(selected));
  };

  return (
    <View style={s.fieldWrap}>
      <Text style={s.fieldLabel}>{label}{required ? " *" : ""}</Text>
      <TouchableOpacity style={s.input} onPress={() => setShow(true)} activeOpacity={0.7}>
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
        <TouchableOpacity style={s.dateDoneBtn} onPress={() => setShow(false)}>
          <Text style={s.dateDoneText}>Done</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fieldWrap:  { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#374151" },
  input: {
    borderWidth: 1.5, borderColor: "#e5e7eb", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    backgroundColor: "#fff", justifyContent: "center",
  },
  dateDoneBtn: { alignSelf: "flex-end", paddingVertical: 6, paddingHorizontal: 4 },
  dateDoneText: { color: "#1a4a52", fontWeight: "700", fontSize: 13 },
});
