import type { EstimateResult, Frequency } from "@/types/estimate";
import type { ProposalAdjustment, ProposalResult, ProposalScopeItem, ProposalTerms } from "@/types/proposal";
import { estimatedMonthlyTotal } from "@/lib/scheduling/frequency";
import { calculateRecurringTotals } from "@/lib/pricing/pricingEngine";
import type { RecurringPricingRule } from "@/types/serviceCatalog";
import { withAuthoritativeEstimatePrice } from "@/lib/pricing/authoritativePrice";

export function repriceEstimateFrequency(estimate: EstimateResult, frequency: Frequency, rules: RecurringPricingRule[], serviceId: string, recurringPricingRuleId?:string|null, customIntervalDays?: number | null): EstimateResult {
  const interval = frequency === "Custom" ? customIntervalDays ?? estimate.calculatorInput.customIntervalDays ?? null : null;
  const pricing = calculateRecurringTotals({ subtotal: estimate.oneTimePrice, frequency, customIntervalDays: interval, rules, serviceId, recurringPricingRuleId, manualDiscountAmount: estimate.manualDiscount });
  return withAuthoritativeEstimatePrice({ ...estimate, calculatedFinalPrice:pricing.finalPrice, recurringPricingRuleId:pricing.recurringPricingRuleId,recurringPricingRuleName:pricing.recurringPricingRuleName, recurringDiscount: pricing.recurringDiscountAmount, recurringDiscountPercent: pricing.recurringDiscountPercent, totalDiscount: money(pricing.recurringDiscountAmount + pricing.manualDiscount), taxes: pricing.taxes, finalPrice: pricing.finalPrice, monthlyPrice: pricing.monthlyPrice, calculatorInput: { ...estimate.calculatorInput, frequency,customIntervalDays:interval,recurringPricingRuleId:pricing.recurringPricingRuleId } },estimate.manualPrice??null);
}

export function calculateProposal(input: { estimate: EstimateResult | null; catalogBasePrice?: number; recurringRules: RecurringPricingRule[]; recurringPricingRuleId?:string|null; serviceId?: string; serviceName: string; serviceDescription: string | null; frequency: Frequency; customIntervalDays?: number | null; estimatedCleaningDays?:number|null; estimatedHoursPerDay?:number|null; adjustments: ProposalAdjustment[]; additionalLabor: number; additionalMaterials: number; laborHoursOverride?:number|null; crewSizeOverride?:number|null; manualDiscountPercent: number; scope: ProposalScopeItem[]; terms: ProposalTerms }): ProposalResult {
  const customIntervalDays = input.frequency === "Custom" ? input.customIntervalDays ?? input.estimate?.calculatorInput.customIntervalDays ?? null : null;
  const adjustmentTotal = input.adjustments.reduce((sum, item) => sum + item.amount, 0);
  const additions = adjustmentTotal + input.additionalLabor + input.additionalMaterials;
  let beforeDiscount: number;
  let recurringDiscount: number;
  let recurringDiscountPercent: number;
  let manualDiscount: number;
  let taxes: number;
  let perVisitTotal: number;
  let recurringPricingRuleId:string|null;
  let recurringPricingRuleName:string|null;
  let baseEstimateAmount:number;

  if (input.estimate) {
    recurringDiscount = input.estimate.recurringDiscount ?? 0;
    recurringDiscountPercent = input.estimate.recurringDiscountPercent ?? 0;
    const inheritedManualDiscount = input.estimate.manualDiscount ?? 0;
    taxes = input.estimate.taxes ?? 0;
    baseEstimateAmount = Math.max(0, input.estimate.finalPrice - taxes + recurringDiscount + inheritedManualDiscount);
    beforeDiscount = baseEstimateAmount + additions;
    manualDiscount = beforeDiscount * clamp(input.manualDiscountPercent) / 100;
    perVisitTotal = Math.max(0, beforeDiscount - recurringDiscount - inheritedManualDiscount - manualDiscount + taxes);
    recurringPricingRuleId=input.estimate.recurringPricingRuleId??null;
    recurringPricingRuleName=input.estimate.recurringPricingRuleName??null;
  } else {
    const subtotal = Math.max(0, input.catalogBasePrice ?? 0) + additions;
    const pricing = calculateRecurringTotals({ subtotal, frequency: input.frequency, customIntervalDays, rules: input.recurringRules, serviceId: input.serviceId ?? "", recurringPricingRuleId:input.recurringPricingRuleId, manualDiscountPercent: input.manualDiscountPercent });
    beforeDiscount = subtotal;
    manualDiscount = pricing.manualDiscount;
    taxes = pricing.taxes;
    perVisitTotal = pricing.finalPrice;
    recurringDiscount = pricing.recurringDiscountAmount;
    recurringDiscountPercent = pricing.recurringDiscountPercent;
    recurringPricingRuleId=pricing.recurringPricingRuleId;
    recurringPricingRuleName=pricing.recurringPricingRuleName;
    baseEstimateAmount=Math.max(0, input.catalogBasePrice ?? 0);
  }

  if (input.laborHoursOverride != null && (!Number.isFinite(input.laborHoursOverride) || input.laborHoursOverride <= 0)) throw new Error("Labor Hours must be greater than 0.");
  if (input.crewSizeOverride != null && (!Number.isInteger(input.crewSizeOverride) || input.crewSizeOverride < 1)) throw new Error("Crew Size must be a positive whole number.");
  const recommendedLaborHours = Math.round(((input.estimate?.laborHours ?? 0) + input.additionalLabor / 25) * 10) / 10;
  const recommendedCrewSize = Math.max(1, input.estimate?.crewSize ?? Math.ceil(recommendedLaborHours / 4));
  const laborHours = input.laborHoursOverride ?? recommendedLaborHours;
  const crew = input.crewSizeOverride ?? recommendedCrewSize;
  const duration = Math.round((laborHours / crew) * 10) / 10;
  const sourceLaborHourlyCost = input.estimate && input.estimate.laborHours > 0 ? input.estimate.laborCost / input.estimate.laborHours : 0;
  const laborOverrideCostDelta = (laborHours - recommendedLaborHours) * sourceLaborHourlyCost;
  const costs = (input.estimate?.laborCost ?? 0) + (input.estimate?.supplyCost ?? 0) + input.additionalMaterials + input.additionalLabor + laborOverrideCostDelta;
  return { serviceName: input.serviceName, serviceDescription: input.serviceDescription, customIntervalDays, estimatedCleaningDays:input.estimatedCleaningDays??null, estimatedHoursPerDay:input.estimatedHoursPerDay??null, upkeepPlan: input.estimate?.upkeepPlan ?? null, baseEstimateAmount: money(baseEstimateAmount), adjustments: input.adjustments, additionalLabor: money(input.additionalLabor), additionalMaterials: money(input.additionalMaterials), recurringPricingRuleId,recurringPricingRuleName, frequencyDiscount: money(recurringDiscount), frequencyDiscountPercent: money(recurringDiscountPercent), inheritedManualDiscount: input.estimate?.manualDiscount ?? 0, manualDiscount: money(manualDiscount), taxRate: 0, taxes: money(taxes), taxFreePricing: true, perVisitTotal: money(perVisitTotal), monthlyTotal: input.estimate?.upkeepPlan ? input.estimate.upkeepPlan.monthlyPackage : estimatedMonthlyTotal(perVisitTotal, input.frequency, customIntervalDays), recommendedLaborHours, laborHoursOverride:input.laborHoursOverride??null, laborHours: Math.round(laborHours * 10) / 10, recommendedCrewSize, crewSizeOverride:input.crewSizeOverride??null, crewRecommendation: crew, estimatedDuration: duration, estimatedProfit: money(perVisitTotal - costs), scope: input.scope, terms: input.terms };
}

function clamp(value: number): number { return Math.min(100, Math.max(0, value || 0)); }
function money(value: number): number { return Math.round(value * 100) / 100; }
