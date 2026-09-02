"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getRevenueReport } from "@/lib/services/revenue";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import {
  REVENUE_PERIODS,
  type RevenueGroup,
  type RevenuePeriod,
  type RevenueReport,
} from "@/types/revenue";

export function RevenuePage() {
  const [period, setPeriod] = useState<RevenuePeriod>("This Year");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [group, setGroup] = useState<RevenueGroup>("Day");
  const [data, setData] = useState<RevenueReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getRevenueReport(period, start, end, group));
    } catch (x) {
      console.error("Revenue report load failed", x);
      setError(
        x instanceof Error ? x.message : "Revenue report could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }
  useOperationalRealtime(["invoices", "payments", "jobs", "expenses", "time_entries"], load);
  useEffect(() => {
    let active = true;
    void getRevenueReport(period, start, end, group)
      .then((x) => {
        if (active) setData(x);
      })
      .catch((x: unknown) => {
        console.error("Revenue report load failed", x);
        if (active)
          setError(
            x instanceof Error
              ? x.message
              : "Revenue report could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [end, group, period, start]);
  return (
    <>
      <Header />
      <section className="mt-6 rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className={input}
            value={period}
            onChange={(e) => {
              const value = e.target.value as RevenuePeriod;
              setPeriod(value);
              setGroup(defaultGroup(value));
            }}
          >
            {REVENUE_PERIODS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            className={input}
            value={group}
            onChange={(e) => setGroup(e.target.value as RevenueGroup)}
          >
            <option>Day</option>
            <option>Week</option>
            <option>Month</option>
          </select>
          {period === "Custom Range" && (
            <>
              <input
                className={input}
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <span>to</span>
              <input
                className={input}
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </>
          )}
          <b className="ml-auto text-sm text-[#143d1a]">
            {data?.range.label ?? period}
          </b>
          <button
            disabled={!data}
            className={secondary}
            onClick={() => data && exportCsv(data)}
          >
            Export CSV
          </button>
          <button
            disabled={!data}
            className={secondary}
            onClick={() => window.print()}
          >
            Print Report
          </button>
        </div>
      </section>
      {error && (
        <div className="mt-5 flex justify-between rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">
          <span>{error}</span>
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {data && data.payments.length === 0 && data.invoices.length === 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          <span>No revenue activity was found for the selected period.</span>
          {period !== "All Time" && (
            <button
              className={secondary}
              onClick={() => {
                setPeriod("All Time");
                setGroup(defaultGroup("All Time"));
              }}
            >
              View All Time
            </button>
          )}
        </div>
      )}
      {loading && !data ? <Skeleton /> : data && <Report data={data} />}
    </>
  );
}
function Report({ data }: { data: RevenueReport }) {
  const s = data.summary;
  return (
    <div id="revenue-report">
      <section className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-8">
        <Metric l="Collected Revenue" v={money(s.collected)} />
        <Metric l="Invoiced Revenue" v={money(s.invoiced)} />
        <Metric l="Outstanding Balance" v={money(s.outstanding)} />
        <Metric l="Paid Invoices" v={s.paidInvoices} />
        <Metric l="Open Invoices" v={s.openInvoices} />
        <Metric l="Average Invoice Value" v={money(s.averageInvoice)} />
        <Metric l="Actual Labor Cost" v={money(data.actualLaborCost)} />
        <Metric l="Net Operating Contribution" v={money(data.netOperatingContribution)} />
      </section>
      <p className="mt-3 text-xs text-neutral-500">Operating Profit Before Labor = Collected Revenue − Expenses. Net Operating Contribution = Collected Revenue − Expenses − Actual Labor Cost. These are operational preparation metrics, not legal or tax net income.</p>
      <section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
        <Panel title="Revenue Over Time">
          <Chart rows={data.overTime} />
        </Panel>
        <Panel title="Collection Health">
          <Stats
            rows={[
              [
                "Collection Rate",
                s.collectionRate === null ? "—" : percent(s.collectionRate),
              ],
              ["Average Payment", money(s.averagePayment)],
              ["Past Due Invoices", String(data.pastDue.count)],
              ["Past Due Balance", money(data.pastDue.balance)],
            ]}
          />
        </Panel>
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="Revenue by Client">
          <Clients rows={data.byClient} />
        </Panel>
        <Panel title="Revenue by Service">
          <Table
            heads={["Service", "Collected", "Invoices", "Average"]}
            rows={data.byService.map((x) => [
              x.service,
              money(x.collected),
              String(x.invoiceCount),
              money(x.averageInvoice),
            ])}
          />
        </Panel>
        <Panel title="Revenue by Division">
          <Table
            heads={["Division", "Collected", "Share", "Invoices"]}
            rows={data.byDivision.map((x) => [
              x.division,
              money(x.collected),
              percent(x.percentage),
              String(x.invoiceCount),
            ])}
          />
        </Panel>
        <Panel title="Payments by Method">
          <Table
            heads={["Method", "Collected", "Payments"]}
            rows={data.byMethod.map((x) => [
              x.method,
              money(x.total),
              String(x.count),
            ])}
          />
        </Panel>
      </section>
      <Panel title="Outstanding Invoices" cls="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead>
              <tr>
                {[
                  "Invoice",
                  "Client",
                  "Total",
                  "Paid",
                  "Balance",
                  "Due",
                  "Status",
                  "Actions",
                ].map((x) => (
                  <th
                    key={x}
                    className="border-b p-3 text-xs uppercase text-neutral-500"
                  >
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.outstandingInvoices.map((x) => (
                <tr key={x.id}>
                  <td className="p-3 font-extrabold text-[#143d1a]">
                    {x.invoice_number}
                  </td>
                  <td className="p-3">{x.client_name}</td>
                  <td className="p-3">{money(x.total)}</td>
                  <td className="p-3">{money(x.amount_paid)}</td>
                  <td className="p-3 font-bold">{money(x.balance_due)}</td>
                  <td className="p-3">{x.due_date || "—"}</td>
                  <td className="p-3">{x.status}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Link
                        className={secondary}
                        href={`/invoices?invoiceId=${x.id}`}
                      >
                        View Invoice
                      </Link>
                      <Link
                        className={primary}
                        href={`/invoices?invoiceId=${x.id}&action=payment`}
                      >
                        Record Payment
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.outstandingInvoices.length && (
            <Empty text="No outstanding invoices." />
          )}
        </div>
      </Panel>
      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="Recent Payments">
          <Table
            heads={["Date", "Client", "Invoice", "Amount", "Method"]}
            rows={data.recentPayments.map((x) => [
              x.paymentDate,
              x.clientName,
              x.invoiceNumber,
              money(x.amount),
              x.method,
            ])}
          />
        </Panel>
        <Panel title="Monthly Performance">
          <Monthly data={data} />
        </Panel>
        <Panel title="Completed Work Value">
          <p className="text-sm text-neutral-500">
            Operational value of completed Jobs. This is not collected revenue.
          </p>
          <Stats
            rows={[
              ["Completed Work Value", money(data.completedWork.total)],
              ["Average Completed Job", money(data.completedWork.average)],
              ["Completed Jobs", String(data.completedWork.count)],
            ]}
          />
        </Panel>
        <Panel title="Top Customers">
          <Clients rows={data.topCustomers} />
        </Panel>
      </section>
    </div>
  );
}
function Chart({ rows }: { rows: RevenueReport["overTime"] }) {
  if (!rows.length) return <Empty text="No payments in this period." />;
  const max = Math.max(...rows.map((x) => x.amount), 1);
  return (
    <div className="space-y-3">
      {rows.map((x) => (
        <div
          key={x.key}
          className="grid grid-cols-[90px_1fr_110px] items-center gap-3 text-sm"
        >
          <span>{x.label}</span>
          <div className="h-3 rounded-full bg-neutral-100">
            <div
              className="h-3 rounded-full bg-[#d4af37]"
              style={{ width: `${Math.max((x.amount / max) * 100, 1)}%` }}
            />
          </div>
          <b className="text-right">{money(x.amount)}</b>
        </div>
      ))}
    </div>
  );
}
function Clients({ rows }: { rows: RevenueReport["byClient"] }) {
  return rows.length ? (
    <div>
      {rows.slice(0, 10).map((x) => (
        <div
          key={x.clientId}
          className="flex justify-between gap-3 border-b py-3 text-sm"
        >
          <div>
            <b className="text-[#143d1a]">{x.clientName}</b>
            <p className="text-xs text-neutral-500">
              {x.invoiceCount} invoices · {x.paidInvoiceCount} paid ·{" "}
              {money(x.outstanding)} outstanding
            </p>
          </div>
          <div className="text-right">
            <b>{money(x.totalPaid)}</b>
            <p>
              <Link className="text-xs text-[#9a7a17]" href="/clients">
                View Client
              </Link>
            </p>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty text="No client revenue in this period." />
  );
}
function Monthly({ data }: { data: RevenueReport }) {
  const rows = [
    ["Collected Revenue", data.monthly.collected, true],
    ["Invoices Issued", data.monthly.invoicesIssued, false],
    ["Payments Received", data.monthly.paymentsReceived, false],
    ["Outstanding Balance", data.monthly.outstanding, true],
  ] as const;
  return (
    <div className="space-y-3">
      {rows.map(([label, x, currency]) => (
        <div
          key={label}
          className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-xl bg-[#f6f7f5] p-3 text-sm"
        >
          <b>{label}</b>
          <span>{currency ? money(x.current) : x.current}</span>
          <span
            className={
              x.change === null
                ? "text-neutral-500"
                : x.change >= 0
                  ? "text-green-700"
                  : "text-red-700"
            }
          >
            {x.change === null
              ? "—"
              : `${x.change >= 0 ? "+" : ""}${x.change.toFixed(1)}%`}
          </span>
        </div>
      ))}
    </div>
  );
}
function Table({ heads, rows }: { heads: string[]; rows: string[][] }) {
  return rows.length ? (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {heads.map((x) => (
              <th
                key={x}
                className="border-b p-3 text-xs uppercase text-neutral-500"
              >
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r[0]}-${i}`}>
              {r.map((x, j) => (
                <td
                  key={j}
                  className={`border-b p-3 ${j === 0 ? "font-bold text-[#143d1a]" : ""}`}
                >
                  {x}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text="No records in this period." />
  );
}
function Stats({ rows }: { rows: string[][] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {rows.map(([l, v]) => (
        <div key={l} className="rounded-xl bg-[#f6f7f5] p-4">
          <p className="text-xs text-neutral-500">{l}</p>
          <b className="mt-2 block text-xl text-[#143d1a]">{v}</b>
        </div>
      ))}
    </div>
  );
}
function Header() {
  return (
    <header className="border-b border-[#143d1a]/10 pb-7">
      <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">
        Financial workspace
      </p>
      <h1 className="text-3xl font-extrabold text-[#143d1a]">Revenue</h1>
      <p className="mt-3 text-neutral-600">
        Track StudioScrubz revenue, payments, outstanding balances, and business
        performance.
      </p>
    </header>
  );
}
function Panel({
  title,
  children,
  cls = "",
}: {
  title: string;
  children: React.ReactNode;
  cls?: string;
}) {
  return (
    <section className={`rounded-2xl border bg-white p-5 ${cls}`}>
      <h2 className="mb-5 text-lg font-extrabold text-[#143d1a]">{title}</h2>
      {children}
    </section>
  );
}
function Metric({ l, v }: { l: string; v: string | number }) {
  return (
    <article className="rounded-2xl border bg-white p-5">
      <p className="text-xs font-bold uppercase text-neutral-500">{l}</p>
      <p className="mt-4 text-2xl font-extrabold text-[#143d1a]">{v}</p>
    </article>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl bg-[#f6f7f5] p-6 text-center text-sm text-neutral-500">
      {text}
    </p>
  );
}
function Skeleton() {
  return (
    <div className="mt-7 grid gap-4 md:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-2xl bg-neutral-200"
        />
      ))}
    </div>
  );
}
function exportCsv(data: RevenueReport) {
  try {
    const rows = [
      [
        "Payment Date",
        "Invoice Number",
        "Client",
        "Service",
        "Payment Method",
        "Amount",
      ],
      ...data.payments.map((x) => [
        x.paymentDate,
        x.invoiceNumber,
        x.clientName,
        x.service,
        x.method,
        x.amount.toFixed(2),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `studioscrubz-revenue-${data.range.start ?? "all"}-${data.range.end ?? "time"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (x) {
    console.error("Revenue CSV export failed", x);
    window.alert("Revenue CSV could not be exported.");
  }
}
function defaultGroup(p: RevenuePeriod): RevenueGroup {
  return ["This Year", "Last Year", "All Time"].includes(p)
    ? "Month"
    : p === "This Quarter"
      ? "Week"
      : "Day";
}
function money(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}
function percent(n: number) {
  return `${n.toFixed(1)}%`;
}
const input =
  "h-11 rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#d4af37]";
const primary =
  "rounded-lg bg-[#143d1a] px-3 py-2 text-xs font-bold text-white";
const secondary =
  "rounded-lg border border-neutral-200 px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50";
