import { getSupabaseClient } from "@/lib/supabase/client";
import type { Prospect, ProspectAssignee, ProspectEvent, ProspectImportPreviewRow, ProspectImportResult, ProspectInput } from "@/types/prospect";
import type { DiscoveryResult } from "@/types/prospectDiscovery";
import type { EnrichmentReviewItem,EnrichmentDecision } from "@/types/prospectEnrichment";
import { groupEnrichmentReview } from "@/lib/prospect-enrichment/reviewGrouping";

export async function getProspects(): Promise<Prospect[]> {
  const { data, error } = await prospectClient().from("prospects").select("*").order("score", { ascending: false });
  if (error) throw new Error(error.message);
  return data as Prospect[];
}

export async function createProspect(input: ProspectInput): Promise<Prospect> {
  const { data, error } = await prospectClient().from("prospects").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as Prospect;
}

export async function updateProspect(id: string, input: Partial<ProspectInput>): Promise<Prospect> {
  const { data, error } = await prospectClient().from("prospects").update(input).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as Prospect;
}

export async function getProspectEvents(prospectId: string): Promise<ProspectEvent[]> {
  const { data, error } = await prospectClient().from("prospect_events").select("*").eq("prospect_id", prospectId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as ProspectEvent[];
}

export async function getProspectAssignees(): Promise<ProspectAssignee[]> {
  const { data, error } = await prospectClient().rpc("get_prospect_assignees");
  if (error) throw new Error(error.message);
  return data as ProspectAssignee[];
}

export async function createProspectImportBatch(requestId:string,filename:string,totalRows:number,assignedUserId:string|null):Promise<string>{const{data,error}=await prospectClient().rpc("create_prospect_import_batch",{p_request_id:requestId,p_filename:filename,p_total_rows:totalRows,p_assigned_user_id:assignedUserId});if(error)throw new Error(error.message);return data as string;}
export async function importProspectRows(batchId:string,rows:ProspectImportPreviewRow[]):Promise<ProspectImportResult>{const{data,error}=await prospectClient().rpc("import_prospect_batch_rows",{p_batch_id:batchId,p_rows:rows});if(error)throw new Error(error.message);return data as ProspectImportResult;}
export async function mergeProspects(survivorId:string,removedId:string,fieldDecisions:Record<string,"survivor"|"removed">,requestId:string):Promise<string>{const{data,error}=await prospectClient().rpc("merge_prospects",{p_survivor_id:survivorId,p_removed_id:removedId,p_field_decisions:fieldDecisions,p_request_id:requestId});if(error)throw new Error(error.message);return data as string;}
export async function importDiscoveryResults(runId:string,results:DiscoveryResult[]):Promise<{imported:number;skipped:number}>{
  const selections=results.filter(result=>result.selected).map(result=>({resultId:result.resultId,classification:result.classification,decision:result.decision,matchedProspectId:result.matchedProspectId}));
  const{data,error}=await prospectClient().rpc("import_prospect_discovery_results",{p_run_id:runId,p_request_id:crypto.randomUUID(),p_selections:selections});
  if(error)throw new Error(error.message);return data as {imported:number;skipped:number};
}

// These tables are introduced by the pending forward-only migration, so the
// hand-maintained generated schema cannot expose them until that migration runs.
function prospectClient() { return getSupabaseClient() as unknown as { from: (table: string) => any; rpc: (name: string, args?: Record<string,unknown>) => Promise<{data:unknown;error:{message:string}|null}> }; }

export async function saveEnrichmentDecisions(runId:string,decisions:Array<{fieldId:string;decision:Exclude<EnrichmentDecision,"Pending">}>):Promise<void>{const{error}=await prospectClient().rpc("save_prospect_enrichment_decisions",{p_run_id:runId,p_decisions:decisions});if(error)throw new Error(error.message)}
export async function getEnrichmentReview(runId:string):Promise<EnrichmentReviewItem[]>{const{data,error}=await prospectClient().rpc("get_prospect_enrichment_review",{p_run_id:runId});if(error)throw new Error(error.message);return groupEnrichmentReview(data as EnrichmentReviewItem[])}
