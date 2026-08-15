export function normalizeSmsPhoneNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasInternationalPrefix = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return hasInternationalPrefix ? `+${digits}` : digits;
}

export function buildDeviceSmsUrl(phoneNumber: string, messageBody: string): string {
  const phone = normalizeSmsPhoneNumber(phoneNumber);
  if (!phone) throw new Error("A valid client phone number is required.");
  const appleDevice = typeof navigator !== "undefined" && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
  const separator = appleDevice ? "&" : "?";
  return `sms:${phone}${separator}body=${encodeURIComponent(messageBody)}`;
}

export function openDeviceSmsApp(phoneNumber: string, messageBody: string): void {
  if (typeof window === "undefined") throw new Error("Device messaging is available only in a browser.");
  const url = buildDeviceSmsUrl(phoneNumber, messageBody);
  try { window.location.href = url; }
  catch { throw new Error("Your device could not open a messaging app."); }
}
