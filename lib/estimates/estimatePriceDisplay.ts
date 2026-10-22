import type { EstimateResult, WeeklyMixedVisit } from "@/types/estimate";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function estimatePriceDisplay(result: Pick<EstimateResult, "finalPrice" | "weeklyMixedVisits" | "weeklyContractTotal">) {
  const visits = Array.isArray(result.weeklyMixedVisits) && result.weeklyMixedVisits.length > 1
    ? result.weeklyMixedVisits
    : [];
  if (!visits.length) {
    return { amount: result.finalPrice, label: "Final price", visits: [] as WeeklyMixedVisit[], isWeeklyContract: false };
  }
  const derivedWeeklyTotal = visits.reduce((sum, visit) => sum + (Number.isFinite(visit.price) ? visit.price : 0), 0);
  const amount = Number.isFinite(result.weeklyContractTotal) && (result.weeklyContractTotal ?? 0) > 0
    ? result.weeklyContractTotal!
    : Math.round(derivedWeeklyTotal * 100) / 100;
  return {
    amount,
    label: "Weekly contract",
    visits: [...visits].sort((a, b) => a.day - b.day),
    isWeeklyContract: true,
  };
}

export function weekdayName(day: number): string {
  return WEEKDAYS[day] ?? "Unknown day";
}
