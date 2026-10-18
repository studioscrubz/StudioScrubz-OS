/* eslint-disable @typescript-eslint/no-explicit-any -- migration-backed tables/RPCs are unavailable to generated types until the migration is applied */
import { hasPermission } from "@/lib/auth/permissions";
import { buildPorterRouteSuggestion, type PorterRouteLocation } from "@/lib/porterRoutePlanning";
import { confidentlyVerified, geoapifyRouteActualCredits, geoapifyRouteReservedCredits, normalizePropertyAddress, parseGeocodingResponse, parseRoutingResponse, reorderByWaypointOrder, stableHash, validateGeoapifyCreditSettlement, type DrivingRoute, type GeoCandidate } from "@/lib/porterGeoapify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { PorterRouteWithStops } from "@/types/porterRoute";

export const runtime = "nodejs";
const TIMEOUT_MS=10_000;
const GEOCODE_TTL="180 days", ROUTE_TTL="24 hours";
const safeMessage=(error:unknown)=>error instanceof Error?error.message:"Geographic optimization failed.";

async function authorized(){
  const session=await createSupabaseServerClient(),auth=await session.auth.getUser();
  if(!auth.data.user) throw Object.assign(new Error("Authentication is required."),{status:401});
  const result=await session.from("user_profiles").select("*").eq("id",auth.data.user.id).single();
  const profile=result.data as UserProfile|null;
  if(result.error||!profile?.is_active||!hasPermission(profile,"porterVisits.manage")) throw Object.assign(new Error("Porter Route management permission is required."),{status:403});
  return {session,profile};
}
function config(){
  const apiKey=process.env.GEOAPIFY_API_KEY;
  if(!apiKey) throw Object.assign(new Error("Geoapify is not configured."),{status:503});
  const daily=Math.min(3000,Math.max(1,Number(process.env.GEOAPIFY_DAILY_CREDIT_LIMIT??process.env.GEOAPIFY_DAILY_REQUEST_LIMIT)||500));
  const maxWaypoints=Math.min(50,Math.max(2,Number(process.env.GEOAPIFY_MAX_WAYPOINTS)||20));
  const maxDistanceChunks=Math.min(20,Math.max(1,Number(process.env.GEOAPIFY_ROUTE_DISTANCE_CREDIT_RESERVE)||10));
  return {apiKey,daily,maxWaypoints,maxDistanceChunks};
}
async function provider(url:URL){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try{
    const response=await fetch(url,{signal:controller.signal,cache:"no-store"});
    if(response.status===429) throw Object.assign(new Error("Geoapify rate limit reached. Try again later."),{status:429});
    if(!response.ok) throw Object.assign(new Error("Geoapify is temporarily unavailable."),{status:503});
    return await response.json() as unknown;
  }catch(error){if((error as {name?:string}).name==="AbortError") throw Object.assign(new Error("Geoapify request timed out."),{status:504});throw error}
  finally{clearTimeout(timer)}
}
type ProviderClaim={state:"claimed"|"cached"|"pending"|"retry_later"|"budget_exhausted";result?:unknown;claim_token?:string;reserved_credits?:number};
async function claimed(admin:any,key:string,operation:"geocode"|"route",creditLimit:number,reservedCredits:number,ttl:string){
  const {data,error}=await admin.rpc("claim_porter_geo_provider_request",{p_request_key:key,p_operation:operation,p_credit_limit:creditLimit,p_reserved_credits:reservedCredits,p_ttl:ttl});
  if(error) throw error; return data as ProviderClaim;
}
async function complete(admin:any,key:string,claim:ProviderClaim,result:unknown,failure:string|null,actualCredits:number|null){
  if(claim.state!=="claimed"||!claim.claim_token||!claim.reserved_credits) throw new Error("Geographic request claim token is unavailable.");
  const meaningfulFailure=failure&&failure.trim().length>=5?failure.trim():failure?"Geoapify request failed.":null;
  const verifiedActualCredits=validateGeoapifyCreditSettlement(claim.reserved_credits,actualCredits);
  const response=await admin.rpc("complete_porter_geo_provider_request",{p_request_key:key,p_claim_token:claim.claim_token,p_result:result,p_failure_reason:meaningfulFailure,p_actual_credits:verifiedActualCredits}); if(response.error) throw response.error;
}
async function geocode(admin:any,property:any,address:string,apiKey:string,daily:number,profile:UserProfile,reviewPlaceId?:string){
  const addressHash=stableHash(address.toLowerCase());
  const existing=(await admin.from("porter_property_geocodes").select("*").eq("property_id",property.id).maybeSingle()).data;
  if(reviewPlaceId&&existing?.status==="Needs Review"&&existing.address_hash===addressHash){
    const candidate=(existing.candidates as GeoCandidate[]).find(item=>item.placeId===reviewPlaceId);
    if(!candidate) throw Object.assign(new Error("The selected geocoding candidate is no longer available."),{status:409});
    await admin.from("porter_property_geocodes").upsert({property_id:property.id,address_hash:addressHash,normalized_address:address,status:"Verified",latitude:candidate.latitude,longitude:candidate.longitude,formatted_address:candidate.formattedAddress,provider_place_id:candidate.placeId,confidence:candidate.confidence,match_type:candidate.matchType,candidates:existing.candidates,failure_reason:null,verified_at:new Date().toISOString(),reviewed_by:profile.id,updated_at:new Date().toISOString()});
    return candidate;
  }
  if(existing?.status==="Verified"&&existing.address_hash===addressHash) return {latitude:existing.latitude,longitude:existing.longitude,formattedAddress:existing.formatted_address,placeId:existing.provider_place_id,confidence:Number(existing.confidence),matchType:existing.match_type} as GeoCandidate;
  if(existing?.status==="Needs Review"&&existing.address_hash===addressHash) return null;
  const key=stableHash(`geocode|${addressHash}`),claim=await claimed(admin,key,"geocode",daily,1,GEOCODE_TTL);
  if(claim.state==="budget_exhausted") throw Object.assign(new Error("The configured daily Geoapify request budget is exhausted."),{status:429});
  if(claim.state==="pending"||claim.state==="retry_later") return null;
  let candidates:GeoCandidate[];
  if(claim.state==="cached") candidates=claim.result as GeoCandidate[];
  else {try{const url=new URL("https://api.geoapify.com/v1/geocode/search");url.searchParams.set("text",address);url.searchParams.set("format","json");url.searchParams.set("limit","3");url.searchParams.set("filter","countrycode:us");url.searchParams.set("apiKey",apiKey);candidates=parseGeocodingResponse(await provider(url))}catch(error){await complete(admin,key,claim,null,safeMessage(error).slice(0,500),null);throw error}await complete(admin,key,claim,candidates,null,1)}
  const verified=confidentlyVerified(candidates),best=candidates[0];
  await admin.from("porter_property_geocodes").upsert({property_id:property.id,address_hash:addressHash,normalized_address:address,status:verified?"Verified":candidates.length?"Needs Review":"Failed",latitude:verified?best.latitude:null,longitude:verified?best.longitude:null,formatted_address:verified?best.formattedAddress:null,provider_place_id:verified?best.placeId:null,confidence:best?.confidence??null,match_type:best?.matchType??null,candidates,failure_reason:candidates.length?null:"No valid Geoapify result.",verified_at:verified?new Date().toISOString():null,reviewed_by:null,updated_at:new Date().toISOString()});
  return verified?best:null;
}
async function driving(admin:any,locations:PorterRouteLocation[],apiKey:string,daily:number,optimize:boolean,maxDistanceChunks:number):Promise<DrivingRoute>{
  const reservedCredits=geoapifyRouteReservedCredits(locations.length,optimize,maxDistanceChunks);
  const key=stableHash(`route|drive|${optimize}|${locations.map(x=>`${x.latitude!.toFixed(6)},${x.longitude!.toFixed(6)}`).join("|")}`),claim=await claimed(admin,key,"route",daily,reservedCredits,ROUTE_TTL);
  if(claim.state==="cached") return claim.result as DrivingRoute;
  if(claim.state==="pending"||claim.state==="retry_later") throw Object.assign(new Error("An identical route calculation is already in progress or cooling down after failure."),{status:409});
  if(claim.state==="budget_exhausted") throw Object.assign(new Error("The configured daily Geoapify request budget is exhausted."),{status:429});
  let result:DrivingRoute;
  try{const url=new URL("https://api.geoapify.com/v1/routing");url.searchParams.set("waypoints",locations.map(x=>`${x.latitude},${x.longitude}`).join("|"));url.searchParams.set("mode","drive");url.searchParams.set("type","balanced");url.searchParams.set("format","json");if(optimize)url.searchParams.set("optimize_stops","true");url.searchParams.set("apiKey",apiKey);result=parseRoutingResponse(await provider(url));if(optimize&&!result.waypointOrder)throw new Error("Geoapify did not return a verifiable optimized waypoint order.")}catch(error){await complete(admin,key,claim,null,safeMessage(error).slice(0,500),null);throw error}
  const actualCredits=geoapifyRouteActualCredits(locations.length,optimize,result.distanceMeters,result.legDistancesMeters);
  await complete(admin,key,claim,result,null,actualCredits);return result;
}

export async function POST(request:Request){
  try{
    const {session,profile}=await authorized(),body=await request.json() as {routeId?:unknown;review?:{propertyId?:unknown;placeId?:unknown}};
    if(typeof body.routeId!=="string"||!/^[0-9a-f-]{36}$/i.test(body.routeId)) throw Object.assign(new Error("A valid Porter Route is required."),{status:400});
    const configValue=config(),routeResult=await session.rpc("get_porter_routes",{p_id:body.routeId});
    const route=(routeResult.data as PorterRouteWithStops[]|null)?.[0];
    if(routeResult.error||!route) throw Object.assign(new Error("Porter Route not found or access denied."),{status:404});
    if(route.status!=="Planned"||route.stops.length<2) throw Object.assign(new Error("Only Planned routes with at least two stops can be optimized."),{status:409});
    if(route.stops.length>configValue.maxWaypoints) throw Object.assign(new Error(`This route has ${route.stops.length} stops; the configured Geoapify waypoint limit is ${configValue.maxWaypoints}.`),{status:400});
    if(route.stops.some(stop=>["Completed","Cancelled"].includes(stop.visit?.status??""))) throw Object.assign(new Error("Completed and Cancelled stops cannot be optimized."),{status:409});
    const admin=createSupabaseAdminClient() as any,visitIds=route.stops.map(stop=>stop.visit_id);
    const visits=await admin.from("property_service_visits").select("id,property_id,scheduled_start_time,status").in("id",visitIds);
    if(visits.error) throw visits.error;
    const propertyIds=[...new Set((visits.data??[]).map((v:any)=>v.property_id).filter(Boolean))];
    const properties=await admin.from("properties").select("id,property_name,address,address_line_2,city,state,zip").in("id",propertyIds);
    if(properties.error) throw properties.error;
    const reviewPropertyId=typeof body.review?.propertyId==="string"?body.review.propertyId:undefined,reviewPlaceId=typeof body.review?.placeId==="string"?body.review.placeId:undefined;
    const locations:PorterRouteLocation[]=[]; const reviewNeeded:Array<{propertyId:string;label:string;address:string;candidates:GeoCandidate[]}>=[];
    for(const stop of [...route.stops].sort((a,b)=>a.stop_order-b.stop_order)){
      const visit=(visits.data??[]).find((v:any)=>v.id===stop.visit_id),property=(properties.data??[]).find((p:any)=>p.id===visit?.property_id);
      if(!property) throw new Error("A route stop property is unavailable.");
      const address=normalizePropertyAddress([property.address,property.address_line_2,property.city,property.state,property.zip]);
      const point=await geocode(admin,property,address,configValue.apiKey,configValue.daily,profile,reviewPropertyId===property.id?reviewPlaceId:undefined);
      const stored=!point?(await admin.from("porter_property_geocodes").select("candidates").eq("property_id",property.id).maybeSingle()).data:null;
      if(!point) reviewNeeded.push({propertyId:property.id,label:property.property_name||stop.visit?.property_label||"Property",address,candidates:(stored?.candidates??[]) as GeoCandidate[]});
      locations.push({stopId:stop.id,visitId:stop.visit_id,label:stop.visit?.property_label??property.property_name??"Porter Visit",address,scheduledStartTime:visit?.scheduled_start_time??null,visitStatus:visit?.status??null,latitude:point?.latitude??null,longitude:point?.longitude??null});
    }
    if(reviewNeeded.length) return Response.json({status:"review_required",routeVersion:route.updated_at,reviewNeeded,locations});
    const base=buildPorterRouteSuggestion(route,locations),current=await driving(admin,locations,configValue.apiKey,configValue.daily,false,configValue.maxDistanceChunks),optimized=await driving(admin,locations,configValue.apiKey,configValue.daily,true,configValue.maxDistanceChunks);
    const suggested=reorderByWaypointOrder(locations,optimized.waypointOrder);
    const safeSuggested=suggested.length===locations.length?suggested:locations;
    return Response.json({status:"ready",suggestion:{...base,suggestedOrder:safeSuggested,changed:safeSuggested.some((x,i)=>x.stopId!==locations[i].stopId),method:"geoapify_driving_v1",currentDrivingMiles:current.distanceMeters/1609.344,suggestedDrivingMiles:optimized.distanceMeters/1609.344,currentDrivingSeconds:current.durationSeconds,suggestedDrivingSeconds:optimized.durationSeconds},attribution:"Powered by Geoapify"});
  }catch(error){const status=Number((error as {status?:number}).status)||400;return Response.json({error:safeMessage(error)},{status})}
}
