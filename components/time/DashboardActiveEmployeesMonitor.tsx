"use client";

import { useCallback, useEffect, useState } from "react";
import { hasPermission } from "@/lib/auth/permissions";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getOperationalActiveTimeEntries } from "@/lib/services/timeEntries";
import { getActiveEmployeeWorkSessions, PLATFORM_PRESENCE_CHANGED_EVENT } from "@/lib/services/workSessions";
import type { ActiveEmployeeWorkSession, ActiveStaffStatus } from "@/types/workSession";
import type { OperationalActiveTimeEntry } from "@/types/timeEntry";
import { ActiveStaffPanel } from "@/components/time/ActiveStaffPanel";

export function DashboardActiveEmployeesMonitor() {
  const { profile } = useAuth();
  const canView = hasPermission(profile, "timeClock.view");
  const [staff, setStaff] = useState<ActiveStaffStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    try {
      const [sessions, entries] = await Promise.all([
        getActiveEmployeeWorkSessions(),
        getOperationalActiveTimeEntries(),
      ]);
      setStaff(mergeActiveStaff(sessions, entries));
      setError(false);
    } catch (cause) { console.error("Active employee monitor load failed", cause); setError(true); }
    finally { setLoading(false); }
  }, [canView]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(PLATFORM_PRESENCE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PLATFORM_PRESENCE_CHANGED_EVENT, refresh);
  }, [load]);
  useOperationalRealtime(["employee_work_sessions", "time_entries"], load);
  if (!canView) return null;
  return <div className="mt-7">
    <div className="min-h-28 w-full rounded-2xl border bg-white p-5 sm:max-w-64">
      <p className="text-xs font-bold uppercase text-neutral-500">Active Techs</p>
      <p className="mt-4 text-3xl font-extrabold text-[#143d1a]">{loading ? "..." : error ? "Unavailable" : staff.length}</p>
    </div>
    {error && <p className="mt-3 text-sm font-bold text-amber-700">Active employee status is temporarily unavailable.</p>}
    {!error && <ActiveStaffPanel staff={staff} />}
  </div>;
}

export function mergeActiveStaff(sessions:ActiveEmployeeWorkSession[],entries:OperationalActiveTimeEntry[]):ActiveStaffStatus[]{
  const byEmployee=new Map<string,ActiveStaffStatus>();
  for(const session of sessions)byEmployee.set(session.employee_id,{...session,availability:"Active / Available",job_id:null,job_number:null,joined_at:null});
  for(const entry of entries){
    const session=byEmployee.get(entry.employee_id);
    byEmployee.set(entry.employee_id,{
      id:session?.id??entry.id,
      employee_id:entry.employee_id,
      employee_number:session?.employee_number??entry.employee_number,
      employee_name:session?.employee_name||entry.employee_name,
      clock_in:session?.clock_in??entry.clock_in,
      status:"Open",
      created_at:session?.created_at??entry.clock_in,
      updated_at:session?.updated_at??entry.clock_in,
      availability:"On Job / Unavailable",
      job_id:entry.job_id,
      job_number:entry.job_number,
      joined_at:entry.clock_in,
    });
  }
  return [...byEmployee.values()].sort((left,right)=>left.employee_name.localeCompare(right.employee_name));
}
