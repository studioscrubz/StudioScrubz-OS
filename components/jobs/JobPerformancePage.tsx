"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import { getJobPerformanceRows } from "@/lib/services/jobPerformance";
import { businessToday, filterPerformanceRows, formatDuration, getJobPerformanceRange, groupByClientProperty, groupByService, groupTrend, performanceChange, sortHistory, summarizeDurations } from "@/lib/jobPerformance";
import { JOB_PERFORMANCE_PERIODS, type JobPerformancePeriod, type JobPerformanceRow, type JobPerformanceSort, type PerformanceFilters } from "@/types/jobPerformance";

const input = "rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm";
const emptyFilters: PerformanceFilters = { service: "", clientId: "", propertyId: "", division: "" };

export function JobPerformancePage() {
  const [period, setPeriod] = useState<JobPerformancePeriod>("Last 90 Days");
  const [customStart, setCustomStart] = useState(""); const [customEnd, setCustomEnd] = useState("");
  const [filters, setFilters] = useState(emptyFilters); const [sort, setSort] = useState<JobPerformanceSort>("Newest");
  const [rows, setRows] = useState<JobPerformanceRow[]>([]); const [timeZone, setTimeZone] = useState("UTC");
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const today = businessToday(timeZone);
  const range = useMemo(() => getJobPerformanceRange(period, today, customStart, customEnd), [period, today, customStart, customEnd]);

  useEffect(() => {
    if (period === "Custom Range" && (!customStart || !customEnd || customEnd < customStart)) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) { setLoading(true); setError(null); } });
    void getBusinessSettings().then(async (settings) => {
      const zone = settings.timezone || "UTC"; const currentToday = businessToday(zone);
      const requested = getJobPerformanceRange(period, currentToday, customStart, customEnd);
      const data = await getJobPerformanceRows(requested.previousStart ?? requested.start, requested.end);
      if (active) { setTimeZone(zone); setRows(data); }
    }).catch((cause: unknown) => { console.error("Job performance load failed", cause); if (active) setError(cause instanceof Error ? cause.message : "Job performance could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, customStart, customEnd]);

  const current = useMemo(() => filterPerformanceRows(rows, range.start, range.end, filters), [rows, range, filters]);
  const previous = useMemo(() => range.previousStart && range.previousEnd ? filterPerformanceRows(rows, range.previousStart, range.previousEnd, filters) : [], [rows, range, filters]);
  const summary = useMemo(() => summarizeDurations(current), [current]);
  const change = useMemo(() => performanceChange(summary, summarizeDurations(previous)), [summary, previous]);
  const trend = useMemo(() => groupTrend(current, range), [current, range]);
  const services = useMemo(() => groupByService(current), [current]);
  const repeats = useMemo(() => groupByClientProperty(current), [current]);
  const history = useMemo(() => sortHistory(current, sort), [current, sort]);
  const options = useMemo(() => ({
    services: unique(rows.map((row) => row.service_name)),
    clients: uniquePairs(rows.map((row) => [row.client_id ?? row.client_name, row.client_name])),
    properties: uniquePairs(rows.filter((row) => !filters.clientId || (row.client_id ?? row.client_name) === filters.clientId).map((row) => [row.property_id ?? row.property_name, row.property_name])),
    divisions: unique(rows.map((row) => row.division)),
  }), [rows, filters.clientId]);

  return <>
    <header className="border-b border-[#143d1a]/10 pb-7">
      <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Operations reporting</p>
      <h1 className="text-3xl font-extrabold text-[#143d1a]">Job Performance</h1>
      <p className="mt-3 text-neutral-600">Are our Jobs getting faster or slower to complete? Metrics use only authoritative master Job time.</p>
    </header>
    <section className="mt-6 rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap gap-3">
        <Select label="Date range" value={period} set={(value) => setPeriod(value as JobPerformancePeriod)} options={[...JOB_PERFORMANCE_PERIODS]} />
        {period === "Custom Range" && <><DateField label="Start" value={customStart} set={setCustomStart} /><DateField label="End" value={customEnd} set={setCustomEnd} /></>}
        <Select label="Service" value={filters.service} set={(service) => setFilters((x) => ({ ...x, service }))} options={options.services} all="All services" />
        <Select label="Client" value={filters.clientId} set={(clientId) => setFilters((x) => ({ ...x, clientId, propertyId: "" }))} options={options.clients} all="All clients" pairs />
        <Select label="Property" value={filters.propertyId} set={(propertyId) => setFilters((x) => ({ ...x, propertyId }))} options={options.properties} all="All properties" pairs />
        <Select label="Division" value={filters.division} set={(division) => setFilters((x) => ({ ...x, division }))} options={options.divisions} all="All divisions" />
      </div>
      <p className="mt-3 text-xs text-neutral-500">Completed date grouping and display use {timeZone}. Elapsed duration uses the stored timestamps, including DST transitions.</p>
    </section>
    {period === "Custom Range" && customStart && customEnd && customEnd < customStart && <Alert text="Custom end date cannot be before the start date." />}
    {error && <Alert text={error} />}
    {loading ? <Skeleton /> : <>
      <section className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-6">
        <Metric label="Average Job Time" value={formatDuration(summary.average)} />
        <Metric label="Median Job Time" value={formatDuration(summary.median)} />
        <Metric label="Fastest Job" value={formatDuration(summary.fastest)} />
        <Metric label="Slowest Job" value={formatDuration(summary.slowest)} />
        <Metric label="Jobs Measured" value={String(summary.count)} />
        <Metric label="Performance Change" value={changeText(change)} note={change ? "vs previous equivalent period" : "comparison unavailable"} />
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="Performance Trend" subtitle="↓ duration = faster · ↑ duration = slower"><Trend rows={trend} /></Panel>
        <Panel title="By Service"><SummaryTable rows={services} /></Panel>
      </section>
      <section className="mt-6"><Panel title="By Client / Property" subtitle="Latest-vs-previous trend appears only with at least two measured Jobs."><RepeatTable rows={repeats} /></Panel></section>
      <section className="mt-6"><Panel title="Job History" action={<select aria-label="Sort job history" className={input} value={sort} onChange={(event) => setSort(event.target.value as JobPerformanceSort)}>{["Newest", "Oldest", "Fastest", "Slowest"].map((x) => <option key={x}>{x}</option>)}</select>}><History rows={history} timeZone={timeZone} /></Panel></section>
    </>}
  </>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) { return <article className="rounded-2xl border bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{label}</p><p className="mt-2 text-2xl font-extrabold text-[#143d1a]">{value}</p>{note && <p className="mt-1 text-xs text-neutral-500">{note}</p>}</article>; }
function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) { return <section className="rounded-2xl border bg-white p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-extrabold text-[#143d1a]">{title}</h2>{subtitle && <p className="mt-1 text-xs text-neutral-500">{subtitle}</p>}</div>{action}</div>{children}</section>; }
function Trend({ rows }: { rows: ReturnType<typeof groupTrend> }) { if (!rows.length) return <Empty />; const max = Math.max(...rows.map((x) => x.average ?? 0), 1); return <div className="space-y-3">{rows.map((row, index) => { const prior = rows[index - 1]?.average; const delta = prior && row.average !== null ? row.average - prior : null; return <div key={row.key} className="grid grid-cols-[90px_1fr_90px] items-center gap-3 text-sm"><span>{row.label}</span><div className="h-3 rounded-full bg-neutral-100"><div className="h-3 rounded-full bg-[#d4af37]" style={{ width: `${Math.max(2, ((row.average ?? 0) / max) * 100)}%` }} /></div><span className="text-right font-bold">{formatDuration(row.average)} {delta === null || Math.abs(delta) < 30 ? "" : delta < 0 ? "↓" : "↑"}</span></div>; })}</div>; }
function SummaryTable({ rows }: { rows: ReturnType<typeof groupByService> }) { return <Table empty={!rows.length} heads={["Service", "Jobs", "Average", "Median", "Fastest", "Slowest"]} rows={rows.map((x) => [x.name, x.count, formatDuration(x.average), formatDuration(x.median), formatDuration(x.fastest), formatDuration(x.slowest)])} />; }
function RepeatTable({ rows }: { rows: ReturnType<typeof groupByClientProperty> }) { return <Table empty={!rows.length} heads={["Client / Property", "Jobs", "Average", "Previous", "Latest", "Trend"]} rows={rows.map((x) => [<span key={`${x.clientName}-${x.propertyName}`}><b>{x.clientName}</b><br /><span className="text-neutral-500">{x.propertyName}</span></span>, x.count, formatDuration(x.average), formatDuration(x.previous), formatDuration(x.latest), changeText(x.trend)])} />; }
function History({ rows, timeZone }: { rows: JobPerformanceRow[]; timeZone: string }) { return <Table empty={!rows.length} heads={["Job #", "Date", "Client", "Property", "Service", "Started", "Ended", "Duration"]} rows={rows.map((x) => [x.job_number, x.ended_business_date, x.client_name, x.property_name, x.service_name, dateTime(x.operational_started_at, timeZone), dateTime(x.operational_ended_at, timeZone), formatDuration(x.duration_seconds)])} />; }
function Table({ heads, rows, empty }: { heads: string[]; rows: Array<Array<ReactNode>>; empty: boolean }) { if (empty) return <Empty />; return <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase tracking-wide text-neutral-500">{heads.map((x) => <th className="px-3 py-2" key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr className="border-b last:border-0" key={i}>{row.map((cell, j) => <td className="whitespace-nowrap px-3 py-3" key={j}>{cell}</td>)}</tr>)}</tbody></table></div>; }
function Select({ label, value, set, options, all, pairs = false }: { label: string; value: string; set: (value: string) => void; options: string[] | Array<[string, string]>; all?: string; pairs?: boolean }) { return <label className="grid gap-1 text-xs font-bold text-neutral-600">{label}<select className={input} value={value} onChange={(e) => set(e.target.value)}>{all && <option value="">{all}</option>}{options.map((option) => { const [key, text] = pairs ? option as [string, string] : [option as string, option as string]; return <option value={key} key={key}>{text}</option>; })}</select></label>; }
function DateField({ label, value, set }: { label: string; value: string; set: (value: string) => void }) { return <label className="grid gap-1 text-xs font-bold text-neutral-600">{label}<input className={input} type="date" value={value} onChange={(e) => set(e.target.value)} /></label>; }
function Alert({ text }: { text: string }) { return <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{text}</p>; }
function Empty() { return <p className="rounded-xl bg-neutral-50 p-5 text-center text-sm text-neutral-500">No measured Jobs match these filters.</p>; }
function Skeleton() { return <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div className="h-28 animate-pulse rounded-2xl bg-neutral-200" key={i} />)}</div>; }
function changeText(change: ReturnType<typeof performanceChange>) { if (!change) return "—"; if (change.direction === "unchanged") return "No material change"; return `${Math.abs(change.percentage).toFixed(1)}% ${change.direction}`; }
function dateTime(value: string, timeZone: string) { return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))].sort(); }
function uniquePairs(values: Array<[string, string]>) { return [...new Map(values.filter(([key]) => Boolean(key))).entries()].sort((a, b) => a[1].localeCompare(b[1])); }
