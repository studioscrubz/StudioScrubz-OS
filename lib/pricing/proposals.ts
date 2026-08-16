import type { EstimateResult, Frequency } from "@/types/estimate";
import type { ProposalAdjustment, ProposalResult, ProposalScopeItem, ProposalTerms } from "@/types/proposal";
import { estimatedMonthlyTotal } from "@/lib/scheduling/frequency";
import { calculateRecurringTotals } from "@/lib/pricing/pricingEngine";
import type { RecurringPricingRule } from "@/types/serviceCatalog";

export function repriceEstimateFrequency(estimate: EstimateResult, frequency: Frequency, rules: RecurringPricingRule[], serviceId: string): EstimateResult {
  const pricing = calculateRecurringTotals({ subtotal: estimate.oneTimePrice, frequency, rules, serviceId, manualDiscountAmount: estimate.manualDiscount, taxRatePercent: estimate.calculatorInput.taxRatePercent });
  return { ...estimate, recurringDiscount: pricing.recurringDiscountAmount, recurringDiscountPercent: pricing.recurringDiscountPercent, totalDiscount: money(pricing.recurringDiscountAmount + pricing.manualDiscount), taxes: pricing.taxes, finalPrice: pricing.finalPrice, monthlyPrice: pricing.monthlyPrice, calculatorInput: { ...estimate.calculatorInput, frequency } };
}

export function calculateProposal(input: { estimate: EstimateResult | null; catalogBasePrice?: number; recurringRules: RecurringPricingRule[]; serviceId?: string; serviceName: string; serviceDescription: string | null; frequency: Frequency; adjustments: ProposalAdjustment[]; additionalLabor: number; additionalMaterials: number; manualDiscountPercent: number; taxRate: number; scope: ProposalScopeItem[]; terms: ProposalTerms }): ProposalResult {
  const adjustmentTotal = input.adjustments.reduce((sum, item) => sum + (item.inherited ? 0 : item.amount), 0);
  const additions = adjustmentTotal + input.additionalLabor + input.additionalMaterials;
  let beforeDiscount: number;
  let recurringDiscount: number;
  let recurringDiscountPercent: number;
  let manualDiscount: number;
  let taxes: number;
  let perVisitTotal: number;

  if (input.estimate) {
    beforeDiscount = input.estimate.finalPrice + additions;
    manualDiscount = beforeDiscount * clamp(input.manualDiscountPercent) / 100;
    const taxable = Math.max(0, beforeDiscount - manualDiscount);
    taxes = taxable * clamp(input.taxRate) / 100;
    perVisitTotal = taxable + taxes;
    recurringDiscount = input.estimate.recurringDiscount;
    recurringDiscountPercent = input.estimate.recurringDiscountPercent;
  } else {
    const subtotal = Math.max(0, input.catalogBasePrice ?? 0) + additions;
    const pricing = calculateRecurringTotals({ subtotal, frequency: input.frequency, rules: input.recurringRules, serviceId: input.serviceId ?? "", manualDiscountPercent: input.manualDiscountPercent, taxRatePercent: input.taxRate });
    beforeDiscount = subtotal;
    manualDiscount = pricing.manualDiscount;
    taxes = pricing.taxes;
    perVisitTotal = pricing.finalPrice;
    recurringDiscount = pricing.recurringDiscountAmount;
    recurringDiscountPercent = pricing.recurringDiscountPercent;
  }

  const laborHours = (input.estimate?.laborHours ?? 0) + input.additionalLabor / 25;
  const crew = Math.max(1, input.estimate?.crewSize ?? Math.ceil(laborHours / 4));
  const duration = Math.round((laborHours / crew) * 10) / 10;
  const costs = (input.estimate?.laborCost ?? 0) + (input.estimate?.supplyCost ?? 0) + input.additionalMaterials + input.additionalLabor;
  return { serviceName: input.serviceName, serviceDescription: input.serviceDescription, baseEstimateAmount: money(input.estimate?.oneTimePrice ?? input.catalogBasePrice ?? beforeDiscount), adjustments: input.adjustments, additionalLabor: money(input.additionalLabor), additionalMaterials: money(input.additionalMaterials), frequencyDiscount: money(recurringDiscount), frequencyDiscountPercent: money(recurringDiscountPercent), inheritedManualDiscount: input.estimate?.manualDiscount ?? 0, manualDiscount: money(manualDiscount), taxRate: input.taxRate, taxes: money(taxes), perVisitTotal: money(perVisitTotal), monthlyTotal: estimatedMonthlyTotal(perVisitTotal, input.frequency), laborHours: Math.round(laborHours * 10) / 10, crewRecommendation: crew, estimatedDuration: duration, estimatedProfit: money(perVisitTotal - costs), scope: input.scope, terms: input.terms };
}

function clamp(value: number): number { return Math.min(100, Math.max(0, value || 0)); }
function money(value: number): number { return Math.round(value * 100) / 100; }
