"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getUpcomingOccurrences } from "@/lib/services/serviceOccurrences";
import type { ServiceOccurrenceWithRelations } from "@/types/serviceOccurrence";

export function DashboardRecurringServices() {
  const [rows, setRows] = useState<ServiceOccurrenceWithRelations[] | null>(null);
  const [error, setError] = useState(false);
  const today = localDate(new Date());
  const weekEnd = addDays(today, 7);

  useEffect(() => {
    void getUpcomingOccurrences(today, weekEnd)
      .then((items) => setRows(items.filter((item) => !item.job_id && item.status === "Scheduled")))
      .catch((cause: unknown) => {
        console.error("Recurring dashboard services failed to load", cause);
        setError(true);
      });
  }, [today, weekEnd]);

  return (
    <section className="mt-6 rounded-2xl border bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-extrabold text-[#143d1a]">Recurring Services</h2>
          <p className="text-sm text-neutral-500">Occurrences awaiting job creation.</p>
        </div>
        <Link href="/agreements" className="rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a]">View Agreements</Link>
      </div>
      {error ? <p className="mt-4 text-sm text-red-700">Recurring services could not be loaded.</p> : !rows ? <div className="mt-4 h-16 animate-pulse rounded-xl bg-neutral-100" /> : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Metric label="Recurring Services Today" value={rows.filter((row) => row.scheduled_date === today).length} />
          <Metric label="Recurring Services This Week" value={rows.length} />
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-[#eef1ed] p-4"><p className="text-sm text-neutral-600">{label}</p><p className="mt-1 text-2xl font-extrabold text-[#143d1a]">{value}</p></div>;
}
function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function addDays(value: string, days: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return localDate(date); }
