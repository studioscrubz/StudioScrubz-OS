"use client";

import { useCallback, useEffect, useState } from "react";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getActiveEmployeeWorkSessions } from "@/lib/services/workSessions";
import type { ActiveEmployeeWorkSession } from "@/types/workSession";

export function ActiveStaffPanel() {
  const [sessions, setSessions] = useState<ActiveEmployeeWorkSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const now = useCurrentTime(sessions.length > 0);
  const load = useCallback(async () => {
    try {
      setSessions(await getActiveEmployeeWorkSessions());
      setError(null);
    } catch (cause) {
      console.error("Active staff load failed", cause);
      setError("Active staff could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);
  useOperationalRealtime(["employee_work_sessions"], load);

  return (
    <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-sm">
      <h2 className="font-extrabold text-[#143d1a]">Active Staff</h2>
      <p className="mt-1 text-xs text-neutral-500">General StudioScrubz work status, separate from crew members currently on a Job.</p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
      {!error && sessions.length === 0 && <p className="mt-4 text-sm text-neutral-500">No staff members are currently ACTIVE.</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sessions.map((session) => (
          <div key={session.id} className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="font-bold text-[#143d1a]">{session.employee_name}</p>
            <p className="mt-1 text-sm font-extrabold text-emerald-700">● ACTIVE <span className="font-medium text-emerald-800">• {compactElapsed(now - Date.parse(session.clock_in))}</span></p>
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
