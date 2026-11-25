export type ContractorScopeCatalog={version:string;source:string;services:string[];areas:Array<{area:string;tasks:Array<{task:string;included:boolean[]}>}>;notes:string[];contact_phone?:string};
export function roseServiceIndex(service:string):number|null {
 const s=service.trim().toLowerCase().replace(/[–—-]/g," ").replace(/\s+/g," ");
 if(/move\s*in|move\s*out|moveout|movein/.test(s))return 2;
 if(/deep/.test(s))return 1;
 if(/regular|standard|basic/.test(s))return 0;
 return null;
}
export function contractorServiceScope(catalog:ContractorScopeCatalog|null|undefined,service:string):string|null {
 if(!catalog?.areas?.length)return null;
 const index=roseServiceIndex(service);
 if(index===null)return null;
 const blocks=catalog.areas.map(section=>{
  const tasks=section.tasks.filter(item=>item.included[index]).map(item=>"- "+item.task);
  return tasks.length?section.area+":\n"+tasks.join("\n"):null;
 }).filter(Boolean);
 return [catalog.source+" — "+(catalog.services[index]??service),"Scope of work:",...blocks,
 "Exclusions and additional services:",...catalog.notes.map(note=>"- "+note)].join("\n\n");
}
export const STARBUCKS_HIGH_DUSTING_SCOPE="Cover merchandise, furnishings, fixtures, displays, and food-service areas with protective plastic or tarps before dusting.\n\nHigh-dust applicable customer-accessible surfaces at eight (8) feet and above.\n\nClean lighting fixtures, vents, ceiling tiles, exposed ductwork, soffits, and tops of merchandising fixtures.\n\nVacuum exposed overhead structural elements, including soffits above serving areas.\n\nRemove light dust from acoustic sound panels using a clean, soft upholstery-brush vacuum attachment.\n\nRemove dust and cobwebs from ceiling corners, edges, molding, and trim.\n\nVacuum-clean ceiling fans.\n\nVacuum interior signage and menu boards without scratching or damaging surfaces.\n\nVacuum interior visual merchandising props and return items to their original positions.\n\nVacuum exposed horizontal and vertical surfaces with visible dust.\n\nVacuum exposed HVAC components, including ductwork, transfer grilles, return grilles, supply grilles, vents, VAV boxes, and air-handling units.\n\nClean lower HVAC vents located above the bar area.\n\nDust interior signage, pipes, poles, and exposed hardware.\n\nSpot-clean visible dust and cobwebs from exposed rafters and joists.\n\nVacuum or wipe walls, columns, poles, and ceiling tiles around vents using appropriate cleaning products.\n\nWipe down areas above the production line where dust has accumulated.\n\nRemove protective coverings after cleaning.\n\nVacuum affected flooring to remove dust and debris generated during high-dusting services.\n\nClean the janitorial storage or mop-sink area if used during service.\n\nPhotograph and report visibly soiled areas requiring unauthorized high-access equipment.\n\nInspect completed work and ensure all cleaned areas are left in proper condition.\n\nFollow all applicable OSHA and site-specific safety requirements.\n\nSERVICE COMPLETION REQUIREMENTS\n\nComplete required arrival check-in with LJ Facility Services.\n\nFollow authorized store entry and alarm-disarming procedures.\n\nCapture a minimum of five photographs: one entrance/address photograph, two before photographs, and two corresponding after photographs.\n\nSubmit required photographs and service completion confirmation to LJ Facility Services.\n\nRemove cleaning supplies, equipment, coverings, and debris.\n\nSecure all doors and windows.\n\nRearm the security alarm according to the provided instructions.\n\nConfirm the location is properly secured before departure.\n\nScope Exclusions: High-access work requiring lifts, scaffolding, or other specialized access equipment is excluded unless separately authorized in writing.";
export function isStarbucksLocation(company:string|null|undefined,property:string|null|undefined):boolean {return company?.trim().toLowerCase()==="lj facility services llc" && /^starbucks\b/i.test(property?.trim()??"");}
export function starbucksScope(company:string|null|undefined,property:string|null|undefined,service:string):string|null {return isStarbucksLocation(company,property)&&/^(high[ -]?dusting|other cleaning)$/i.test(service.trim())?STARBUCKS_HIGH_DUSTING_SCOPE:null;}
