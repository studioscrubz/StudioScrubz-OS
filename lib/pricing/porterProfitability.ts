import type { PorterServicePricingSnapshot } from "@/types/propertyServicePlan";
import type { ProfitabilityAdjustments, ProfitabilitySettings } from "@/types/profitability";

const round = (value: number) => Math.round(value * 100) / 100;
const up = (value: number) => Math.ceil(value * 100 - 1e-9) / 100;
const clean = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;

/** Private monthly cost analysis. Does not alter or persist Property Service Plan client prices. */
export function calculatePorterProfitability(
  pricing: PorterServicePricingSnapshot,
  settings: ProfitabilitySettings,
  extras: ProfitabilityAdjustments,
) {
  const price = pricing.approvedMonthlyPrice;
  const loadedLabor = round(pricing.monthlyHours * pricing.inputs.porterHourlyPay * (1 + settings.employerBurdenRate));
  // The source calculator already quotes these recurring monthly amounts.
  const supplies = pricing.inputs.suppliesMonthly;
  const travel = pricing.inputs.travelMonthly;
  const setup = clean(extras.setupLabor);
  const owner = clean(extras.ownerLabor);
  const direct = round(loadedLabor + supplies + travel + setup + owner
    + clean(extras.equipment) + clean(extras.subcontractors) + clean(extras.parkingTolls)
    + clean(extras.disposal) + clean(extras.otherDirectExpenses));
  const processing = clean(extras.paymentProcessingFees);
  const commissions = clean(extras.salesCommissions);
  // Supervision/Admin is already an input to the original monthly quote; include it once.
  const overhead = round(pricing.inputs.supervisionAdminMonthly + clean(extras.allocatedOverhead));
  const grossProfit = round(price - direct);
  const contributionProfit = round(grossProfit - processing - commissions);
  const operatingProfit = round(contributionProfit - overhead);
  const margin = (profit: number) => price > 0 ? round(profit / price * 100) : null;
  const target = settings.targetGrossMarginRate;
  const minimum = target >= 0 && target < 1
    ? up((direct + processing + commissions + overhead) / (1 - target))
    : null;
  return {
    price, monthlyHours: pricing.monthlyHours, loadedLabor, supplies, travel, direct,
    processing, commissions, overhead, grossProfit, contributionProfit, operatingProfit,
    grossMarginPercent: margin(grossProfit), contributionMarginPercent: margin(contributionProfit),
    operatingMarginPercent: margin(operatingProfit), recommendedMinimumPrice: minimum,
    differenceToTarget: minimum == null ? null : round(Math.max(0, minimum - price)),
  };
}
