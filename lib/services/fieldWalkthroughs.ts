import { getSupabaseClient } from "@/lib/supabase/client";
import type { FieldMeasurements } from "@/types/fieldWalkthrough";

export async function getAssignedFieldWalkthroughs() {
  const {data,error} = await getSupabaseClient().rpc("get_assigned_field_walkthroughs");
  if(error) throw error;
  return data;
}
export async function saveAssignedFieldWalkthrough(id: string, measurements: FieldMeasurements, complete: boolean) {
  const {error} = await getSupabaseClient().rpc("submit_assigned_field_walkthrough", {p_id:id,p_measurements:measurements,p_complete:complete});
  if(error) throw error;
}
