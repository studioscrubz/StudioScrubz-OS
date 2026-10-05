import { getSupabaseClient } from "@/lib/supabase/client";
import type { FieldMeasurements } from "@/types/fieldWalkthrough";

export async function getAssignedFieldWalkthroughs() {
  const {data,error} = await getSupabaseClient().rpc("get_assigned_field_walkthroughs");
  if(error) throw error;
  return data;
}
export async function canPerformScheduledWalkthrough(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("can_perform_scheduled_walkthrough", { p_id: id });
  if (error) throw error;
  return data;
}
export async function saveAssignedFieldWalkthrough(id: string, measurements: FieldMeasurements, complete: boolean) {
  const {error} = await getSupabaseClient().rpc("submit_assigned_field_walkthrough", {p_id:id,p_measurements:measurements,p_complete:complete});
  if(error) throw error;
}
export async function returnWalkthroughPricingToAssessment(id: string) {
  const { error } = await getSupabaseClient().rpc("return_walkthrough_pricing_to_assessment", { p_id: id });
  if (!error) return;
  console.error("Return walkthrough pricing RPC failed", { code: error.code });
  if (error.code === "42501") {
    throw new Error("Only the active employee assigned to execute this walkthrough can return it to Assessment.");
  }
  if (error.code === "23505") {
    throw new Error("This walkthrough already has an active Proposal and can no longer be returned to Assessment.");
  }
  throw new Error("The walkthrough could not be returned to Assessment. Reload and try again; if it continues, contact the Master Admin with the walkthrough number.");
}
