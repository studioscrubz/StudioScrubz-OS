"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getMyWorkSession, notifyPlatformPresenceChanged, toggleMyWorkAuthoritatively } from "@/lib/services/workSessions";
import { getOperationalActiveTimeEntries } from "@/lib/services/timeEntries";
import type { EmployeeWorkSession } from "@/types/workSession";
import type { OperationalActiveTimeEntry } from "@/types/timeEntry";

export function DashboardTimeClockControl({ employeeId }: { employeeId: string | null }) {
  const [session, setSession] = useState<EmployeeWorkSession | null>(null);
  const [jobEntry, setJobEntry] = useState<OperationalActiveTimeEntry | null>(null);
  const [loading, setLoading] = useState(Boolean(employeeId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useCurrentTime(Boolean(jobEntry));
  const load = useCallback(async () => {
    if (!employeeId) { setSession(null); setJobEntry(null); setLoading(false); return; }
    setLoading(true);
    try {
      const [presence, entries] = await Promise.all([getMyWorkSession(), getOperationalActiveTimeEntries()]);
      setSession(presence);
      setJobEntry(entries.find((entry) => entry.employee_id === employeeId && Boolean(entry.job_id)) ?? null);
      setError(null);
    } catch (cause) {
      console.error("Operational status load failed", cause);
      setError("Work status unavailable. Refresh or try again shortly.");
    } finally { setLoading(false); }
  }, [employeeId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useOperationalRealtime(["employee_work_sessions", "time_entries"], load);
  if (!employeeId) return null;

  async function toggle() {
    setBusy(true); setError(null);
    try {
      const result = await toggleMyWorkAuthoritatively(session);
      setSession(result.session);
      await load();
      if (result.error) setError(message(result.error, result.action === "stop" ? "Deactivation failed." : "Activation failed."));
      else notifyPlatformPresenceChanged();
    } catch (cause) { setError(message(cause, "Authoritative presence could not be refreshed.")); }
    finally { setBusy(false); }
  }

  return <section className="mt-4 rounded-2xl border border-[#143d1a]/15 bg-[#f6f8f5] px-4 py-3 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xs font-extrabold uppercase tracking-[.14em] text-[#143d1a]">My Availability</h2>
      {loading ? <span className="text-xs text-neutral-500">Loading status...</span> : jobEntry ? <span className="inline-flex items-center gap-2 text-xs font-extrabold text-amber-700"><span aria-hidden="true" className="size-2 rounded-full bg-amber-500"/>On Job · Unavailable</span> : session ? <button type="button" disabled={busy} aria-pressed="true" onClick={() => void toggle()} className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700 disabled:opacity-60"><span aria-hidden="true" className="size-2 rounded-full bg-emerald-500"/>{busy ? "Deactivating…" : "Active · Available"}</button> : <button type="button" disabled={busy} aria-pressed="false" onClick={() => void toggle()} className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-extrabold text-neutral-600 disabled:opacity-60"><span aria-hidden="true" className="size-2 rounded-full bg-neutral-400"/>{busy ? "Activating…" : "Inactive"}</button>}
    </div>
    {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm font-bold text-red-700">{error}</p>}
    {!loading && jobEntry ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <p className="font-extrabold text-[#143d1a]">{jobEntry.job_number ?? "Assigned Job"}</p>
      <p className="text-neutral-600">Time on this Job · {elapsed(now - Date.parse(jobEntry.clock_in))}</p>
      <Link href={`/jobs?jobId=${jobEntry.job_id}`} className="rounded-lg border border-[#143d1a] bg-white px-3 py-1.5 text-xs font-extrabold text-[#143d1a]">Open Job</Link>
      <p className="w-full text-xs text-neutral-500">End this Job before deactivating.</p>
    </div> : !loading && session ? <p className="mt-1 text-xs text-neutral-600">Presence only — no payroll time running.</p> : null}
  </section>;
}

function useCurrentTime(ticking:boolean){const[now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!ticking)return;const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id)},[ticking]);return now}
function elapsed(ms:number){const total=Math.max(0,Math.floor(ms/1000));return `${Math.floor(total/3600)}h ${String(Math.floor((total%3600)/60)).padStart(2,"0")}m ${String(total%60).padStart(2,"0")}s`}
function message(cause:unknown,fallback:string){return cause instanceof Error&&cause.message?cause.message:fallback}
