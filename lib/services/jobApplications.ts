import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import { hasPermission } from "@/lib/auth/permissions";
import type { JobApplication,JobApplicationStatus } from "@/types/jobApplication";
type RpcResult={data:unknown;error:{message:string}|null};type JobApplicationRpcClient={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<RpcResult>};
async function authorize(){if(!hasPermission(await getCurrentProfile(),"jobApplications.manage"))throw new Error("Job application access denied.")}
export async function getJobApplications():Promise<JobApplication[]>{await authorize();const{data,error}=await (getSupabaseClient() as unknown as JobApplicationRpcClient).rpc("get_job_applications");if(error)throw new Error(error.message);return(data??[]) as JobApplication[]}
export async function updateJobApplication(id:string,status:JobApplicationStatus,internalNotes:string):Promise<void>{await authorize();const{error}=await (getSupabaseClient() as unknown as JobApplicationRpcClient).rpc("update_job_application",{p_application_id:id,p_status:status,p_internal_notes:internalNotes});if(error)throw new Error(error.message)}
