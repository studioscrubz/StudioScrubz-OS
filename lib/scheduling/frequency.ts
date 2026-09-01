export const CANONICAL_SERVICE_FREQUENCIES = ["One-Time", "Daily", "Weekly", "Biweekly", "Twice Monthly", "Monthly", "Custom"] as const;

export type CanonicalServiceFrequency = (typeof CANONICAL_SERVICE_FREQUENCIES)[number];

export function isRecurringFrequency(frequency: string): boolean {
  return frequency !== "One-Time";
}

export function validCustomIntervalDays(value: number | null | undefined): value is number {
  return Number.isInteger(value) && Number(value) >= 1;
}

export function estimatedVisitsPerMonth(frequency: string, customIntervalDays?: number | null): number {
  if (frequency === "Daily") return 365 / 12;
  if (frequency === "Weekly") return 52 / 12;
  if (frequency === "Biweekly") return 26 / 12;
  if (frequency === "Twice Monthly") return 2;
  if (frequency === "Every 4 Weeks") return 13 / 12;
  if (frequency === "Monthly") return 1;
  if (frequency === "Custom") return validCustomIntervalDays(customIntervalDays) ? 365 / customIntervalDays / 12 : 0;
  return frequency === "One-Time" ? 1 : 0;
}

export function serviceFrequencyLabel(frequency: string, customIntervalDays?: number | null): string {
  if (frequency === "Biweekly") return "Bi-Weekly — Every 2 weeks (26 visits/year)";
  if (frequency === "Twice Monthly") return "Twice Monthly — 2 visits/month (24 visits/year)";
  if (frequency === "Custom") return validCustomIntervalDays(customIntervalDays) ? `Every ${customIntervalDays} Days` : "Custom — Repeat Every X Days";
  return frequency;
}

export function estimatedMonthlyTotal(perVisit: number, frequency: string, customIntervalDays?: number | null): number | null {
  if (!isRecurringFrequency(frequency)) return null;
  const visits = estimatedVisitsPerMonth(frequency, customIntervalDays);
  return visits > 0 ? Math.round(perVisit * visits * 100) / 100 : null;
}
