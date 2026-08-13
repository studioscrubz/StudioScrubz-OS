"use client";
import { useEffect, useMemo, useState } from "react";
import { getPayrollPeriodSummary } from "@/lib/services/payrollPrep";
import type { PayrollPeriod, PayrollPrepSummary } from "@/types/payrollPrep";
export function PayrollPrepPage() {
  const [periodName, setPeriodName] = useState("This Week"),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [approvedOnly, setApprovedOnly] = useState(true),
    [data, setData] = useState<PayrollPrepSummary | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const period = useMemo(() => getPeriod(periodName, start, end), [periodName, start, end]);
  useEffect(() => {
    let active = true;
    void getPayrollPeriodSummary(period, approvedOnly)
      .then((x) => {
        if (active) setData(x);
      })
      .catch((x) => setError(msg(x)))
      .finally(() => setLoading(false));
    return () => {
      active = false;
    };
  }, [approvedOnly, period]);
  return (
    <>
      <header className="border-b pb-7">
        <h1 className="text-3xl font-extrabold text-[#143d1a]">
          Payroll Preparation
        </h1>
        <p className="mt-3 text-neutral-600">
          Review approved StudioScrubz employee hours and estimated gross pay.
        </p>
      </header>
      <section className="mt-6 flex flex-wrap gap-3 rounded-2xl border bg-white p-4">
        <select
          className={input}
          value={periodName}
          onChange={(e) => setPeriodName(e.target.value)}
        >
          <option>This Week</option>
          <option>Last Week</option>
          <option>This Month</option>
          <option>Custom Range</option>
        </select>
        {periodName === "Custom Range" && (
          <>
            <input
              className={input}
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <input
              className={input}
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </>
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={approvedOnly}
            onChange={(e) => setApprovedOnly(e.target.checked)}
          />{" "}
          Approved Only
        </label>
        <span className="ml-auto font-bold">{period.label}</span>
        <button
          disabled={!data}
          className={secondary}
          onClick={() => data && exportCsv(data, period)}
        >
          Export Payroll CSV
        </button>
        <button className={secondary} onClick={() => window.print()}>
          Print Payroll Summary
        </button>
      </section>
      {error && (
        <p className="mt-4 rounded bg-red-50 p-3 text-red-700">{error}</p>
      )}
      {loading && !data ? (
        <div className="mt-6 h-44 animate-pulse rounded-2xl bg-neutral-200" />
      ) : (
        data && (
          <>
            <section className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-5">
              {[
                ["Total Employees", data.totalEmployees],
                ["Regular Hours", hours(data.regularHours)],
                ["Overtime Hours", hours(data.overtimeHours)],
                ["Total Hours", hours(data.totalHours)],
                ["Estimated Gross Payroll", money(data.estimatedGrossPayroll)],
              ].map(([l, v]) => (
                <Card key={l} l={String(l)} v={String(v)} />
              ))}
            </section>
            <div className="mt-6 overflow-x-auto rounded-2xl border bg-white">
              <table className="w-full min-w-[950px] text-sm">
                <thead>
                  <tr>
                    {[
                      "Employee",
                      "Department",
                      "Regular Hours",
                      "OT Hours",
                      "Total Hours",
                      "Regular Pay",
                      "OT Pay",
                      "Estimated Gross Pay",
                      "Action",
                    ].map((x) => (
                      <th className="p-3 text-left" key={x}>
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((x) => (
                    <tr className="border-t" key={x.employeeId}>
                      <td className="p-3">
                        <b>{x.employeeName}</b>
                        <p className="text-xs text-neutral-500">
                          {x.employeeNumber}
                        </p>
                      </td>
                      <td className="p-3">{x.department}</td>
                      <td className="p-3">{hours(x.regularHours)}</td>
                      <td className="p-3">{hours(x.overtimeHours)}</td>
                      <td className="p-3 font-bold">{hours(x.totalHours)}</td>
                      <td className="p-3">{money(x.regularPay)}</td>
                      <td className="p-3">{money(x.overtimePay)}</td>
                      <td className="p-3 font-bold">{money(x.grossPay)}</td>
                      <td className="p-3">
                        <a
                          className={secondary}
                          href={`/time-clock?employeeId=${x.employeeId}`}
                        >
                          View Time Entries
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.rows.length && (
                <p className="p-10 text-center text-neutral-500">
                  No qualifying time entries in this period.
                </p>
              )}
            </div>
            <p className="mt-4 text-sm text-neutral-500">
              Preparation values are estimates only. This page does not process
              payroll, withholding, taxes, or direct deposits.
            </p>
          </>
        )
      )}
    </>
  );
}
function getPeriod(name: string, start: string, end: string): PayrollPeriod {
  const d = new Date(),
    today = local(d);
  if (name === "This Month")
    return {
      start: `${today.slice(0, 7)}-01`,
      end: today,
      label: "This Month",
    };
  const week = new Date(d);
  week.setDate(
    week.getDate() - week.getDay() + (name === "Last Week" ? -7 : 0),
  );
  const finish = new Date(week);
  finish.setDate(finish.getDate() + 6);
  if (name === "Custom Range")
    return {
      start: start || today,
      end: end || today,
      label: `${start || today} to ${end || today}`,
    };
  return { start: local(week), end: local(finish), label: name };
}
function exportCsv(data: PayrollPrepSummary, p: PayrollPeriod) {
  try {
    const rows = [
        [
          "Employee Number",
          "Employee Name",
          "Department",
          "Period Start",
          "Period End",
          "Regular Hours",
          "Overtime Hours",
          "Regular Pay",
          "Overtime Pay",
          "Gross Pay",
        ],
        ...data.rows.map((x) => [
          x.employeeNumber,
          x.employeeName,
          x.department,
          p.start,
          p.end,
          String(x.regularHours),
          String(x.overtimeHours),
          String(x.regularPay),
          String(x.overtimePay),
          String(x.grossPay),
        ]),
      ],
      blob = new Blob(
        [
          rows
            .map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))
            .join("\r\n"),
        ],
        { type: "text/csv" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `payroll-prep-${p.start}-${p.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (x) {
    console.error(x);
    alert("Payroll CSV export failed.");
  }
}
function Card({ l, v }: { l: string; v: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <p className="text-xs uppercase text-neutral-500">{l}</p>
      <b className="mt-3 block text-2xl text-[#143d1a]">{v}</b>
    </div>
  );
}
function local(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function money(x: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(x);
}
function hours(x: number) {
  return x.toFixed(2);
}
function msg(x: unknown) {
  console.error(x);
  return x instanceof Error
    ? x.message
    : "Payroll preparation could not be loaded.";
}
const input = "h-11 rounded-lg border px-3";
const secondary =
  "rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50";
