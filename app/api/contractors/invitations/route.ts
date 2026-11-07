import "server-only";
import { randomBytes,createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendResendEmail } from "@/lib/email/resend";
import { contractorContext,requireInternal,ContractorAccessError,handleContractorError,
  uuid,required,audited,noCache } from "@/lib/contractors/server";

const hash=(token:string)=>createHash("sha256").update(token).digest("hex");
const tokenFormat=/^[0-9a-f]{64}$/i;
export async function GET(request:Request){
 try{
  const raw=new URL(request.url).searchParams.get("token")??"";
  if(!tokenFormat.test(raw))throw new ContractorAccessError("Invitation unavailable.",404);
  const db=createSupabaseAdminClient(),{data:invite}=await db.from("contractor_invitations")
   .select("id,company_id,invited_email,expires_at,status").eq("token_hash",hash(raw)).maybeSingle();
  if(!invite||invite.status!=="Pending"||new Date(invite.expires_at).getTime()<=Date.now())
   throw new ContractorAccessError("Invitation is expired or unavailable.",404);
  const {data:company}=await db.from("contractor_companies").select("name,status").eq("id",invite.company_id).single();
  if(!company||!["Pending","Active"].includes(company.status))throw new ContractorAccessError("Company invitation unavailable.",404);
  return noCache({companyName:company.name,email:invite.invited_email,expiresAt:invite.expires_at});
 }catch(error){return handleContractorError(error);}
}
export async function POST(request:Request){
 try{
  const raw=await request.text();
  if(raw.length>6000)throw new ContractorAccessError("Invitation request is too large.",413);
  const body=JSON.parse(raw) as Record<string,unknown>;
  const action=required(body.action,"action",40);
  if(action==="redeem"){
   const token=required(body.token,"invitation token",64);
   if(!tokenFormat.test(token))throw new ContractorAccessError("Invalid invitation token.",400);
   const session=await createSupabaseServerClient();
   const {data:{user},error:authError}=await session.auth.getUser();
   if(authError||!user)throw new ContractorAccessError("Sign in before redeeming your invitation.",401);
   const {data,error}=await session.rpc("redeem_contractor_invitation" as never,{p_token_hash:hash(token)} as never);
   if(error)throw new ContractorAccessError(error.message,409);
   return noCache({companyId:data});
  }
  const ctx=await contractorContext();
  if(action==="revoke"){
   requireInternal(ctx);
   const invitationId=uuid(body.invitationId);
   const {data:invite,error}=await ctx.admin.from("contractor_invitations").select("company_id,status")
    .eq("id",invitationId).maybeSingle();
   if(error||!invite)throw new ContractorAccessError("Invitation not found.",404);
   if(invite.status!=="Pending")throw new ContractorAccessError("Only pending invitations may be revoked.",409);
   const result=await ctx.admin.from("contractor_invitations").update({status:"Revoked"}).eq("id",invitationId).eq("status","Pending");
   if(result.error)throw result.error;
   await audited(ctx,{companyId:invite.company_id,type:"Invitation Revoked",detail:{invitationId}});
   return noCache({ok:true});
  }
  if(action!=="invite"&&action!=="resend")throw new ContractorAccessError("Unknown invitation action.",400);
  if(ctx.type==="partner"&&(ctx.role!=="Company Admin"||action!=="invite"))
   throw new ContractorAccessError("Only the contractor owner can invite teammates.");
  const previous=action==="resend"
   ?await ctx.admin.from("contractor_invitations").select("company_id,invited_email,member_role")
    .eq("id",uuid(body.invitationId)).eq("status","Pending").maybeSingle()
   :null;
  if(previous?.error)throw previous.error;
  if(previous&&!previous.data)throw new ContractorAccessError("Pending invitation not found.",404);
  const companyId=ctx.type==="partner"?ctx.companyId:previous?.data?.company_id??uuid(body.companyId);
  const email=required(previous?.data?.invited_email??body.email,"invitation email",320).toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(email))throw new ContractorAccessError("Valid invitation email required.",400);
  const role=ctx.type==="partner"?"Member":previous?.data?.member_role??"Company Admin";
  const {data:company,error:companyError}=await ctx.admin.from("contractor_companies").select("id,name,status")
   .eq("id",companyId).maybeSingle();
  if(companyError||!company||!["Pending","Active"].includes(company.status))
   throw new ContractorAccessError("Active or pending company required.",409);
  // Generate a fresh one-use secret every time. Never persist plaintext.
  const token=randomBytes(32).toString("hex"),tokenHash=hash(token);
  let invite:{id:string;expires_at:string};
  if(ctx.type==="partner"){
   const {data,error}=await ctx.admin.rpc("prepare_contractor_team_invitation",{
    p_actor:ctx.userId,p_email:email,p_token_hash:tokenHash,
   }).single();
   if(error||!data)throw new ContractorAccessError(error?.code==="P0001"?error.message:"Team invitation preparation failed.",409);
   invite=data;
  }else{
   const {data:existingMember,error:memberError}=await ctx.admin.from("contractor_members").select("id")
    .eq("company_id",companyId).eq("email",email).eq("is_active",true).limit(1);
   if(memberError)throw memberError;
   if(existingMember?.length)throw new ContractorAccessError("This person already has company access.",409);
   const {error:revokeError}=await ctx.admin.from("contractor_invitations").update({status:"Revoked"})
    .eq("company_id",companyId).eq("invited_email",email).eq("status","Pending");
   if(revokeError)throw revokeError;
   const {data,error}=await ctx.admin.from("contractor_invitations").insert({
    company_id:companyId,invited_email:email,member_role:role,token_hash:tokenHash,invited_by:ctx.userId,
   }).select("id,expires_at").single();
   if(error||!data)throw error??new Error("Invitation preparation failed.");
   invite=data;
  }
  await audited(ctx,{companyId,type:"Invitation Prepared",detail:{invitationId:invite.id,email,role}});
  const origin=process.env.NODE_ENV==="production"?"https://partners.studioscrubz.com":new URL(request.url).origin;
  const activationPath=process.env.NODE_ENV==="production"?"/activate":"/contractor/activate";
  const activationUrl=`${origin}${activationPath}?token=${token}`;
  let sent;
  try {
   sent=await sendResendEmail({recipientEmail:email,subject:"StudioScrubz Contractor Portal Invitation",
    text:`You have been invited to join ${company.name} on the StudioScrubz Contractor Portal. Activate your account within seven days: ${activationUrl}`,
    html:`<p>Your company has been invited to use the StudioScrubz Contractor Portal.</p><p><a href="${activationUrl}" style="display:inline-block;background:#143d1a;color:white;padding:12px 18px;text-decoration:none">Activate contractor account</a></p><p>Invitation expires in seven days. If you did not expect this invitation, ignore this message.</p>`,
    idempotencyKey:`contractor-invitation:${invite.id}`,replyTo:null});
  }catch(error){
   await ctx.admin.from("contractor_invitations").update({delivery_status:"Failed"}).eq("id",invite.id);
   await audited(ctx,{companyId,type:"Invitation Delivery Failed",detail:{invitationId:invite.id}});
   throw new ContractorAccessError("Invitation was prepared, but the email provider did not confirm delivery. Resend after checking configuration.",503);
  }
  const update=await ctx.admin.from("contractor_invitations").update({
   delivery_status:"Sent",delivery_provider_id:sent.id,
  }).eq("id",invite.id);
  if(update.error)throw new ContractorAccessError("Email provider accepted delivery; status recording needs review. Do not resend without checking.",503);
  await audited(ctx,{companyId,type:"Invitation Email Sent",detail:{invitationId:invite.id,providerId:sent.id}});
  return noCache({invitationId:invite.id,status:"Sent",expiresAt:invite.expires_at});
 }catch(error){return handleContractorError(error);}
}
