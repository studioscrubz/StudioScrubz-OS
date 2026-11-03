"use client";
import { useCallback, useEffect, useState } from "react";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getJobProfitabilitySummary } from "@/lib/services/timeEntries";
import type { JobProfitabilitySummary as Summary } from "@/types/timeEntry";
export function JobLaborSummary({
  jobId,
  estimatedHours,
  estimatedCost,
  price,
}: {
  jobId: string;
  estimatedHours: number;
  estimatedCost: number;
  price: number;
}) {
  const [data, setData] = useState<Summary | null>(null),
    [error, setError] = useState(false);
  const reload = useCallback(async () => {
    try {
      setData(await getJobProfitabilitySummary(jobId));
      setError(false);
    } catch (cause) {
      console.error("Job labor load failed", cause);
      setError(true);
    }
  }, [jobId]);
  useEffect(() => { void reload(); }, [reload]);
  useOperationalRealtime(["time_entries"], reload);
  return (
    <section className="mt-6">
      <h3 className="font-extrabold text-[#143d1a]">Labor</h3>
      {error ? (
        <p className="mt-2 text-sm text-red-700">
          Actual labor could not be loaded.
        </p>
      ) : data ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Employees Worked", data.employeesWorked],
              ["Regular Hours", data.regularHours.toFixed(2)],
              ["OT Hours", data.overtimeHours.toFixed(2)],
              ["Actual Labor Hours", data.totalHours.toFixed(2)],
              ["Estimated Labor Hours", estimatedHours.toFixed(2)],
              ["Labor Hours Variance (actual - estimate)", `${data.totalHours - estimatedHours > 0 ? "+" : ""}${(data.totalHours - estimatedHours).toFixed(2)} h`],
              ["Estimated Labor Cost", money(estimatedCost)],
              ["Actual Labor Cost", money(data.actualLaborCost)],
              ["Cost Variance", money(data.actualLaborCost - estimatedCost)],
              ["Collected Revenue", money(data.collectedRevenue)],
              ["Job Expenses", money(data.expenses)],
              ["Job Gross Profit", money(data.grossProfit)],
              ["Job Gross Margin", data.grossMargin === null ? "Unavailable" : `${data.grossMargin.toFixed(1)}%`],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-neutral-50 p-3">
                <p className="text-xs text-neutral-500">{l}</p>
                <b>{v}</b>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Labor variance compares recorded completed/approved job time with estimated person-hours. Positive variance indicates overtime against the estimate; negative means fewer hours. Incomplete or unsubmitted time entries will not be reflected. Actual labor uses completed and approved time-entry gross pay.
            Manual Contract Labor expenses remain separate external costs. Job
            price ({money(price)}) is operational value, not collected revenue.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">Loading labor…</p>
      )}
    </section>
  );
}
function money(x: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(x);
}
