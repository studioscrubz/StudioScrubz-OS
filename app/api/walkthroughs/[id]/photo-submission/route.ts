import { NextResponse } from "next/server";
import { newAssessmentToken, hashAssessmentToken, ASSESSMENT_PHOTO_TOKEN_DAYS } from "@/lib/assessmentPhotoAccess";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPublicSiteUrl } from "@/lib/publicSiteUrl";

export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const server=await createSupabaseServerClient();
  const {data:{user}}=await server.auth.getUser();
  if(!user)return NextResponse.json({error:"Sign in required."},{status:401});
  const admin=createSupabaseAdminClient();
  const {data:profile}=await admin.from("user_profiles").select("role,is_active").eq("id",user.id).maybeSingle();
  if(!profile?.is_active||!["Master Admin","Administrator","Manager","Sales"].includes(profile.role))return NextResponse.json({error:"Photo submission access denied."},{status:403});
  const {data:walkthrough}=await server.from("walkthroughs").select("id,measurements").eq("id",id).maybeSingle();
  if(!walkthrough)return NextResponse.json({error:"Assessment unavailable."},{status:404});
  const token=newAssessmentToken();
  const expiresAt=new Date(Date.now()+ASSESSMENT_PHOTO_TOKEN_DAYS*86400000).toISOString();
  const {error}=await admin.from("assessment_photo_access").upsert({walkthrough_id:id,token_hash:hashAssessmentToken(token),expires_at:expiresAt,submitted_at:null,created_by:user.id},{onConflict:"walkthrough_id"});
  if(error)return NextResponse.json({error:"Photo submission link could not be created."},{status:500});
  const measurements={...(walkthrough.measurements as Record<string,unknown>),assessmentMethod:"Customer Photo Submission",photoSubmissionStatus:"Sent"};
  await admin.from("walkthroughs").update({measurements}).eq("id",id);
  return NextResponse.json({url:`${getPublicSiteUrl()}/assessment/${token}`,expiresAt},{headers:{"Cache-Control":"private, no-store"}});
}
