import "server-only";
import {createSupabaseAdminClient} from "@/lib/supabase/admin";
import {sendResendEmail} from "@/lib/email/resend";
import {escapeEmailHtml} from "@/lib/email/studioScrubzTemplate";
import {createHash} from "node:crypto";

const localDate=()=>{
 const bits=new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const get=(k:string)=>bits.find(x=>x.type===k)?.value??"";
 return `${get("year")}-${get("month")}-${get("day")}`;
};
const daysBetween=(start:string,end:string)=>Math.max(0,Math.floor(
 (Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000));
const safeError=(e:unknown)=>e instanceof Error?e.message.slice(0,240):"Email provider rejected the request";
type Event={key:string;companyId:string;opportunityId:string|null;invoiceId:string|null;email:string;type:string;subject:string;text:string};
async function dispatch(event:Event){
 const db=createSupabaseAdminClient();
 const {data:delivery,error:insertError}=await db.from("contractor_notification_deliveries").insert({
  event_key:event.key,company_id:event.companyId,opportunity_id:event.opportunityId,
  invoice_id:event.invoiceId,recipient_email:event.email,event_type:event.type,
 }).select("id").maybeSingle();
 if(insertError){
  if(insertError.code==="23505")return "skipped" as const;
  throw insertError;
 }
 if(!delivery)return "skipped" as const;
 try{
  const sent=await sendResendEmail({recipientEmail:event.email,subject:event.subject,text:event.text,
   html:`<p style="white-space:pre-line">${escapeEmailHtml(event.text)}</p>`,
   idempotencyKey:`contractor-notification:${createHash("sha256").update(event.key).digest("hex")}`,
   replyTo:null});
  const {error}=await db.from("contractor_notification_deliveries").update({
   status:"Sent",provider_message_id:sent.id,sent_at:new Date().toISOString(),
  }).eq("id",delivery.id);
  if(error)throw error;
  return "sent" as const;
 }catch(e){
  await db.from("contractor_notification_deliveries").update({
   status:"Failed",failure_reason:safeError(e),
  }).eq("id",delivery.id);
  return "failed" as const;
 }
}
export async function GET(request:Request){
 if(!process.env.CRON_SECRET||request.headers.get("authorization")!==`Bearer ${process.env.CRON_SECRET}`)
  return Response.json({error:"Unauthorized"},{status:401});
 try{
  const db=createSupabaseAdminClient(),today=localDate();
  const [companies,opps,followups]=await Promise.all([
   db.from("contractor_companies").select("id,name,status,contact_email,assigned_manager_id").eq("status","Active").limit(500),
   db.from("contractor_opportunities").select("id,company_id,linked_job_id,status").not("linked_job_id","is",null).limit(500),
   db.from("contractor_followups").select("company_id,assigned_manager_id,note,due_at").eq("status","Pending").lte("due_at",new Date().toISOString()).limit(500),
  ]);
  if(companies.error||opps.error||followups.error)throw companies.error??opps.error??followups.error;
  const companyMap=new Map((companies.data??[]).map(x=>[x.id,x]));
  const linked=(opps.data??[]).filter(x=>x.linked_job_id&&companyMap.has(x.company_id));
  const ids=linked.map(x=>x.linked_job_id as string);
  const [invoices,jobs]=await Promise.all([
   ids.length?db.from("invoices").select("id,job_id,invoice_number,due_date,total,amount_paid,status")
    .in("job_id",ids).lt("due_date",today).is("archived_at",null).neq("status","Cancelled").limit(200):Promise.resolve({data:[],error:null}),
   ids.length?db.from("jobs").select("id,status,assigned_crew_id,assigned_employee_id,scheduled_date")
    .in("id",ids).limit(500):Promise.resolve({data:[],error:null}),
  ]);
  if(invoices.error||jobs.error)throw invoices.error??jobs.error;
  const opportunityByJob=new Map(linked.map(x=>[x.linked_job_id,x]));
  let sent=0,failed=0,skipped=0;
  const events:Event[]=[];
  const overdueByManager=new Map<string,number>();
  for(const inv of invoices.data??[]){
   const outstanding=Math.max(0,Number(inv.total)-Number(inv.amount_paid));
   const opp=opportunityByJob.get(inv.job_id),company=opp?companyMap.get(opp.company_id):null;
   if(!opp||!company||!company.contact_email||!inv.due_date||outstanding<=0)continue;
   const daysLate=daysBetween(inv.due_date,today);
   if(daysLate<1)continue;
   const week=Math.floor((daysLate-1)/7);
   events.push({
    key:`overdue:${inv.id}:${week}`,companyId:company.id,opportunityId:opp.id,invoiceId:inv.id,
    email:company.contact_email,type:"Contractor Overdue Invoice",
    subject:`StudioScrubz payment reminder — ${inv.invoice_number}`,
    text:`Invoice ${inv.invoice_number} has an outstanding balance of $${outstanding.toFixed(2)} and was due ${inv.due_date}. Please contact StudioScrubz Operations regarding payment.`,
   });
   if(company.assigned_manager_id)overdueByManager.set(company.assigned_manager_id,(overdueByManager.get(company.assigned_manager_id)??0)+1);
  }
  const unassignedByManager=new Map<string,number>();
  for(const job of jobs.data??[]){
   const opp=opportunityByJob.get(job.id),company=opp?companyMap.get(opp.company_id):null;
   if(!company?.assigned_manager_id||!["Ready to Schedule","Scheduled","Crew Assigned"].includes(job.status))continue;
   if(!job.assigned_crew_id&&!job.assigned_employee_id)
    unassignedByManager.set(company.assigned_manager_id,(unassignedByManager.get(company.assigned_manager_id)??0)+1);
  }
  const followupsByManager=new Map<string,number>();
  for(const task of followups.data??[]){
   if(!companyMap.has(task.company_id))continue;
   followupsByManager.set(task.assigned_manager_id,(followupsByManager.get(task.assigned_manager_id)??0)+1);
  }
  const managerIds=[...new Set([...overdueByManager.keys(),...unassignedByManager.keys(),...followupsByManager.keys()])];
  if(managerIds.length){
   const {data:managers,error}=await db.from("user_profiles").select("id,email,is_active")
    .in("id",managerIds).eq("is_active",true);
   if(error)throw error;
   for(const manager of managers??[]){
    if(!manager.email)continue;
    const overdue=overdueByManager.get(manager.id)??0,unassigned=unassignedByManager.get(manager.id)??0,due=followupsByManager.get(manager.id)??0;
    if(!overdue&&!unassigned&&!due)continue;
    // The digest is internal and contains only counts; customer names and
    // financial projection details never leave the internal management app.
    const firstCompany=(companies.data??[]).find(c=>c.assigned_manager_id===manager.id);
    if(!firstCompany)continue;
    events.push({key:`operations-digest:${manager.id}:${today}`,companyId:firstCompany.id,
     opportunityId:null,invoiceId:null,email:manager.email,type:"Contractor Operations Digest",
     subject:"StudioScrubz — Contractor Operations attention required",
     text:`Contractor Management requires your review. Outstanding overdue invoices: ${overdue}. Jobs awaiting crew assignment: ${unassigned}. Due follow-ups: ${due}. Sign in to StudioScrubz OS for details.`});
   }
  }
  for(const event of events.slice(0,100)){
   const result=await dispatch(event);
   if(result==="sent")sent++;else if(result==="failed")failed++;else skipped++;
  }
  return Response.json({processed:Math.min(events.length,100),sent,failed,skipped,
   pending:Math.max(0,events.length-100)},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("Contractor overdue reminder processing failed",error);
  return Response.json({error:"Contractor notification processing failed."},{status:503});
 }
}
