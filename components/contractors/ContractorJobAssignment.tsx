"use client";
import {useEffect,useState} from "react";
import {assignJobWorker,findCrewConflicts,findIndividualTechConflicts,getEligibleJobTechs} from "@/lib/services/jobs";
import {getActiveCrews} from "@/lib/services/crews";
import type {CrewWithRelations} from "@/types/crew";
import type {EligibleJobTech} from "@/types/job";

const select="mt-2 w-full rounded-lg border bg-white p-2 text-sm text-neutral-900";
const button="rounded-lg bg-[#143d1a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50";
type JobAssignmentProps={jobId:string;date:string|null;startTime:string|null;duration:number|null;onAssigned:()=>Promise<void>};

export function ContractorJobAssignment({jobId,date,startTime,duration,onAssigned}:JobAssignmentProps){
 const [crews,setCrews]=useState<CrewWithRelations[]>([]),[people,setPeople]=useState<EligibleJobTech[]>([]);
 const [worker,setWorker]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 useEffect(()=>{let alive=true;void Promise.all([getActiveCrews(),getEligibleJobTechs()]).then(([c,p])=>{
  if(alive){setCrews(c);setPeople(p);}
 }).catch(e=>{if(alive)setError(e instanceof Error?e.message:"Staff options unavailable")}).finally(()=>{if(alive)setLoading(false)});
 return()=>{alive=false};},[]);
 async function assign(){
  if(!worker)return;setBusy(true);setError("");setMessage("");
  try{
   const [kind,id]=worker.split(":");
   if((kind!=="crew"&&kind!=="individual")||!id)throw new Error("Select a valid technician or crew.");
   if(date&&startTime&&duration&&duration>0){
    const conflicts=kind==="crew"
     ?await findCrewConflicts(jobId,id,date,startTime,duration)
     :await findIndividualTechConflicts(jobId,id,date,startTime,duration);
    if(conflicts.length)throw new Error("Scheduling conflict detected. Resolve conflicts in Jobs and Scheduling before assigning.");
   }
   await assignJobWorker(jobId,kind==="crew"?{kind:"crew",crewId:id}:{kind:"individual",employeeId:id});
   setMessage("Assignment saved through the existing Jobs workflow. Technician notifications and scheduling safeguards remain active.");
   await onAssigned();
  }catch(e){setError(e instanceof Error?e.message:"Job assignment failed.");}finally{setBusy(false);}
 }
 return <div className="rounded-lg border bg-neutral-50 p-3 text-sm">
  <h3 className="font-extrabold text-[#143d1a]">Assign technicians through StudioScrubz Jobs</h3>
  <p className="mt-1 text-xs text-neutral-600">Uses the existing assignment RPC, availability protections and operational notifications.</p>
  <select className={select} value={worker} onChange={e=>setWorker(e.target.value)} disabled={loading||busy}>
   <option value="">{loading?"Loading available workers…":"Select crew or individual"}</option>
   <optgroup label="Active crews with crew leads">{crews.filter(c=>Boolean(c.crew_lead_id)).map(c=><option key={c.id} value={`crew:${c.id}`}>{c.crew_name}</option>)}</optgroup>
   <optgroup label="Individual technicians">{people.map(p=><option key={p.employee_id} value={`individual:${p.employee_id}`}>{p.display_name} ({p.operational_role})</option>)}</optgroup>
  </select>
  <button type="button" className={button} disabled={loading||busy||!worker} onClick={()=>void assign()}>{busy?"Assigning…":"Assign to Job"}</button>
  {error&&<p role="alert" className="mt-2 text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 text-[#143d1a]">{message}</p>}
 </div>;
}
