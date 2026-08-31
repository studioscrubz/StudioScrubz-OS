export const JOB_PERFORMANCE_PERIODS = ["Last 30 Days", "Last 90 Days", "Last 6 Months", "Last 12 Months", "All Time", "Custom Range"] as const;
export type JobPerformancePeriod = (typeof JOB_PERFORMANCE_PERIODS)[number];
export type JobPerformanceSort = "Newest" | "Oldest" | "Fastest" | "Slowest";
export type JobPerformanceRow = {
  id: string; job_number: string; client_id: string | null; client_name: string;
  property_id: string | null; property_name: string; service_name: string; division: string;
  scheduled_date: string | null; operational_started_at: string; operational_ended_at: string;
  ended_business_date: string; duration_seconds: number;
};
export type PerformanceFilters = { service: string; clientId: string; propertyId: string; division: string };
export type DurationSummary = { count: number; average: number | null; median: number | null; fastest: number | null; slowest: number | null };
export type PerformanceChange = { percentage: number; direction: "faster" | "slower" | "unchanged" };
export type JobPerformanceRange = { start: string | null; end: string | null; previousStart: string | null; previousEnd: string | null };
