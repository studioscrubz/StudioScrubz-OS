"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getEmployees } from "@/lib/services/employees";
import type { Employee } from "@/types/employee";
import { useAuth } from "@/components/auth/AuthProvider";

type Status =
 | "not_started"|"conditional_offer_issued"|"authorization_pending"|"authorized"
 | "invited"|"in_progress"|"completed_review_pending"|"individualized_review"
 | "pre_adverse_action"|"response_pending"|"cleared"|"final_adverse_decision"|"declined"|"canceled";
type ScreeningEvent={id:string;employee_id:string;previous_status:string|null;next_status:string;occurred_at:string;actor_id:string};
type Screening = {employee_id:string;status:Status;provider:string;provider_reference:string|null;
 conditional_offer_at:string|null;authorization_recorded_at:string|null;invitation_at:string|null;
 completed_at:string|null;reviewed_at:string|null;cleared_at:string|null;updated_at:string};
const names:Record<Status,string>={
 not_started:"Not started",conditional_offer_issued:"Offer issued",
 authorization_pending:"Authorization pending",authorized:"Authorized",
 invited:"Provider invitation sent",in_progress:"In progress",
 completed_review_pending:"Needs management review",individualized_review:"Individualized review",
 pre_adverse_action:"Pre-adverse-action notices",response_pending:"Response pending",
 cleared:"Cleared",final_adverse_decision:"Final decision",declined:"Declined authorization",canceled:"Canceled",
};
const next: Record<Status,Status[]> = {
 not_started:["conditional_offer_issued"],conditional_offer_issued:["authorization_pending","canceled"],
 authorization_pending:["authorized","declined","canceled"],authorized:["invited","canceled"],
 invited:["in_progress","canceled"],in_progress:["completed_review_pending","canceled"],
 completed_review_pending:["cleared","individualized_review"],
 individualized_review:["cleared","pre_adverse_action"],
 pre_adverse_action:["response_pending","cleared"],
 response_pending:["cleared","final_adverse_decision"],
 cleared:[],final_adverse_decision:[],declined:[],canceled:[],
};
const requiresReference = new Set<Status>(["authorized","pre_adverse_action","final_adverse_decision"]);
export default function BackgroundScreeningPage(){
 const {profile}=useAuth();
 const canManage=!!profile?.is_active&&["Master Admin","Administrator","Manager"].includes(profile.role);
 const [employees,setEmployees]=useState<Employee[]>([]);
 const [records,setRecords]=useState<Screening[]>([]);
 const [events,setEvents]=useState<ScreeningEvent[]>([]);
 const [employeeId,setEmployeeId]=useState("");
 const [target,setTarget]=useState<Status|null>(null);
 const [reference,setReference]=useState("");
 const [confirmReview,setConfirmReview]=useState(false);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const refresh=useCallback(async()=>{
   const [emps,response]=await Promise.all([getEmployees(),fetch("/api/employees/background-screening",{cache:"no-store"})]);
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||"Unable to load background screening.");
   setEmployees(emps.filter(e=>!e.archived_at&&e.employment_type!=="1099"));
   setRecords(data.screenings||[]);
   setEvents(data.events||[]);
 },[]);
 useEffect(()=>{if(!canManage){setLoading(false);return;}
   let active=true;
   void refresh().catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));})
       .finally(()=>{if(active)setLoading(false);});
   return ()=>{active=false};
 },[canManage,refresh]);
 useEffect(()=>{
   if(!employees.length||employeeId)return;
   const fromUrl=new URLSearchParams(window.location.search).get("employee");
   setEmployeeId(fromUrl&&employees.some(e=>e.id===fromUrl)?fromUrl:employees[0].id);
 },[employees,employeeId]);
 const record=records.find(r=>r.employee_id===employeeId);
 const status:Status=record?.status??"not_started";
 const worker=employees.find(e=>e.id===employeeId);
 const count=useMemo(()=>({
  pending:records.filter(r=>["authorization_pending","conditional_offer_issued"].includes(r.status)).length,
  progress:records.filter(r=>["invited","in_progress"].includes(r.status)).length,
  review:records.filter(r=>["completed_review_pending","individualized_review","pre_adverse_action","response_pending"].includes(r.status)).length,
  clear:records.filter(r=>r.status==="cleared").length
 }),[records]);
 async function update(){
  if(!target||!employeeId)return;
  if(requiresReference.has(target)&&!reference.trim()){
    setError("A verifiable reference is required for this step.");return;
  }
  if(target==="cleared"&&!confirmReview){
    setError("Confirm that an authorized person completed the human review.");return;
  }
  setSaving(true);setError("");setMessage("");
  try{
    const response=await fetch("/api/employees/background-screening",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({employeeId,status:target,reference:reference.trim(),confirmHumanReview:confirmReview})
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Unable to update screening");
    await refresh();setTarget(null);setReference("");setConfirmReview(false);
    setMessage("Screening status updated. No background reports were stored.");
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setSaving(false);}
 }
 if(!canManage) return <main className="p-6"><h1 className="text-xl font-bold">Access restricted</h1><p>Background screening is limited to authorized hiring management.</p></main>;
 return <main className="space-y-6 p-4 md:p-8">
  <header>
   <p className="text-xs font-semibold uppercase tracking-widest text-green-800">Employees / Hiring</p>
   <h1 className="text-2xl font-extrabold text-green-950">Background Screening</h1>
   <p className="mt-2 text-sm text-neutral-600">Review screening status for new W-2 hires. This tracks status only; order reports and obtain candidate consent through your approved screening provider.</p>
  </header>
  <div className="grid gap-3 sm:grid-cols-4">
   {([["Authorization pending",count.pending],["In progress",count.progress],["Needs review",count.review],["Cleared",count.clear]] as const).map(([label,n])=>
    <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-neutral-500">{label}</p><p className="text-2xl font-bold text-green-950">{n}</p></div>)}
  </div>
  {loading?<p>Loading employees…</p>:<>
   {error&&<div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
   {message&&<div role="status" className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm">{message}</div>}
   <section className="rounded-xl border bg-white p-5 space-y-4">
    <label className="block text-sm font-semibold">Employee
     <select className="mt-2 block w-full rounded-lg border p-3" value={employeeId} onChange={e=>{setEmployeeId(e.target.value);setTarget(null);setError("");}}>
      {employees.map(e=><option key={e.id} value={e.id}>{e.first_name} {e.last_name} — {e.job_title||e.department}</option>)}
     </select>
    </label>
    {!worker?<p className="text-sm">No eligible W-2 employees currently available.</p>:<>
     <div className="rounded-lg bg-neutral-50 p-4 space-y-2">
      <p className="font-semibold">{worker.first_name} {worker.last_name}</p>
      <p className="text-sm">Current status: <strong>{names[status]}</strong></p>
      <p className="text-xs text-neutral-600">Provider: {record?.provider??"Checkr (proposed)"} • Status updated: {record?.updated_at?new Date(record.updated_at).toLocaleString():"Not started"}</p>
      <p className="text-xs">Screening clearance: <strong>{status==="cleared"?"Cleared":"Not cleared"}</strong></p>
     </div>
     <p className="text-sm text-neutral-700">For consent and background reports, use your authorized provider's secure dashboard. Never enter SSNs, criminal findings, or full screening reports into StudioScrubz OS.</p>
     <a href="https://dashboard.checkr.com/" target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg border px-4 py-2 text-sm font-semibold text-green-800">Open Checkr dashboard ↗</a>
     <div className="border-t pt-4 space-y-3">
      <h2 className="font-bold">Record next screening step</h2>
      {next[status].length?<>
       <select className="w-full rounded-lg border p-3" value={target??""} onChange={e=>{setTarget(e.target.value as Status||null);setReference("");setConfirmReview(false);}}>
        <option value="">Select next step</option>
        {next[status].map(s=><option key={s} value={s}>{names[s]}</option>)}
       </select>
       {target&&<>
        <label className="block text-sm">Provider / supporting action reference {requiresReference.has(target)?"(required)":"(optional)"}
         <input className="mt-1 block w-full rounded-lg border p-3" value={reference} maxLength={300} onChange={e=>setReference(e.target.value)} placeholder="Secure provider reference or notice receipt ID — no report details"/>
        </label>
        {target==="authorized"&&<p className="text-xs text-amber-800">Record authorization only after receiving verifiable written consent from the candidate.</p>}
        {target==="invited"&&<p className="text-xs text-amber-800">First send the provider invitation from Checkr. This action only records that it was sent; it does not email the candidate.</p>}
        {target==="cleared"&&<label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmReview} onChange={e=>setConfirmReview(e.target.checked)}/>
          I confirm I personally reviewed the results and all applicable individualized review and notice steps are complete.
        </label>}
        <button className="rounded-lg bg-green-900 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={saving} onClick={()=>void update()}>{saving?"Saving…":"Save screening step"}</button>
       </>}
      </>:<p className="text-sm text-neutral-600">This screening workflow is complete or closed. Contact the Master Admin for correction procedures.</p>}
     </div>
    </>}
   </section>
   <section className="rounded-xl border bg-white p-5">
    <h2 className="font-bold text-green-950">Screening Activity</h2>
    <p className="mt-1 text-xs text-neutral-500">Restricted audit history; no report contents stored.</p>
    <ul className="mt-3 space-y-2 text-sm">
     {events.filter(e=>e.employee_id===employeeId).slice(0,12).map(e=>
       <li key={e.id} className="border-t py-2">
         <span className="font-medium">{names[e.next_status as Status]??e.next_status}</span>
         <span className="ml-2 text-xs text-neutral-500">{new Date(e.occurred_at).toLocaleString()}</span>
       </li>)}
     {!events.some(e=>e.employee_id===employeeId)&&<li className="text-neutral-500">No activity recorded yet.</li>}
    </ul>
   </section>
   <p className="text-xs text-neutral-500">Legal note: Screening requires appropriate standalone disclosure, authorization, and any applicable federal/California fair-chance and adverse-action procedure. This screen does not collect consent or order reports.</p>
  </>}
 </main>;
}
