export function openDeviceEmailApp(recipient: string, subject: string, messageBody: string): void {
  const email = recipient.trim();
  if (!email) throw new Error("No email address is saved for this client.");
  if (typeof window === "undefined") throw new Error("Email handoff is available only in a browser.");
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(messageBody)}`;
}
