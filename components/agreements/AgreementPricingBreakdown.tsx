import type { AgreementPricingSnapshot } from "@/types/agreement";

export function AgreementPricingBreakdown({ pricing }: { pricing: AgreementPricingSnapshot | null }) {
  if (!pricing) return null;
  const rows: Array<[string, string]> = [
    ["Standard Service Price", money(pricing.standard_service_price)],
    ["Frequency", pricing.frequency],
    [pricing.frequency_discount_label, `${number(pricing.frequency_discount_percent)}%`],
    ["Frequency Discount", `-${money(pricing.frequency_discount_amount)}`],
    ["Price After Frequency Discount", money(pricing.price_after_frequency_discount)],
    ["Custom Discount", `-${money(pricing.custom_discount_amount)}`],
    ["Taxes", money(pricing.taxes)],
    ["Final Per-Visit Price", money(pricing.final_per_visit_price)],
    ["Estimated Monthly Total", pricing.estimated_monthly_total === null ? "Not applicable" : money(pricing.estimated_monthly_total)],
  ];
  return <section className="mt-6 rounded-xl border border-[#d4af37]/50 bg-[#fffdf5] p-5"><h3 className="font-extrabold text-[#143d1a]">Pricing Breakdown</h3><dl className="mt-3 divide-y divide-[#143d1a]/10">{rows.map(([label,value])=><div key={label} className="flex justify-between gap-5 py-2 text-sm"><dt className="text-neutral-600">{label}</dt><dd className="text-right font-bold">{value}</dd></div>)}</dl></section>;
}
const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
const number=(value:number)=>new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(value);
