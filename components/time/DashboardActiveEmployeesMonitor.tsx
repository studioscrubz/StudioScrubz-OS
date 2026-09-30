"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { ActiveStaffPanel } from "@/components/time/ActiveStaffPanel";
import { hasPermission } from "@/lib/auth/permissions";
import { getActiveScrubTechnicians } from "@/lib/services/employees";
import { getOperationalActiveTimeEntries } from "@/lib/services/timeEntries";
import { getActiveEmployeeWorkSessions, PLATFORM_PRESENCE_CHANGED_EVENT } from "@/lib/services/workSessions";
import type { ActiveScrubTechnician } from "@/types/employee";
import type { OperationalActiveTimeEntry } from "@/types/timeEntry";
import type { ActiveEmployeeWorkSession } from "@/types/workSession";

export type ScrubTechRosterStatus = {
  employee_id: string;
  employee_number: string | null;
  employee_name: string;
  availability: "Available" | "On Job / Unavailable" | "Offline";
  job_id: string | null;
  job_number: string | null;
  joined_at: string | null;
};

export function DashboardActiveEmployeesMonitor() {
  const { profile } = useAuth();
  const canViewRoster = hasPermission(profile, "employees.scrubTechRosterView");
  const canViewPresence = hasPermission(profile, "timeClock.view");
  const [staff, setStaff] = useState<ScrubTechRosterStatus[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!canViewRoster) {
      setStaff([]);
      return;
    }
    try {
      const technicians = await getActiveScrubTechnicians();
      let sessions: ActiveEmployeeWorkSession[] = [];
      let entries: OperationalActiveTimeEntry[] = [];
      if (canViewPresence) {
        try {
          [sessions, entries] = await Promise.all([
            getActiveEmployeeWorkSessions(),
            getOperationalActiveTimeEntries(),
          ]);
        } catch (cause) {
          console.error(
            "Active technician presence could not be loaded; showing the authoritative roster without presence.",
            cause,
          );
        }
      }
      setStaff(mergeScrubTechRoster(technicians, sessions, entries));
      setError(false);
    } catch (cause) {
      console.error("Active Scrub Technician roster could not be loaded", cause);
      setError(true);
    }
  }, [canViewRoster, canViewPresence]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!canViewPresence) return;
    const refresh = () => void load();
    window.addEventListener(PLATFORM_PRESENCE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PLATFORM_PRESENCE_CHANGED_EVENT, refresh);
  }, [canViewPresence, load]);

  useOperationalRealtime(["employees", "employee_work_sessions", "time_entries"], load);

  if (!canViewRoster) return null;
  return <div className="mt-7">
    {error ? <p className="mt-3 text-sm font-bold text-amber-700">Active Scrub Technician roster is temporarily unavailable.</p> : <ActiveStaffPanel staff={staff} showPresence={canViewPresence}/>}
  </div>;
}

export function mergeScrubTechRoster(technicians: ActiveScrubTechnician[], sessions: ActiveEmployeeWorkSession[], entries: OperationalActiveTimeEntry[]): ScrubTechRosterStatus[] {
  const byEmployee = new Map<string, ScrubTechRosterStatus>();
  for (const technician of technicians) {
    byEmployee.set(technician.id, {
      employee_id: technician.id,
      employee_number: technician.employee_number,
      employee_name: technician.preferred_name?.trim() || `${technician.first_name} ${technician.last_name}`.trim(),
      availability: "Offline",
      job_id: null,
      job_number: null,
      joined_at: null,
    });
  }
  for (const session of sessions) {
    const technician = byEmployee.get(session.employee_id);
    if (technician) byEmployee.set(session.employee_id, { ...technician, availability: "Available" });
  }
  for (const entry of entries) {
    const technician = byEmployee.get(entry.employee_id);
    if (technician) byEmployee.set(entry.employee_id, { ...technician, availability: "On Job / Unavailable", job_id: entry.job_id, job_number: entry.job_number, joined_at: entry.clock_in });
  }
  return [...byEmployee.values()].sort((left, right) => left.employee_name.localeCompare(right.employee_name));
}
