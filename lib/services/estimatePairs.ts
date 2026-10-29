import { getSupabaseClient } from "@/lib/supabase/client";
import type { EstimateWithRelations } from "@/types/estimate";

// The database authorizes matching active commercial client/property estimates
// and requires exactly one of the pair to be High Dusting.
export async function pairHighDustingEstimates(firstId: string, secondId: string) {
 if (firstId === secondId) throw new Error("Cannot link an estimate to itself.");
 const [estimate_a_id,estimate_b_id]=[firstId,secondId].sort();
 const {error}=await getSupabaseClient().from("estimate_service_pairs").upsert(
  {estimate_a_id,estimate_b_id},
  {onConflict:"estimate_a_id,estimate_b_id",ignoreDuplicates:true}
 );
 if(error) throw new Error("Both estimates were created, but linking failed: "+error.message);
}
export async function loadHighDustingPairs(): Promise<{estimate_a_id:string;estimate_b_id:string}[]> {
 const {data,error}=await getSupabaseClient().from("estimate_service_pairs").select("estimate_a_id,estimate_b_id");
 if(error) throw error;
 return data ?? [];
}
export function relatedHighDustingEstimates(
 estimateId:string, pairs:{estimate_a_id:string;estimate_b_id:string}[], estimates:EstimateWithRelations[]
):EstimateWithRelations[]{
 const ids=pairs.flatMap(pair=>pair.estimate_a_id===estimateId?[pair.estimate_b_id]:pair.estimate_b_id===estimateId?[pair.estimate_a_id]:[]);
 return estimates.filter(estimate=>ids.includes(estimate.id));
}
