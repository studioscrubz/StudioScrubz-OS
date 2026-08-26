"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getTimeEntriesForJob } from "@/lib/services/timeEntries";
import { employeeName } from "@/types/employee";
import type { JobWithRelations } from "@/types/job";
import type { TimeEntryWithRelations } from "@/types/timeEntry";

export function JobTimeSummary({ job }: { job: JobWithRelations }) {
  const [entries, setEntries] = useState<TimeEntryWithRelations[]>([]);
  const [error, setError] = useState<string | null>(null);
  const now = useCurrentTime(job.status === "In Progress" || entries.some(isOpen));
  const load = useCallback(async () => {
    try {
      setEntries((await getTimeEntriesForJob(job.id)).filter(isJobTime));
      setError(null);
    } catch (cause) {
      console.error("Job time summary load failed", cause);
      setError("Job time details could not be loaded.");
    }
  }, [job.id]);

  useEffect(() => {
    let active = true;
    void getTimeEntriesForJob(job.id)
      .then((rows) => { if (active) { setEntries(rows.filter(isJobTime)); setError(null); } })
      .catch((cause: unknown) => { if (active) { console.error("Job time summary load failed", cause); setError("Job time details could not be loaded."); } });
    return () => { active = false; };
  }, [job.id]);
  useOperationalRealtime(["time_entries", "jobs"], load);

  const ordered = useMemo(
    () => [...entries].sort((a, b) => a.clock_in.localeCompare(b.clock_in)),
    [entries],
  );
  const open = ordered.filter(isOpen);
  const completed = ordered.filter((entry) => !isOpen(entry) && ["Completed", "Approved"].includes(entry.status));
  const startedAt = job.operational_started_at;
  const jobEnd = job.operational_ended_at;
  const durationLabel = job.status === "In Progress" ? "Elapsed" : "Actual Job Duration";
  const jobDuration = startedAt && jobEnd
    ? duration(Date.parse(jobEnd) - Date.parse(startedAt))
    : startedAt && job.status === "In Progress" && now !== null
      ? duration(now - Date.parse(startedAt))
      : "—";
  const totalLaborHours = completed.reduce((sum, entry) => sum + Number(entry.total_hours || 0), 0);

  return (
    <section className="mt-6 rounded-xl border border-[#143d1a]/20 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-[#143d1a]">Job Time</h3>
          <p className="mt-1 text-xs text-neutral-500">Operational duration and individual labor time are tracked separately.</p>
        </div>
        {open.length > 0 && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-extrabold text-green-800">ACTIVE · {open.length} {open.length === 1 ? "TECH" : "TECHS"}</span>}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p> : <>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Job Started" value={startedAt ? displayDateTime(startedAt) : "Unavailable"} />
          <Metric label="Job Ended" value={jobEnd ? displayDateTime(jobEnd) : job.status === "In Progress" ? "In progress" : "Unavailable"} />
          <Metric label={durationLabel} value={jobDuration} />
          <Metric label="Total Labor" value={formatHours(totalLaborHours)} />
        </div>
        {open.length > 0 && <><h4 className="mt-5 font-bold text-[#143d1a]">Active Crew</h4><div className="mt-2 grid gap-2">{open.map((entry) => <CrewRow key={entry.id} entry={entry} now={now ?? Date.parse(entry.clock_in)} active />)}</div></>}
        {completed.length > 0 && <><h4 className="mt-5 font-bold text-[#143d1a]">Crew Time</h4><div className="mt-2 grid gap-2">{completed.map((entry) => <CrewRow key={entry.id} entry={entry} now={now ?? Date.parse(entry.clock_in)} />)}</div></>}
        {!ordered.length && <p className="mt-4 text-sm text-neutral-500">No Job time has been recorded.</p>}
      </>}
    </section>
  );
}

function CrewRow({ entry, now, active = false }: { entry: TimeEntryWithRelations; now: number; active?: boolean }) {
  const elapsed = active
    ? duration(now - Date.parse(entry.clock_in))
    : formatHours(Number(entry.total_hours || 0));
  return <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-neutral-50 p-3 text-sm"><div><b>{employeeName(entry.employee)}</b><p className="text-xs text-neutral-500">{active ? `Joined ${displayTime(entry.clock_in)}` : `${displayTime(entry.clock_in)} – ${entry.clock_out ? displayTime(entry.clock_out) : "—"}`}</p></div><span className={active ? "font-extrabold text-green-700" : "font-bold text-neutral-700"}>{active ? "On Job · " : "Completed · "}{elapsed}</span></div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-neutral-50 p-3"><p className="text-xs text-neutral-500">{label}</p><b className="mt-1 block">{value}</b></div>; }
function isJobTime(entry: TimeEntryWithRelations) { return !entry.archived_at && entry.entry_type === "Job"; }
function isOpen(entry: TimeEntryWithRelations) { return entry.status === "Open" && !entry.clock_out && !entry.archived_at; }
function useCurrentTime(ticking: boolean) { const [now, setNow] = useState<number | null>(null); useEffect(() => { const initial = window.setTimeout(() => setNow(Date.now()), 0); if (!ticking) return () => window.clearTimeout(initial); const id = window.setInterval(() => setNow(Date.now()), 1000); return () => { window.clearTimeout(initial); window.clearInterval(id); }; }, [ticking]); return now; }
function displayTime(value: string) { return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function displayDateTime(value: string) { return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function formatHours(hours: number) { return duration(Math.max(0, hours) * 3_600_000, false); }
function duration(milliseconds: number, seconds = true) { const total = Math.max(0, Math.floor(milliseconds / 1000)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const remainingSeconds = total % 60; return seconds ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}` : `${hours}h ${String(minutes).padStart(2, "0")}m`; }
