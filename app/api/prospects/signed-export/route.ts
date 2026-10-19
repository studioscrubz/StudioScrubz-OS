import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/permissions";
import type { UserProfile } from "@/types/auth";

const FIELDS = ["company_name","industry","company_type","contact_name","contact_title","contact_phone","contact_location","contact_linkedin","business_email","business_phone","website","address","city","state","zip","territory","source_url","notes","next_action","next_follow_up_at"] as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
function secret(){const value=process.env.PROSPECT_EXPORT_SIGNING_KEY;if(!value||value.length<32)throw new Error("Configure PROSPECT_EXPORT_SIGNING_KEY (at least 32 characters) on the server.");return value;}
function signature(id:string,updated:string,user:string){return createHmac("sha256",secret()).update("studioscrubz-prospect-export-v1|"+user+"|"+id+"|"+updated).digest("hex");}
async function context(){const db=await createSupabaseServerClient();const {data:{user}}=await db.auth.getUser();if(!user)return null;const {data:profile}=await db.from("user_profiles").select("*").eq("id",user.id).single();if(!profile||!hasPermission(profile as UserProfile,"prospects.manage"))return null;return {db,user};}
function csvCell(value:unknown){let s=value==null?"":String(value);if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export async function GET(){
 try{
  const ctx=await context();if(!ctx)return Response.json({error:"Unauthorized"},{status:403});
  const all:Record<string,unknown>[]=[];for(let from=0;from<20000;from+=500){const {data,error}=await ctx.db.from("prospects").select("*").is("merged_into_prospect_id",null).order("id").range(from,from+499);if(error)throw error;all.push(...(data??[]));if((data??[]).length<500)break;}
  const columns=["Prospect ID","Export Version","Export Updated At","Export Signature",...FIELDS];
  const lines=[columns.map(csvCell).join(",")];
  for(const row of all){const id=String(row.id),updated=String(row.updated_at);lines.push([id,"1",updated,signature(id,updated,ctx.user.id),...FIELDS.map(k=>row[k])].map(csvCell).join(","));}
  return new Response("\uFEFF"+lines.join("\r\n"),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="StudioScrubz_Prospects_Update_'+new Date().toISOString().slice(0,10)+'.csv"',"Cache-Control":"private, no-store"}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:"Export failed"},{status:500});}
}
export async function POST(request:Request){
 try{
  const ctx=await context();if(!ctx)return Response.json({error:"Unauthorized"},{status:403});
  const body=await request.json() as {mode?:string;rows?:Array<Record<string,unknown>>};
  if(!["preview","apply"].includes(body.mode??"")||!Array.isArray(body.rows)||body.rows.length>2000)return Response.json({error:"Invalid update request (maximum 2,000 rows)."}, {status:400});
  const ids=new Set<string>();const results: Array<{id:string;status:string;changes?:Record<string,string>;error?:string}>=[];
  for(const row of body.rows){
   const id=String(row["Prospect ID"]??""),updated=String(row["Export Updated At"]??""),sig=String(row["Export Signature"]??"");
   if(!UUID.test(id)||ids.has(id)){results.push({id,status:"Rejected",error:"Invalid or duplicate ID"});continue;}ids.add(id);
   if(row["Export Version"]!=="1"||!/^[a-f0-9]{64}$/.test(sig)){results.push({id,status:"Rejected",error:"Not a valid StudioScrubz export"});continue;}
   const expected=signature(id,updated,ctx.user.id);
   if(!timingSafeEqual(Buffer.from(sig),Buffer.from(expected))){results.push({id,status:"Rejected",error:"Export signature mismatch"});continue;}
   const {data:existing,error}=await ctx.db.from("prospects").select("*").eq("id",id).is("merged_into_prospect_id",null).maybeSingle();
   if(error||!existing){results.push({id,status:"Rejected",error:"Record not accessible or no longer exists"});continue;}
   if(existing.updated_at!==updated){results.push({id,status:"Conflict",error:"Prospect changed since export; download a fresh copy"});continue;}
   const changes:Record<string,string>={};let invalid=false;
   for(const field of FIELDS){const raw=row[field];if(typeof raw!=="string"){invalid=true;break;}const value=raw.trim();if(!value)continue; // blanks preserve existing values
    if(field==="business_email"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)){invalid=true;break;}
    if(field==="next_follow_up_at"&&Number.isNaN(Date.parse(value))){invalid=true;break;}
    if(value!==String((existing as Record<string,unknown>)[field]??""))changes[field]=value;
   }
   if(invalid){results.push({id,status:"Rejected",error:"Invalid or missing editable field"});continue;}
   if(!Object.keys(changes).length){results.push({id,status:"Unchanged"});continue;}
   if(body.mode==="apply"){
    const {data:written,error:writeError}=await ctx.db.from("prospects").update(changes).eq("id",id).eq("updated_at",updated).select("id").maybeSingle();
    if(writeError||!written){results.push({id,status:"Rejected",error:writeError?.message??"Concurrent update or insufficient permissions"});continue;}
   }
   results.push({id,status:body.mode==="apply"?"Updated":"Will update",changes});
  }
  return Response.json({results},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:"Update failed"},{status:500});}
}
