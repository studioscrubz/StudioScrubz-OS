"use client";

import { useCallback, useEffect, useState } from "react";
import { hasPermission } from "@/lib/auth/permissions";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getOperationalActiveTimeEntries } from "@/lib/services/timeEntries";
import { getActiveEmployeeWorkSessions } from "@/lib/services/workSessions";
import type { ActiveStaffStatus } from "@/types/workSession";
import { ActiveStaffPanel } from "@/components/time/ActiveStaffPanel";

export function DashboardActiveEmployeesMonitor() {
  const { profile } = useAuth();
  const canView = hasPermission(profile, "timeClock.view");
  const [staff, setStaff] = useState<ActiveStaffStatus[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    try {
      const [sessions, entries] = await Promise.all([getActiveEmployeeWorkSessions(), getOperationalActiveTimeEntries()]);
      setStaff(sessions.map((session) => {
        const job = entries.find((entry) => entry.employee_id === session.employee_id && Boolean(entry.job_id));
        return { ...session, availability: job ? "On Job / Unavailable" : "Active / Available",
          job_id: job?.job_id ?? null, job_number: job?.job_number ?? null, joined_at: job?.clock_in ?? null };
      }));
      setError(false);
    } catch (cause) { console.error("Active employee monitor load failed", cause); setError(true); }
    finally { setLoading(false); }
  }, [canView]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useOperationalRealtime(["employee_work_sessions", "time_entries"], load);
  if (!canView) return null;
  return <div className="mt-7">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className={`min-h-28 w-full rounded-2xl border p-5 text-left transition sm:max-w-64 ${expanded ? "border-emerald-400 bg-emerald-50 shadow-sm" : "bg-white hover:border-emerald-300"}`}>
      <p className="text-xs font-bold uppercase text-neutral-500">Platform Active</p>
      <p className="mt-4 text-3xl font-extrabold text-[#143d1a]">{loading ? "..." : error ? "Unavailable" : staff.length}</p>
    </button>
    {error && <p className="mt-3 text-sm font-bold text-amber-700">Active employee status is temporarily unavailable.</p>}
    {expanded && !error && <ActiveStaffPanel staff={staff} />}
  </div>;
}
