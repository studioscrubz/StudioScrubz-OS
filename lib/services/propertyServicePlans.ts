import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { validatePropertyServicePlan, type PropertyServicePlanInput, type PropertyServicePlanAreaInput, type PropertyServicePlanWithAreas } from "@/types/propertyServicePlan";

async function authorize() {
  if (!hasPermission(await getCurrentProfile(), "propertyServicePlans.manage")) throw new Error("Property Service Plan access denied.");
}

export async function listPropertyServicePlans(includeArchived = false): Promise<PropertyServicePlanWithAreas[]> {
  await authorize();
  const db = getSupabaseClient();
  let query = db.from("property_service_plans").select("*").order("updated_at", { ascending: false });
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw new Error(`Property Service Plans could not be loaded: ${error.message}`);
  if (!data.length) return [];
  const areas = await db.from("property_service_plan_areas").select("*").in("service_plan_id", data.map(plan => plan.id)).order("sort_order").order("id");
  if (areas.error) throw new Error(`Service areas could not be loaded: ${areas.error.message}`);
  return data.map(plan => ({ ...plan, areas: areas.data.filter(area => area.service_plan_id === plan.id) }));
}

export async function getPropertyServicePlan(id: string): Promise<PropertyServicePlanWithAreas> {
  await authorize();
  const db = getSupabaseClient();
  const { data, error } = await db.from("property_service_plans").select("*").eq("id", id).single();
  if (error) throw new Error(`Property Service Plan could not be loaded: ${error.message}`);
  const areas = await db.from("property_service_plan_areas").select("*").eq("service_plan_id", id).order("sort_order").order("id");
  if (areas.error) throw new Error(`Service areas could not be loaded: ${areas.error.message}`);
  return { ...data, areas: areas.data };
}

async function save(id: string | null, input: PropertyServicePlanInput, areas: PropertyServicePlanAreaInput[], updatedAt: string | null, archive = false) {
  await authorize();
  validatePropertyServicePlan(input, areas);
  const { data, error } = await getSupabaseClient().rpc("save_property_service_plan", {
    p_id: id, p_plan: input, p_areas: areas, p_expected_updated_at: updatedAt, p_archive: archive,
  });
  if (error) throw new Error(`Property Service Plan could not be saved: ${error.message}`);
  return data;
}

export const createPropertyServicePlan = (input: PropertyServicePlanInput, areas: PropertyServicePlanAreaInput[]) => save(null, input, areas, null);
export const updatePropertyServicePlan = (plan: PropertyServicePlanWithAreas, input: PropertyServicePlanInput, areas: PropertyServicePlanAreaInput[]) => save(plan.id, input, areas, plan.updated_at);
export const setPropertyServicePlanStatus = (plan: PropertyServicePlanWithAreas, status: PropertyServicePlanInput["status"]) => save(plan.id, { ...plan, status }, plan.areas, plan.updated_at);
export const archivePropertyServicePlan = (plan: PropertyServicePlanWithAreas) => save(plan.id, { ...plan, status: "Ended" }, plan.areas, plan.updated_at, true);
export const savePropertyServicePlanAreas = (plan: PropertyServicePlanWithAreas, areas: PropertyServicePlanAreaInput[]) => save(plan.id, plan, areas, plan.updated_at);

export async function deletePropertyServicePlan(plan: PropertyServicePlanWithAreas): Promise<void> {
  await authorize();
  const { error } = await getSupabaseClient().rpc("delete_property_service_plan", { p_id: plan.id });
  if (error) throw new Error(`Property Service Plan could not be deleted: ${error.message}`);
}
