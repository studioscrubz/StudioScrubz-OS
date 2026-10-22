"use client";

import type { ServiceWeekday } from "@/types/estimate";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function WeeklyServiceDaysField({ value, onChange }: {
  value?: ServiceWeekday[];
  onChange: (days: ServiceWeekday[]) => void;
}) {
  const selected = value ?? [];
  return (
    <fieldset className="col-span-full rounded-xl border border-[#143d1a]/20 bg-[#f4f8f3] p-4">
      <legend className="px-1 text-sm font-bold text-[#143d1a]">Choose service days</legend>
      <p className="mb-3 text-sm text-neutral-700">
        Select at least two weekdays. {selected.length ? `${selected.length} days per week selected.` : "No days selected yet."}
      </p>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((label, index) => {
          const day = index as ServiceWeekday;
          const checked = selected.includes(day);
          return (
            <label key={label} className={`flex min-h-11 min-w-14 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold ${checked ? "border-[#143d1a] bg-[#143d1a] text-white" : "border-neutral-300 bg-white text-[#143d1a]"}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(checked ? selected.filter((item) => item !== day) : [...selected, day].sort((a, b) => a - b))}
                className="accent-[#d4af37]"
                aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]}
              />
              {label}
            </label>
          );
        })}
      </div>
      {selected.length === 1 && <p className="mt-2 text-xs text-amber-700">Choose at least one more service day.</p>}
    </fieldset>
  );
}
