import "server-only";
import {OPERATIONAL_PHOTO_BUCKET,OPERATIONAL_PHOTO_MIME_TYPES} from "@/types/photo";
import {contractorContext,requirePartner,uuid,handleContractorError,noCache,ContractorAccessError} from "@/lib/contractors/server";
// Only customer-authorized invoice completion photos are exposed; internal Job photos never are.
export async function GET(request:Request){
 try{
  const ctx=await contractorContext();requirePartner(ctx);
  const params=new URL(request.url).searchParams;
  const jobId=uuid(params.get("jobId"));
  const photoId=params.has("photoId")?uuid(params.get("photoId")):null;
  const {data:op,error:oe}=await ctx.admin.from("contractor_opportunities")
   .select("id,quality_approved_at").eq("company_id",ctx.companyId).eq("linked_job_id",jobId).maybeSingle();
  if(oe||!op)throw new ContractorAccessError("Job is not assigned to this company.",404);
  if(!op.quality_approved_at)throw new ContractorAccessError("Completion photos are available after StudioScrubz quality review.",403);
  const {data:invoices,error:ie}=await ctx.admin.from("invoices").select("id")
   .eq("job_id",jobId).is("archived_at",null).neq("status","Cancelled");
  if(ie)throw ie;
  if(!invoices?.length){
   if(photoId)throw new ContractorAccessError("Completion photo unavailable.",404);
   return noCache({photos:[]});
  }
  const visible=ctx.admin.from("invoice_job_photos").select("id,category,caption,storage_path,mime_type")
   .eq("job_id",jobId).in("invoice_id",invoices.map(x=>x.id)).eq("customer_visible",true);
  if(photoId){
   const {data:photo,error}=await visible.eq("id",photoId).maybeSingle();
   if(error)throw error;
   if(!photo)throw new ContractorAccessError("Completion photo unavailable.",404);
   if(!(OPERATIONAL_PHOTO_MIME_TYPES as readonly string[]).includes(photo.mime_type))
    throw new ContractorAccessError("Unsupported completion photo format.",415);
   const {data:stream,error:downloadError}=await ctx.admin.storage.from(OPERATIONAL_PHOTO_BUCKET).download(photo.storage_path).asStream();
   if(downloadError||!stream)throw new ContractorAccessError("Completion photo unavailable.",503);
   return new Response(stream,{headers:{
    "Content-Type":photo.mime_type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
   }});
  }
  const {data:photos,error}=await visible.order("id").limit(50);
  if(error)throw error;
  return noCache({photos:(photos??[]).map(p=>({id:p.id,category:p.category,caption:p.caption,
    url:`/api/contractors/completion-photos?jobId=${jobId}&photoId=${p.id}`}))});
 }catch(error){return handleContractorError(error);}
}
