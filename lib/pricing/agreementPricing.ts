import { calculateRecurringTotals } from "@/lib/pricing/pricingEngine";
import type { AgreementFrequency, AgreementPricingSnapshot } from "@/types/agreement";
import type { ProposalWithRelations } from "@/types/proposal";
import type { RecurringPricingRule } from "@/types/serviceCatalog";

export function proposalAgreementPricing(proposal: ProposalWithRelations): AgreementPricingSnapshot {
  const estimate = proposal.estimate?.result;
  return make({
    source: "Accepted Proposal",
    serviceDescription: proposal.result.serviceDescription?.trim() || proposal.walkthrough?.measurements.serviceDescription?.trim() || proposal.estimate?.result.serviceDescription?.trim() || null,
    standard: estimate?.oneTimePrice ?? proposal.result.baseEstimateAmount,
    frequency: proposal.frequency,
    recurringRuleId:proposal.result.recurringPricingRuleId??null,
    recurringRuleName:proposal.result.recurringPricingRuleName??null,
    frequencyDiscount: proposal.result.frequencyDiscount ?? estimate?.recurringDiscount ?? 0,
    frequencyPercent: proposal.result.frequencyDiscountPercent ?? estimate?.recurringDiscountPercent ?? 0,
    customDiscount: (proposal.result.inheritedManualDiscount ?? estimate?.manualDiscount ?? 0) + proposal.result.manualDiscount,
    taxes: proposal.result.taxFreePricing ? proposal.result.taxes : (estimate?.taxes ?? 0) + proposal.result.taxes,
    final: proposal.result.perVisitTotal,
    monthly: proposal.result.monthlyTotal,
    upkeepPlan: proposal.result.upkeepPlan ? { standard_cleaning_value: proposal.result.upkeepPlan.standardCleaningValue, adjustment_percent: proposal.result.upkeepPlan.adjustmentPercent, upkeep_visit_value: proposal.result.upkeepPlan.upkeepVisitValue, visits_included: 3, monthly_package: proposal.result.upkeepPlan.monthlyPackage } : null,
    // Preserve every explicitly purchased proposal add-on in the immutable
    // agreement pricing snapshot. The legacy property name also holds custom
    // add-ons; labor/material inputs remain separate internal pricing inputs.
    catalogAddons:proposal.result.adjustments,
  });
}

export function catalogAgreementPricing(input: { standardPrice:number; frequency:AgreementFrequency; serviceId:string; rules:RecurringPricingRule[]; recurringPricingRuleId?:string|null;customDiscount?:number; serviceDescription?:string|null }): AgreementPricingSnapshot {
  const pricing=calculateRecurringTotals({subtotal:input.standardPrice,frequency:input.frequency,rules:input.rules,serviceId:input.serviceId,recurringPricingRuleId:input.recurringPricingRuleId,manualDiscountAmount:Math.max(0,input.customDiscount??0)});
  return make({ source:"Service Catalog", serviceDescription:input.serviceDescription?.trim()||null, standard:input.standardPrice, frequency:input.frequency, recurringRuleId:pricing.recurringPricingRuleId,recurringRuleName:pricing.recurringPricingRuleName,frequencyDiscount:pricing.recurringDiscountAmount, frequencyPercent:pricing.recurringDiscountPercent, customDiscount:pricing.manualDiscount, taxes:pricing.taxes, final:pricing.finalPrice, monthly:pricing.monthlyPrice });
}

function make(values:{source:AgreementPricingSnapshot["source"];serviceDescription?:string|null;standard:number;frequency:AgreementFrequency;recurringRuleId?:string|null;recurringRuleName?:string|null;frequencyDiscount:number;frequencyPercent:number;customDiscount:number;taxes:number;final:number;monthly:number|null;upkeepPlan?:AgreementPricingSnapshot["upkeep_plan"];catalogAddons?:AgreementPricingSnapshot["catalog_addons"]}):AgreementPricingSnapshot {
  return { source:values.source, service_description:values.serviceDescription?.trim()||null, standard_service_price:round(values.standard), frequency:values.frequency, recurring_pricing_rule_id:values.recurringRuleId??null,recurring_pricing_rule_name:values.recurringRuleName??null, frequency_discount_label:values.recurringRuleName||`${values.frequency} Service Discount`, frequency_discount_percent:round(values.frequencyPercent), frequency_discount_amount:round(values.frequencyDiscount), price_after_frequency_discount:round(Math.max(0,values.standard-values.frequencyDiscount)), custom_discount_amount:round(values.customDiscount), taxes:round(values.taxes), final_per_visit_price:round(values.final), estimated_monthly_total:values.monthly===null?null:round(values.monthly), upkeep_plan:values.upkeepPlan??null, captured_at:new Date().toISOString(),catalog_addons:values.catalogAddons??[] };
}
const round=(value:number)=>Math.round(Number(value||0)*100)/100;
