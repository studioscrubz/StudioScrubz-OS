import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import type { ChangeRequest, ChangeRequestItem, VisibleChangeRequest } from "@/types/changeRequest";

export async function getChangeRequestsForJob(jobId: string): Promise<VisibleChangeRequest[]> {
  const client = getSupabaseClient();
  const profile = await getCurrentProfile();
  if (profile?.role !== "Master Admin") {
    const { data, error } = await client.from("change_requests_operational").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  const { data, error } = await client.from("change_requests").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
  if (error) throw error;
  const requests = (data ?? []) as ChangeRequest[];
  if (!requests.length) return [];
  const { data: items, error: itemsError } = await client.from("change_request_items").select("*").in("change_request_id", requests.map((item) => item.id)).order("sort_order");
  if (itemsError) throw itemsError;
  return requests.map((request) => ({ ...request, items: (items ?? []).filter((item) => item.change_request_id === request.id) }));
}

export async function createChangeRequest(input: {jobId:string;fieldDiscoveryId?:string|null;title:string;description:string;area?:string|null;priceImpact?:number;timeImpactMinutes:number}): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("create_change_request", { p_job_id:input.jobId, p_field_discovery_id:input.fieldDiscoveryId ?? null, p_title:input.title, p_description:input.description, p_area:input.area ?? null, p_price_impact:input.priceImpact ?? 0, p_time_impact_minutes:input.timeImpactMinutes });
  if (error) throw error;
  return data;
}

export async function updateChangeRequestDraft(input: {id:string;title:string;description:string;area:string|null;priceImpact:number;timeImpactMinutes:number}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_change_request_draft", { p_change_request_id:input.id, p_title:input.title, p_description:input.description, p_area:input.area, p_price_impact:input.priceImpact, p_time_impact_minutes:input.timeImpactMinutes });
  if (error) throw error;
}

export async function addChangeRequestItem(id:string, item:Pick<ChangeRequestItem,"description"|"quantity"|"unit"|"unit_price"|"line_total">):Promise<void>{
  const { error } = await getSupabaseClient().rpc("add_change_request_item", { p_change_request_id:id, p_description:item.description, p_quantity:item.quantity, p_unit:item.unit, p_unit_price:item.unit_price, p_line_total:item.line_total });
  if(error)throw error;
}

export async function sendChangeRequest(id:string):Promise<ChangeRequest>{const{data,error}=await getSupabaseClient().rpc("send_change_request",{p_change_request_id:id});if(error)throw error;return data}
export function canManageChangeRequests(role:string|null){return ["Master Admin","Administrator","Manager"].includes(role??"")}
