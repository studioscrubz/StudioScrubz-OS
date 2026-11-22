import "server-only";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {createSupabaseAdminClient} from "@/lib/supabase/admin";
import {createHash,randomBytes} from "node:crypto";

export class OnboardingError extends Error {
 constructor(message:string,public status=400){super(message);}
}
export function responseError(cause:unknown){
 const status=cause instanceof OnboardingError?cause.status:500;
 if(status===500)console.error("Onboarding operation failed",cause);
 return Response.json({error:status===500?"Onboarding request could not be completed.":(cause as Error).message},
  {status,headers:{"Cache-Control":"no-store"}});
}
export const noStore={"Cache-Control":"no-store"};
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function id(value:unknown){
 if(typeof value!=="string"||!uuid.test(value))throw new OnboardingError("Invalid identifier.");
 return value;
}
export function requiredText(value:unknown,max=200){
 if(typeof value!=="string"||!value.trim()||value.trim().length>max)
  throw new OnboardingError("A valid value is required.");
 return value.trim();
}
export function hashToken(token:string){return createHash("sha256").update(token).digest("hex");}
export function newInviteToken(){return randomBytes(32).toString("base64url");}
export async function authorizedHiring(){
 const supabase=await createSupabaseServerClient();
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user)throw new OnboardingError("Sign in required.",401);
 const admin=createSupabaseAdminClient();
 const {data:profile,error:profileError}=await admin.from("user_profiles").select("id,role,is_active")
  .eq("id",user.id).maybeSingle();
 if(profileError)throw profileError;
 if(!profile?.is_active)throw new OnboardingError("Not authorized.",403);
 if(!["Master Admin","Administrator"].includes(profile.role)){
  if(profile.role!=="Manager")throw new OnboardingError("Not authorized.",403);
  const {data:allow,error:allowError}=await admin.from("employee_screening_authorized_reviewers")
   .select("user_id").eq("user_id",user.id).maybeSingle();
  if(allowError)throw allowError;
  if(!allow)throw new OnboardingError("Manager not authorized for onboarding.",403);
 }
 return {admin,actor:user.id,role:profile.role};
}
