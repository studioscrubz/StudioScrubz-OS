import { getSupabaseClient } from "@/lib/supabase/client";
import type { GpsPosition } from "@/types/gpsMileage";

export type JobsiteCheck = {
  result: "Within Radius" | "Outside Radius";
  checkedAt: string;
  distanceMeters: number;
  accuracyMeters: number;
};
export type JobsiteGpsSummary = {
  configured: boolean;
  radiusMeters: number | null;
  manager: boolean;
  lastCheck: JobsiteCheck | null;
  employeeChecks: Array<JobsiteCheck & { employeeId: string }>;
  exceptions: Array<{ employeeId: string; approvedAt: string }>;
};

type JsonRpc = { rpc: (name: string, args: Record<string, unknown>) => Promise<{
  data: unknown;
  error: { message: string } | null;
}> };
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (getSupabaseClient() as unknown as JsonRpc).rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const getJobsiteGpsSummary = (jobId: string) =>
  call<JobsiteGpsSummary>("get_jobsite_arrival_summary", { p_job_id: jobId });

export const setJobsiteGpsLocation = (propertyId: string, position: GpsPosition, radiusMeters = 250) =>
  call<{ configured: boolean; radiusMeters: number }>("set_jobsite_geofence", {
    p_property_id: propertyId, p_position: position, p_radius_meters: radiusMeters,
  });

export const verifyJobsiteArrival = (jobId: string, position: GpsPosition) =>
  call<JobsiteCheck>("verify_jobsite_arrival", { p_job_id: jobId, p_position: position });

export const approveJobsiteGpsException = (jobId: string, employeeId: string, reason: string) =>
  call<{ approved: boolean; exceptionId: string }>("approve_jobsite_arrival_exception", {
    p_job_id: jobId, p_employee_id: employeeId, p_reason: reason,
  });
