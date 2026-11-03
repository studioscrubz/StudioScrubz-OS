"use client";
import { useCallback, useEffect, useState } from "react";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getJobProfitabilitySummary } from "@/lib/services/timeEntries";
import type { JobProfitabilitySummary as Summary } from "@/types/timeEntry";

export function JobLaborSummary({
  jobId,
  price,
}: {
  jobId: string;
  estimatedHours?: number;
  estimatedCost?: number;
  price: number;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    try {
      setData(await getJobProfitabilitySummary(jobId));
      setError(false);
    } catch (cause) {
      console.error("Job performance load failed", cause);
      setError(true);
    }
  }, [jobId]);
  useEffect(() => { void reload(); }, [reload]);
  useOperationalRealtime(["time_entries","invoices","payments","expenses"], reload);
  const estimated = data?.estimatedLaborHours ?? null;
  const hasTime = Boolean(data && data.timeEntryCount > 0);
  const variance = data && estimated !== null && hasTime
    ? data.totalHours - estimated
    : null;
  const warnings: string[] = [];
  if (data) {
    if (estimated === null) warnings.push("Original estimated person-hours missing: no labor variance can be calculated.");
    if (data.laborRecordsMissing) warnings.push("Completed job has no completed or approved time entries; recorded labor costs may be understated.");
    if (data.unapprovedTimeEntries > 0) warnings.push(`${data.unapprovedTimeEntries} completed time ${data.unapprovedTimeEntries === 1 ? "entry is" : "entries are"} awaiting approval.`);
    if (!data.paymentsReconciled) warnings.push("Recorded payments do not match the invoice paid totals; verify billing links.");
    if (Math.abs(data.jobPrice - data.invoicedRevenue) > 0.01) warnings.push("Job price and invoiced amount differ; use invoice/payment totals for financial assessment.");
    if (data.outstandingBalance > 0.01) warnings.push(`${money(data.outstandingBalance)} remains unpaid on linked invoices.`);
  }
  return (
    <section className="mt-6">
      <h3 className="font-extrabold text-[#143d1a]">Job Performance</h3>
      {error ? (
        <p className="mt-2 text-sm text-red-700">Financial or labor data could not be loaded. No performance result is displayed.</p>
      ) : data ? (
        <>
          <p className="mt-2 text-xs text-neutral-600">Internal performance report — based on recorded completed/approved time, current invoices, nonvoided payments, and directly linked active expenses.</p>
          {warnings.length > 0 && <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <b>Data quality: review needed</b>
            <ul className="mt-2 list-disc space-y-1 pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </div>}
          <h4 className="mt-4 font-bold text-[#143d1a]">Labor performance</h4>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Workers with recorded time", data.employeesWorked],
              ["Actual person-hours", hasTime ? data.totalHours.toFixed(2) : "Unavailable"],
              ["Original estimated person-hours", estimated === null ? "Unavailable" : `${estimated.toFixed(2)} (${data.laborEstimateSource})`],
              ["Labor hours variance (actual - planned)", variance === null ? "Unavailable" : `${variance > 0 ? "+" : ""}${variance.toFixed(2)} h`],
              ["Actual gross labor pay", hasTime ? money(data.actualLaborCost) : "Unavailable"],
              ["Completed, not yet approved entries", data.unapprovedTimeEntries],
            ].map(([label,value])=><div key={String(label)} className="rounded-xl bg-neutral-50 p-3"><p className="text-xs text-neutral-500">{label}</p><b>{value}</b></div>)}
          </div>
          <h4 className="mt-5 font-bold text-[#143d1a]">Billing reconciliation</h4>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Saved job price", money(data.jobPrice || price)],
              ["Total invoiced", money(data.invoicedRevenue)],
              ["Payments received", money(data.collectedRevenue)],
              ["Outstanding balance", money(data.outstandingBalance)],
              ["Directly linked job expenses", money(data.expenses)],
              ["Payment matching", data.paymentsReconciled ? "Matched" : "Review needed"],
            ].map(([label,value])=><div key={String(label)} className="rounded-xl bg-neutral-50 p-3"><p className="text-xs text-neutral-500">{label}</p><b>{value}</b></div>)}
          </div>
          <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold text-neutral-600">Recorded contribution after gross labor pay and job-linked expenses</p>
            <p className="mt-1 text-xl font-bold text-[#143d1a]">{hasTime ? money(data.grossProfit) : "Unavailable"}</p>
            <p className="text-xs text-neutral-600">{hasTime && data.grossMargin !== null ? `${data.grossMargin.toFixed(1)}% of collected payments` : "Margin unavailable"}</p>
            <p className="mt-2 text-xs text-neutral-600">Not net profit or verified gross margin. Excludes unlinked expenses, possible payroll burden, overhead, travel, taxes and other costs unless explicitly recorded against this job. Payments received are cash collected, not necessarily earned revenue. No historical values have been rewritten.</p>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">Loading job performance…</p>
      )}
    </section>
  );
}
function money(x: number) {
  return new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(x);
}
