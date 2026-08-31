import type { DurationSummary, JobPerformancePeriod, JobPerformanceRange, JobPerformanceRow, JobPerformanceSort, PerformanceChange, PerformanceFilters } from "@/types/jobPerformance";

const DAY = 86_400_000;
export function getJobPerformanceRange(period: JobPerformancePeriod, today: string, customStart = "", customEnd = ""): JobPerformanceRange {
  if (period === "All Time") return { start: null, end: null, previousStart: null, previousEnd: null };
  const end = period === "Custom Range" ? customEnd || null : today;
  let start: string | null;
  if (period === "Custom Range") start = customStart || null;
  else if (period === "Last 30 Days") start = addDays(today, -29);
  else if (period === "Last 90 Days") start = addDays(today, -89);
  else if (period === "Last 6 Months") start = addMonths(today, -6);
  else start = addMonths(today, -12);
  if (!start || !end || end < start) return { start, end, previousStart: null, previousEnd: null };
  const days = Math.round((dateValue(end) - dateValue(start)) / DAY) + 1;
  return { start, end, previousStart: addDays(start, -days), previousEnd: addDays(start, -1) };
}
export function isValidMeasuredJob(row: JobPerformanceRow) {
  return Boolean(row.operational_started_at && row.operational_ended_at && Number.isFinite(Number(row.duration_seconds)) && Number(row.duration_seconds) >= 0);
}
export function filterPerformanceRows(rows: JobPerformanceRow[], start: string | null, end: string | null, filters: PerformanceFilters) {
  return rows.filter((row) => isValidMeasuredJob(row) && (!start || row.ended_business_date >= start) && (!end || row.ended_business_date <= end)
    && (!filters.service || row.service_name === filters.service) && (!filters.clientId || (row.client_id ?? row.client_name) === filters.clientId)
    && (!filters.propertyId || (row.property_id ?? row.property_name) === filters.propertyId) && (!filters.division || row.division === filters.division));
}
export function summarizeDurations(rows: JobPerformanceRow[]): DurationSummary {
  const values = rows.map((row) => Number(row.duration_seconds)).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!values.length) return { count: 0, average: null, median: null, fastest: null, slowest: null };
  const middle = Math.floor(values.length / 2);
  return { count: values.length, average: values.reduce((total, value) => total + value, 0) / values.length,
    median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    fastest: values[0], slowest: values.at(-1) ?? null };
}
export function performanceChange(current: DurationSummary, previous: DurationSummary): PerformanceChange | null {
  if (current.average === null || previous.average === null || previous.average <= 0) return null;
  const percentage = ((previous.average - current.average) / previous.average) * 100;
  return { percentage, direction: Math.abs(percentage) < 0.05 ? "unchanged" : percentage > 0 ? "faster" : "slower" };
}
export function groupTrend(rows: JobPerformanceRow[], range: JobPerformanceRange) {
  const span = range.start && range.end ? Math.round((dateValue(range.end) - dateValue(range.start)) / DAY) + 1 : Infinity;
  const grain = span <= 45 ? "day" : span <= 210 ? "week" : "month";
  const groups = group(rows, (row) => grain === "day" ? row.ended_business_date : grain === "week" ? weekStart(row.ended_business_date) : row.ended_business_date.slice(0, 7));
  return groups.sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => ({ key, label: trendLabel(key, grain), ...summarizeDurations(values) }));
}
export function groupByService(rows: JobPerformanceRow[]) {
  return group(rows, (row) => row.service_name || "Unspecified service").map(([name, values]) => ({ name, ...summarizeDurations(values) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
export function groupByClientProperty(rows: JobPerformanceRow[]) {
  return group(rows, (row) => `${row.client_id ?? row.client_name}\u0000${row.property_id ?? row.property_name}`).map(([, values]) => {
    const ordered = [...values].sort((a, b) => a.operational_ended_at.localeCompare(b.operational_ended_at));
    const latest = ordered.at(-1)!; const previous = ordered.length > 1 ? ordered.at(-2)! : null;
    const trend = previous && Number(previous.duration_seconds) > 0 ? performanceChange(summarizeDurations([latest]), summarizeDurations([previous])) : null;
    return { clientName: latest.client_name, propertyName: latest.property_name, latest: Number(latest.duration_seconds), previous: previous ? Number(previous.duration_seconds) : null, trend, ...summarizeDurations(values) };
  }).sort((a, b) => b.count - a.count || a.propertyName.localeCompare(b.propertyName));
}
export function sortHistory(rows: JobPerformanceRow[], sort: JobPerformanceSort) {
  return [...rows].sort((a, b) => sort === "Newest" ? b.operational_ended_at.localeCompare(a.operational_ended_at) : sort === "Oldest" ? a.operational_ended_at.localeCompare(b.operational_ended_at)
    : sort === "Fastest" ? Number(a.duration_seconds) - Number(b.duration_seconds) : Number(b.duration_seconds) - Number(a.duration_seconds));
}
export function formatDuration(totalSeconds: number | null) {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  let minutes = Math.round(totalSeconds / 60); const days = Math.floor(minutes / 1440); minutes -= days * 1440;
  const hours = Math.floor(minutes / 60); minutes -= hours * 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes || (!days && !hours) ? `${minutes}m` : ""].filter(Boolean).join(" ");
}
export function businessToday(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function group(rows: JobPerformanceRow[], key: (row: JobPerformanceRow) => string) { const groups = new Map<string, JobPerformanceRow[]>(); for (const row of rows) { const value = key(row); groups.set(value, [...(groups.get(value) ?? []), row]); } return [...groups]; }
function dateValue(value: string) { return Date.parse(`${value}T00:00:00Z`); }
function iso(value: Date) { return value.toISOString().slice(0, 10); }
function addDays(value: string, days: number) { return iso(new Date(dateValue(value) + days * DAY)); }
function addMonths(value: string, months: number) { const source = new Date(`${value}T00:00:00Z`); const day = source.getUTCDate(); source.setUTCDate(1); source.setUTCMonth(source.getUTCMonth() + months); const lastDay = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate(); source.setUTCDate(Math.min(day, lastDay)); return iso(source); }
function weekStart(value: string) { const date = new Date(`${value}T00:00:00Z`); return addDays(value, -((date.getUTCDay() + 6) % 7)); }
function trendLabel(key: string, grain: string) { return grain === "month" ? new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`)) : key; }
