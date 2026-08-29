"use client";

import { DashboardTimeClockControl } from "@/components/time/DashboardTimeClockControl";

// Keep one authoritative platform-presence control if this legacy export is
// mounted again. This prevents its behavior from drifting back to payroll time.
export function WorkClockControl({ employeeId }: { employeeId: string | null }) {
  return <DashboardTimeClockControl employeeId={employeeId} />;
}
