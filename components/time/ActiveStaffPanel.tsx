"use client";

import { useEffect, useState } from "react";
import type { OperationalActiveTimeEntry } from "@/types/timeEntry";

export function ActiveStaffPanel({ entries }: { entries: OperationalActiveTimeEntry[] }) {
  const now = useCurrentTime(entries.length > 0);

  return (
    <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-sm">
      <h2 className="font-extrabold text-[#143d1a]">Active Staff</h2>
      <p className="mt-1 text-xs text-neutral-500">Employees with an open operational time entry.</p>
      {entries.length === 0 && <p className="mt-4 text-sm text-neutral-500">No staff members are currently ACTIVE.</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="font-bold text-[#143d1a]">{entry.employee_name}</p>
            <p className="mt-1 text-sm font-extrabold text-emerald-700">● ACTIVE</p>
            <p className="mt-2 text-xs text-neutral-600">Clocked in: {displayTime(entry.clock_in)}</p>
            <p className="text-xs text-neutral-600">Elapsed: {compactElapsed(now - Date.parse(entry.clock_in))}</p>
            <p className="mt-1 text-xs font-bold text-[#143d1a]">{entry.job_number ? `Job ${entry.job_number}` : "Non-Job time"}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function useCurrentTime(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [ticking]);
  return now;
}

function compactElapsed(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function displayTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
