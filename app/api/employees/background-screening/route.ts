import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ScreeningStatus =
  | "not_started" | "conditional_offer_issued" | "authorization_pending"
  | "authorized" | "invited" | "in_progress" | "completed_review_pending"
  | "individualized_review" | "pre_adverse_action" | "response_pending"
  | "cleared" | "final_adverse_decision" | "declined" | "canceled";

const transitions: Record<ScreeningStatus, ScreeningStatus[]> = {
  not_started: ["conditional_offer_issued"],
  conditional_offer_issued: ["authorization_pending","canceled"],
  authorization_pending: ["authorized","declined","canceled"],
  authorized: ["invited","canceled"],
  invited: ["in_progress","canceled"],
  in_progress: ["completed_review_pending","canceled"],
  completed_review_pending: ["cleared","individualized_review"],
  individualized_review: ["cleared","pre_adverse_action"],
  pre_adverse_action: ["response_pending","cleared"],
  response_pending: ["cleared","final_adverse_decision"],
  cleared: [], final_adverse_decision: [], declined: [], canceled: [],
};
const validStatuses = new Set<string>(Object.keys(transitions));
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "no-store" };
class ApiError extends Error { constructor(message:string, public status:number=400){super(message);} }

async function authorize() {
  const client = await createSupabaseServerClient();
  const {data:{user},error} = await client.auth.getUser();
  if (error || !user) throw new ApiError("Sign in is required.",401);
  const admin = createSupabaseAdminClient();
  const {data:profile,error:profileError} = await admin.from("user_profiles").select("id,role,is_active").eq("id",user.id).maybeSingle();
  if(profileError) throw profileError;
  // Explicitly restrict screening report status to HR-authorized roles.
  if(!profile?.is_active)throw new ApiError("Background screening management is restricted.",403);
  if(!["Master Admin","Administrator"].includes(profile.role)){
    if(profile.role!=="Manager")throw new ApiError("Background screening management is restricted.",403);
    const {data:allowed,error:permissionError}=await admin.from("employee_screening_authorized_reviewers")
      .select("user_id").eq("user_id",user.id).maybeSingle();
    if(permissionError)throw permissionError;
    if(!allowed)throw new ApiError("Management screening access has not been authorized.",403);
  }
  return { admin, actor:user.id };
}
function reject(error:unknown){
 const status=error instanceof ApiError?error.status:500;
 return Response.json({error:status===500?"Screening request could not be completed.":(error as Error).message},{status,headers:noStore});
}
function str(v:unknown,max=300){return typeof v==="string"?v.trim().slice(0,max):"";}
function validateId(v:unknown){ if(typeof v!=="string"||!uuidRe.test(v)) throw new ApiError("Invalid employee identifier."); return v;}
export async function GET(request:Request) {
 try {
  const {admin}=await authorize();
  const url=new URL(request.url);
  const employeeId=url.searchParams.get("employeeId");
  if(url.searchParams.get("summary")==="1"){
    const {count,error:countError}=await admin.from("employee_background_screenings")
      .select("employee_id",{count:"exact",head:true})
      .in("status",["completed_review_pending","individualized_review","pre_adverse_action","response_pending"]);
    if(countError)throw countError;
    return Response.json({needsReview:count??0},{headers:noStore});
  }
  const query=admin.from("employee_background_screenings").select("employee_id,status,provider,provider_reference,conditional_offer_at,authorization_recorded_at,authorization_reference,invitation_at,completed_at,reviewed_at,cleared_at,updated_at").order("updated_at",{ascending:false});
  const {data,error}=employeeId?await query.eq("employee_id",validateId(employeeId)):await query.limit(200);
  if(error) throw error;
  const eventQuery=admin.from("employee_background_screening_events")
    .select("id,employee_id,previous_status,next_status,actor_id,occurred_at,action_reference")
    .order("occurred_at",{ascending:false}).limit(100);
  const {data:events,error:eventError}=employeeId
    ? await eventQuery.eq("employee_id",validateId(employeeId))
    : await eventQuery;
  if(eventError)throw eventError;
  return Response.json({screenings:data??[],events:events??[]},{headers:noStore});
 }catch(e){return reject(e);}
}
export async function POST(request:Request) {
 try {
  const {admin,actor}=await authorize();
  let body:Record<string,unknown>;
  try {body=await request.json();}catch{throw new ApiError("Invalid request.");}
  const employeeId=validateId(body.employeeId);
  const next=body.status;
  if(typeof next!=="string"||!validStatuses.has(next))throw new ApiError("Invalid screening action.");
  const status=next as ScreeningStatus;
  const evidence=str(body.reference);
  const {data:employee,error:empError}=await admin.from("employees")
    .select("id,employment_type,archived_at").eq("id",employeeId).maybeSingle();
  if(empError)throw empError;
  if(!employee||employee.archived_at)throw new ApiError("Employee not found or archived.",404);
  if(employee.employment_type==="1099")throw new ApiError("This workflow applies to W-2 hires only.");
  const {data:existing,error:readError}=await admin.from("employee_background_screenings")
    .select("*").eq("employee_id",employeeId).maybeSingle();
  if(readError)throw readError;
  const from=(existing?.status??"not_started") as ScreeningStatus;
  if(!transitions[from]?.includes(status))throw new ApiError("Invalid screening progression. Refresh and try again.",409);
  if(["authorized","invited","in_progress","completed_review_pending"].includes(status)
     && !(status==="authorized"?evidence:existing?.authorization_reference))
    throw new ApiError("A verifiable authorization reference is required.");
  if(status==="pre_adverse_action"&&!evidence)
    throw new ApiError("Record the individualized assessment reference before proceeding.");
  if(status==="final_adverse_decision"&&!evidence)
    throw new ApiError("Record proof that required notices and response procedures were completed.");
  if(["cleared"].includes(status) && body.confirmHumanReview!==true)
    throw new ApiError("Human review confirmation is required.");
  const now=new Date().toISOString();
  const patch:Record<string,unknown> = {employee_id:employeeId,status,updated_at:now};
  if(status==="conditional_offer_issued")patch.conditional_offer_at=now;
  if(status==="authorized"){patch.authorization_recorded_at=now;patch.authorization_reference=evidence;}
  if(status==="invited"){patch.invitation_at=now;patch.provider_reference=evidence||existing?.provider_reference||null;}
  if(status==="completed_review_pending")patch.completed_at=now;
  if(status==="cleared"){patch.reviewed_at=now;patch.reviewed_by=actor;patch.cleared_at=now;}
  // First-save insert conflict is handled by upsert; further updates use optimistic locking.
  if(existing?.updated_at) {
    const {data,error}=await admin.from("employee_background_screenings")
      .update(patch).eq("employee_id",employeeId).eq("updated_at",existing.updated_at).select("employee_id,status").maybeSingle();
    if(error)throw error;
    if(!data)throw new ApiError("Screening status changed; refresh before updating.",409);
  }else{
    const {error}=await admin.from("employee_background_screenings").insert(patch);
    if(error)throw error;
  }
  const {error:auditError}=await admin.from("employee_background_screening_events").insert({
    employee_id:employeeId,previous_status:from,next_status:status,actor_id:actor,
    action_reference:evidence||null,
  });
  if(auditError)throw auditError;
  return Response.json({ok:true,status},{headers:noStore});
 }catch(e){return reject(e);}
}
