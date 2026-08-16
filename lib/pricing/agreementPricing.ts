import { applyRecurringRule } from "@/lib/pricing/pricingEngine";
import type { AgreementFrequency, AgreementPricingSnapshot } from "@/types/agreement";
import type { ProposalWithRelations } from "@/types/proposal";
import type { RecurringPricingRule } from "@/types/serviceCatalog";
import { estimatedMonthlyTotal } from "@/lib/scheduling/frequency";

const supported = new Set<AgreementFrequency>(["One-Time", "Daily", "Weekly", "Biweekly", "Monthly"]);

export function proposalAgreementPricing(proposal: ProposalWithRelations): AgreementPricingSnapshot {
  const estimate = proposal.estimate?.result;
  return make({
    source: "Accepted Proposal",
    standard: estimate?.oneTimePrice ?? proposal.result.baseEstimateAmount,
    frequency: proposal.frequency,
    frequencyDiscount: proposal.result.frequencyDiscount ?? estimate?.recurringDiscount ?? 0,
    frequencyPercent: proposal.result.frequencyDiscountPercent ?? estimate?.recurringDiscountPercent ?? 0,
    customDiscount: (proposal.result.inheritedManualDiscount ?? estimate?.manualDiscount ?? 0) + proposal.result.manualDiscount,
    taxes: (estimate?.taxes ?? 0) + proposal.result.taxes,
    final: proposal.result.perVisitTotal,
    monthly: proposal.result.monthlyTotal,
  });
}

export function catalogAgreementPricing(input: { standardPrice:number; frequency:AgreementFrequency; serviceId:string; rules:RecurringPricingRule[]; customDiscount?:number; taxes?:number }): AgreementPricingSnapshot {
  const recurring = supported.has(input.frequency)
    ? applyRecurringRule(input.standardPrice, input.frequency, input.rules, input.serviceId)
    : { amount: input.standardPrice, discount: 0, percent: 0 };
  const customDiscount=Math.max(0,input.customDiscount??0),taxes=Math.max(0,input.taxes??0);
  const final = round(Math.max(0,recurring.amount-customDiscount)+taxes);
  return make({ source:"Service Catalog", standard:input.standardPrice, frequency:input.frequency, frequencyDiscount:recurring.discount, frequencyPercent:recurring.percent, customDiscount, taxes, final, monthly:estimatedMonthlyTotal(final,input.frequency) });
}

function make(values:{source:AgreementPricingSnapshot["source"];standard:number;frequency:AgreementFrequency;frequencyDiscount:number;frequencyPercent:number;customDiscount:number;taxes:number;final:number;monthly:number|null}):AgreementPricingSnapshot {
  return { source:values.source, standard_service_price:round(values.standard), frequency:values.frequency, frequency_discount_label:`${values.frequency} Service Discount`, frequency_discount_percent:round(values.frequencyPercent), frequency_discount_amount:round(values.frequencyDiscount), price_after_frequency_discount:round(Math.max(0,values.standard-values.frequencyDiscount)), custom_discount_amount:round(values.customDiscount), taxes:round(values.taxes), final_per_visit_price:round(values.final), estimated_monthly_total:values.monthly===null?null:round(values.monthly), captured_at:new Date().toISOString() };
}
const round=(value:number)=>Math.round(Number(value||0)*100)/100;
