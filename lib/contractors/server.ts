import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class ContractorAccessError extends Error {
  constructor(message: string, readonly status = 403) { super(message); }
}
export type ContractorContext =
  | { type:"internal"; userId:string; role:"Master Admin"|"Manager"; companyId:null; admin:ReturnType<typeof createSupabaseAdminClient> }
  | { type:"partner"; userId:string; role:"Company Admin"|"Member"; companyId:string; admin:ReturnType<typeof createSupabaseAdminClient> };

export async function contractorContext():Promise<ContractorContext> {
  const session=await createSupabaseServerClient();
  const {data:{user},error}=await session.auth.getUser();
  if(error||!user)throw new ContractorAccessError("Sign in is required.",401);
  const admin=createSupabaseAdminClient();
  const {data:staff,error:staffError}=await admin.from("user_profiles")
    .select("role,is_active").eq("id",user.id).maybeSingle();
  if(staffError)throw new Error("Internal account could not be verified.");
  if(staff?.is_active && (staff.role==="Master Admin"||staff.role==="Manager")) {
    return {type:"internal",userId:user.id,role:staff.role,companyId:null,admin};
  }
  // A StudioScrubz employee never falls back to a partner identity.
  if(staff)throw new ContractorAccessError("Contractor access is not enabled for this account.");
  const {data:member,error:memberError}=await admin.from("contractor_members")
    .select("company_id,member_role,is_active").eq("user_id",user.id).maybeSingle();
  if(memberError||!member?.is_active)throw new ContractorAccessError("No active contractor invitation has been redeemed.");
  const {data:company,error:companyError}=await admin.from("contractor_companies")
    .select("status").eq("id",member.company_id).maybeSingle();
  if(companyError||!company||company.status!=="Active")throw new ContractorAccessError("Company portal access is inactive.");
  return {type:"partner",userId:user.id,role:member.member_role as "Company Admin"|"Member",
    companyId:member.company_id,admin};
}
export function requireInternal(ctx:ContractorContext):asserts ctx is Extract<ContractorContext,{type:"internal"}> {
  if(ctx.type!=="internal")throw new ContractorAccessError("StudioScrubz Operations access is required.");
}
export function requireMaster(ctx:ContractorContext):asserts ctx is Extract<ContractorContext,{type:"internal"}> {
  requireInternal(ctx);
  if(ctx.role!=="Master Admin")throw new ContractorAccessError("Master Admin approval is required.");
}
export function requirePartner(ctx:ContractorContext):asserts ctx is Extract<ContractorContext,{type:"partner"}> {
  if(ctx.type!=="partner")throw new ContractorAccessError("Contractor portal access is required.");
}
export function required(value:unknown,label:string,max=1000):string {
  if(typeof value!=="string"||!value.trim()||value.trim().length>max)
    throw new ContractorAccessError(`Enter a valid ${label} (maximum ${max} characters).`,400);
  return value.trim();
}
export function optional(value:unknown,max=2000):string|null {
  if(value==null||value==="")return null;
  if(typeof value!=="string"||value.length>max)throw new ContractorAccessError("Invalid text value.",400);
  return value.trim()||null;
}
export function uuid(value:unknown):string {
  if(typeof value!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new ContractorAccessError("Invalid record identifier.",400);
  return value;
}
export function money(value:unknown,label="amount"):number {
  const amount=typeof value==="number"?value:Number(value);
  if(!Number.isFinite(amount)||amount<0||amount>100_000_000)throw new ContractorAccessError(`Invalid ${label}.`,400);
  return Math.round(amount*100)/100;
}
export function handleContractorError(error:unknown):Response {
  if(error instanceof ContractorAccessError)return Response.json({error:error.message},{status:error.status});
  console.error("Contractor management request failed",error);
  return Response.json({error:"Contractor request could not be completed."},{status:500});
}
export function noCache(data:unknown):Response {
  return Response.json(data,{headers:{"Cache-Control":"private, no-store"}});
}
export async function audited(ctx:ContractorContext, input:{
  companyId:string;opportunityId?:string;type:string;detail?:Record<string,unknown>
}) {
  const {error}=await ctx.admin.from("contractor_audit_events").insert({
    company_id:input.companyId,opportunity_id:input.opportunityId??null,
    actor_id:ctx.userId,event_type:input.type,detail:input.detail??{},
  });
  if(error)throw error;
}
export async function partnerOpportunity(ctx:ContractorContext,id:string) {
  const {data,error}=await ctx.admin.from("contractor_opportunities").select("*").eq("id",uuid(id))
    .eq("company_id",ctx.companyId).maybeSingle();
  if(error||!data)throw new ContractorAccessError("This opportunity is unavailable.",404);
  return data;
}
export async function internalOpportunity(ctx:ContractorContext,id:string) {
  requireInternal(ctx);
  const {data,error}=await ctx.admin.from("contractor_opportunities").select("*").eq("id",uuid(id)).maybeSingle();
  if(error||!data)throw new ContractorAccessError("Opportunity not found.",404);
  return data;
}
