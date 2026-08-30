import { getSupabaseClient } from "@/lib/supabase/client";
import type { ActiveEmployeeWorkSession, EmployeeWorkSession } from "@/types/workSession";

export const PLATFORM_PRESENCE_CHANGED_EVENT = "studioscrubz:platform-presence-changed";

export async function startMyWork(): Promise<EmployeeWorkSession> {
  const { data, error } = await getSupabaseClient().rpc("start_my_work");
  if (error) throw new Error(safeMessage(error, "Your work session could not be started."));
  const session = normalizeWorkSession(data);
  if (!session || session.status !== "Open" || session.clock_out) throw new Error("Your active presence could not be confirmed.");
  return session;
}

export async function stopMyWork(): Promise<EmployeeWorkSession> {
  const { data, error } = await getSupabaseClient().rpc("stop_my_work");
  if (error) throw new Error(safeMessage(error, "Your work session could not be stopped."));
  const session = normalizeWorkSession(data);
  if (!session || session.status !== "Completed" || !session.clock_out) throw new Error("Your inactive presence could not be confirmed.");
  return session;
}

export async function getMyWorkSession(): Promise<EmployeeWorkSession | null> {
  const { data, error } = await getSupabaseClient().rpc("get_my_work_session");
  if (error) throw new Error(safeMessage(error, "Your current work session could not be loaded."));
  const session = normalizeWorkSession(data);
  return session?.status === "Open" && !session.clock_out ? session : null;
}

export async function getActiveEmployeeWorkSessions(): Promise<ActiveEmployeeWorkSession[]> {
  const { data, error } = await getSupabaseClient().rpc("get_active_employee_work_sessions");
  if (error) throw new Error(safeMessage(error, "Active staff could not be loaded."));
  return (data ?? []).flatMap((session) => {
    const normalized = normalizeWorkSession(session);
    if (!normalized || normalized.status !== "Open" || normalized.clock_out) return [];
    const employeeName = typeof session.employee_name === "string" && session.employee_name.trim()
      ? session.employee_name.trim()
      : "Employee";
    const employeeNumber = typeof session.employee_number === "string" && session.employee_number.trim()
      ? session.employee_number.trim()
      : null;
    return [{ ...normalized, employee_number: employeeNumber, employee_name: employeeName }];
  });
}

export type PresenceToggleDependencies = {
  start: () => Promise<EmployeeWorkSession>;
  stop: () => Promise<EmployeeWorkSession>;
  refresh: () => Promise<EmployeeWorkSession | null>;
};

export async function toggleMyWorkAuthoritatively(
  current: EmployeeWorkSession | null,
  dependencies: PresenceToggleDependencies = { start: startMyWork, stop: stopMyWork, refresh: getMyWorkSession },
) {
  const action = current ? "stop" as const : "start" as const;
  let error: unknown = null;
  try {
    if (action === "start") await dependencies.start();
    else await dependencies.stop();
  } catch (cause) {
    error = cause;
  }
  const session = await dependencies.refresh();
  return { action, session, error };
}

export function notifyPlatformPresenceChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PLATFORM_PRESENCE_CHANGED_EVENT));
}

export function normalizeWorkSession(value: unknown): EmployeeWorkSession | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EmployeeWorkSession>;
  if (typeof row.id !== "string" || !row.id || typeof row.employee_id !== "string" || !row.employee_id
    || typeof row.clock_in !== "string" || !row.clock_in || (row.status !== "Open" && row.status !== "Completed")
    || typeof row.created_at !== "string" || typeof row.updated_at !== "string"
    || (row.clock_out !== null && typeof row.clock_out !== "string")) return null;
  return row as EmployeeWorkSession;
}

function safeMessage(cause: unknown, fallback: string) {
  const detail = cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
    ? cause.message.trim()
    : "";
  return detail && !/jwt|token|secret|authorization header|service[_ -]?role/i.test(detail) ? detail : fallback;
}
