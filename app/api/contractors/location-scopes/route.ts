import "server-only";
import {contractorContext,requireInternal,uuid,handleContractorError,noCache,ContractorAccessError} from "@/lib/contractors/server";

type ScopeItem={text?:unknown;label?:unknown;description?:unknown};
export async function GET(request:Request){
 try{
  const ctx=await contractorContext();
  requireInternal(ctx);
  const url=new URL(request.url);
  const companyId=uuid(url.searchParams.get("companyId"));
  const propertyId=uuid(url.searchParams.get("propertyId"));
  const {data:company,error:companyError}=await ctx.admin.from("contractor_companies")
   .select("client_id").eq("id",companyId).eq("status","Active").maybeSingle();
  if(companyError)throw companyError;
  if(!company?.client_id)throw new ContractorAccessError("Contractor client is unavailable.",404);
  const {data:property,error:propertyError}=await ctx.admin.from("properties")
   .select("id").eq("id",propertyId).eq("client_id",company.client_id).maybeSingle();
  if(propertyError)throw propertyError;
  if(!property)throw new ContractorAccessError("Property does not belong to the selected contractor client.",404);
  const {data:jobs,error:jobError}=await ctx.admin.from("jobs")
   .select("id,service_name,scope,updated_at")
   .eq("client_id",company.client_id).eq("property_id",propertyId)
   .is("archived_at",null).order("updated_at",{ascending:false}).limit(100);
  if(jobError)throw jobError;
  const serviceScopes=new Map<string,{name:string;scope:string}>();
  for(const job of jobs??[]){
   const name=typeof job.service_name==="string"?job.service_name.trim():"";
   if(!name)continue;
   const key=name.toLowerCase();
   const items=Array.isArray(job.scope)?job.scope as ScopeItem[]:[];
   const scope=items.map(item=>typeof item?.text==="string"?item.text:typeof item?.label==="string"?item.label:typeof item?.description==="string"?item.description:"").filter(Boolean).join("\n");
   if(scope&&!serviceScopes.has(key))serviceScopes.set(key,{name,scope});
  }
  return noCache({services:[...serviceScopes.values()]});
 }catch(error){return handleContractorError(error);}
}
