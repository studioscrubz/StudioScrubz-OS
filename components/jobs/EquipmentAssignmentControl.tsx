"use client";
import { useEffect, useState } from "react";
import { getJobEquipmentAssignments, setJobEquipmentResponsibility, getEquipmentConfirmation, confirmEquipmentResponsibility, handoffJobEquipment } from "@/lib/services/equipmentAccountability";
import type { EligibleJobTech } from "@/types/job";

export function EquipmentAssignmentControl({
  jobId, crewLeadId, employeeId, role, techs, disabled = false,
}: {
  jobId: string;
  crewLeadId: string | null;
  employeeId: string | null;
  role: string | null;
  techs: EligibleJobTech[];
  disabled?: boolean;
}) {
  const canEdit = role === "Master Admin" || (role === "Crew Lead" && employeeId === crewLeadId);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [handoffFrom,setHandoffFrom]=useState("");
  const [handoffTo,setHandoffTo]=useState("");
  const [handoffReason,setHandoffReason]=useState("");
  const [confirmed,setConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getJobEquipmentAssignments(jobId),getEquipmentConfirmation(jobId)]).then(([rows,isConfirmed]) => {
      if (active) setConfirmed(isConfirmed);
      if (!active) return;
      const ids = rows.map(row => row.employee_id);
      setSelected(ids);
      setSaved(ids);
      setError(null);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load equipment assignments.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [jobId]);
  const options = [...techs];
  if (crewLeadId && !options.some(tech => tech.employee_id === crewLeadId)) {
    options.unshift({ employee_id: crewLeadId, display_name: "Crew Lead", operational_role: "Crew Lead" });
  }
  const dirty = [...selected].sort().join(",") !== [...saved].sort().join(",");
  return <section className="rounded-xl border border-[#143d1a]/20 bg-[#f6f8f5] p-3">
    <h3 className="text-sm font-extrabold text-[#143d1a]">Equipment Responsibility</h3>
    <p className="mt-1 text-xs text-neutral-600">Assign custodians as soon as the job is created, including before the service date. Only workers assigned to this job can be saved.</p>
    {loading ? <p className="mt-2 text-xs">Loading equipment assignments…</p> :
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map(tech => <label key={tech.employee_id} className="flex items-center gap-2 rounded-lg bg-white p-2 text-sm">
          <input type="checkbox" checked={selected.includes(tech.employee_id)} disabled={!canEdit || disabled || saving}
            onChange={event => setSelected(current => event.target.checked ? [...current, tech.employee_id] : current.filter(id => id !== tech.employee_id))} />
          <span>{tech.display_name}{tech.employee_id === crewLeadId ? " (Crew Lead)" : ""}</span>
        </label>)}
      </div>}
    {canEdit && !loading && !disabled && <>
      <input aria-label="Reason for equipment reassignment" className="mt-2 w-full rounded-lg border p-2 text-sm" placeholder="Reason for reassignment (optional)" value={reason} onChange={event => setReason(event.target.value)} />
      <button type="button" disabled={!dirty || saving} className="mt-2 rounded-lg bg-[#143d1a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
        onClick={async () => { setSaving(true); setError(null); setNotice(null); try {
          await setJobEquipmentResponsibility(jobId,selected,reason);
          setSaved([...selected]); setConfirmed(false); setNotice("Equipment custodians saved. Confirm assignments before starting the job."); setReason("");
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save equipment assignments."); }
        finally { setSaving(false); } }}>{saving ? "Saving…" : "Save Equipment Custodians"}</button>
    </>}
    {canEdit && !loading && <button type="button" disabled={saving || disabled || dirty || confirmed} className="mt-2 ml-2 rounded-lg border border-[#143d1a] bg-white px-3 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-50" onClick={async()=>{setSaving(true);setError(null);try{await confirmEquipmentResponsibility(jobId);setConfirmed(true);setNotice("Equipment responsibility confirmed for job start.");}catch(e){setError(e instanceof Error?e.message:"Confirmation failed.");}finally{setSaving(false);}}}>{confirmed?"Responsibility Confirmed":"Confirm Custodians / None"}</button>}
    {canEdit && !loading && saved.length>0 && <div className="mt-3 rounded-lg border bg-white p-3">
      <p className="text-sm font-bold">Document Equipment Handoff</p>
      <select aria-label="Outgoing custodian" className="mt-2 w-full border p-2 text-sm" value={handoffFrom} onChange={e=>setHandoffFrom(e.target.value)}><option value="">Outgoing custodian</option>{options.filter(t=>saved.includes(t.employee_id)).map(t=><option key={t.employee_id} value={t.employee_id}>{t.display_name}</option>)}</select>
      <select aria-label="Incoming custodian" className="mt-2 w-full border p-2 text-sm" value={handoffTo} onChange={e=>setHandoffTo(e.target.value)}><option value="">Incoming custodian</option>{options.filter(t=>t.employee_id!==handoffFrom).map(t=><option key={t.employee_id} value={t.employee_id}>{t.display_name}</option>)}</select>
      <textarea aria-label="Equipment handoff reason" className="mt-2 w-full border p-2 text-sm" value={handoffReason} onChange={e=>setHandoffReason(e.target.value)} placeholder="Reason and equipment being transferred" />
      <button type="button" disabled={saving || !handoffFrom || !handoffTo || !handoffReason.trim()} className="mt-2 rounded-lg bg-[#143d1a] px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={async()=>{setSaving(true);setError(null);try{await handoffJobEquipment(jobId,handoffFrom,handoffTo,handoffReason);const rows=await getJobEquipmentAssignments(jobId);const ids=rows.map(row=>row.employee_id);setSaved(ids);setSelected(ids);setConfirmed(false);setHandoffFrom("");setHandoffTo("");setHandoffReason("");setNotice("Handoff recorded. Incoming custodian must acknowledge; reconfirm before job start.");}catch(e){setError(e instanceof Error?e.message:"Handoff failed.");}finally{setSaving(false)}}}>Record Handoff</button>
    </div>}
    {!canEdit && !loading && <p className="mt-2 text-xs text-neutral-600">Only the assigned Crew Lead or Master Admin can change custodians.</p>}
    {notice && <p role="status" className="mt-2 text-xs font-bold text-[#143d1a]">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-xs font-bold text-red-700">{error}</p>}
  </section>;
}
