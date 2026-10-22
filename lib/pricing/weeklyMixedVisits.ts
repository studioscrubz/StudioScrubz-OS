import type { CommercialCalculatorInput, EstimateResult, ServiceWeekday, WeeklyMixedVisit } from "@/types/estimate";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const round = (n: number) => Math.round(n * 100) / 100;

export function mixedVisitTotals(
  visits: readonly WeeklyMixedVisit[],
  days: readonly ServiceWeekday[] | undefined,
  workerHourlyPay: number,
) {
  if (!days || days.length < 2 || days.length > 7 || new Set(days).size !== days.length)
    throw new Error("Select at least two distinct service days for the weekly contract.");
  if (visits.length !== days.length || new Set(visits.map(v => v.day)).size !== days.length || visits.some(v => !days.includes(v.day)))
    throw new Error("Enter one separate visit for every selected weekday.");
  for (const visit of visits) {
    if (!visit.serviceLevel.trim() || !visit.scope.trim())
      throw new Error(`Enter the service level and scope for ${DAYS[visit.day]}.`);
    if (!Number.isFinite(visit.hours) || visit.hours <= 0)
      throw new Error(`Enter estimated service hours for ${DAYS[visit.day]}.`);
    if (!Number.isFinite(visit.price) || visit.price <= 0)
      throw new Error(`Enter a positive visit price for ${DAYS[visit.day]}.`);
    if (visit.price < visit.hours * workerHourlyPay / 0.75)
      throw new Error(`${DAYS[visit.day]} is below a basic 25% gross-margin labor floor. Review pricing or hours.`);
  }
  const weeklyTotal = round(visits.reduce((sum, v) => sum + v.price, 0));
  return {
    weeklyTotal,
    monthlyAverage: round(weeklyTotal * 52 / 12),
    averagePerVisit: round(weeklyTotal / visits.length),
    weeklyHours: round(visits.reduce((sum, v) => sum + v.hours, 0)),
    visitsPerMonth: visits.length * 52 / 12,
  };
}

export function withMixedVisitEstimate(base: EstimateResult, input: CommercialCalculatorInput): EstimateResult {
  const visits = input.weeklyMixedVisits;
  if (input.frequency !== "Multiple Days Per Week" || visits === undefined) return base;
  const totals = mixedVisitTotals(visits, input.serviceDaysOfWeek, input.workerHourlyPay);
  const laborCost = round(totals.weeklyHours * input.workerHourlyPay / visits.length);
  const averageSupplyCost = base.supplyCost;
  return {
    ...base,
    calculatorInput: input,
    weeklyMixedVisits: visits.map(v => ({ ...v })),
    weeklyContractTotal: totals.weeklyTotal,
    oneTimePrice: totals.averagePerVisit,
    basePrice: totals.averagePerVisit,
    finalPrice: totals.averagePerVisit,
    calculatedFinalPrice: totals.averagePerVisit,
    monthlyPrice: totals.monthlyAverage,
    visitsPerMonth: totals.visitsPerMonth,
    recurringDiscount: 0,
    recurringDiscountPercent: 0,
    recurringPricingRuleId: null,
    recurringPricingRuleName: null,
    manualDiscount: 0,
    totalDiscount: 0,
    taxes: 0,
    adjustments: [],
    catalogAddons: [],
    laborHours: round(totals.weeklyHours / visits.length),
    laborCost,
    supplyCost: averageSupplyCost,
    estimatedProfit: round(totals.averagePerVisit - laborCost - averageSupplyCost),
    scope: visits.map(v => `${DAYS[v.day]} — ${v.serviceLevel.trim()}, ${v.hours} hours, $${round(v.price).toFixed(2)} per visit. Scope: ${v.scope.trim()}`),
  };
}
