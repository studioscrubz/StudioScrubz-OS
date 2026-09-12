import { getSupabaseClient } from "@/lib/supabase/client";
import { MILEAGE_CHANGED_EVENT } from "@/lib/services/mileage";
import type { GpsPosition } from "@/types/gpsMileage";

export const GPS_TRIP_CHANGED_EVENT = "studioscrubz:gps-trip-changed";
function changed() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GPS_TRIP_CHANGED_EVENT));
    window.dispatchEvent(new Event(MILEAGE_CHANGED_EVENT));
  }
}
export async function getGpsTrips(jobId: string) {
  const { data, error } = await getSupabaseClient().rpc("get_job_gps_trips", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  return data;
}
export async function startGpsTrip(jobId: string, vehicleId: string, position: GpsPosition) {
  const { data, error } = await getSupabaseClient().rpc("start_job_gps_trip", { p_job_id: jobId, p_vehicle_id: vehicleId, p_position: position });
  if (error) throw new Error(error.message);
  changed();
  return data;
}
export async function finishGpsTrip(id: string, position: GpsPosition) {
  const { data, error } = await getSupabaseClient().rpc("finish_job_gps_trip", { p_id: id, p_position: position });
  if (error) throw new Error(error.message);
  changed();
  return data;
}
export async function cancelGpsTrip(id: string) {
  const { data, error } = await getSupabaseClient().rpc("cancel_job_gps_trip", { p_id: id });
  if (error) throw new Error(error.message);
  changed();
  return data;
}
export async function getGpsMileageForJob(jobId: string) {
  const { data, error } = await getSupabaseClient().rpc("get_job_gps_mileage", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  return data;
}
