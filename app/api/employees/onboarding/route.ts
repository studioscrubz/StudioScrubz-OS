import "server-only";
import {randomUUID} from "node:crypto";
import {sendResendEmail} from "@/lib/email/resend";
import {ONBOARDING_STEPS,onboardingStepsComplete} from "@/lib/onboarding/steps";
import {authorizedHiring,responseError,OnboardingError,noStore,id,requiredText,newInviteToken,hashToken} from "@/lib/onboarding/server";

type Admin=Awaited<ReturnType<typeof authorizedHiring>>["admin"];
type CaseRow={id:string;employee_id:string;application_id:string|null;candidate_email:string;position:string;hourly_rate:number;status:string;invite_sent_at:string|null;candidate_ack_at:string|null;approved_at:string|null;start_date:string|null;created_at:string};
type Step={case_id:string;code:string;completed_at:string|null;completed_by:string|null};

async function audit(admin:Admin,caseId:string,eventType:string,actor:string|null){
 const {error}=await admin.from("employee_onboarding_events").insert({case_id:caseId,event_type:eventType,actor_id:actor});
 if(error)console.error("Onboarding event audit failed",error);
}
async function load(admin:Admin){
 const [{data:cases,error:ce},{data:steps,error:se},{data:employees,error:ee},{data:applications,error:ae},{data:screenings,error:be}]=await Promise.all([
  admin.from("employee_onboarding_cases").select("id,employee_id,application_id,candidate_email,position,hourly_rate,status,invite_sent_at,candidate_ack_at,approved_at,start_date,created_at").order("created_at",{ascending:false}).limit(150),
  admin.from("employee_onboarding_steps").select("case_id,code,completed_at,completed_by"),
  admin.from("employees").select("id,first_name,last_name,email,department,employment_type,employment_status,archived_at").is("archived_at",null).order("last_name"),
  admin.from("job_applications").select("id,full_name,email,phone,status,opening_identifier").eq("status","Selected").eq("opening_identifier","scrub-tech").limit(100),
  admin.from("employee_background_screenings").select("employee_id,status")
 ]);
 if(ce||se||ee||ae||be)throw ce||se||ee||ae||be;
 return {cases:cases??[],steps:steps??[],employees:employees??[],
   selectedApplications:applications??[],screenings:screenings??[]};
}
export async function GET(){
 try {const {admin}=await authorizedHiring();return Response.json(await load(admin),{headers:noStore});}
 catch(e){return responseError(e);}
}
export async function POST(req:Request){
 try{
  const {admin,actor}=await authorizedHiring();
  const text=await req.text();
  if(text.length>12000)throw new OnboardingError("Request too large.");
  let body:Record<string,unknown>;
  try{body=JSON.parse(text);}catch{throw new OnboardingError("Invalid request.");}
  const action=requiredText(body.action,35);
  if(action==="create"){
    const position=body.position;
    if(position!=="Scrub Technician"&&position!=="Crew Lead")throw new OnboardingError("Select a valid role.");
    const rate=position==="Crew Lead"?27:25;
    let employeeId:string;
    let applicationId:string|null=null;
    let email:string;
    let newEmployeeId:string|null=null;
    if(body.applicationId){
      applicationId=id(body.applicationId);
      const {data:app,error}=await admin.from("job_applications").select("id,full_name,email,phone,status,opening_identifier")
        .eq("id",applicationId).maybeSingle();
      if(error)throw error;
      if(!app||app.status!=="Selected"||app.opening_identifier!=="scrub-tech")
        throw new OnboardingError("Applicant must be selected for the SCRUBZ Tech opening.");
      const {data:already,error:existingError}=await admin.from("employee_onboarding_cases").select("id").eq("application_id",applicationId).maybeSingle();
      if(existingError)throw existingError;
      if(already)throw new OnboardingError("This application already has onboarding.",409);
      email=requiredText(app.email,254);
      const words=app.full_name.trim().split(/\s+/);
      if(words.length<2)throw new OnboardingError("Verify applicant's legal first and last name in Applications before onboarding.");
      const {data:employee,error:createError}=await admin.from("employees").insert({
        employee_number:"SCR-"+randomUUID().slice(0,12).toUpperCase(),
        first_name:words[0],last_name:words.slice(1).join(" "),
        email,phone:app.phone,department:"Scrub Technicians",
        job_title:position,employment_type:"Part-Time",employment_status:"Inactive",
        hourly_rate:rate,commission_rate:0,
      }).select("id").single();
      if(createError)throw createError;
      employeeId=employee.id;
      newEmployeeId=employeeId;
    }else if(body.source==="indeed"){
      const name=requiredText(body.fullName,160);
      email=requiredText(body.email,254);
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new OnboardingError("Enter a valid candidate email address.");
      const words=name.split(/\s+/);
      if(words.length<2)throw new OnboardingError("Provide candidate's verified first and last name.");
      const {data:matches,error:matchError}=await admin.from("employees")
        .select("id").ilike("email",email).limit(1);
      if(matchError)throw matchError;
      if(matches?.length)throw new OnboardingError("This email already belongs to an employee. Use Existing Employee instead.");
      const phone=typeof body.phone==="string"?body.phone.trim().slice(0,30):"";
      const {data:employee,error:createError}=await admin.from("employees").insert({
        employee_number:"SCR-"+randomUUID().slice(0,12).toUpperCase(),
        first_name:words[0],last_name:words.slice(1).join(" "),
        email,phone:phone||null,department:"Scrub Technicians",
        job_title:position,employment_type:"Part-Time",employment_status:"Inactive",
        hourly_rate:rate,commission_rate:0,
      }).select("id").single();
      if(createError)throw createError;
      employeeId=employee.id;
      newEmployeeId=employeeId;
    }else{
      employeeId=id(body.employeeId);
      const {data:employee,error}=await admin.from("employees")
        .select("id,email,employment_type,archived_at").eq("id",employeeId).maybeSingle();
      if(error)throw error;
      if(!employee||employee.archived_at||employee.employment_type==="1099")
        throw new OnboardingError("Select an eligible W-2 employee.");
      email=requiredText(employee.email,254);
    }
    const startDate=body.startDate;
    const candidateStart=(typeof startDate==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(startDate))?startDate:null;
    const {data:caseRow,error:caseError}=await admin.from("employee_onboarding_cases")
      .insert({employee_id:employeeId,application_id:applicationId,candidate_email:email,position,
        hourly_rate:rate,start_date:candidateStart,created_by:actor})
      .select("id").single();
    if(caseError){
      if(newEmployeeId)await admin.from("employees").delete().eq("id",newEmployeeId);
      throw caseError;
    }
    const {error:stepsError}=await admin.from("employee_onboarding_steps")
      .insert(ONBOARDING_STEPS.map(([code])=>({case_id:caseRow.id,code})));
    if(stepsError)throw stepsError;
    await audit(admin,caseRow.id,"created",actor);
    return Response.json({ok:true,caseId:caseRow.id},{headers:noStore});
  }
  const caseId=id(body.caseId);
  const {data:caseRow,error:readError}=await admin.from("employee_onboarding_cases").select("*")
     .eq("id",caseId).maybeSingle();
  if(readError)throw readError;
  if(!caseRow)throw new OnboardingError("Onboarding case not found.",404);
  if(caseRow.status==="completed"||caseRow.status==="canceled")
    throw new OnboardingError("This onboarding case is closed.",409);
  if(action==="verify_step"){
    const code=requiredText(body.code,80);
    if(!ONBOARDING_STEPS.some(([key])=>key===code))throw new OnboardingError("Unknown requirement.");
    const verified=body.verified===true;
    const reference=typeof body.reference==="string"?body.reference.trim().slice(0,200):null;
    const {data:updated,error}=await admin.from("employee_onboarding_steps")
      .update({completed_at:verified?new Date().toISOString():null,completed_by:verified?actor:null,evidence_reference:verified?reference:null})
      .eq("case_id",caseId).eq("code",code).select("code").maybeSingle();
    if(error)throw error;
    if(!updated)throw new OnboardingError("Requirement not found.");
    await audit(admin,caseId,verified?"step_verified":"step_reset",actor);
    return Response.json({ok:true},{headers:noStore});
  }
  if(action==="invite"){
    const {data:screening,error:se}=await admin.from("employee_background_screenings")
      .select("status").eq("employee_id",caseRow.employee_id).maybeSingle();
    if(se)throw se;
    if(screening?.status!=="cleared")throw new OnboardingError("Background screening clearance is required before sending the onboarding invitation.");
    const token=newInviteToken();
    const {error:updateError}=await admin.from("employee_onboarding_cases").update({
       invite_token_hash:hashToken(token),invite_expires_at:new Date(Date.now()+7*86400000).toISOString(),
       status:"invited",updated_at:new Date().toISOString(),
    }).eq("id",caseId);
    if(updateError)throw updateError;
    const url="https://app.studioscrubz.com/onboarding/invite/"+encodeURIComponent(token);
    const sent=await sendResendEmail({
      recipientEmail:caseRow.candidate_email,
      subject:"StudioScrubz — Complete your new-hire orientation",
      text:`Welcome to StudioScrubz!\n\nUse your private onboarding link (expires in 7 days):\n${url}\n\nFor security, I-9, tax forms and bank details must be completed through the secure process designated by management; do not email these documents.\n\nIf you weren't expecting this invitation, contact StudioScrubz.`,
      html:`<p>Welcome to StudioScrubz!</p><p>Your private onboarding link expires in 7 days:</p><p><a href="${url}">Open onboarding instructions</a></p><p>Do not email tax, banking, or identification documents.</p>`,
      idempotencyKey:"employee-onboarding-"+caseId+"-"+hashToken(token).slice(0,18),
      replyTo:null,
    });
    const {error:stampError}=await admin.from("employee_onboarding_cases")
      .update({invite_sent_at:new Date().toISOString(),status:"invited"}).eq("id",caseId);
    if(stampError)throw stampError;
    await audit(admin,caseId,"invited",actor);
    return Response.json({ok:true,providerMessageId:sent.id},{headers:noStore});
  }
  if(action==="approve"){
    const {data:steps,error:stepError}=await admin.from("employee_onboarding_steps")
      .select("code,completed_at").eq("case_id",caseId);
    if(stepError)throw stepError;
    if(!onboardingStepsComplete(steps??[]))throw new OnboardingError("Complete every onboarding requirement before approval.");
    if(!caseRow.candidate_ack_at)throw new OnboardingError("Candidate orientation acknowledgment is still pending.");
    const {data:screening,error:screenError}=await admin.from("employee_background_screenings")
      .select("status").eq("employee_id",caseRow.employee_id).maybeSingle();
    if(screenError)throw screenError;
    if(screening?.status!=="cleared")throw new OnboardingError("Background screening is not cleared.");
    // Keep employee record inactive until all checks pass. Existing workers are not reclassified.
    const {error:activateError}=await admin.from("employees").update({
      employment_status:"Active",job_title:caseRow.position,
      hourly_rate:caseRow.hourly_rate,
    }).eq("id",caseRow.employee_id);
    if(activateError)throw activateError;
    const {error:approveError}=await admin.from("employee_onboarding_cases").update({
      status:"completed",approved_at:new Date().toISOString(),approved_by:actor,
      invite_token_hash:null,invite_expires_at:null,updated_at:new Date().toISOString(),
    }).eq("id",caseId);
    if(approveError)throw approveError;
    await audit(admin,caseId,"approved",actor);
    return Response.json({ok:true},{headers:noStore});
  }
  throw new OnboardingError("Unsupported onboarding action.");
 }catch(e){return responseError(e);}
}
