import type { ServiceWeekday, WeeklyMixedVisit } from "@/types/estimate";
import type { ProposalResult, ProposalScopeItem } from "@/types/proposal";

// These helpers preserve explicit day prices instead of treating the weekly sum
// as a uniform per-visit charge.
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * Recover a historical day breakdown only when every selected weekday has a
 * recognizable, explicitly priced scope entry. Never invent visit prices.
 */
export function recoverWeeklyVisitsFromScope(
  scope: readonly ProposalScopeItem[],
  days: readonly ServiceWeekday[],
): WeeklyMixedVisit[] | null {
  if (days.length < 2 || new Set(days).size !== days.length) return null;
  const visits: WeeklyMixedVisit[] = [];
  for (const day of days) {
    const dayName = DAY_NAMES[day];
    const entry = scope.map(item => item.text.trim()).find(text =>
      new RegExp(`^${dayName}\\s*[—–-]\\s*`, "i").test(text),
    );
    if (!entry) return null;
    const match = entry.match(
      /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s*[—–-]\s*(.+?),\s*(\d+(?:\.\d+)?)\s*hours?\s*,\s*\$([\d,]+(?:\.\d{1,2})?)\s*per\s*visit\.?\s*(?:Scope:\s*([\s\S]+))?$/i,
    );
    if (!match) return null;
    const price = Number(match[3].replaceAll(",", ""));
    const hours = Number(match[2]);
    if (!(price > 0 && hours > 0 && match[1].trim() && match[4]?.trim())) return null;
    visits.push({ day, serviceLevel: match[1].trim(), hours, price: cents(price), scope: match[4].trim() });
  }
  return visits;
}

/** Keep the actual weekly amounts authoritative; per-visit is an average for legacy fields only. */
export function withProposalWeeklyVisitPrices(
  result: ProposalResult,
  visits: readonly WeeklyMixedVisit[],
  days: readonly ServiceWeekday[],
): ProposalResult {
  const selected = days.map(day => visits.find(visit => visit.day === day)).filter((v): v is WeeklyMixedVisit => Boolean(v));
  if (selected.length !== days.length || days.length < 2 || new Set(days).size !== days.length) return result;
  const weeklyTotal = cents(selected.reduce((sum, visit) => sum + (Number.isFinite(visit.price) ? Math.max(0, visit.price) : 0), 0));
  const average = cents(weeklyTotal / selected.length);
  const averageHours = cents(selected.reduce((sum, visit) => sum + (Number.isFinite(visit.hours) ? Math.max(0, visit.hours) : 0), 0) / selected.length);
  return {
    ...result,
    serviceDaysOfWeek: [...days],
    weeklyMixedVisits: selected.map(visit => ({ ...visit })),
    weeklyContractTotal: weeklyTotal,
    baseEstimateAmount: average,
    calculatedPerVisitTotal: average,
    manualPerVisitTotal: null,
    perVisitTotal: average,
    monthlyTotal: cents(weeklyTotal * 52 / 12),
    frequencyDiscount: 0,
    frequencyDiscountPercent: 0,
    inheritedManualDiscount: 0,
    manualDiscount: 0,
    taxes: 0,
    laborHours: averageHours,
    recurringPricingRuleId: null,
    recurringPricingRuleName: null,
    estimatedProfit: cents(result.estimatedProfit + average - result.perVisitTotal),
  };
}
