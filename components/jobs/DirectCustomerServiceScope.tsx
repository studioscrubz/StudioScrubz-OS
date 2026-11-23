"use client";
import {useEffect,useState} from "react";
import {getSupabaseClient} from "@/lib/supabase/client";

/** Read-only catalog guidance for directly booked customer services.
 * This is not part of the client's locked/accepted proposal scope.
 */
export function DirectCustomerServiceScope({jobId}:{jobId:string}){
 const [description,setDescription]=useState<string|null>(null);
 const [error,setError]=useState(false);
 useEffect(()=>{
  let mounted=true;
  setDescription(null);setError(false);
  void getSupabaseClient()
   .rpc("get_direct_customer_service_description",{p_job_id:jobId})
   .then(({data,error})=>{
    if(!mounted)return;
    if(error){setError(true);return;}
    setDescription(typeof data==="string"&&data.trim()?data.trim():null);
   }).catch(()=>{if(mounted)setError(true);});
  return ()=>{mounted=false;};
 },[jobId]);
 if(error||!description)return null;
 return <section aria-label="Service description" className="mt-3 rounded-lg border border-[#143d1a]/15 bg-[#f6f8f5] p-3">
  <h4 className="text-sm font-extrabold text-[#143d1a]">Service Description — Cleaning Tasks</h4>
  <p className="mt-1 text-xs text-neutral-600">StudioScrubz service catalog guidance. Follow the job's accepted scope and approved changes if any details differ.</p>
  <p className="mt-2 whitespace-pre-line text-sm text-neutral-800">{description}</p>
 </section>;
}
