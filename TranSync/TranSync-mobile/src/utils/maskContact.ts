// Display-only masking for contact details on screens where someone else might
// be looking over the commuter's shoulder. The real value is never changed —
// these only build the hidden version shown until the eye icon is tapped.

// "marthy.manalo@gmail.com" -> "m•••••••••@gmail.com". Keeps the first
// character and the domain so it's still recognisable as the commuter's own.
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const at = email.lastIndexOf("@");
  if (at < 1) return "•".repeat(Math.min(email.length, 8));
  const local  = email.slice(0, at);
  const domain = email.slice(at);
  return local[0] + "•".repeat(Math.min(Math.max(local.length - 1, 3), 9)) + domain;
}

// "09171234503" -> "0917••••503" — keeps the first 4 and last 3 digits so the
// commuter can still tell which number it is.
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  if (phone.length <= 7) return "•".repeat(phone.length);
  return phone.slice(0, 4) + "•".repeat(phone.length - 7) + phone.slice(-3);
}
