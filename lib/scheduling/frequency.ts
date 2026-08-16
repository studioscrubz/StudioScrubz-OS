export const CANONICAL_SERVICE_FREQUENCIES = ["One-Time", "Daily", "Weekly", "Biweekly", "Monthly"] as const;

export type CanonicalServiceFrequency = (typeof CANONICAL_SERVICE_FREQUENCIES)[number];

export function isRecurringFrequency(frequency: string): boolean {
  return frequency !== "One-Time";
}

export function estimatedVisitsPerMonth(frequency: string): number {
  if (frequency === "Daily") return 365 / 12;
  if (frequency === "Weekly") return 52 / 12;
  if (frequency === "Biweekly") return 26 / 12;
  if (frequency === "Every 4 Weeks") return 13 / 12;
  if (frequency === "Monthly") return 1;
  return frequency === "One-Time" ? 1 : 0;
}

export function estimatedMonthlyTotal(perVisit: number, frequency: string): number | null {
  if (!isRecurringFrequency(frequency)) return null;
  return Math.round(perVisit * estimatedVisitsPerMonth(frequency) * 100) / 100;
}
