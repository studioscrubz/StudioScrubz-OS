"use client";
import type { PendingCalendarResult } from "./pending";

export async function requestPendingJobCalendarSync(jobId:string,request:typeof fetch=fetch):Promise<PendingCalendarResult>{
  try{
    const response=await request(`/api/integrations/google-calendar/jobs/${encodeURIComponent(jobId)}/process-pending`,{method:"POST"});
    const body=await response.json();
    if(!response.ok){console.warn("Prompt Google Calendar sync failed",{jobId,status:response.status,error:body.error});return{processed:false,skipped:"request_failed"}}
    return body as PendingCalendarResult;
  }catch(cause){console.warn("Prompt Google Calendar sync request failed",{jobId,error:cause instanceof Error?cause.message:"Unknown error"});return{processed:false,skipped:"request_failed"}}
}
