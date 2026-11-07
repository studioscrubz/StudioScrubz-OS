import "server-only";
import {OPERATIONAL_PHOTO_BUCKET} from "@/types/photo";
import {contractorContext,requirePartner,uuid,handleContractorError,noCache,ContractorAccessError} from "@/lib/contractors/server";
// Only customer-authorized invoice completion photos are exposed; internal Job photos never are.
export async function GET(request:Request){
 try{
  const ctx=await contractorContext();requirePartner(ctx);
  const jobId=uuid(new URL(request.url).searchParams.get("jobId"));
  const {data:op,error:oe}=await ctx.admin.from("contractor_opportunities")
   .select("id").eq("company_id",ctx.companyId).eq("linked_job_id",jobId).maybeSingle();
  if(oe||!op)throw new ContractorAccessError("Job is not assigned to this company.",404);
  const {data:invoice,error:ie}=await ctx.admin.from("invoices").select("id")
   .eq("job_id",jobId).is("archived_at",null).neq("status","Cancelled").limit(1).maybeSingle();
  if(ie)throw ie;
  if(!invoice)return noCache({photos:[]});
  const {data:photos,error}=await ctx.admin.from("invoice_job_photos")
   .select("id,category,caption,storage_path").eq("invoice_id",invoice.id)
   .eq("customer_visible",true).limit(50);
  if(error)throw error;
  if(!photos?.length)return noCache({photos:[]});
  const signed=await ctx.admin.storage.from(OPERATIONAL_PHOTO_BUCKET)
   .createSignedUrls(photos.map(x=>x.storage_path),60);
  if(signed.error)throw signed.error;
  return noCache({photos:photos.map((p,i)=>({id:p.id,category:p.category,caption:p.caption,
    url:signed.data?.[i]?.signedUrl??null})).filter(p=>p.url)});
 }catch(error){return handleContractorError(error);}
}
