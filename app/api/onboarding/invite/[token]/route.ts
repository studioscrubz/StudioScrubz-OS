import "server-only";
import {createSupabaseAdminClient} from "@/lib/supabase/admin";
import {hashToken,OnboardingError,responseError,noStore} from "@/lib/onboarding/server";
function tokenValue(token:string){
 if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))throw new OnboardingError("Invalid invitation.",404);
 return hashToken(token);
}
async function lookup(token:string){
 const admin=createSupabaseAdminClient();
 const {data,error}=await admin.from("employee_onboarding_cases")
  .select("id,position,hourly_rate,minimum_shift_hours,candidate_ack_at,invite_expires_at,status")
  .eq("invite_token_hash",tokenValue(token)).maybeSingle();
 if(error)throw error;
 if(!data||!data.invite_expires_at||new Date(data.invite_expires_at).getTime()<=Date.now()
   ||!["invited","in_progress","ready_for_review"].includes(data.status))
    throw new OnboardingError("This onboarding invitation has expired or is unavailable. Contact the hiring team.",410);
 return {admin,caseRow:data};
}
export async function GET(_request:Request,{params}:{params:Promise<{token:string}>}){
 try{
  const {token}=await params;
  const {caseRow}=await lookup(token);
  return Response.json({position:caseRow.position,hourlyRate:caseRow.hourly_rate,
   minimumShiftHours:caseRow.minimum_shift_hours,acknowledged:!!caseRow.candidate_ack_at},
   {headers:noStore});
 }catch(error){return responseError(error);}
}
export async function POST(request:Request,{params}:{params:Promise<{token:string}>}){
 try{
  const {token}=await params;
  const {admin,caseRow}=await lookup(token);
  if((request.headers.get("content-length")??"").length>20)throw new OnboardingError("Invalid request.");
  const raw=await request.text();
  if(raw.length>1000)throw new OnboardingError("Invalid request.");
  let body:Record<string,unknown>;
  try{body=JSON.parse(raw);}catch{throw new OnboardingError("Invalid request.");}
  if(body.acknowledgeTerms!==true)throw new OnboardingError("Review the orientation information and confirm acknowledgment.");
  if(!caseRow.candidate_ack_at){
   const {error}=await admin.from("employee_onboarding_cases").update({
    candidate_ack_at:new Date().toISOString(),status:"in_progress",updated_at:new Date().toISOString()
   }).eq("id",caseRow.id).is("candidate_ack_at",null);
   if(error)throw error;
   const {error:ev}=await admin.from("employee_onboarding_events").insert({
     case_id:caseRow.id,event_type:"candidate_acknowledged",actor_id:null
   });
   if(ev)console.error("Failed to log candidate orientation acknowledgment",ev);
  }
  return Response.json({ok:true},{headers:noStore});
 }catch(error){return responseError(error);}
}
