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