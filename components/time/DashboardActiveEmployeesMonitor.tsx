"use client";

import { useCallback, useEffect, useState } from "react";
import { hasPermission } from "@/lib/auth/permissions";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getOperationalActiveTimeEntries } from "@/lib/services/timeEntries";
import type { OperationalActiveTimeEntry } from "@/types/timeEntry";
import { ActiveStaffPanel } from "@/components/time/ActiveStaffPanel";

export function DashboardActiveEmployeesMonitor() {
  const { profile } = useAuth();
  const canView = hasPermission(profile, "timeClock.view");
  const [entries, setEntries] = useState<OperationalActiveTimeEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    try {
      const activeEntries = await getOperationalActiveTimeEntries();
      setEntries(activeEntries);
      setError(false);
    } catch (cause) {
      console.error("Active employee monitor load failed", cause);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [load]);

  useOperationalRealtime(["time_entries"], load);

  if (!canView) return null;

  const activeEmployeeCount = new Set(
    entries.map((entry) => entry.employee_id),
  ).size;

  return (
    <div className="mt-7">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className={`min-h-28 w-full rounded-2xl border p-5 text-left transition sm:max-w-64 ${
          expanded
            ? "border-emerald-400 bg-emerald-50 shadow-sm"
            : "bg-white hover:border-emerald-300"
        }`}
      >
        <p className="text-xs font-bold uppercase text-neutral-500">
          Active Employees
        </p>
        <p className="mt-4 text-3xl font-extrabold text-[#143d1a]">
          {loading ? "..." : error ? "Unavailable" : activeEmployeeCount}
        </p>
      </button>

      {error && (
        <p className="mt-3 text-sm font-bold text-amber-700">
          Active employee status is temporarily unavailable.
        </p>
      )}

      {expanded && !error && <ActiveStaffPanel entries={entries} />}
    </div>
  );
}
