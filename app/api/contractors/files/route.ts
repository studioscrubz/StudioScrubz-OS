import "server-only";
import {randomUUID} from "node:crypto";
import {contractorContext,ContractorAccessError,requirePartner,uuid,audited,handleContractorError,noCache} from "@/lib/contractors/server";
const BUCKET="contractor-private",MAX=15*1024*1024;
const mimes:Record<string,string>={"application/pdf":"pdf","image/png":"png","image/jpeg":"jpg","image/webp":"webp"};
function magic(bytes:Uint8Array,mime:string):boolean{
 if(mime==="application/pdf")return String.fromCharCode(...bytes.subarray(0,5))==="%PDF-";
 if(mime==="image/png")return [137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x);
 if(mime==="image/jpeg")return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==="image/webp")return String.fromCharCode(...bytes.subarray(0,4))==="RIFF"&&String.fromCharCode(...bytes.subarray(8,12))==="WEBP";
 return false;
}
export async function GET(request:Request){
 try{
  const ctx=await contractorContext();
  const id=uuid(new URL(request.url).searchParams.get("id"));
  const {data:document,error}=await ctx.admin.from("contractor_documents").select("id,company_id,storage_path")
   .eq("id",id).maybeSingle();
  if(error||!document||ctx.type==="partner"&&document.company_id!==ctx.companyId)
   throw new ContractorAccessError("File unavailable.",404);
  const {data:signed,error:se}=await ctx.admin.storage.from(BUCKET).createSignedUrl(document.storage_path,60);
  if(se||!signed)throw new ContractorAccessError("Secure file link unavailable.",503);
  return noCache({url:signed.signedUrl,expiresInSeconds:60});
 }catch(error){return handleContractorError(error);}
}
export async function POST(request:Request){
 try{
  const ctx=await contractorContext();
  const form=await request.formData();
  const uploaded=form.get("file"),category=form.get("category"),companyArg=form.get("companyId");
  if(!(uploaded instanceof File))throw new ContractorAccessError("Select a file.",400);
  if(uploaded.size<1||uploaded.size>MAX||!Object.hasOwn(mimes,uploaded.type))throw new ContractorAccessError("Unsupported or oversized file.",400);
  const bytes=new Uint8Array(await uploaded.arrayBuffer());
  if(!magic(bytes,uploaded.type))throw new ContractorAccessError("File contents do not match declared format.",400);
  const companyId=ctx.type==="partner"?ctx.companyId:uuid(companyArg);
  const categories=["Scope","Photo","Insurance","Tax","Agreement","Other"];
  if(typeof category!=="string"||!categories.includes(category))throw new ContractorAccessError("Invalid document category.",400);
  const opportunityArg=form.get("opportunityId");
  const opportunityId=typeof opportunityArg==="string"&&opportunityArg?uuid(opportunityArg):null;
  const {data:company}=await ctx.admin.from("contractor_companies").select("id,status").eq("id",companyId).maybeSingle();
  if(!company||company.status==="Archived"||company.status==="Suspended")throw new ContractorAccessError("Company is not active.",403);
  if(opportunityId){
   const {data:op}=await ctx.admin.from("contractor_opportunities").select("id").eq("id",opportunityId)
    .eq("company_id",companyId).maybeSingle();
   if(!op)throw new ContractorAccessError("Opportunity is not within this company.",403);
  }
  if(ctx.type==="partner"&&category==="Tax")throw new ContractorAccessError("Upload tax documents through approved onboarding only.",403);
  const fileName=uploaded.name.replace(/[\r\n]/g," ").slice(0,180).trim()||"attachment";
  const path=`${companyId}/${opportunityId??"company"}/${randomUUID()}.${mimes[uploaded.type]}`;
  const result=await ctx.admin.storage.from(BUCKET).upload(path,bytes,{contentType:uploaded.type,upsert:false});
  if(result.error)throw result.error;
  const saved=await ctx.admin.from("contractor_documents").insert({
   company_id:companyId,opportunity_id:opportunityId,uploaded_by:ctx.userId,
   storage_path:path,file_name:fileName,mime_type:uploaded.type,file_size:uploaded.size,category,
  }).select("id").single();
  if(saved.error||!saved.data){
   await ctx.admin.storage.from(BUCKET).remove([path]);
   throw saved.error??new Error("Document metadata could not be saved.");
  }
  await audited(ctx,{companyId,opportunityId:opportunityId??undefined,type:"File Uploaded",
   detail:{documentId:saved.data.id,category,mime:uploaded.type}});
  return noCache({documentId:saved.data.id});
 }catch(error){return handleContractorError(error);}
}
