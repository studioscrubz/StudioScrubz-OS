"use client";

import { useEffect, useState } from "react";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { formatTime12Hour } from "@/lib/formatTime";
import { createJobFromOccurrence, getUpcomingOccurrences } from "@/lib/services/serviceOccurrences";
import type { ServiceOccurrenceWithRelations } from "@/types/serviceOccurrence";

export function ScheduleOccurrences() {
  const [rows, setRows] = useState<ServiceOccurrenceWithRelations[]>([]);
  const [error, setError] = useState(false);
  async function load() {
    const records = await getUpcomingOccurrences(day(), add(day(), 60));
    setRows(records.filter((row) => !row.job_id && !["Skipped", "Cancelled"].includes(row.status)));
    setError(false);
  }
  useOperationalRealtime(["service_occurrences", "service_agreements", "jobs"], load);
  useEffect(() => {
    let active = true;
    void getUpcomingOccurrences(day(), add(day(), 60))
      .then((records) => { if (active) setRows(records.filter((row) => !row.job_id && !["Skipped", "Cancelled"].includes(row.status))); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  async function create(id: string) {
    try { await createJobFromOccurrence(id); setRows((current) => current.filter((row) => row.id !== id)); }
    catch { setError(true); }
  }
  return <section className="mt-6 rounded-2xl border border-dashed bg-white p-5"><h2 className="font-extrabold text-[#143d1a]">Upcoming Recurring Services</h2>{error && <p className="text-sm text-red-700">Recurring services could not be loaded.</p>}<div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((row) => <article className="rounded-xl bg-neutral-50 p-4" key={row.id}><b>{row.scheduled_date} · {formatTime12Hour(row.scheduled_start_time)}</b><p>{row.agreement.service_name}</p><p className="text-sm text-neutral-500">{row.agreement.agreement_number}</p><div className="mt-2 flex gap-2"><button className="rounded bg-[#143d1a] px-3 py-2 text-xs font-bold text-white" onClick={() => void create(row.id)}>Create Job</button><a className="rounded border px-3 py-2 text-xs font-bold" href="/agreements">View Agreement</a></div></article>)}</div>{!rows.length && !error && <p className="mt-3 text-sm text-neutral-500">No recurring occurrences are awaiting Jobs.</p>}</section>;
}

function day() { return new Date().toISOString().slice(0, 10); }
function add(value: string, count: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + count); return date.toISOString().slice(0, 10); }
