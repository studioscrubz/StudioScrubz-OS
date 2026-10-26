"use client";
import { useEffect, useMemo, useState } from "react";
import { confirmEquipmentResponsibility, getEquipmentConfirmation, getJobEquipmentAssignments, getJobEquipmentResponsibility, setJobEquipmentResponsibility } from "@/lib/services/equipmentAccountability";
import type { EligibleJobTech } from "@/types/job";

export function EquipmentAssignmentControl({jobId,crewLeadId,employeeId,role,techs,disabled=false}:{
  jobId:string;crewLeadId:string|null;employeeId:string|null;role:string|null;techs:EligibleJobTech[];disabled?:boolean;
}) {
  // Crew Lead is determined by the assigned crew, so multi-role employees keep
  // their field authority without broadening access to another crew's Job.
  const canEdit=Boolean(employeeId&&employeeId===crewLeadId);
  const options=useMemo(()=>{const byId=new Map(techs.map(row=>[row.employee_id,row]));if(crewLeadId&&!byId.has(crewLeadId))byId.set(crewLeadId,{employee_id:crewLeadId,display_name:"Crew Lead",operational_role:"Crew Lead"});return [...byId.values()]},[techs,crewLeadId]);
  const [selected,setSelected]=useState("");
  const [saved,setSaved]=useState("");
  const [status,setStatus]=useState("Pending Assignment");
  const [confirmed,setConfirmed]=useState(false);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [reason,setReason]=useState("");
  const [notice,setNotice]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{let active=true;void Promise.all([getJobEquipmentAssignments(jobId),getEquipmentConfirmation(jobId),getJobEquipmentResponsibility(jobId)]).then(([assignments,isConfirmed,task])=>{if(!active)return;const id=task?.responsible_employee_id??assignments[0]?.employee_id??"";setSelected(id);setSaved(id);setStatus(task?.status??"Pending Assignment");setConfirmed(isConfirmed);setError(null)}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Unable to load equipment responsibility.")}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[jobId]);
  const dirty=selected!==saved;
  async function save(){setSaving(true);setError(null);setNotice(null);try{await setJobEquipmentResponsibility(jobId,[selected],reason);setSaved(selected);setStatus("Assigned");setConfirmed(false);setReason("");setNotice("Responsible employee assigned. Confirm responsibility before starting the job.")}catch(cause){setError(cause instanceof Error?cause.message:"Could not assign equipment responsibility.")}finally{setSaving(false)}}
  async function confirm(){setSaving(true);setError(null);try{await confirmEquipmentResponsibility(jobId);setConfirmed(true);setNotice("Equipment responsibility confirmed for job start.")}catch(cause){setError(cause instanceof Error?cause.message:"Confirmation failed.")}finally{setSaving(false)}}
  if (!canEdit) return null;
  return <section id={`equipment-responsibility-${jobId}`} className="rounded-xl border border-[#143d1a]/20 bg-[#f6f8f5] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-extrabold text-[#143d1a]">Equipment &amp; Supplies Responsibility</h3><span className="rounded-full border border-[#d4af37]/50 bg-amber-50 px-2 py-1 text-xs font-bold text-[#71570c]">{status}</span></div>
    <p className="mt-1 text-xs text-neutral-600">Designate one assigned crew member to own equipment and supplies check-off for this job.</p>
    {loading?<p className="mt-2 text-xs">Loading responsibility…</p>:<div className="mt-2 grid gap-2 sm:grid-cols-2">{options.map(tech=><label key={tech.employee_id} className="flex items-center gap-2 rounded-lg bg-white p-2 text-sm"><input type="radio" name={`equipment-responsible-${jobId}`} checked={selected===tech.employee_id} disabled={!canEdit||disabled||saving} onChange={()=>setSelected(tech.employee_id)}/><span>{tech.display_name}{tech.employee_id===crewLeadId?" (Crew Lead)":""}</span></label>)}</div>}
    {canEdit&&!loading&&!disabled&&<><input aria-label="Reason for equipment reassignment" className="mt-2 w-full rounded-lg border p-2 text-sm" placeholder="Reason for reassignment (optional)" value={reason} onChange={event=>setReason(event.target.value)}/><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={!dirty||!selected||saving} className="rounded-lg bg-[#143d1a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={()=>void save()}>{saving?"Saving…":"Assign Responsible Person"}</button><button type="button" disabled={saving||dirty||!saved||confirmed} className="rounded-lg border border-[#143d1a] bg-white px-3 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-50" onClick={()=>void confirm()}>{confirmed?"Responsibility Confirmed":"Confirm Responsible Person"}</button></div></>}
    {!canEdit&&!loading&&<p className="mt-2 text-xs text-neutral-600">Only the assigned Crew Lead can manage equipment responsibility.</p>}
    {notice&&<p role="status" className="mt-2 text-xs font-bold text-[#143d1a]">{notice}</p>}{error&&<p role="alert" className="mt-2 text-xs font-bold text-red-700">{error}</p>}
  </section>;
}
