import "server-only";
import {randomUUID} from "node:crypto";
import {createSupabaseAdminClient} from "@/lib/supabase/admin";
import {sendResendEmail} from "@/lib/email/resend";
import {resolveEmailSenderProfile} from "@/lib/email/senderProfiles";
import {noCache} from "@/lib/contractors/server";

const COMPANY_ID="a1b0e01c-3990-47e8-9c4f-40c772ce35fd";
const EMAIL="management@bravahomecleaning.com";
const HEADER={"Cache-Control":"private, no-store"};

export async function POST(request:Request) {
  // No public user-supplied email or company ID. Reject cross-site browser requests.
  const origin=request.headers.get("origin");
  const expected=new URL(request.url).origin;
  if (!origin || origin!==expected) return Response.json({error:"Invalid sign-in origin."},{status:403,headers:HEADER});
  try {
    const db=createSupabaseAdminClient();
    const {data:company,error:companyError}=await db.from("contractor_companies")
      .select("id,status,contact_email").eq("id",COMPANY_ID).maybeSingle();
    if(companyError||company?.status!=="Active"||company.contact_email?.toLowerCase()!==EMAIL)
      return Response.json({error:"Brava sign-in is unavailable."},{status:403,headers:HEADER});
    const {data:member,error:memberError}=await db.from("contractor_members")
      .select("id").eq("company_id",COMPANY_ID).eq("email",EMAIL).eq("is_active",true).limit(1);
    const {data:invite,error:inviteError}=await db.from("contractor_invitations")
      .select("id,expires_at").eq("company_id",COMPANY_ID).eq("invited_email",EMAIL)
      .eq("member_role","Company Admin").eq("status","Pending").gt("expires_at",new Date().toISOString()).limit(1);
    if(memberError||inviteError||(!member?.length&&!invite?.length))
      return Response.json({error:"Brava management access must be approved by StudioScrubz Operations."},{status:403,headers:HEADER});
    const {data:reserved,error:limitError}=await db.rpc("reserve_brava_email_otp" as never);
    if(limitError)throw limitError;
    if(reserved!==true)return Response.json({error:"Code requests are limited. Please try again later."},{status:429,headers:HEADER});
    // Supabase generates a real Auth OTP; the server sends only the six-digit code via Resend.
    const {data:generated,error:generateError}=await db.auth.admin.generateLink({type:"magiclink",email:EMAIL});
    const code=generated?.properties?.email_otp;
    if(generateError||!code||!/^[0-9]{6}$/.test(code))throw new Error("Email OTP could not be generated.");
    await sendResendEmail({
      recipientEmail:EMAIL,subject:"Your Brava Contractor Portal verification code",
      text:`Your Brava Contractor Portal verification code is: ${code}\n\nEnter it at https://partners.studioscrubz.com/brava. Do not share this code. If you did not request it, you can ignore this email.`,
      html:`<p>Enter this one-time code to access the Brava Contractor Portal:</p><p style="font-size:32px;font-weight:800;letter-spacing:8px">${code}</p><p>This code expires according to your secure sign-in settings. Never share it.</p><p>If you did not request it, ignore this message.</p>`,
      idempotencyKey:`brava-email-code:${randomUUID()}`,...resolveEmailSenderProfile("contractorInvitation"),
    });
    return noCache({sent:true});
  }catch(error){
    console.error("Brava verification code delivery failed",error instanceof Error?error.name:"Unknown error");
    return Response.json({error:"Could not send the code. Contact StudioScrubz Operations if this continues."},{status:503,headers:HEADER});
  }
}
