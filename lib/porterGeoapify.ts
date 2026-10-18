import "server-only";
import { createHash } from "node:crypto";

export type GeoCandidate = { latitude:number; longitude:number; formattedAddress:string; placeId:string|null; confidence:number; matchType:string|null };
export type DrivingRoute = { distanceMeters:number; durationSeconds:number; waypointOrder:number[] | null; legDistancesMeters:number[] };

function routingBaseCredits(waypointCount:number,optimize:boolean){
  if(!Number.isInteger(waypointCount)||waypointCount<2) throw new Error("At least two route waypoints are required.");
  const pairs=waypointCount-1;
  const flexible=Math.max(0,waypointCount-2);
  const optimization=optimize&&waypointCount>3?flexible*Math.min(flexible,10):0;
  return pairs+optimization;
}
export function geoapifyRouteReservedCredits(waypointCount:number,optimize:boolean,maxDistanceChunks=10){
  if(!Number.isInteger(maxDistanceChunks)||maxDistanceChunks<1) throw new Error("A positive route distance credit reserve is required.");
  const pairs=waypointCount-1,optimization=routingBaseCredits(waypointCount,optimize)-pairs;
  return pairs*maxDistanceChunks+optimization;
}
export function geoapifyRouteActualCredits(waypointCount:number,optimize:boolean,distanceMeters:number,legDistancesMeters?:number[]){
  if(!Number.isFinite(distanceMeters)||distanceMeters<0) throw new Error("A valid route distance is required for credit accounting.");
  const pairs=waypointCount-1,optimization=routingBaseCredits(waypointCount,optimize)-pairs;
  const validLegs=legDistancesMeters?.filter(distance=>Number.isFinite(distance)&&distance>=0);
  const driving=validLegs?.length===pairs
    ?validLegs.reduce((total,distance)=>total+Math.max(1,Math.ceil(distance/500_000)),0)
    :pairs*Math.max(1,Math.ceil(distanceMeters/500_000));
  return driving+optimization;
}
export function validateGeoapifyCreditSettlement(reservedCredits:number,actualCredits:number|null){
  if(!Number.isInteger(reservedCredits)||reservedCredits<1) throw new Error("A positive credit reservation is required.");
  if(actualCredits!==null&&(!Number.isInteger(actualCredits)||actualCredits<0||actualCredits>reservedCredits)) throw new Error("Verified actual credits must fit the reservation.");
  return actualCredits;
}

export function normalizePropertyAddress(parts: Array<string | null | undefined>) {
  const value = parts.map(part => part?.trim()).filter(Boolean).join(", ").replace(/\s+/g," ");
  if (value.length < 12 || !/\d/.test(value) || value.split(",").length < 3) throw new Error("A complete street, city, state, and postal address is required.");
  return value;
}
export function stableHash(value:string){ return createHash("sha256").update(value).digest("hex"); }
export function validCoordinate(latitude:number,longitude:number){ return Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180; }

export function parseGeocodingResponse(value:unknown): GeoCandidate[] {
  const results = (value as {results?:unknown[]})?.results;
  if(!Array.isArray(results)) throw new Error("Geoapify returned an invalid geocoding response.");
  return results.flatMap(raw=>{
    const row=raw as Record<string,unknown>, rank=row.rank as Record<string,unknown>|undefined;
    const latitude=Number(row.lat),longitude=Number(row.lon),confidence=Number(rank?.confidence);
    if(!validCoordinate(latitude,longitude)||!Number.isFinite(confidence)||typeof row.formatted!=="string") return [];
    return [{latitude,longitude,formattedAddress:row.formatted,placeId:typeof row.place_id==="string"?row.place_id:null,confidence,matchType:typeof rank?.match_type==="string"?rank.match_type:null}];
  });
}
export function confidentlyVerified(candidates:GeoCandidate[],minimum=.9){
  const first=candidates[0], second=candidates[1];
  return Boolean(first&&first.confidence>=minimum&&first.matchType==="full_match"&&(!second||first.confidence-second.confidence>=.05));
}
export function parseRoutingResponse(value:unknown):DrivingRoute{
  const result=(value as {results?:unknown[]})?.results?.[0] as Record<string,unknown>|undefined;
  const distanceMeters=Number(result?.distance),durationSeconds=Number(result?.time);
  if(!Number.isFinite(distanceMeters)||distanceMeters<0||!Number.isFinite(durationSeconds)||durationSeconds<0) throw new Error("Geoapify returned an invalid driving-route response.");
  const order=Array.isArray(result?.waypoints)?(result.waypoints as Array<Record<string,unknown>>).map(item=>Number(item.original_index)):null;
  const legs=Array.isArray(result?.legs)?(result.legs as Array<Record<string,unknown>>).map(item=>Number(item.distance)).filter(Number.isFinite):[];
  return {distanceMeters,durationSeconds,waypointOrder:order&&order.every(Number.isInteger)?order:null,legDistancesMeters:legs};
}
export function reorderByWaypointOrder<T>(items:T[],order:number[]|null){
  if(!order) return items;
  if(order.length!==items.length||new Set(order).size!==items.length||order.some(index=>index<0||index>=items.length)) throw new Error("Geoapify returned an invalid waypoint order.");
  return order.map(index=>items[index]);
}
