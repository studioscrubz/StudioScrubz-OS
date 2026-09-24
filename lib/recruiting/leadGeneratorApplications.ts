import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendResendEmail } from "@/lib/email/resend";

export type LeadGeneratorApplicationInput = { fullName?:unknown;email?:unknown;phone?:unknown;city?:unknown;preferredContactMethod?:unknown;relevantExperience?:unknown;reachableNetworks?:unknown;weeklyAvailability?:unknown;fitReason?:unknown;commissionAcknowledged?:unknown;contactConsent?:unknown;website?:unknown };
export class JobApplicationError extends Error { constructor(message:string,public status=400){super(message)} }
const text=(v:unknown,max:number,label:string)=>{if(typeof v!=="string")throw new JobApplicationError(`${label} is required.`);const x=v.trim().replace(/\s+/g," ");if(x.length<2||x.length>max)throw new JobApplicationError(`${label} must be between 2 and ${max} characters.`);return x};
const email=(v:unknown)=>{const x=text(v,254,"Email").toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))throw new JobApplicationError("Enter a valid email address.");return x};
const phone=(v:unknown)=>{const d=String(v??"").replace(/\D/g,"");const normalized=d.length===10?`+1${d}`:`+${d}`;if(!/^\+[1-9]\d{7,14}$/.test(normalized))throw new JobApplicationError("Enter a valid phone number.");return normalized};
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
export async function submitLeadGeneratorApplication(raw:LeadGeneratorApplicationInput,ip:string){
  if(raw.website)throw new JobApplicationError("Invalid submission.");
  const method=text(raw.preferredContactMethod,10,"Preferred contact method");if(!["Email","Phone","Text"].includes(method))throw new JobApplicationError("Select a valid preferred contact method.");
  if(raw.commissionAcknowledged!==true)throw new JobApplicationError("Acknowledge the commission-based compensation terms.");
  if(raw.contactConsent!==true)throw new JobApplicationError("Consent to contact is required.");
  const clean={full_name:text(raw.fullName,120,"Full name"),email:email(raw.email),phone:phone(raw.phone),city:text(raw.city,100,"City"),preferred_contact_method:method,relevant_experience:text(raw.relevantExperience,2000,"Relevant experience"),reachable_networks:text(raw.reachableNetworks,2000,"Reachable industries, communities, or networks"),weekly_availability:text(raw.weeklyAvailability,500,"Weekly availability"),fit_reason:text(raw.fitReason,2000,"Why you would be a good fit"),commission_acknowledged:true,contact_consent:true};
  const db=createSupabaseAdminClient(),ipHash=hash(ip||"unknown"),fingerprint=hash(`${clean.email}|${clean.phone}`),since=new Date(Date.now()-15*60_000).toISOString();
  const [ipCount,contactCount]=await Promise.all([db.from("job_applications").select("id",{count:"exact",head:true}).eq("submitted_ip_hash",ipHash).gte("created_at",since),db.from("job_applications").select("id",{count:"exact",head:true}).eq("contact_fingerprint",fingerprint).gte("created_at",since)]);
  if(ipCount.error||contactCount.error)throw new JobApplicationError("Application could not be submitted.",500);
  if((ipCount.count??0)>=5)throw new JobApplicationError("Too many applications were submitted from this connection. Please try again later.",429);
  if((contactCount.count??0)>0)throw new JobApplicationError("An application with this email and phone was recently submitted. Please wait before trying again.",429);
  const created=await db.from("job_applications").insert({...clean,opening_identifier:"lead-generator",source_page:"/careers",submitted_ip_hash:ipHash,contact_fingerprint:fingerprint,status:"New"}).select("id,full_name,email,phone,city,created_at").single();
  if(created.error)throw new JobApplicationError("Application could not be submitted.",500);
  let notification:{status:"Sent"|"Failed";id?:string;error?:string};
  try{const sent=await sendResendEmail({recipientEmail:"info@studioscrubz.com",replyTo:clean.email,subject:`Lead Generator application — ${clean.full_name}`,text:`New Lead Generator application\n\nApplicant: ${clean.full_name}\nEmail: ${clean.email}\nPhone: ${clean.phone}\nCity: ${clean.city}\nPreferred contact: ${clean.preferred_contact_method}\n\nReview the application in the authenticated StudioScrubz OS.`,html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><h1 style="color:#143d1a">New Lead Generator application</h1><p><strong>${escapeHtml(clean.full_name)}</strong> from ${escapeHtml(clean.city)}</p><p>Email: ${escapeHtml(clean.email)}<br>Phone: ${escapeHtml(clean.phone)}<br>Preferred contact: ${escapeHtml(clean.preferred_contact_method)}</p><p>Review the application in the authenticated StudioScrubz OS.</p></div>`,idempotencyKey:`job-application:${created.data.id}:notification:v1`});notification={status:"Sent",id:sent.id}}catch(cause){notification={status:"Failed",error:cause instanceof Error?cause.message:"Email delivery failed."}}
  await db.from("job_applications").update({notification_status:notification.status,notification_provider_id:notification.id??null,notification_error:notification.error?.slice(0,1000)??null,notification_updated_at:new Date().toISOString()}).eq("id",created.data.id);
  return {id:created.data.id,submitted:true};
}
function escapeHtml(v:string){return v.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
