import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { formatTime12h } from "../../utils/time";

// Shared 12-hour AM/PM time picker for every schedule-related time field
// (Bus boarding/departure time, UV Express/Jeepney operating hours) — mirrors
// registration/DateField.tsx's native-picker pattern (Android shows its own
// modal and auto-dismisses on pick; iOS renders an inline spinner that stays
// open until "Done"). Value is exchanged/stored as 24-hour "HH:MM" (the
// format every schedule endpoint already expects) but 24-hour time is never
// shown to the user — only formatTime12h()'s "5:30 PM" style display.

function timeStringToDate(value: string): Date {
  const d = new Date();
  const [h, m] = value.split(":").map(Number);
  d.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
  return d;
}

function dateToTimeString(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export default function TimeField({
  label, value, onChange, placeholder = "Select time",
}: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const pickerValue = value ? timeStringToDate(value) : new Date();

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShow(false);
    if (event.type === "dismissed") return;
    if (selected) onChange(dateToTimeString(selected));
  };

  return (
    <View style={s.fieldWrap}>
      {!!label && <Text style={s.fieldLabel}>{label}</Text>}
      <TouchableOpacity style={s.input} onPress={() => setShow(true)} activeOpacity={0.7}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: value ? "#111827" : "#9ca3af" }}>
          {value ? formatTime12h(value) : placeholder}
        </Text>
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={pickerValue}
          mode="time"
          is24Hour={false}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleChange}
        />
      )}
      {Platform.OS === "ios" && show && (
        <TouchableOpacity style={s.doneBtn} onPress={() => setShow(false)}>
          <Text style={s.doneText}>Done</Text>
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
  doneBtn:  { alignSelf: "flex-end", paddingVertical: 6, paddingHorizontal: 4 },
  doneText: { color: "#1a4a52", fontWeight: "700", fontSize: 13 },
});
