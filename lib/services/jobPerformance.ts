import { getSupabaseClient } from "@/lib/supabase/client";
import type { JobPerformanceRow } from "@/types/jobPerformance";

export async function getJobPerformanceRows(start: string | null, end: string | null): Promise<JobPerformanceRow[]> {
  const { data, error } = await getSupabaseClient().rpc("get_job_performance_rows", { p_start_date: start, p_end_date: end });
  if (error) throw new Error(safeMessage(error));
  return (data ?? []).map((row: JobPerformanceRow) => ({ ...row, duration_seconds: Number(row.duration_seconds) }));
}
function safeMessage(cause: unknown) { const detail = cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" ? cause.message.trim() : ""; return detail && !/jwt|token|secret|authorization header|service[_ -]?role/i.test(detail) ? detail : "Job performance could not be loaded."; }
