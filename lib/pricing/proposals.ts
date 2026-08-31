import type { EstimateResult, Frequency } from "@/types/estimate";
import type { ProposalAdjustment, ProposalResult, ProposalScopeItem, ProposalTerms } from "@/types/proposal";
import { estimatedMonthlyTotal } from "@/lib/scheduling/frequency";
import { calculateRecurringTotals } from "@/lib/pricing/pricingEngine";
import type { RecurringPricingRule } from "@/types/serviceCatalog";
import { withAuthoritativeEstimatePrice } from "@/lib/pricing/authoritativePrice";

export function repriceEstimateFrequency(estimate: EstimateResult, frequency: Frequency, rules: RecurringPricingRule[], serviceId: string, recurringPricingRuleId?:string|null): EstimateResult {
  const pricing = calculateRecurringTotals({ subtotal: estimate.oneTimePrice, frequency, rules, serviceId, recurringPricingRuleId, manualDiscountAmount: estimate.manualDiscount });
  return withAuthoritativeEstimatePrice({ ...estimate, calculatedFinalPrice:pricing.finalPrice, recurringPricingRuleId:pricing.recurringPricingRuleId,recurringPricingRuleName:pricing.recurringPricingRuleName, recurringDiscount: pricing.recurringDiscountAmount, recurringDiscountPercent: pricing.recurringDiscountPercent, totalDiscount: money(pricing.recurringDiscountAmount + pricing.manualDiscount), taxes: pricing.taxes, finalPrice: pricing.finalPrice, monthlyPrice: pricing.monthlyPrice, calculatorInput: { ...estimate.calculatorInput, frequency,recurringPricingRuleId:pricing.recurringPricingRuleId } },estimate.manualPrice??null);
}

export function calculateProposal(input: { estimate: EstimateResult | null; catalogBasePrice?: number; recurringRules: RecurringPricingRule[]; recurringPricingRuleId?:string|null; serviceId?: string; serviceName: string; serviceDescription: string | null; frequency: Frequency; adjustments: ProposalAdjustment[]; additionalLabor: number; additionalMaterials: number; manualDiscountPercent: number; scope: ProposalScopeItem[]; terms: ProposalTerms }): ProposalResult {
  const adjustmentTotal = input.adjustments.reduce((sum, item) => sum + (item.inherited ? 0 : item.amount), 0);
  const additions = adjustmentTotal + input.additionalLabor + input.additionalMaterials;
  let beforeDiscount: number;
  let recurringDiscount: number;
  let recurringDiscountPercent: number;
  let manualDiscount: number;
  let taxes: number;
  let perVisitTotal: number;
  let recurringPricingRuleId:string|null;
  let recurringPricingRuleName:string|null;

  if (input.estimate) {
    beforeDiscount = Math.max(0, input.estimate.finalPrice) + additions;
    manualDiscount = beforeDiscount * clamp(input.manualDiscountPercent) / 100;
    taxes = 0;
    perVisitTotal = Math.max(0, beforeDiscount - manualDiscount);
    recurringDiscount = input.estimate.recurringDiscount;
    recurringDiscountPercent = input.estimate.recurringDiscountPercent;
    recurringPricingRuleId=input.estimate.recurringPricingRuleId??null;
    recurringPricingRuleName=input.estimate.recurringPricingRuleName??null;
  } else {
    const subtotal = Math.max(0, input.catalogBasePrice ?? 0) + additions;
    const pricing = calculateRecurringTotals({ subtotal, frequency: input.frequency, rules: input.recurringRules, serviceId: input.serviceId ?? "", recurringPricingRuleId:input.recurringPricingRuleId, manualDiscountPercent: input.manualDiscountPercent });
    beforeDiscount = subtotal;
    manualDiscount = pricing.manualDiscount;
    taxes = pricing.taxes;
    perVisitTotal = pricing.finalPrice;
    recurringDiscount = pricing.recurringDiscountAmount;
    recurringDiscountPercent = pricing.recurringDiscountPercent;
    recurringPricingRuleId=pricing.recurringPricingRuleId;
    recurringPricingRuleName=pricing.recurringPricingRuleName;
  }

  const laborHours = (input.estimate?.laborHours ?? 0) + input.additionalLabor / 25;
  const crew = Math.max(1, input.estimate?.crewSize ?? Math.ceil(laborHours / 4));
  const duration = Math.round((laborHours / crew) * 10) / 10;
  const costs = (input.estimate?.laborCost ?? 0) + (input.estimate?.supplyCost ?? 0) + input.additionalMaterials + input.additionalLabor;
  return { serviceName: input.serviceName, serviceDescription: input.serviceDescription, baseEstimateAmount: money(input.estimate?.finalPrice ?? input.catalogBasePrice ?? beforeDiscount), adjustments: input.adjustments, additionalLabor: money(input.additionalLabor), additionalMaterials: money(input.additionalMaterials), recurringPricingRuleId,recurringPricingRuleName, frequencyDiscount: money(recurringDiscount), frequencyDiscountPercent: money(recurringDiscountPercent), inheritedManualDiscount: input.estimate?.manualDiscount ?? 0, manualDiscount: money(manualDiscount), taxRate: 0, taxes: money(taxes), taxFreePricing: true, perVisitTotal: money(perVisitTotal), monthlyTotal: estimatedMonthlyTotal(perVisitTotal, input.frequency), laborHours: Math.round(laborHours * 10) / 10, crewRecommendation: crew, estimatedDuration: duration, estimatedProfit: money(perVisitTotal - costs), scope: input.scope, terms: input.terms };
}

function clamp(value: number): number { return Math.min(100, Math.max(0, value || 0)); }
function money(value: number): number { return Math.round(value * 100) / 100; }
