"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {ONBOARDING_STEPS} from "@/lib/onboarding/steps";

type Case={id:string;employee_id:string;application_id:string|null;candidate_email:string;position:string;hourly_rate:number;status:string;invite_sent_at:string|null;candidate_ack_at:string|null;approved_at:string|null;start_date:string|null;created_at:string};
type Step={case_id:string;code:string;completed_at:string|null;completed_by:string|null};
type Employee={id:string;first_name:string;last_name:string;email:string|null;department:string;employment_type:string|null;employment_status:string};
type Application={id:string;full_name:string;email:string;status:string};
type Data={cases:Case[];steps:Step[];employees:Employee[];selectedApplications:Application[];screenings:{employee_id:string;status:string}[]};
const statuses:Record<string,string>={draft:"Not invited",invited:"Invitation sent",in_progress:"In progress",ready_for_review:"Review needed",completed:"Ready for assignment",canceled:"Canceled"};

export default function EmployeeOnboarding(){
 const [data,setData]=useState<Data|null>(null);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [mode,setMode]=useState<"indeed"|"application"|"employee">("indeed");
 const [applicationId,setApplicationId]=useState("");
 const [employeeId,setEmployeeId]=useState("");
 const [fullName,setFullName]=useState("");
 const [email,setEmail]=useState("");
 const [phone,setPhone]=useState("");
 const [position,setPosition]=useState<"Scrub Technician"|"Crew Lead">("Scrub Technician");
 const [startDate,setStartDate]=useState("");
 const [chosen,setChosen]=useState("");
 const [references,setReferences]=useState<Record<string,string>>({});
 const refresh=useCallback(async()=>{
  const r=await fetch("/api/employees/onboarding",{cache:"no-store"});
  const json=await r.json();
  if(!r.ok)throw new Error(json.error||"Could not load onboarding.");
  setData(json);
  return json as Data;
 },[]);
 useEffect(()=>{let active=true;void refresh().catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[refresh]);
 const selected=data?.cases.find(c=>c.id===chosen)??data?.cases[0];
 const person=data?.employees.find(e=>e.id===selected?.employee_id);
 const steps=(data?.steps??[]).filter(x=>x.case_id===selected?.id);
 const done=steps.filter(s=>s.completed_at).length;
 const eligible=data?.screenings.some(s=>s.employee_id===selected?.employee_id&&s.status==="cleared")??false;
 const allDone=ONBOARDING_STEPS.every(([code])=>steps.some(s=>s.code===code&&!!s.completed_at));
 const counts=useMemo(()=>{
  const cases=data?.cases??[];
  return [
   ["Pending Invitations",cases.filter(c=>c.status==="draft").length],
   ["Paperwork / Training",cases.filter(c=>["invited","in_progress","ready_for_review"].includes(c.status)).length],
   ["Awaiting Approval",cases.filter(c=>c.status!=="completed"&&c.status!=="canceled"&&c.candidate_ack_at&&data?.screenings.some(s=>s.employee_id===c.employee_id&&s.status==="cleared")&&ONBOARDING_STEPS.every(([code])=>data?.steps.some(s=>s.case_id===c.id&&s.code===code&&s.completed_at))).length],
   ["Ready for Assignment",cases.filter(c=>c.status==="completed").length],
  ] as const;
 },[data]);
 async function execute(body:Record<string,unknown>,success:string){
  setBusy(true);setError("");setNotice("");
  try{
   const r=await fetch("/api/employees/onboarding",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   const json=await r.json();
   if(!r.ok)throw new Error(json.error||"Onboarding action failed.");
   await refresh();
   if(json.caseId)setChosen(json.caseId);
   setNotice(success);
   return true;
  }catch(e){setError(e instanceof Error?e.message:"Onboarding action failed.");return false;}
  finally{setBusy(false);}
 }
 const canCreate=mode==="indeed"?!!fullName.trim()&&!!email.trim():mode==="application"?!!applicationId:!!employeeId;
 return <main className="space-y-6 p-4 md:p-7">
  <header>
   <p className="text-xs font-bold uppercase tracking-widest text-green-800">Team / Employee Onboarding</p>
   <h1 className="text-3xl font-extrabold text-[#143d1a]">Employee Onboarding</h1>
   <p className="mt-2 text-sm text-neutral-600">Prepare new part-time W-2 SCRUBZ Techs and Crew Leads for their first assignment. Hiring management verifies all required steps; no tax documents, I-9 images, banking details, or screening reports are stored here.</p>
  </header>
  {loading&&<p>Loading onboarding…</p>}
  {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-900">{notice}</p>}
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
   {counts.map(([title,count])=><div key={title} className="rounded-xl border bg-white p-4"><p className="text-xs text-neutral-600">{title}</p><p className="text-2xl font-bold text-[#143d1a]">{count}</p></div>)}
  </div>
  <section className="rounded-2xl border bg-white p-5 space-y-4">
   <h2 className="text-lg font-bold">Start new employee onboarding</h2>
   <label className="block text-sm font-semibold">Candidate source
    <select value={mode} onChange={e=>setMode(e.target.value as typeof mode)} className="mt-1 w-full rounded-lg border p-3">
     <option value="indeed">Indeed / external applicant</option>
     <option value="application">Selected StudioScrubz application</option>
     <option value="employee">Existing employee record</option>
    </select>
   </label>
   {mode==="indeed"&&<div className="grid gap-3 md:grid-cols-2">
    <label className="text-sm">Applicant name<input className="mt-1 w-full rounded-lg border p-3" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="First and last name"/></label>
    <label className="text-sm">Applicant email<input type="email" className="mt-1 w-full rounded-lg border p-3" value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label className="text-sm">Phone (optional)<input className="mt-1 w-full rounded-lg border p-3" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
   </div>}
   {mode==="application"&&<label className="block text-sm">Selected applicant
     <select value={applicationId} onChange={e=>setApplicationId(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
      <option value="">Choose selected applicant</option>
      {data?.selectedApplications.map(a=><option key={a.id} value={a.id}>{a.full_name} — {a.email}</option>)}
     </select>
   </label>}
   {mode==="employee"&&<label className="block text-sm">Employee
    <select value={employeeId} onChange={e=>setEmployeeId(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
     <option value="">Choose employee</option>
     {data?.employees.filter(e=>e.employment_type!=="1099").map(e=><option value={e.id} key={e.id}>{e.first_name} {e.last_name} — {e.employment_status}</option>)}
    </select>
   </label>}
   <div className="grid gap-3 md:grid-cols-2">
    <label className="block text-sm">Position
     <select value={position} onChange={e=>setPosition(e.target.value as typeof position)} className="mt-1 w-full rounded-lg border p-3">
      <option>Scrub Technician</option><option>Crew Lead</option>
     </select>
    </label>
    <label className="block text-sm">Proposed start date (optional)
     <input className="mt-1 w-full rounded-lg border p-3" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/>
    </label>
   </div>
   <p className="text-sm text-neutral-600">Starting pay: <strong>${position==="Crew Lead"?"27":"25"}/hour</strong>. Two company-guaranteed paid hours per scheduled shift; StudioScrubz provides supplies and equipment. This creates an inactive employee record for new external/selected candidates, not an active job assignment.</p>
   <button disabled={busy||!canCreate} onClick={()=>void execute({
    action:"create",source:mode,
    ...(mode==="indeed"?{fullName,email,phone}:mode==="application"?{applicationId}:{employeeId}),
    position,startDate
   },"Onboarding record created. Complete screening and verify each requirement before approval.")}
     className="rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white disabled:opacity-50">
    {busy?"Processing…":"Start Onboarding"}
   </button>
  </section>
  <section className="rounded-2xl border bg-white p-5 space-y-4">
   <h2 className="text-lg font-bold">Manage employee onboarding</h2>
   <label className="block text-sm">Employee
    <select value={selected?.id??""} onChange={e=>setChosen(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
     {!data?.cases.length&&<option value="">No onboarding cases yet</option>}
     {data?.cases.map(c=>{
      const emp=data.employees.find(e=>e.id===c.employee_id);
      return <option key={c.id} value={c.id}>{emp?.first_name} {emp?.last_name} — {statuses[c.status]??c.status}</option>;
     })}
    </select>
   </label>
   {selected&&<>
    <div className="rounded-xl bg-neutral-50 p-4 space-y-1">
     <h3 className="font-bold text-[#143d1a]">{person?.first_name} {person?.last_name}</h3>
     <p className="text-sm">Position: {selected.position} · ${selected.hourly_rate}/hour · {statuses[selected.status]??selected.status}</p>
     <p className="text-sm">Candidate orientation: {selected.candidate_ack_at?"Acknowledged":"Pending"}</p>
     <p className="text-sm">Background Screening: <strong>{eligible?"Cleared":"Not cleared"}</strong></p>
     <p className="text-sm">Requirements verified: <strong>{done}/{ONBOARDING_STEPS.length}</strong></p>
     <a className="text-sm font-semibold text-[#143d1a] underline" href={`/employees/background-screening?employee=${encodeURIComponent(selected.employee_id)}`}>View Background Screening</a>
    </div>
    <button disabled={busy||!eligible||selected.status==="completed"||selected.status==="canceled"} className="rounded-lg border border-green-800 px-4 py-2 text-sm font-semibold text-green-900 disabled:opacity-40" onClick={()=>void execute({action:"invite",caseId:selected.id},"Onboarding invitation submitted by email. Link expires in seven days.")}>Send / resend onboarding invitation</button>
    {!eligible&&<p className="text-sm text-amber-800">An invitation can be sent after background screening clearance. The candidate will review the position overview; complete legally required paperwork through secure, separate channels.</p>}
    <div className="space-y-3 border-t pt-4">
     <h3 className="font-bold">Management verification checklist</h3>
     <p className="text-xs text-neutral-600">Check an item only after completing or verifying the actual requirement. Sensitive documents stay in authorized payroll/I-9 systems. Keep supporting references generic, not private form contents.</p>
     {ONBOARDING_STEPS.map(([code,label])=>{
      const step=steps.find(s=>s.code===code);
      const verified=!!step?.completed_at;
      return <div key={code} className="rounded-lg border p-3">
       <label className="flex gap-3 text-sm">
        <input type="checkbox" checked={verified} disabled={busy||selected.status==="completed"}
         onChange={e=>void execute({action:"verify_step",caseId:selected.id,code,verified:e.target.checked,reference:references[code]??""},e.target.checked?"Requirement verified.":"Verification reset.")}/>
        <span className={verified?"font-semibold text-green-900":""}>{label}</span>
       </label>
       {!verified&&<input value={references[code]??""} onChange={e=>setReferences(p=>({...p,[code]:e.target.value}))}
        className="mt-2 w-full rounded border p-2 text-xs" placeholder="Optional verification reference (no sensitive details)" maxLength={200}/>}
      </div>;
     })}
    </div>
    <div className="rounded-lg border p-4 space-y-3">
     <h3 className="font-bold">Final management approval</h3>
     <p className="text-sm">Approval requires all {ONBOARDING_STEPS.length} verified steps, candidate orientation acknowledgment, and cleared background screening. Newly created employee records remain inactive until this step.</p>
     <button disabled={busy||!allDone||!selected.candidate_ack_at||!eligible||selected.status==="completed"} onClick={()=>void execute({action:"approve",caseId:selected.id},"Onboarding completed and employee activated.")}
      className="rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white disabled:opacity-40">{selected.status==="completed"?"Approved":"Approve & Activate Employee"}</button>
    </div>
   </>}
  </section>
 </main>;
}
