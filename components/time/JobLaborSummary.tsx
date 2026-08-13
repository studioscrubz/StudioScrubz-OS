"use client";
import { useEffect, useState } from "react";
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
  useEffect(() => {
    void getJobProfitabilitySummary(jobId)
      .then(setData)
      .catch((x) => {
        console.error("Job labor load failed", x);
        setError(true);
      });
  }, [jobId]);
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
            Actual labor uses completed and approved time-entry gross pay.
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
