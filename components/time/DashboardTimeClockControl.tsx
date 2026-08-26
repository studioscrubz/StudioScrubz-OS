"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clockInCurrentEmployeeGeneral, clockOutCurrentEmployeeGeneral } from "@/lib/services/timeEntries";
import type { OperationalActiveTimeEntry } from "@/types/timeEntry";

export function DashboardTimeClockControl({
  employeeId,
  activeEntry,
  refresh,
}: {
  employeeId: string | null;
  activeEntry: OperationalActiveTimeEntry | null;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const now = useCurrentTime(Boolean(activeEntry));

  if (!employeeId) return null;

  async function clockIn() {
    setBusy(true);
    setError(null);
    try {
      await clockInCurrentEmployeeGeneral();
      await refresh();
    } catch (cause) {
      setError(message(cause, "Clock-in failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function clockOut() {
    if (!activeEntry || activeEntry.job_id) return;
    const minutes = Number(breakMinutes);
    if (!Number.isInteger(minutes) || minutes < 0) {
      setError("Break minutes must be a whole number greater than or equal to zero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await clockOutCurrentEmployeeGeneral(activeEntry.id, minutes);
      await refresh();
      setBreakMinutes("0");
    } catch (cause) {
      setError(message(cause, "Clock-out failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-[#143d1a]/15 bg-[#f6f8f5] p-5 shadow-sm">
      <h2 className="text-xs font-extrabold uppercase tracking-[.14em] text-[#143d1a]">My Time</h2>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
      {!activeEntry ? (
        <button type="button" disabled={busy} onClick={() => void clockIn()} className="mt-4 min-h-12 w-full rounded-xl bg-[#143d1a] px-5 py-3 font-extrabold text-white disabled:cursor-wait disabled:opacity-60 sm:w-auto">
          {busy ? "CLOCKING IN…" : "CLOCK IN"}
        </button>
      ) : activeEntry.job_id ? (
        <div className="mt-3">
          <p className="font-extrabold text-emerald-700">● ACTIVE ON JOB</p>
          <p className="mt-1 text-lg font-extrabold text-[#143d1a]">{activeEntry.job_number ?? "Assigned Job"}</p>
          <p className="mt-1 text-sm text-neutral-600">Clocked in {displayTime(activeEntry.clock_in)} · {elapsed(now - Date.parse(activeEntry.clock_in))}</p>
          <Link href={`/jobs?jobId=${activeEntry.job_id}`} className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl border border-[#143d1a] px-5 py-3 font-extrabold text-[#143d1a]">OPEN JOB</Link>
        </div>
      ) : (
        <div className="mt-3">
          <p className="font-extrabold text-emerald-700">● ACTIVE · {elapsed(now - Date.parse(activeEntry.clock_in))}</p>
          <p className="mt-1 text-sm text-neutral-600">Clocked in {displayTime(activeEntry.clock_in)}</p>
          <label className="mt-4 block max-w-48 text-xs font-bold text-neutral-600">Break minutes<input type="number" min="0" step="1" value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-900" /></label>
          <button type="button" disabled={busy} onClick={() => void clockOut()} className="mt-3 min-h-12 w-full rounded-xl bg-[#143d1a] px-5 py-3 font-extrabold text-white disabled:cursor-wait disabled:opacity-60 sm:w-auto">
            {busy ? "CLOCKING OUT…" : "CLOCK OUT"}
          </button>
        </div>
      )}
    </section>
  );
}

function useCurrentTime(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [ticking]);
  return now;
}

function elapsed(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}m ${String(total % 60).padStart(2, "0")}s`;
}

function displayTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function message(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
