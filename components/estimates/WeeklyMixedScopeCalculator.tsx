"use client";

import type { ServiceWeekday, WeeklyMixedVisit } from "@/types/estimate";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const money = (n: number) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(n);

export function newWeeklyVisit(day: ServiceWeekday): WeeklyMixedVisit {
  return { day, serviceLevel: "", scope: "", hours: 0, price: 0 };
}

export function WeeklyMixedScopeCalculator({ days, visits, onChange }: {
  days: ServiceWeekday[];
  visits: WeeklyMixedVisit[];
  onChange: (visits: WeeklyMixedVisit[]) => void;
}) {
  const aligned = days.map(day => visits.find(v => v.day === day) ?? newWeeklyVisit(day));
  const weekly = aligned.reduce((sum, item) => sum + Math.max(0, item.price || 0), 0);
  const incomplete = aligned.length < 2 || aligned.some(item => !item.serviceLevel.trim() || !item.scope.trim() || item.hours <= 0 || item.price <= 0);
  const update = (day: ServiceWeekday, patch: Partial<WeeklyMixedVisit>) => {
    onChange(aligned.map(item => item.day === day ? {...item, ...patch} : item));
  };
  return (
    <fieldset className="col-span-full space-y-4 rounded-xl border border-[#143d1a]/20 bg-[#f6faf4] p-4">
      <legend className="px-2 font-bold text-[#143d1a]">StudioScrubz Weekly — Different Scope Per Day</legend>
      <p className="text-sm text-neutral-700">Set the work, hours and visit price separately for each weekday. No automatic recurring discount is applied to these individually negotiated weekly prices.</p>
      {aligned.length < 2 && <p role="status" className="text-sm font-bold text-amber-800">Select at least two weekdays above.</p>}
      {aligned.map(visit => (
        <section key={visit.day} className="rounded-xl border border-neutral-200 bg-white p-4">
          <h3 className="mb-3 font-bold text-[#143d1a]">{DAY_NAMES[visit.day]}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-neutral-700">Service level
              <input aria-label={`${DAY_NAMES[visit.day]} service level`} placeholder="Detailed cleaning / Light maintenance" value={visit.serviceLevel} onChange={e=>update(visit.day,{serviceLevel:e.target.value})} className="mt-1 block w-full rounded-lg border px-3 py-2"/>
            </label>
            <label className="text-sm font-semibold text-neutral-700">Estimated hours
              <input aria-label={`${DAY_NAMES[visit.day]} hours`} type="number" min="0.25" step="0.25" value={visit.hours || ""} onChange={e=>update(visit.day,{hours:Number(e.target.value)})} className="mt-1 block w-full rounded-lg border px-3 py-2"/>
            </label>
            <label className="text-sm font-semibold text-neutral-700 sm:col-span-2">Included tasks / separate day scope
              <textarea aria-label={`${DAY_NAMES[visit.day]} scope`} rows={2} placeholder="Rooms, work areas and cleaning tasks performed on this day" value={visit.scope} onChange={e=>update(visit.day,{scope:e.target.value})} className="mt-1 block w-full rounded-lg border px-3 py-2"/>
            </label>
            <label className="text-sm font-semibold text-neutral-700">Price for this visit ($)
              <input aria-label={`${DAY_NAMES[visit.day]} visit price`} type="number" min="0" step="0.01" value={visit.price || ""} onChange={e=>update(visit.day,{price:Number(e.target.value)})} className="mt-1 block w-full rounded-lg border px-3 py-2"/>
            </label>
          </div>
        </section>
      ))}
      <div className="grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-3">
        <div><span className="block text-xs text-neutral-500">Weekly contract total</span><b className="text-xl text-[#143d1a]">{money(weekly)}</b></div>
        <div><span className="block text-xs text-neutral-500">Average monthly (52 ÷ 12 weeks)</span><b className="text-xl text-[#143d1a]">{money(weekly*52/12)}</b></div>
        <div><span className="block text-xs text-neutral-500">Discount</span><b className="text-xl text-[#143d1a]">$0.00</b></div>
      </div>
      {incomplete && <p role="status" className="text-sm text-neutral-600">Enter a service level, scope, estimated hours and a positive price for each selected day to finish this quote.</p>}
      <p className="text-xs text-neutral-600">The system uses a per-visit average for legacy summary fields, but the actual contractual amounts are the different day prices listed above. Use weekly contract billing, not uniform per-visit billing.</p>
    </fieldset>
  );
}
