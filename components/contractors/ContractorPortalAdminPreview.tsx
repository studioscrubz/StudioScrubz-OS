"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {StudioScrubzLogo} from "@/components/branding/StudioScrubzLogo";
import {formatTime12Hour} from "@/lib/formatTime";

type Opportunity={
 id:string;opportunity_number:string;service_type:string;property_name:string|null;
 property_address:string;requested_date:string;requested_time:string|null;status:string;
 linked_job_id:string|null;proposed_amount:number;agreed_amount:number|null;
};
type ScheduledJob={id:string;job_number:string;service_name:string|null;property_name:string|null;scheduled_date:string;start_time:string|null;location?:string|null};
type CompletedJob={id:string;job_number:string;client_name:string;service_name:string|null;property_name:string|null;completed_at:string|null};
type Invoice={id:string;invoice_number:string;total:number;amount_paid:number;balance_due:number;status:string;issue_date:string|null};
type Preview={
 preview:true;company:{id:string;name:string;contractor_code:string;contact_name:string;contact_email:string;phone:string|null;business_address:string|null;status:string;payment_terms:string|null};
 opportunities:Opportunity[];upcomingJobs:ScheduledJob[];completedJobs:CompletedJob[];invoiceHistory:Invoice[];
 operationsManager:{name:string}|null;
};
type Tab="dashboard"|"jobs"|"messages"|"company";
const secondary="rounded-lg border border-[#143d1a]/30 bg-white px-4 py-2 text-sm font-bold text-[#143d1a]";
const primary="rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white";
const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(value));
const date=(value:string|null)=>value?new Date(value.includes("T")?value:value+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"Not scheduled";
const panel="rounded-xl border bg-white p-5";
export function ContractorPortalAdminPreview({companyId}:{companyId:string}){
 const [data,setData]=useState<Preview|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[tab,setTab]=useState<Tab>("dashboard");
 useEffect(()=>{
  const controller=new AbortController();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)){
   setError("Choose a contractor from Contractor Management.");setLoading(false);return()=>controller.abort();
  }
  void fetch("/api/contractors?"+new URLSearchParams({view:"admin-portal-preview",companyId}),{
   cache:"no-store",signal:controller.signal,
  }).then(async response=>{
   const result=await response.json();
   if(!response.ok)throw new Error(result.error??"Contractor preview is unavailable.");
   if(!controller.signal.aborted)setData(result as Preview);
  }).catch(cause=>{
   if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Preview unavailable");
  }).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[companyId]);
 const invoices=useMemo(()=>data?.invoiceHistory??[],[data]);
 const totals=useMemo(()=>invoices.reduce((sum,row)=>({
  billed:sum.billed+Number(row.total),paid:sum.paid+Number(row.amount_paid),due:sum.due+Number(row.balance_due),
 }),{billed:0,paid:0,due:0}),[invoices]);
 if(loading)return <div role="status" className="rounded-xl border bg-white p-8">Loading contractor preview…</div>;
 if(!data)return <section className="rounded-xl border border-red-300 bg-white p-6"><p role="alert">{error||"Contractor preview unavailable."}</p><Link className="mt-3 inline-block underline" href="/contractors/companies">Back to contractors</Link></section>;
 return <div className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
   <div><p className="font-extrabold text-amber-950">MASTER ADMIN · READ-ONLY CONTRACTOR PREVIEW</p>
   <p className="text-sm text-amber-900">Live contractor records. No contractor login, impersonation, edits, messages, uploads, or financial actions.</p></div>
   <Link className={secondary} href="/contractors/companies">Exit preview</Link>
  </div>
  <div className="overflow-hidden rounded-xl border bg-[#f5f6f4] text-neutral-900">
   <header className="bg-[#143d1a] px-4 py-4 text-white"><div className="mx-auto flex max-w-6xl items-center gap-4">
    <StudioScrubzLogo size={72}/>
    <div><h1 className="text-xl font-extrabold">Contractor Portal</h1><p className="text-sm text-white/85">{data.company.name}</p></div>
   </div></header>
   <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
    <nav aria-label="Contractor portal preview sections" className="flex flex-wrap gap-2">
     {([["dashboard","Dashboard"],["jobs","My Requests & Jobs"],["messages","Messages"],["company","Company Profile"]] as const).map(([key,label])=>
      <button key={key} type="button" onClick={()=>setTab(key)} className={tab===key?primary:secondary} aria-current={tab===key?"page":undefined}>{label}</button>)}
     <button className={secondary+" cursor-not-allowed opacity-50"} type="button" disabled title="Creating jobs is disabled in preview mode">Submit New Job · Disabled</button>
    </nav>
    {tab==="dashboard"&&<>
     <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {([["Submitted opportunities",data.opportunities.length],
       ["Pending decisions",data.opportunities.filter(x=>["New Opportunity","Information Requested","Negotiating","Awaiting Approval"].includes(x.status)).length],
       ["Accepted jobs",data.opportunities.filter(x=>Boolean(x.linked_job_id)).length],
       ["Outstanding invoices",money(totals.due)]] as const).map(([label,value])=>
       <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-neutral-600">{label}</p><p className="mt-2 text-2xl font-extrabold text-[#143d1a]">{value}</p></div>)}
     </div>
     <section className={panel}><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">Invoice history</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
       {[["Invoices",String(invoices.length)],["Total invoiced",money(totals.billed)],["Paid",money(totals.paid)],["Outstanding",money(totals.due)]].map(([label,value])=>
        <div key={label}><dt>{label}</dt><dd className="font-bold">{value}</dd></div>)}
      </dl>
      {invoices.length>0&&<details className="mt-4"><summary className="cursor-pointer font-bold">View invoices</summary>
       <div className="mt-2 divide-y text-sm">{invoices.map(invoice=><div key={invoice.id} className="flex flex-wrap justify-between gap-2 py-2">
        <span>{invoice.invoice_number} · {invoice.status}{invoice.issue_date?` · ${invoice.issue_date}`:""}</span><span>{money(invoice.total)} total · {money(invoice.balance_due)} due</span>
       </div>)}</div></details>}
     </section>
    {tab==="dashboard"&&<section className={panel}><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">Upcoming jobs</h2>
     {data.upcomingJobs?.length?data.upcomingJobs.map(job=><div key={job.id} className="border-b py-3 last:border-0">
      <b>{job.property_name??job.service_name??job.job_number}</b><p className="text-sm">{job.job_number}{job.service_name?` · ${job.service_name}`:""}</p>
      <p className="text-sm">{date(job.scheduled_date)} · {formatTime12Hour(job.start_time,"Time pending")}</p>
      {job.location&&<p className="text-sm">{job.location}</p>}
     </div>):<p className="text-sm text-neutral-600">No upcoming jobs scheduled.</p>}
    </section>}
     <section className={panel}><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">Recent opportunities</h2>
      {data.opportunities.slice(0,15).map(op=><div key={op.id} className="flex flex-wrap items-start justify-between gap-2 border-b py-3">
       <div><b>{op.property_name??op.property_address}</b><p className="text-sm">{op.opportunity_number} · {op.service_type}</p>
        <p className="text-sm">{date(op.requested_date)}{op.requested_time?` · ${formatTime12Hour(op.requested_time)}`:""} · {op.property_address}</p></div>
       <span className="text-sm">{op.status}</span>
      </div>)}
      {!data.opportunities.length&&<p className="text-sm text-neutral-600">No opportunities submitted.</p>}
     </section>
    </>}
    {tab==="jobs"&&<section className={panel}><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">Upcoming jobs</h2>
     {data.upcomingJobs?.length?data.upcomingJobs.map(job=><div key={job.id} className="border-b py-3 last:border-0">
      <b>{job.property_name??job.service_name??job.job_number}</b><p className="text-sm">{job.job_number}{job.service_name?` · ${job.service_name}`:""}</p>
      <p className="text-sm">{date(job.scheduled_date)} · {formatTime12Hour(job.start_time,"Time pending")}</p>
      {job.location&&<p className="text-sm">{job.location}</p>}
     </div>):<p className="text-sm text-neutral-600">No upcoming jobs scheduled.</p>}
    </section>}
    {tab==="jobs"&&<>
     <section className={panel}><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">My Requests &amp; Jobs</h2>
      {data.opportunities.map(op=><div key={op.id} className="border-b py-3 last:border-0">
       <div className="flex flex-wrap justify-between gap-2"><b>{op.opportunity_number} · {op.service_type}</b><span>{op.status}</span></div>
       <p className="text-sm">{op.property_name??op.property_address}</p>
       <p className="text-sm">Requested {date(op.requested_date)} · Proposed {money(op.proposed_amount)}{op.agreed_amount!=null?` · Agreed ${money(op.agreed_amount)}`:""}</p>
      </div>)}
      {!data.opportunities.length&&<p>No requests submitted.</p>}
     </section>
     <section className={panel}><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">Completed jobs</h2>
      {data.completedJobs?.length?data.completedJobs.map(job=><div key={job.id} className="border-b py-3 last:border-0">
       <b>{job.client_name}</b><p className="text-sm">{job.job_number}{job.service_name?` · ${job.service_name}`:""}</p>
       {job.property_name&&<p className="text-sm">{job.property_name}</p>}
       <p className="text-sm">Completed {date(job.completed_at)}</p>
      </div>):<p className="text-sm text-neutral-600">No completed jobs available yet.</p>}
     </section>
    </>}
    {tab==="messages"&&<section className={panel}><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">Private messages with Operations</h2>
     <p className="text-sm">The contractor communicates with {data.operationsManager?.name??"their assigned Operations Manager"} here.</p>
     <p className="mt-3 rounded-lg bg-neutral-100 p-3 text-sm">Message bodies and read actions are intentionally unavailable in Master Admin preview mode. No message can be sent.</p>
    </section>}
    {tab==="company"&&<div className="grid gap-4 lg:grid-cols-2">
     <section className={panel}><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">Company profile</h2>
      <p className="text-sm"><b>{data.company.name}</b> · {data.company.contractor_code}</p>
      <p>{data.company.contact_email}</p><p>{data.company.phone??""}</p><p>{data.company.business_address??""}</p>
      <p className="mt-2">Payment terms: {data.company.payment_terms??"Not specified"}</p>
      <p className="mt-4 border-t pt-3 text-sm text-neutral-600">Company editing is disabled in this preview.</p>
     </section>
     <section className={panel}><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">Company documents</h2>
      <p className="text-sm text-neutral-600">Secure document contents and uploads are disabled in preview mode.</p>
     </section>
    </div>}
   </div>
  </div>
 </div>;
}
