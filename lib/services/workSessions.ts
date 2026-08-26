import { getSupabaseClient } from "@/lib/supabase/client";
import type { ActiveEmployeeWorkSession, EmployeeWorkSession } from "@/types/workSession";

export async function startMyWork(): Promise<EmployeeWorkSession> {
  const { data, error } = await getSupabaseClient().rpc("start_my_work");
  if (error) throw new Error(safeMessage(error, "Your work session could not be started."));
  if (!data) throw new Error("Your work session could not be confirmed.");
  return data;
}

export async function stopMyWork(): Promise<EmployeeWorkSession> {
  const { data, error } = await getSupabaseClient().rpc("stop_my_work");
  if (error) throw new Error(safeMessage(error, "Your work session could not be stopped."));
  if (!data) throw new Error("Your work-session clock-out could not be confirmed.");
  return data;
}

export async function getMyWorkSession(): Promise<EmployeeWorkSession | null> {
  const { data, error } = await getSupabaseClient().rpc("get_my_work_session");
  if (error) throw new Error(safeMessage(error, "Your current work session could not be loaded."));
  return data ?? null;
}

export async function getActiveEmployeeWorkSessions(): Promise<ActiveEmployeeWorkSession[]> {
  const { data, error } = await getSupabaseClient().rpc("get_active_employee_work_sessions");
  if (error) throw new Error(safeMessage(error, "Active staff could not be loaded."));
  return data ?? [];
}

function safeMessage(cause: unknown, fallback: string) {
  const detail = cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
    ? cause.message.trim()
    : "";
  return detail && !/jwt|token|secret|authorization header|service[_ -]?role/i.test(detail) ? detail : fallback;
}
