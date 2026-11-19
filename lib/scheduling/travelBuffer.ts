/** Shared travel transition rules for scheduled cleaning appointments. */
export const DEFAULT_TRAVEL_BUFFER_MINUTES=60;
export type BuildingAddress={address?:string|null;address_line_2?:string|null;city?:string|null;state?:string|null;zip?:string|null};
function clean(value:string|null|undefined){return (value??"").trim().toLowerCase().replace(/[.,#]/g,"").replace(/\s+/g," ");}
function street(value:string|null|undefined){
 // Unit is a separate property field when possible. For imported addresses, strip
 // an explicit unit/suite suffix only (do not strip a building's street number).
 return clean(value).replace(/\s+(?:apt|apartment|unit|suite|ste)\s+[a-z0-9-]+$/i,"").trim();
}
export function sameBuilding(a:BuildingAddress|null|undefined,b:BuildingAddress|null|undefined){
 if(!a||!b)return false;
 const first=street(a.address),second=street(b.address);
 if(!first||!second||first!==second)return false;
 // All available geographic fields must agree, and at least city or ZIP must be
 // specified on both sides to avoid equating unrelated streets.
 let verified=false;
 for(const key of ["city","state","zip"] as const){
  const av=clean(a[key]),bv=clean(b[key]);
  if(av&&bv&&av!==bv)return false;
  if((key==="city"||key==="zip")&&av&&bv)verified=true;
 }
 return verified;
}
export function bufferMinutesBetween(a:BuildingAddress|null|undefined,b:BuildingAddress|null|undefined){
 return sameBuilding(a,b)?0:DEFAULT_TRAVEL_BUFFER_MINUTES;
}
export function appointmentConflict(a:{start:number;end:number;building?:BuildingAddress|null},b:{start:number;end:number;building?:BuildingAddress|null}){
 // A transition buffer applies AFTER the earlier job, not on both sides.
 const [earlier,later]=a.start<=b.start?[a,b]:[b,a];
 const buffer=bufferMinutesBetween(earlier.building,later.building);
 return earlier.end+buffer>later.start;
}
