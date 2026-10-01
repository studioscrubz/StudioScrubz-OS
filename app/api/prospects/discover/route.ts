import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildDiscoverySearchPoints,buildOverpassQuery,DISCOVERY_MAX_RADIUS_METERS,DISCOVERY_MAX_RESULTS,DISCOVERY_MIN_RADIUS_METERS,DISCOVERY_MAX_RADIUS_MILES,DISCOVERY_MIN_RADIUS_MILES,DISCOVERY_PROVIDER_TILE_RADIUS_METERS,haversineMeters,isDiscoveryCategory,milesToMeters,normalizeDiscoveryLocation,overpassUnavailableMessage } from "@/lib/prospectDiscovery";
import type { UserProfile } from "@/types/auth";

const USER_AGENT="StudioScrubz Prospect Engine/1.1 (contact: support@studioscrubz.com)";
const OVERPASS_URL=process.env.OVERPASS_API_URL||"https://overpass-api.de/api/interpreter";
const NOMINATIM_URL=process.env.NOMINATIM_API_URL||"https://nominatim.openstreetmap.org/search";
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROVIDER_REQUESTS=48;
function optionalUuid(value:unknown){if(value===null||value===undefined)return null;if(typeof value!=="string")throw new Error("Invalid assignee.");const normalized=value.trim();if(!normalized)return null;if(!UUID_PATTERN.test(normalized))throw new Error("Invalid assignee.");return normalized;}
type OsmElement={type:string;id:number;lat?:number;lon?:number;center?:{lat:number;lon:number};tags?:Record<string,string>};
export async function POST(request:Request){
 const server=await createSupabaseServerClient();const{data:{user}}=await server.auth.getUser();if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
 const{data:rawProfile}=await server.from("user_profiles").select("*").eq("id",user.id).single();const profile=rawProfile as UserProfile|null;if(!profile?.is_active||!["Master Admin","Administrator","Manager","Sales"].includes(profile.role))return NextResponse.json({error:"Prospect discovery denied."},{status:403});
 let body:{location?:string;radiusMiles?:number;category?:string;keyword?:string;assignedUserId?:string|null;requestId?:string};try{body=await request.json();}catch{return NextResponse.json({error:"Invalid discovery request."},{status:400});}
 const location=body.location?.trim()??"",radiusMiles=Number(body.radiusMiles),category=body.category??"",keyword=body.keyword?.trim()??"",radiusMeters=milesToMeters(radiusMiles);
 if(location.length<2||location.length>120||!Number.isFinite(radiusMiles)||radiusMiles<DISCOVERY_MIN_RADIUS_MILES||radiusMiles>DISCOVERY_MAX_RADIUS_MILES||radiusMeters<DISCOVERY_MIN_RADIUS_METERS||radiusMeters>DISCOVERY_MAX_RADIUS_METERS||!isDiscoveryCategory(category)||keyword.length>80)return NextResponse.json({error:"Invalid location, radius, category, or keyword."},{status:400});
 let assigned:string|null;try{assigned=profile.role==="Sales"?user.id:optionalUuid(body.assignedUserId);}catch{return NextResponse.json({error:"Invalid assignee."},{status:400});}
 const db=server as any;const{data:started,error:startError}=await db.rpc("begin_prospect_discovery",{p_request_id:body.requestId??crypto.randomUUID(),p_location:location,p_radius_meters:radiusMeters,p_category:category,p_keyword:keyword,p_assigned_user_id:assigned});
 if(startError)return NextResponse.json({error:startError.message},{status:startError.message.includes("rate limit")?429:400});const runId=started.runId as string;
 if(started.cached){const{data,error}=await db.rpc("get_prospect_discovery_results",{p_run_id:runId});return NextResponse.json(error?{error:error.message}:{runId,cached:true,results:data??[]},{status:error?500:200});}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55_000);
 const diagnostics={attemptedRequests:0,successfulResponses:0,failedResponses:0,httpStatuses:[] as number[],rawElements:0,rejectedMissingName:0,rejectedMissingCoordinate:0,rejectedOutsideRadius:0,duplicates:0,finalUsable:0};
 try{
  const normalizedLocation=normalizeDiscoveryLocation(location);const{data:cachedLocation,error:locationError}=await db.rpc("get_prospect_discovery_location",{p_location:normalizedLocation});if(locationError)throw new Error(locationError.message);
  let latitude:number,longitude:number;
  if(cachedLocation){latitude=Number(cachedLocation.latitude);longitude=Number(cachedLocation.longitude);}
  else{const geoUrl=new URL(NOMINATIM_URL);geoUrl.search=new URLSearchParams({q:location,format:"jsonv2",limit:"1",countrycodes:"us",addressdetails:"0"}).toString();const geoResponse=await fetch(geoUrl,{headers:{"User-Agent":USER_AGENT,"Accept":"application/json"},signal:controller.signal,cache:"no-store"});if(!geoResponse.ok)throw new Error(`Location provider unavailable (${geoResponse.status}).`);const geocoded=await geoResponse.json() as Array<{lat:string;lon:string}>;if(!geocoded[0])throw new Error("Location was not found.");latitude=Number(geocoded[0].lat);longitude=Number(geocoded[0].lon);if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw new Error("Location provider returned invalid coordinates.");const{error:cacheError}=await db.rpc("cache_prospect_discovery_location",{p_location:normalizedLocation,p_latitude:latitude,p_longitude:longitude});if(cacheError)throw new Error(cacheError.message);}
  const points=buildDiscoverySearchPoints(latitude,longitude,radiusMeters),results:Array<Record<string,unknown>>=[],seen=new Set<string>(),retrievedAt=new Date().toISOString();
  const recordHttpStatus=(status:number)=>{if(!diagnostics.httpStatuses.includes(status)&&diagnostics.httpStatuses.length<5)diagnostics.httpStatuses.push(status);};
  for(const point of points.slice(0,MAX_PROVIDER_REQUESTS)){
   if(results.length>=DISCOVERY_MAX_RESULTS)break;
   const tileRadius=Math.min(radiusMeters,DISCOVERY_PROVIDER_TILE_RADIUS_METERS);
   diagnostics.attemptedRequests+=1;
   let response:Response;
   try{response=await fetch(OVERPASS_URL,{method:"POST",headers:{"User-Agent":USER_AGENT,"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"},body:new URLSearchParams({data:buildOverpassQuery(category,point.latitude,point.longitude,tileRadius,keyword)}),signal:controller.signal,cache:"no-store"});}
   catch(cause){if(controller.signal.aborted)throw cause;diagnostics.failedResponses+=1;continue;}
   if(!response.ok){diagnostics.failedResponses+=1;recordHttpStatus(response.status);continue;}
   let payload:{elements?:OsmElement[]};
   try{payload=await response.json() as {elements?:OsmElement[]};}catch{diagnostics.failedResponses+=1;continue;}
   diagnostics.successfulResponses+=1;
   const elements=Array.isArray(payload.elements)?payload.elements:[];diagnostics.rawElements+=elements.length;
   for(const element of elements){
    if(results.length>=DISCOVERY_MAX_RESULTS)break;
    const tags=element.tags??{},lat=element.lat??element.center?.lat,lon=element.lon??element.center?.lon,name=tags.name||tags.brand||tags.operator;
    if(!name){diagnostics.rejectedMissingName+=1;continue;}
    if(lat===undefined||lon===undefined){diagnostics.rejectedMissingCoordinate+=1;continue;}
    const distanceMeters=haversineMeters(latitude,longitude,lat,lon);if(distanceMeters>radiusMeters){diagnostics.rejectedOutsideRadius+=1;continue;}
    const providerIdentifier=`${element.type}/${element.id}`;if(seen.has(providerIdentifier)){diagnostics.duplicates+=1;continue;}seen.add(providerIdentifier);
    const address=[tags["addr:housenumber"],tags["addr:street"]].filter(Boolean).join(" ")||null;const contactCount=[tags.email||tags["contact:email"],tags.phone||tags["contact:phone"],tags.website||tags["contact:website"],address].filter(Boolean).length;const allowedTags=["name","brand","operator","office","shop","amenity","tourism","leisure","craft","building","addr:housenumber","addr:street","addr:city","addr:state","addr:postcode","email","contact:email","phone","contact:phone","website","contact:website"];const publicTags=Object.fromEntries(allowedTags.flatMap(key=>tags[key]===undefined?[]:[[key,tags[key]]]));
    results.push({providerIdentifier,sourceUrl:`https://www.openstreetmap.org/${providerIdentifier}`,retrievedAt,businessName:name,address,city:tags["addr:city"]||null,state:tags["addr:state"]||null,zip:tags["addr:postcode"]||null,phone:tags.phone||tags["contact:phone"]||null,email:tags.email||tags["contact:email"]||null,website:tags.website||tags["contact:website"]||null,latitude:lat,longitude:lon,distanceMeters,confidenceScore:Math.min(100,40+contactCount*15),normalizedSourceData:{osmType:element.type,osmId:element.id,tags:publicTags}});
   }
  }
  diagnostics.finalUsable=results.length;
  if(diagnostics.successfulResponses===0)throw new Error(overpassUnavailableMessage(diagnostics.httpStatuses));
  if(!results.length)throw new Error("OpenStreetMap discovery provider returned no usable results.");
  results.sort((a,b)=>(a.distanceMeters as number)-(b.distanceMeters as number));
  await db.rpc("stage_prospect_discovery",{p_run_id:runId,p_latitude:latitude,p_longitude:longitude,p_results:results,p_error:null});const{data,error}=await db.rpc("get_prospect_discovery_results",{p_run_id:runId});if(error)throw new Error(error.message);return NextResponse.json({runId,cached:false,results:data??[]},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){const message=error instanceof Error&&error.name==="AbortError"?"Public discovery provider timed out.":error instanceof Error?error.message:"Public discovery provider unavailable.";await db.rpc("stage_prospect_discovery",{p_run_id:runId,p_latitude:0,p_longitude:0,p_results:[],p_error:message});return NextResponse.json({error:message},{status:503});}finally{console.info("Prospect discovery provider diagnostics",{runId,...diagnostics});clearTimeout(timer);}
}
