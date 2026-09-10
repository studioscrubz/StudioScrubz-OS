import type { PorterServicePricingInput, PorterServicePricingSnapshot } from "@/types/propertyServicePlan";

export const PORTER_WEEKS_PER_MONTH = 4.33;
const money = (value: number) => Math.round(value * 100) / 100;

// The caller supplies the timestamp so identical inputs produce identical snapshots.
export function calculatePorterService(input: PorterServicePricingInput, calculatedAt: string): PorterServicePricingSnapshot {
  for (const key of ["laborHoursPerVisit", "visitsPerWeek", "billedHourlyRate"] as const) {
    if (!Number.isFinite(input[key]) || input[key] <= 0) throw new Error(`${key} must be greater than zero.`);
  }
  if (!Number.isInteger(input.visitsPerWeek) || input.visitsPerWeek > 7) throw new Error("visitsPerWeek must be a whole integer from 1 through 7.");
  for (const key of ["porterHourlyPay", "suppliesMonthly", "travelMonthly", "supervisionAdminMonthly", "complexityAdjustmentMonthly"] as const) {
    if (!Number.isFinite(input[key]) || input[key] < 0) throw new Error(`${key} must be zero or greater.`);
  }
  if (input.manualMonthlyPriceOverride !== undefined && (!Number.isFinite(input.manualMonthlyPriceOverride) || input.manualMonthlyPriceOverride <= 0)) throw new Error("manualMonthlyPriceOverride must be greater than zero.");
  if (!calculatedAt || !Number.isFinite(Date.parse(calculatedAt))) throw new Error("A valid calculatedAt timestamp is required.");
  const monthlyHours = input.laborHoursPerVisit * input.visitsPerWeek * PORTER_WEEKS_PER_MONTH;
  const baseMonthlyPrice = money(monthlyHours * input.billedHourlyRate);
  const recommendedMonthlyPrice = money(baseMonthlyPrice + input.suppliesMonthly + input.travelMonthly + input.supervisionAdminMonthly + input.complexityAdjustmentMonthly);
  const approvedMonthlyPrice = money(input.manualMonthlyPriceOverride ?? recommendedMonthlyPrice);
  if (approvedMonthlyPrice <= 0) throw new Error("Approved monthly price must round to at least one cent.");
  const monthlyLaborCost = money(monthlyHours * input.porterHourlyPay);
  const monthlyOperatingCosts = money(input.suppliesMonthly + input.travelMonthly + input.supervisionAdminMonthly);
  const projectedGrossProfit = money(approvedMonthlyPrice - monthlyLaborCost - monthlyOperatingCosts);
  const projectedGrossMarginPercent = money(projectedGrossProfit / approvedMonthlyPrice * 100);
  const totals = { monthlyHours, baseMonthlyPrice, recommendedMonthlyPrice, approvedMonthlyPrice, monthlyLaborCost, monthlyOperatingCosts, projectedGrossProfit, projectedGrossMarginPercent };
  if (Object.values(totals).some(value => !Number.isFinite(value))) throw new Error("Pricing inputs produce totals outside the supported numeric range.");
  return { version: 1, inputs: { ...input }, ...totals, calculatedAt: new Date(calculatedAt).toISOString() };
}
