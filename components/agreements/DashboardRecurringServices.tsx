"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getUpcomingOccurrences } from "@/lib/services/serviceOccurrences";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import type { ServiceOccurrenceWithRelations } from "@/types/serviceOccurrence";

export function DashboardRecurringServices() {
  const [rows, setRows] = useState<ServiceOccurrenceWithRelations[] | null>(null);
  const [error, setError] = useState(false);
  const today = localDate(new Date());
  const weekEnd = addDays(today, 7);

  async function load() {
    const items = await getUpcomingOccurrences(today, weekEnd);
    setRows(items.filter((item) => !item.job_id && item.status === "Scheduled"));
    setError(false);
  }
  useOperationalRealtime(["service_occurrences", "service_agreements", "jobs"], load);

  useEffect(() => {
    void getUpcomingOccurrences(today, weekEnd)
      .then((items) => setRows(items.filter((item) => !item.job_id && item.status === "Scheduled")))
      .catch((cause: unknown) => {
        console.error("Recurring dashboard services failed to load", cause);
        setError(true);
      });
  }, [today, weekEnd]);

  return (
    <section className="mt-5 rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-extrabold text-[#143d1a]">Recurring Services</h2>
          <p className="text-xs text-neutral-500">Occurrences awaiting job creation.</p>
        </div>
        <Link href="/agreements" className="rounded-lg border px-2.5 py-1.5 text-[11px] font-bold text-[#143d1a]">View Agreements</Link>
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">Recurring services could not be loaded.</p> : !rows ? <div className="mt-3 h-14 animate-pulse rounded-xl bg-neutral-100" /> : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Metric label="Recurring Services Today" value={rows.filter((row) => row.scheduled_date === today).length} />
          <Metric label="Recurring Services This Week" value={rows.length} />
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-[#eef1ed] p-3"><p className="text-xs text-neutral-600">{label}</p><p className="mt-0.5 text-xl font-extrabold text-[#143d1a]">{value}</p></div>;
}
function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function addDays(value: string, days: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return localDate(date); }
