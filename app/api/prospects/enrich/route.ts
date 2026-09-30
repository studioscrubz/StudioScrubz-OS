import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ENRICHMENT_MAX_ITEMS } from "@/lib/prospectEnrichment";
import { enrichmentOrchestrator } from "@/lib/prospect-enrichment/orchestrator";
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
  const{data:inputs,error:inputError}=await db.rpc("get_prospect_enrichment_inputs",{p_run_id:enrichmentRunId});
  if(inputError)return NextResponse.json({error:inputError.message},{status:400});

  for(const item of inputs??[]){
    try{
      const snapshot=item.input??{};
      const found=await enrichmentOrchestrator.enrich({
        discoveryResultId:String(item.resultId),businessName:String(snapshot.businessName??""),
        website:item.website?String(item.website):undefined,verifiedDomain:item.canonicalDomain?String(item.canonicalDomain):undefined,
        email:snapshot.email?String(snapshot.email):undefined,phone:snapshot.phone?String(snapshot.phone):undefined,
        address:snapshot.address?String(snapshot.address):undefined,city:snapshot.city?String(snapshot.city):undefined,
        state:snapshot.state?String(snapshot.state):undefined,zip:snapshot.zip?String(snapshot.zip):undefined,
        sourceUrl:snapshot.sourceUrl?String(snapshot.sourceUrl):undefined,locationQuery:item.locationQuery?String(item.locationQuery):undefined,
        cacheKey:item.cacheKey?String(item.cacheKey):null
      },{getCached:async cacheKey=>{const{data,error}=await db.rpc("get_prospect_enrichment_cache",{p_cache_key:cacheKey});if(error)throw new Error(error.message);return data}});
      const{error}=await db.rpc("stage_prospect_enrichment_result",{p_item_id:item.itemId,p_status:found.status,p_candidates:found.candidates,p_canonical_url:found.canonicalUrl,p_canonical_domain:found.canonicalDomain,p_cache_key:found.cacheKey,p_error:found.error??null});
      if(error)throw new Error(error.message);
    }catch(cause){
      await db.rpc("stage_prospect_enrichment_result",{p_item_id:item.itemId,p_status:"Failed",p_candidates:[],p_canonical_url:item.website??null,p_canonical_domain:item.canonicalDomain??null,p_cache_key:item.cacheKey??null,p_error:cause instanceof Error?cause.message:"Enrichment failed."});
    }
  }
  const{data:items,error:reviewError}=await db.rpc("get_prospect_enrichment_review",{p_run_id:enrichmentRunId});
  return NextResponse.json(reviewError?{error:reviewError.message}:{runId:enrichmentRunId,items:items??[]},{status:reviewError?500:200,headers:{"Cache-Control":"private, no-store"}});
}
