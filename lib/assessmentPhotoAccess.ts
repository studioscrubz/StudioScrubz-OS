import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const ASSESSMENT_PHOTO_TOKEN_DAYS = 14;

export function hashAssessmentToken(token:string){return createHash("sha256").update(token).digest("hex")}
export function newAssessmentToken(){return randomBytes(32).toString("base64url")}

export async function assessmentForToken(token:string){
  if(token.length<40)return null;
  const admin=createSupabaseAdminClient();
  const {data:access,error}=await admin.from("assessment_photo_access").select("walkthrough_id,expires_at,submitted_at").eq("token_hash",hashAssessmentToken(token)).maybeSingle();
  if(error)throw new Error("Assessment access could not be verified.");
  if(!access||Date.parse(access.expires_at)<=Date.now())return null;
  const {data:walkthrough,error:walkthroughError}=await admin.from("walkthroughs").select("*,property:properties!walkthroughs_property_id_fkey(*)").eq("id",access.walkthrough_id).is("archived_at",null).maybeSingle();
  if(walkthroughError)throw new Error("Assessment could not be loaded.");
  return walkthrough?{access,walkthrough}:null;
}
