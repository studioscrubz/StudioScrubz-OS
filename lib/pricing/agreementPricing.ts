import { calculateRecurringTotals } from "@/lib/pricing/pricingEngine";
import type { AgreementFrequency, AgreementPricingSnapshot } from "@/types/agreement";
import type { ProposalWithRelations } from "@/types/proposal";
import type { RecurringPricingRule } from "@/types/serviceCatalog";

export function proposalAgreementPricing(proposal: ProposalWithRelations): AgreementPricingSnapshot {
  const estimate = proposal.estimate?.result;
  const serviceAdjustments = proposal.result.adjustments
    .filter((item) => !item.catalogAddonId)
    .reduce((sum, item) => sum + item.amount, 0) +
    proposal.result.additionalLabor + proposal.result.additionalMaterials;
  return make({
    source: "Accepted Proposal",
    serviceDescription: proposal.result.serviceDescription?.trim() || proposal.walkthrough?.measurements.serviceDescription?.trim() || proposal.estimate?.result.serviceDescription?.trim() || null,
    // Proposal results now separate the discount-eligible service from purchased add-ons.
    // The accepted final and allocation remain authoritative for older accepted proposals.
    standard: proposal.result.baseEstimateAmount + serviceAdjustments,
    frequency: proposal.frequency,
    recurringRuleId:proposal.result.recurringPricingRuleId??null,
    recurringRuleName:proposal.result.recurringPricingRuleName??null,
    frequencyDiscount: proposal.result.frequencyDiscount ?? estimate?.recurringDiscount ?? 0,
    frequencyPercent: proposal.result.frequencyDiscountPercent ?? estimate?.recurringDiscountPercent ?? 0,
    customDiscount: (proposal.result.inheritedManualDiscount ?? estimate?.manualDiscount ?? 0) + proposal.result.manualDiscount,
    taxes: proposal.result.taxFreePricing ? proposal.result.taxes : (estimate?.taxes ?? 0) + proposal.result.taxes,
    final: proposal.result.perVisitTotal,
    monthly: proposal.result.monthlyTotal,
    acceptedPricingAllocation: proposal.result.acceptedPricingAllocation ?? null,
    estimatedCleaningDays:proposal.result.estimatedCleaningDays??null,
    estimatedHoursPerDay:proposal.result.estimatedHoursPerDay??null,
    upkeepPlan: proposal.result.upkeepPlan ? { standard_cleaning_value: proposal.result.upkeepPlan.standardCleaningValue, adjustment_percent: proposal.result.upkeepPlan.adjustmentPercent, upkeep_visit_value: proposal.result.upkeepPlan.upkeepVisitValue, visits_included: 3, monthly_package: proposal.result.upkeepPlan.monthlyPackage } : null,
    // Preserve every explicitly purchased proposal add-on in the immutable
    // agreement pricing snapshot. The legacy property name also holds custom
    // add-ons; labor/material inputs remain separate internal pricing inputs.
    catalogAddons:proposal.result.adjustments.filter((item) => Boolean(item.catalogAddonId)),
  });
}

export function agreementPricingWithAdditionalDiscount(pricing: AgreementPricingSnapshot, additionalDiscount: number): AgreementPricingSnapshot {
  if (!Number.isFinite(additionalDiscount) || additionalDiscount < 0) throw new Error("Enter a valid non-negative agreement discount.");
  const discount = Math.round(additionalDiscount * 100) / 100;
  const allocation = pricing.accepted_pricing_allocation;
  const maxDiscount = allocation ? allocation.baseServiceAmount : pricing.final_per_visit_price;
  if (discount >= maxDiscount && discount > 0) throw new Error("The agreement discount must be less than the base service price.");
  const final = Math.round((pricing.final_per_visit_price - discount) * 100) / 100;
  return {
    ...pricing,
    custom_discount_amount: Math.round((pricing.custom_discount_amount + discount) * 100) / 100,
    additional_agreement_discount_amount: Math.round(((pricing.additional_agreement_discount_amount ?? 0) + discount) * 100) / 100,
    final_per_visit_price: final,
    estimated_monthly_total: pricing.estimated_monthly_total === null || pricing.final_per_visit_price <= 0
      ? pricing.estimated_monthly_total
      : Math.round((pricing.estimated_monthly_total - discount * pricing.estimated_monthly_total / pricing.final_per_visit_price) * 100) / 100,
    accepted_pricing_allocation: allocation ? {
      ...allocation,
      baseServiceAmount: Math.round((allocation.baseServiceAmount - discount) * 100) / 100,
      totalAmount: final,
    } : allocation,
  };
}

export function catalogAgreementPricing(input: { standardPrice:number; frequency:AgreementFrequency; serviceId:string; rules:RecurringPricingRule[]; recurringPricingRuleId?:string|null;customDiscount?:number; serviceDaysOfWeek?:readonly number[]|null; serviceDescription?:string|null }): AgreementPricingSnapshot {
  const pricing=calculateRecurringTotals({subtotal:input.standardPrice,frequency:input.frequency,serviceDaysOfWeek:input.serviceDaysOfWeek,rules:input.rules,serviceId:input.serviceId,recurringPricingRuleId:input.recurringPricingRuleId,manualDiscountAmount:Math.max(0,input.customDiscount??0)});
  return make({ source:"Service Catalog", serviceDescription:input.serviceDescription?.trim()||null, standard:input.standardPrice, frequency:input.frequency, recurringRuleId:pricing.recurringPricingRuleId,recurringRuleName:pricing.recurringPricingRuleName,frequencyDiscount:pricing.recurringDiscountAmount, frequencyPercent:pricing.recurringDiscountPercent, customDiscount:pricing.manualDiscount, taxes:pricing.taxes, final:pricing.finalPrice, monthly:pricing.monthlyPrice });
}

function make(values:{source:AgreementPricingSnapshot["source"];serviceDescription?:string|null;standard:number;frequency:AgreementFrequency;recurringRuleId?:string|null;recurringRuleName?:string|null;frequencyDiscount:number;frequencyPercent:number;customDiscount:number;taxes:number;final:number;monthly:number|null;acceptedPricingAllocation?:AgreementPricingSnapshot["accepted_pricing_allocation"];estimatedCleaningDays?:number|null;estimatedHoursPerDay?:number|null;upkeepPlan?:AgreementPricingSnapshot["upkeep_plan"];catalogAddons?:AgreementPricingSnapshot["catalog_addons"]}):AgreementPricingSnapshot {
  return { source:values.source, service_description:values.serviceDescription?.trim()||null, standard_service_price:round(values.standard), frequency:values.frequency, recurring_pricing_rule_id:values.recurringRuleId??null,recurring_pricing_rule_name:values.recurringRuleName??null, frequency_discount_label:values.recurringRuleName||`${values.frequency} Service Discount`, frequency_discount_percent:round(values.frequencyPercent), frequency_discount_amount:round(values.frequencyDiscount), price_after_frequency_discount:round(Math.max(0,values.standard-values.frequencyDiscount)), custom_discount_amount:round(values.customDiscount), taxes:round(values.taxes), final_per_visit_price:round(values.final), estimated_monthly_total:values.monthly===null?null:round(values.monthly), accepted_pricing_allocation:values.acceptedPricingAllocation??null, estimated_cleaning_days:values.estimatedCleaningDays??null, estimated_hours_per_day:values.estimatedHoursPerDay??null, upkeep_plan:values.upkeepPlan??null, captured_at:new Date().toISOString(),catalog_addons:values.catalogAddons??[] };
}
const round=(value:number)=>Math.round(Number(value||0)*100)/100;
