import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { discoverOfficialWebsite, enrichOfficialWebsite, ENRICHMENT_MAX_ITEMS, ENRICHMENT_PROVIDER_VERSION } from "@/lib/prospectEnrichment";
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
    let website=item.website as string|null;
    let canonicalDomain=item.canonicalDomain as string|null;
    let cacheKey=item.cacheKey as string|null;
    try{
      if(!website){
        const snapshot=item.input??{};
        const discovered=await discoverOfficialWebsite({
          businessName:String(snapshot.businessName??""),
          address:snapshot.address?String(snapshot.address):undefined,
          city:snapshot.city?String(snapshot.city):undefined,
          state:snapshot.state?String(snapshot.state):undefined,
          zip:snapshot.zip?String(snapshot.zip):undefined,
          locationQuery:item.locationQuery?String(item.locationQuery):undefined
        });
        if(!discovered){
          await db.rpc("stage_prospect_enrichment_result",{p_item_id:item.itemId,p_status:"No Additional Data Found",p_candidates:[],p_canonical_url:null,p_canonical_domain:null,p_cache_key:null,p_error:null});
          continue;
        }
        website=discovered.url;
        canonicalDomain=new URL(website).hostname.replace(/^www\./,"");
        cacheKey=null;
      }

      if(cacheKey){
        const{data:cached}=await db.rpc("get_prospect_enrichment_cache",{p_cache_key:cacheKey});
        if(cached?.providerVersion===ENRICHMENT_PROVIDER_VERSION){
          await db.rpc("stage_prospect_enrichment_result",{p_item_id:item.itemId,p_status:cached.status,p_candidates:cached.results??[],p_canonical_url:website,p_canonical_domain:canonicalDomain,p_cache_key:cacheKey,p_error:null});
          continue;
        }
      }

      const found=await enrichOfficialWebsite(website);
      const status=found.candidates.length?"Complete":"No Additional Data Found";
      const{error}=await db.rpc("stage_prospect_enrichment_result",{p_item_id:item.itemId,p_status:status,p_candidates:found.candidates,p_canonical_url:found.canonicalUrl,p_canonical_domain:found.canonicalDomain,p_cache_key:cacheKey,p_error:null});
      if(error)throw new Error(error.message);
    }catch(cause){
      await db.rpc("stage_prospect_enrichment_result",{p_item_id:item.itemId,p_status:"Failed",p_candidates:[],p_canonical_url:website,p_canonical_domain:canonicalDomain,p_cache_key:cacheKey,p_error:cause instanceof Error?cause.message:"Enrichment failed."});
    }
  }
  const{data:items,error:reviewError}=await db.rpc("get_prospect_enrichment_review",{p_run_id:enrichmentRunId});
  return NextResponse.json(reviewError?{error:reviewError.message}:{runId:enrichmentRunId,items:items??[]},{status:reviewError?500:200,headers:{"Cache-Control":"private, no-store"}});
}
