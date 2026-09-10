import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { validateVisitDate, validateVisitMutation, type CreatePorterVisitInput, type PorterVisitMutation, type PorterVisitWithAreas } from "@/types/porterVisit";

async function authorize(management = false) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile, management ? "porterVisits.manage" : "porterVisits.view")) throw new Error("Porter Visit access denied.");
  return profile;
}
export async function listPorterVisits(): Promise<PorterVisitWithAreas[]> {
  await authorize();
  const { data, error } = await getSupabaseClient().rpc("get_porter_visits", {});
  if (error) throw new Error(`Porter Visits could not be loaded: ${error.message}`);
  return data;
}
export async function getPorterVisit(id: string): Promise<PorterVisitWithAreas> {
  await authorize();
  const { data, error } = await getSupabaseClient().rpc("get_porter_visits", { p_id: id });
  if (error) throw new Error(`Porter Visit could not be loaded: ${error.message}`);
  if (!data[0]) throw new Error("Porter Visit not found or access denied.");
  return data[0];
}
export async function createPorterVisit(input: CreatePorterVisitInput) {
  await authorize(true);
  if (!input.plan_id) throw new Error("Select an active Property Service Plan.");
  validateVisitDate(input.scheduled_date);
  const { data, error } = await getSupabaseClient().rpc("create_porter_visit", {
    p_plan_id: input.plan_id, p_scheduled_date: input.scheduled_date, p_assigned_crew_id: input.assigned_crew_id, p_notes: input.visit_notes,
  });
  if (error) throw new Error(`Porter Visit could not be created: ${error.message}`);
  return data;
}
export async function mutatePorterVisit(visit: PorterVisitWithAreas, mutation: PorterVisitMutation) {
  const profile = await authorize();
  validateVisitMutation(visit, mutation, hasPermission(profile, "porterVisits.manage"));
  const { data, error } = await getSupabaseClient().rpc("mutate_porter_visit", {
    p_id: visit.id, p_expected_updated_at: visit.updated_at, p_action: mutation.action, p_data: mutation.data ?? {},
  });
  if (error) throw new Error(`Porter Visit could not be updated: ${error.message}`);
  return data;
}
export async function deletePorterVisit(visitOrId: PorterVisitWithAreas | string): Promise<void> {
  await authorize(true);
  const id = typeof visitOrId === "string" ? visitOrId : visitOrId.id;
  const db = getSupabaseClient();
  const { data: photoRows, error: photosError } = await db.from("property_service_visit_photos").select("storage_path").eq("visit_id", id);
  if (photosError) throw new Error(`Porter Visit photo paths could not be retrieved: ${photosError.message}`);
  const providedPaths = typeof visitOrId === "object" && Array.isArray(visitOrId.photos) ? visitOrId.photos.map(p => p.storage_path) : [];
  const dbPaths = (photoRows ?? []).map(p => p.storage_path);
  const paths = Array.from(new Set([...providedPaths, ...dbPaths].filter(Boolean)));
  if (paths.length > 0) {
    const { error: storageError } = await db.storage.from("operational-photos").remove(paths);
    if (storageError) throw new Error(`Porter Visit photo storage cleanup failed: ${storageError.message}`);
  }
  const { error: rpcError } = await db.rpc("delete_porter_visit", { p_id: id });
  if (rpcError) throw new Error(`Porter Visit could not be deleted: ${rpcError.message}`);
}
