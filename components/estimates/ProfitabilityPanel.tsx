"use client";

import { useEffect, useRef, useState } from "react";
import { validateManualTravelOverride } from "@/lib/pricing/profitability";
import { calculateTravelProjection } from "@/lib/services/profitability";
import type { ProfitabilityProjection, ProfitabilitySettings, TravelProjection } from "@/types/profitability";

export function ProfitabilityPanel({ projection, settings, destination, editable, onTravelChange, onOtherDirectExpensesChange }: {
  projection: ProfitabilityProjection;
  settings?: ProfitabilitySettings;
  destination?: string;
  editable?: boolean;
  onTravelChange?: (value: TravelProjection) => void;
  onOtherDirectExpensesChange?: (value: number) => void;
}) {
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const lastDestination = useRef("");
  const travel = projection.travel;
  const route = async () => {
    if (!destination?.trim() || !onTravelChange || routing) return;
    setRouting(true); setRouteError(null);
    try { onTravelChange({ ...(await calculateTravelProjection(destination)), travelingEmployeeCount: projection.cleanerCount }); }
    catch (error) { setRouteError(error instanceof Error ? error.message : "Travel could not be calculated. Enter a manual override."); }
    finally { setRouting(false); }
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
      ["Estimated labor hours", hours(projection.estimatedLaborHours)], ["Base wage", money(projection.hourlyWage)],
      ["Projected W-2 burden", percent(projection.employerBurdenRate)], ["Loaded labor rate", money(projection.loadedHourlyLaborCost)],
      ["Loaded cleaning labor", money(projection.directCosts.loadedCleaningLabor)], ["Supplies", money(projection.directCosts.supplies)],
      ["Equipment", money(projection.directCosts.equipment)], ["Subcontractors", money(projection.directCosts.subcontractors)],
      ["Other direct expenses", money(projection.directCosts.other)], ["Vehicle expense", maybeMoney(projection.directCosts.vehicleOperating)],
      ["Paid travel labor", maybeMoney(projection.directCosts.compensableTravelLabor)], ["Legacy travel logistics", money(projection.directCosts.legacyTravelLogistics)], ["Total estimated job cost", maybeMoney(projection.totalEstimatedDirectCost)],
      ["Proposed customer price", money(projection.price)], ["Projected gross profit", maybeMoney(projection.grossProfit)],
      ["Projected gross margin", maybePercent(projection.grossMarginPercent)], ["Target gross margin", percent(projection.targetGrossMarginPercent)],
      ["Recommended minimum", maybeMoney(projection.recommendedMinimumPrice)], ["Difference to target", maybeMoney(projection.differenceToRecommendedMinimum)],
    ].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b border-[#143d1a]/10 py-1.5"><dt className="text-neutral-600">{label}</dt><dd className="text-right font-bold text-[#143d1a]">{value}</dd></div>)}</dl>
    <div className={`mt-4 rounded-lg border p-3 text-sm ${projection.travelCostsVerified ? "border-[#143d1a]/15 bg-white" : "border-amber-300 bg-amber-50 text-amber-900"}`}><p className="font-bold">Travel: {travel.verification}</p><p className="mt-1">{travel.roundTripMiles == null ? "Mileage and duration require a verified route or manual override." : `${travel.roundTripMiles.toFixed(2)} round-trip miles · ${travel.roundTripMinutes?.toFixed(1) ?? "—"} minutes · ${travel.vehicleCount} vehicle${travel.vehicleCount === 1 ? "" : "s"}`}</p>{travel.warning && <p className="mt-1">{travel.warning}</p>}</div>
    {editable && settings && <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Manual round-trip miles<input type="number" min="0" step="0.01" value={travel.roundTripMiles ?? ""} onChange={(event) => updateManualTravel("roundTripMiles", event.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal" /></label><label className="text-sm font-bold">Manual round-trip minutes<input type="number" min="0" step="0.1" value={travel.roundTripMinutes ?? ""} onChange={(event) => updateManualTravel("roundTripMinutes", event.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal" /></label><label className="text-sm font-bold">Vehicles for this job<input type="number" min="1" step="1" value={travel.vehicleCount} onChange={(event) => onTravelChange?.({ ...travel, vehicleCount: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal" /></label><label className="text-sm font-bold">Other direct expenses<input type="number" min="0" step="0.01" value={projection.directCosts.other} onChange={(event) => onOtherDirectExpensesChange?.(Math.max(0, Number(event.target.value) || 0))} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal" /></label><div className="sm:col-span-2"><button type="button" disabled={routing || !destination?.trim()} onClick={() => void route()} className="rounded-lg border border-[#143d1a]/30 bg-white px-4 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-50">{routing ? "Calculating travel..." : "Recalculate driving route"}</button>{routeError && <p role="alert" className="mt-2 text-sm text-red-700">{routeError}</p>}</div></div>}
    {!projection.costComplete && <p role="status" className="mt-3 text-sm font-semibold text-amber-900">Travel costs are incomplete and are excluded from the margin result until a route or manual override and vehicle operating rate are configured.</p>}
  </section>;
}

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const maybeMoney = (value: number | null) => value == null ? "Unverified" : money(value);
const percent = (value: number) => `${value.toFixed(1)}%`;
const maybePercent = (value: number | null) => value == null ? "Unverified" : percent(value);
const hours = (value: number) => `${value.toFixed(2)} h`;
