"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { canAccessFinances } from "@/lib/auth/permissions";
import { getProfitabilitySettings } from "@/lib/services/profitability";
import { calculatePorterProfitability } from "@/lib/pricing/porterProfitability";
import { emptyProfitabilityAdjustments, type ProfitabilityAdjustments, type ProfitabilitySettings } from "@/types/profitability";
import type { PorterServicePricingSnapshot } from "@/types/propertyServicePlan";

const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const labels: Array<[keyof ProfitabilityAdjustments, string]> = [
  ["equipment", "Equipment and rentals (monthly)"],
  ["subcontractors", "Subcontractors (monthly)"],
  ["setupLabor", "Setup / loading labor (monthly)"],
  ["ownerLabor", "Owner labor (monthly, not in porter hours)"],
  ["parkingTolls", "Parking and tolls (monthly)"],
  ["disposal", "Disposal and debris (monthly)"],
  ["paymentProcessingFees", "Payment processing fees (monthly)"],
  ["salesCommissions", "Sales and lead commissions (monthly)"],
  ["allocatedOverhead", "Additional overhead (excluding supervision above)"],
  ["otherDirectExpenses", "Other direct expenses (monthly)"],
];

/** This panel is internal-only; these assumptions are never copied to a plan pricing snapshot. */
export function PorterProfitabilityPanel({ pricing }: { pricing: PorterServicePricingSnapshot }) {
  const { profile } = useAuth();
  const authorized = canAccessFinances(profile);
  const [settings, setSettings] = useState<ProfitabilitySettings | null>(null);
  const [error, setError] = useState("");
  const [extras, setExtras] = useState<ProfitabilityAdjustments>(emptyProfitabilityAdjustments);
  useEffect(() => {
    if (!authorized) return;
    let active = true;
    void getProfitabilitySettings().then(value => {
      if (active) { setSettings(value); setError(""); }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load profitability settings.");
    });
    return () => { active = false; };
  }, [authorized]);
  if (!authorized) return null;
  const result = settings ? calculatePorterProfitability(pricing, settings, extras) : null;
  const figures: Array<[string, string]> = result ? [
    ["Quoted monthly customer price", money(result.price)],
    ["Monthly porter hours", result.monthlyHours.toFixed(2)],
    ["Loaded wages including employer burden", money(result.loadedLabor)],
    ["Supplies already entered", money(result.supplies)],
    ["Travel expense already entered", money(result.travel)],
    ["Total direct cost", money(result.direct)],
    ["Gross profit", money(result.grossProfit)],
    ["Gross margin", String(result.grossMarginPercent ?? "—") + "%"],
    ["Payment processing fees (deducted)", "-" + money(result.processing)],
    ["Sales commissions (deducted)", "-" + money(result.commissions)],
    ["Customer price after commission", money(result.price - result.commissions)],
    ["Contribution profit", money(result.contributionProfit)],
    ["Contribution margin", String(result.contributionMarginPercent ?? "—") + "%"],
    ["Supervision/Admin plus allocated overhead", money(result.overhead)],
    ["Estimated operating profit", money(result.operatingProfit)],
    ["Operating margin", String(result.operatingMarginPercent ?? "—") + "%"],
    ["Recommended minimum including commissions and overhead", result.recommendedMinimumPrice == null ? "Unavailable" : money(result.recommendedMinimumPrice)],
    ["Additional price needed to reach target", result.differenceToTarget == null ? "Unavailable" : money(result.differenceToTarget)],
  ] : [];
  return <section className="mt-4 rounded-xl border border-[#143d1a]/20 bg-white p-4 sm:p-5" aria-label="Internal monthly profitability">
    <h3 className="text-lg font-extrabold text-[#143d1a]">Internal Profitability — Monthly Contract</h3>
    <p className="mt-1 text-sm text-neutral-600">Private financial review for Porter / Luxury Property Care. The original monthly customer price is unchanged. Internal expenses and recommendations are not added to client proposals or the saved plan.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {!result && !error && <p role="status" className="mt-3 text-sm text-neutral-600">Loading internal profitability assumptions…</p>}
    {result && <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {figures.map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-3 border-b border-neutral-200 py-2 text-sm"><span className="text-neutral-600">{label}</span><strong className="text-right text-[#143d1a]">{value}</strong></div>)}
      </div>
      <h4 className="mt-5 text-sm font-bold text-[#143d1a]">Additional monthly financial assumptions</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {labels.map(([key, label]) => <label key={key} className="text-sm font-bold">{label}<input type="number" step="0.01" min="0" value={extras[key]} onChange={event => {
          const value = Number(event.target.value);
          if (!Number.isFinite(value) || value < 0) return;
          setExtras(previous => ({ ...previous, [key]: value }));
        }} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-normal"/></label>)}
      </div>
      <p className="mt-3 text-xs text-amber-900">Expenses entered here are for this private calculation only and reset when the editor is closed. The existing monthly Travel and Supervision/Admin entries are counted once; do not duplicate them. Recurring travel is the monthly amount you entered, not a Geoapify-verified route.</p>
    </>}
  </section>;
}
