import { getSupabaseClient } from "@/lib/supabase/client";
import type { JobPerformanceRow } from "@/types/jobPerformance";

export async function getJobPerformanceRows(
  start: string | null,
  end: string | null,
): Promise<JobPerformanceRow[]> {
  const { data, error } = await getSupabaseClient().rpc(
    "get_job_performance_rows",
    {
      p_start_date: start,
      p_end_date: end,
    },
  );

  if (error) throw new Error(safeMessage(error));

  return (data ?? []).map((row: JobPerformanceRow) => ({
    ...row,

    duration_seconds: Number(row.duration_seconds),
    actual_labor_hours: numberOrNull(row.actual_labor_hours),
    performance_labor_hours: numberOrNull(row.performance_labor_hours),
    approved_exception_hours: numberOrNull(row.approved_exception_hours),

    budgeted_labor_hours: numberOrNull(row.budgeted_labor_hours),
    budgeted_crew_size: numberOrNull(row.budgeted_crew_size),
    budgeted_estimated_duration: numberOrNull(
      row.budgeted_estimated_duration,
    ),

    effective_labor_hours: numberOrNull(row.effective_labor_hours),
    effective_crew_size: numberOrNull(row.effective_crew_size),
    effective_estimated_duration: numberOrNull(
      row.effective_estimated_duration,
    ),
  }));
}

function numberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeMessage(cause: unknown) {
  const detail =
    cause &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof cause.message === "string"
      ? cause.message.trim()
      : "";

  return detail &&
    !/jwt|token|secret|authorization header|service[_ -]?role/i.test(detail)
    ? detail
    : "Job performance could not be loaded.";
}
