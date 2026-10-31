// Formats a bare "HH:MM" or "HH:MM:SS" time-of-day string (as stored for
// schedules/operating hours — no date component) into a 12-hour AM/PM
// string, e.g. "05:00" -> "5:00 AM", "21:30" -> "9:30 PM". Kept separate
// from full-datetime formatting (which goes through `Date`/`toLocaleString`
// elsewhere) since these values have no date to construct a `Date` from.
export function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  if (isNaN(h)) return hhmm;
  const m = (mStr ?? "00").padStart(2, "0");
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}
