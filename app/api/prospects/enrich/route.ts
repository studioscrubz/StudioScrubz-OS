import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ENRICHMENT_MAX_ITEMS } from "@/lib/prospectEnrichment";
import { enrichmentOrchestrator } from "@/lib/prospect-enrichment/orchestrator";
import { SupabaseProviderCallRecorder } from "@/lib/prospect-enrichment/providerCallRecorder";
import { groupEnrichmentReview } from "@/lib/prospect-enrichment/reviewGrouping";
import type { EnrichmentCandidate,EnrichmentReviewItem } from "@/types/prospectEnrichment";
import type { UserProfile } from "@/types/auth";

export async function POST(request:Request){
  const server=await createSupabaseServerClient();
  const{data:{user}}=await server.auth.getUser();
  if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  const{data:raw}=await server.from("user_profiles").select("*").eq("id",user.id).single();
  const profile=raw as UserProfile|null;
  if(!profile?.is_active||!["Master Admin","Administrator","Manager","Sales"].includes(profile.role))return NextResponse.json({error:"Prospect enrichment denied."},{status:403});
  let body:{runId?:string;resultIds?:string[];requestId?:string};
  try{body=await request.json()}catch{return NextResponse.json({error:"Invalid enrichment request."},{status:400})}
  if(!body.runId||!Array.isArray(body.resultIds)||body.resultIds.length<1||body.resultIds.length>ENRICHMENT_MAX_ITEMS)return NextResponse.json({error:"Select 1–10 discovery results."},{status:400});
  const db=server as any;
  const{data:started,error:startError}=await db.rpc("begin_prospect_enrichment",{p_request_id:body.requestId??crypto.randomUUID(),p_discovery_run_id:body.runId,p_result_ids:body.resultIds});
  if(startError)return NextResponse.json({error:startError.message},{status:startError.message.includes("rate limit")?429:400});
  const enrichmentRunId=started.runId;
  const providerCalls=new SupabaseProviderCallRecorder(db);
  const{data:categoryRows}=await db.from("prospect_discovery_run_results").select("id,prospect_discovery_entities(category)").in("id",body.resultIds);
  const categoryByResult=new Map<string,string>((categoryRows??[]).map((row:any)=>{const entity=Array.isArray(row.prospect_discovery_entities)?row.prospect_discovery_entities[0]:row.prospect_discovery_entities;return[String(row.id),String(entity?.category??"")]}));
  const{data:inputs,error:inputError}=await db.rpc("get_prospect_enrichment_inputs",{p_run_id:enrichmentRunId});
  if(inputError)return NextResponse.json({error:inputError.message},{status:400});

  for(const item of inputs??[]){
    try{
      const snapshot=item.input??{};
      const found=await enrichmentOrchestrator.enrich({
        enrichmentItemId:String(item.itemId),
        discoveryResultId:String(item.resultId),businessName:String(snapshot.businessName??""),
        websiteCandidate:item.website?String(item.website):undefined,websiteCandidateDomain:item.canonicalDomain?String(item.canonicalDomain):undefined,
        email:snapshot.email?String(snapshot.email):undefined,phone:snapshot.phone?String(snapshot.phone):undefined,
        address:snapshot.address?String(snapshot.address):undefined,city:snapshot.city?String(snapshot.city):undefined,
        state:snapshot.state?String(snapshot.state):undefined,zip:snapshot.zip?String(snapshot.zip):undefined,
        sourceUrl:snapshot.sourceUrl?String(snapshot.sourceUrl):undefined,locationQuery:item.locationQuery?String(item.locationQuery):undefined,category:categoryByResult.get(String(item.resultId))||undefined,
        cacheKey:item.cacheKey?String(item.cacheKey):null
      },{providerCalls,getCached:async cacheKey=>{const{data,error}=await db.rpc("get_prospect_enrichment_cache",{p_cache_key:cacheKey});if(error)throw new Error(error.message);return data}});
      const{error}=await db.rpc("stage_prospect_enrichment_result",{p_item_id:item.itemId,p_status:found.status,p_candidates:found.candidates,p_canonical_url:found.canonicalUrl,p_canonical_domain:found.canonicalDomain,p_cache_key:found.cacheKey,p_error:found.error??null});
      if(error)throw new Error(error.message);
    }catch(cause){
      await db.rpc("stage_prospect_enrichment_result",{p_item_id:item.itemId,p_status:"Failed",p_candidates:[],p_canonical_url:item.website??null,p_canonical_domain:item.canonicalDomain??null,p_cache_key:item.cacheKey??null,p_error:cause instanceof Error?cause.message:"Enrichment failed."});
    }
  }
  const{data:items,error:reviewError}=await db.rpc("get_prospect_enrichment_review",{p_run_id:enrichmentRunId});
  if(reviewError)return NextResponse.json({error:reviewError.message},{status:500,headers:{"Cache-Control":"private, no-store"}});
  const reviewItems=(items??[]) as EnrichmentReviewItem[],itemIds=reviewItems.map(item=>item.itemId);
  const{data:evidenceRows,error:evidenceError}=itemIds.length?await db.from("prospect_enrichment_fields").select("id,enrichment_item_id,field_name,candidate_value,normalized_value,source_type,source_url,source_page_type,confidence,retrieved_at,decision,provider_key,verification_status,provider_metadata").in("enrichment_item_id",itemIds):{data:[],error:null};
  if(evidenceError)return NextResponse.json({error:evidenceError.message},{status:500,headers:{"Cache-Control":"private, no-store"}});
  const byItem=new Map<string,EnrichmentCandidate[]>();
  for(const row of evidenceRows??[]){const candidate={id:String(row.id),fieldName:row.field_name,value:String(row.candidate_value),normalizedValue:row.normalized_value,sourceType:row.source_type,sourceUrl:String(row.source_url),sourcePageType:String(row.source_page_type),confidence:Number(row.confidence),retrievedAt:String(row.retrieved_at),decision:row.decision,providerKey:row.provider_key,verificationStatus:row.verification_status,identityConfidence:typeof row.provider_metadata?.identityConfidence==="number"?row.provider_metadata.identityConfidence:undefined} as EnrichmentCandidate;const group=byItem.get(String(row.enrichment_item_id))??[];group.push(candidate);byItem.set(String(row.enrichment_item_id),group)}
  const projected=groupEnrichmentReview(reviewItems.map(item=>({...item,candidates:byItem.get(item.itemId)??item.candidates})));
  return NextResponse.json({runId:enrichmentRunId,items:projected},{status:200,headers:{"Cache-Control":"private, no-store"}});
}
