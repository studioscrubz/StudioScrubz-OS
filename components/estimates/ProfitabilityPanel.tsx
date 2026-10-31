"use client";

import { useEffect, useRef, useState } from "react";
import { validateManualTravelOverride } from "@/lib/pricing/profitability";
import { calculateTravelProjection } from "@/lib/services/profitability";
import type { ProfitabilityAdjustments, ProfitabilityProjection, ProfitabilitySettings, TravelProjection } from "@/types/profitability";

export function ProfitabilityPanel({ projection, settings, destination, editable, priceEditable, integratedProjectCosts, projectPrice, onTravelChange, onAdjustmentsChange }: {
  projection: ProfitabilityProjection;
  settings?: ProfitabilitySettings;
  destination?: string;
  editable?: boolean;
  priceEditable?: boolean;
  integratedProjectCosts?: boolean;
  projectPrice?: {
    manualPrice: number | null;
    calculatedPrice: number;
    onChange: (amount: number | null) => void;
    title?: string;
    artifactLabel?: string;
    unitLabel?: string;
    canApplyMinimum?: boolean;
    minimumUnavailableReason?: string;
  };
  onTravelChange?: (value: TravelProjection) => void;
  onAdjustmentsChange?: (value: ProfitabilityAdjustments) => void;
}) {
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const lastDestination = useRef("");
  const travel = projection.travel;
  const adjustments: ProfitabilityAdjustments = {
    equipment: projection.directCosts.equipment,
    subcontractors: projection.directCosts.subcontractors,
    setupLabor: projection.directCosts.setupLabor ?? 0,
    ownerLabor: projection.directCosts.ownerLabor ?? 0,
    parkingTolls: projection.directCosts.parkingTolls ?? 0,
    disposal: projection.directCosts.disposal ?? 0,
    paymentProcessingFees: projection.operatingCosts?.paymentProcessingFees ?? 0,
    salesCommissions: projection.operatingCosts?.salesCommissions ?? 0,
    allocatedOverhead: projection.operatingCosts?.allocatedOverhead ?? 0,
    otherDirectExpenses: projection.directCosts.other,
  };
  const route = async () => {
    if (!destination?.trim() || !onTravelChange || routing) return;
    setRouting(true); setRouteError(null);
    try { onTravelChange({ ...(await calculateTravelProjection(destination)), travelingEmployeeCount: projection.cleanerCount }); }
    catch (error) { setRouteError(error instanceof Error ? error.message : "Travel could not be calculated. Enter a manual override."); }
    finally { setRouting(false); }
  };
  const updateExpense = (key: keyof ProfitabilityAdjustments, raw: string) => {
    const next = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(next) || next < 0) return;
    onAdjustmentsChange?.({ ...adjustments, [key]: next });
  };
  const updateManualTravel = (field: "roundTripMiles" | "roundTripMinutes", raw: string) => {
    if (!onTravelChange) return;
    const value = raw === "" ? null : Number(raw);
    const next = { ...travel, [field]: value };
    try {
      const valid = validateManualTravelOverride(next);
      setRouteError(null);
      onTravelChange({ ...next, verification: "Manual", provider: "Manual", roundTripMiles: valid.miles, roundTripMinutes: valid.minutes, warning: "Manual travel override; confirm against route evidence.", calculatedAt: new Date().toISOString() });
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "Correct the manual travel values.");
      onTravelChange({ ...next, verification: "Unverified", provider: null, warning: "Manual travel override is incomplete or invalid.", calculatedAt: null });
    }
  };
  useEffect(() => {
    if (!editable || !settings || !destination?.trim() || travel.verification === "Manual" || lastDestination.current === destination) return;
    const timer = window.setTimeout(() => { lastDestination.current = destination; void route(); }, 700);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Route changes are intentionally keyed to the address, never price edits.
  }, [destination, editable, settings, travel.verification]);

  return <section className="rounded-2xl border border-[#143d1a]/15 bg-[#f7f9f6] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-extrabold text-[#143d1a]">Internal Profitability</h2><p className="mt-1 text-sm text-neutral-600">{projection.periodLabel}. Internal costs are never included in customer documents.</p></div>{projection.belowTargetMargin && <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-extrabold text-red-800">Below Target Margin</span>}</div>
    <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{[
      ["Estimated cleaners", String(projection.cleanerCount)], ["Hours per cleaner", hours(projection.hoursPerCleaner)],
      ["Estimated labor hours", hours(projection.estimatedLaborHours)],
      ...(projection.projectDays != null
        ? [["Planned project days", String(projection.projectDays)], ["Round-trip travel days", String(projection.roundTripsPerPeriod ?? projection.projectDays)]]
        : [["Visits in quoted period", String(projection.visitsPerPeriod ?? 1)]]), ["Base wage", money(projection.hourlyWage)],
      ["Projected W-2 burden", percent(projection.employerBurdenRate)], ["Loaded labor rate", money(projection.loadedHourlyLaborCost)],
      ["Loaded cleaning labor", money(projection.directCosts.loadedCleaningLabor)], ["Supplies", money(projection.directCosts.supplies)],
      [integratedProjectCosts ? "Additional equipment outside project quote" : "Equipment", money(projection.directCosts.equipment)], ["Subcontractors", money(projection.directCosts.subcontractors)],
      ["Other direct expenses", money(projection.directCosts.other)],
      ["Setup and loading labor", money(projection.directCosts.setupLabor ?? 0)],
      ["Owner labor", money(projection.directCosts.ownerLabor ?? 0)],
      ["Parking and tolls", money(projection.directCosts.parkingTolls ?? 0)],
      ["Disposal and debris", money(projection.directCosts.disposal ?? 0)], ["Vehicle expense", maybeMoney(projection.directCosts.vehicleOperating)],
      ["Paid travel labor", maybeMoney(projection.directCosts.compensableTravelLabor)], ["Legacy travel logistics", money(projection.directCosts.legacyTravelLogistics)],
      [integratedProjectCosts ? "Project costs already included in quote" : "Existing post-construction project costs", money(projection.directCosts.legacyProjectCosts ?? 0)], ["Total estimated job cost", maybeMoney(projection.totalEstimatedDirectCost)],
      ["Proposed customer price", money(projection.price)], ["Projected gross profit", maybeMoney(projection.grossProfit)],
      ["Projected gross margin", maybePercent(projection.grossMarginPercent)],
      ["Payment processing fees", money(projection.operatingCosts?.paymentProcessingFees ?? 0)],
      ["Sales commissions (deducted)", `-${money(projection.operatingCosts?.salesCommissions ?? 0)}`],
      ["Customer price after commission", money(projection.price - (projection.operatingCosts?.salesCommissions ?? 0))],
      ["Contribution profit", maybeMoney(projection.contributionProfit ?? null)],
      ["Contribution margin", maybePercent(projection.contributionMarginPercent ?? null)],
      ["Allocated overhead", money(projection.operatingCosts?.allocatedOverhead ?? 0)],
      ["Estimated operating profit", maybeMoney(projection.operatingProfit ?? null)],
      ["Estimated operating margin", maybePercent(projection.operatingMarginPercent ?? null)], ["Target gross margin", percent(projection.targetGrossMarginPercent)],
      ["Recommended minimum (includes commission, fees and overhead)", maybeMoney(projection.recommendedMinimumPrice)], ["Difference to target", maybeMoney(projection.differenceToRecommendedMinimum)],
    ].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b border-[#143d1a]/10 py-1.5"><dt className="text-neutral-600">{label}</dt><dd className="text-right font-bold text-[#143d1a]">{value}</dd></div>)}</dl>
    <div className={`mt-4 rounded-lg border p-3 text-sm ${projection.travelCostsVerified ? "border-[#143d1a]/15 bg-white" : "border-amber-300 bg-amber-50 text-amber-900"}`}><p className="font-bold">Travel: {travel.verification}</p><p className="mt-1">{travel.roundTripMiles == null ? "Mileage and duration require a verified route or manual override." : `${travel.roundTripMiles.toFixed(2)} round-trip miles · ${travel.roundTripMinutes?.toFixed(1) ?? "—"} minutes · ${travel.vehicleCount} vehicle${travel.vehicleCount === 1 ? "" : "s"}`}</p>{travel.warning && <p className="mt-1">{travel.warning}</p>}</div>
    {editable && settings && <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Manual round-trip miles<input type="number" min="0" step="0.01" value={travel.roundTripMiles ?? ""} onChange={(event) => updateManualTravel("roundTripMiles", event.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal" /></label><label className="text-sm font-bold">Manual round-trip minutes<input type="number" min="0" step="0.1" value={travel.roundTripMinutes ?? ""} onChange={(event) => updateManualTravel("roundTripMinutes", event.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal" /></label><label className="text-sm font-bold">Vehicles for this job<input type="number" min="1" step="1" value={travel.vehicleCount} onChange={(event) => onTravelChange?.({ ...travel, vehicleCount: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal" /></label><div className="sm:col-span-2 mt-2 font-bold text-[#143d1a]">Internal expense assumptions (amounts for the quoted period)</div>{([
      ["equipment", integratedProjectCosts ? "Additional equipment outside quoted project expenses (if any)" : "Equipment and rentals"],
      ["subcontractors", "Subcontractor costs"],
      ["setupLabor", "Setup / loading / cleanup labor"],
      ["ownerLabor", "Owner labor (not already in cleaner count)"],
      ["parkingTolls", "Parking and tolls"],
      ["disposal", "Disposal and debris"],
      ["paymentProcessingFees", "Payment processing fees"],
      ["salesCommissions", "Sales and lead commissions"],
      ["allocatedOverhead", "Allocated operating overhead"],
      ["otherDirectExpenses", "Other direct expenses"],
    ] as const).filter(([key]) => !integratedProjectCosts || key !== "equipment" || adjustments.equipment > 0).map(([key, label]) => <label key={key} className="text-sm font-bold">{label}<input type="number" min="0" step="0.01" value={adjustments[key]} onChange={(event) => updateExpense(key, event.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal" /></label>) }<div className="sm:col-span-2"><button type="button" disabled={routing || !destination?.trim()} onClick={() => void route()} className="rounded-lg border border-[#143d1a]/30 bg-white px-4 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-50">{routing ? "Calculating travel..." : "Recalculate driving route"}</button>{routeError && <p role="alert" className="mt-2 text-sm text-red-700">{routeError}</p>}</div></div>}
    {!editable && projectPrice && <div className="mt-4 rounded-xl border border-[#143d1a]/10 bg-white p-4">
      <h3 className="text-sm font-bold text-[#143d1a]">Internal expense assumptions (amounts for the quoted period)</h3>
      <p className="mt-1 text-xs text-neutral-600">These expenses were inherited from the linked estimate and are read-only here. Edit the linked estimate to revise the underlying expenses.</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{([
        ["Equipment and rentals", adjustments.equipment], ["Subcontractor costs", adjustments.subcontractors],
        ["Setup / loading / cleanup labor", adjustments.setupLabor], ["Owner labor", adjustments.ownerLabor],
        ["Parking and tolls", adjustments.parkingTolls], ["Disposal and debris", adjustments.disposal],
        ["Payment processing fees", adjustments.paymentProcessingFees], ["Sales and lead commissions", adjustments.salesCommissions],
        ["Allocated operating overhead", adjustments.allocatedOverhead], ["Other direct expenses", adjustments.otherDirectExpenses],
      ] as const).map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b border-neutral-100 py-1.5"><dt className="text-neutral-600">{label}</dt><dd className="font-bold text-[#143d1a]">{money(value)}</dd></div>)}</dl>
    </div>}
    {projectPrice && (editable || priceEditable) && <div className="mt-4 rounded-xl border border-[#143d1a]/20 bg-white p-4">
      <h3 className="text-sm font-extrabold text-[#143d1a]">{projectPrice.title ?? "Post-Construction Estimate Price"}</h3>
      <p className="mt-1 text-xs text-neutral-600">Edit the customer estimate here after reviewing the costs for the quoted period. Your chosen price updates profitability immediately and is saved when you select Save Estimate or Update Estimate.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><p className="text-xs font-semibold text-neutral-600">Original calculated bid</p><p className="font-bold text-[#143d1a]">{money(projectPrice.calculatedPrice)}</p></div>
        <div><p className="text-xs font-semibold text-neutral-600">Profitability minimum</p><p className="font-bold text-[#143d1a]">{maybeMoney(projection.recommendedMinimumPrice)}</p></div>
      </div>
      <label className="mt-3 block text-sm font-bold text-[#143d1a]">Manual / Custom Estimate Amount{projectPrice.unitLabel ? ` (${projectPrice.unitLabel})` : ""}
        <input aria-label="Manual or custom Post-Construction estimate amount" type="number" min="0.01" step="0.01"
          value={projectPrice.manualPrice ?? ""} placeholder={String(projectPrice.calculatedPrice)}
          onChange={event => {
            const raw = event.target.value;
            if (!raw) { projectPrice.onChange(null); return; }
            const next = Number(raw);
            if (Number.isFinite(next) && next > 0) projectPrice.onChange(next);
          }}
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-normal"/>
      </label>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button"
          disabled={projectPrice.canApplyMinimum === false || projection.recommendedMinimumPrice == null || !Number.isFinite(projection.recommendedMinimumPrice) || projection.recommendedMinimumPrice <= 0}
          onClick={() => {
            const minimum = projection.recommendedMinimumPrice;
            if (projectPrice.canApplyMinimum !== false && minimum != null && Number.isFinite(minimum) && minimum > 0) projectPrice.onChange(minimum);
          }}
          className="rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
          Use Profitability Minimum
        </button>
        <button type="button" disabled={projectPrice.manualPrice === null} onClick={() => projectPrice.onChange(null)}
          className="rounded-lg border border-[#143d1a]/30 px-4 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-40">
          Use Original Calculated Bid
        </button>
      </div>
      <p className="mt-3 text-sm text-neutral-600">Current customer {projectPrice.artifactLabel ?? "estimate"} amount: <strong className="text-[#143d1a]">{money(projection.price)}</strong>. This change is not saved until you save or update the {projectPrice.artifactLabel ?? "estimate"}.</p>
      {projectPrice.canApplyMinimum === false && <p className="mt-2 text-xs font-semibold text-amber-900">{projectPrice.minimumUnavailableReason ?? "This contract has individually priced visits. Adjust each visit before saving."}</p>}
      {projection.recommendedMinimumPrice == null && <p className="mt-2 text-xs font-semibold text-amber-900">Verify travel and job costs before applying the profitability minimum. Manual pricing remains available.</p>}
    </div>}
    {integratedProjectCosts && <p className="mt-3 text-xs font-semibold text-neutral-600">Equipment, supervision, contingency, and additional travel/logistics entered in Project Cost Details are already included in the customer quote and the profitability calculation. Do not enter them twice. All other inputs here are additional project expenses.</p>}
    {settings?.vehicleOperatingRatePerMile == null && <p className="mt-3 text-sm font-semibold text-amber-900">Driving distance is verified, but vehicle cost and margin remain unverified until you set a vehicle operating rate per mile in Business Settings.</p>}
    <p className="mt-3 text-xs text-neutral-600">Commissions are deducted from projected earnings. The recommended minimum covers direct costs, entered commission, payment fees and overhead before applying the configured target margin. Enter the full expected commission for the quoted period; zero is treated as $0, not automatically verified. The customer-facing estimate is not changed automatically.</p>
    {!projection.costComplete && <p role="status" className="mt-3 text-sm font-semibold text-amber-900">Travel costs are incomplete and are excluded from the margin result until a route or manual override and vehicle operating rate are configured.</p>}
  </section>;
}

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const maybeMoney = (value: number | null) => value == null ? "Unverified" : money(value);
const percent = (value: number) => `${value.toFixed(1)}%`;
const maybePercent = (value: number | null) => value == null ? "Unverified" : percent(value);
const hours = (value: number) => `${value.toFixed(2)} h`;
