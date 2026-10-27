"use client";

import { useEffect, useState } from "react";
import {
  confirmEquipmentResponsibility,
  getEquipmentConfirmation,
  getJobEquipmentResponsibility,
  setJobEquipmentResponsibility,
} from "@/lib/services/equipmentAccountability";
import type { EligibleJobTech } from "@/types/job";

type Props = {
  jobId: string;
  crewLeadId: string | null;
  employeeId: string | null;
  role: string | null;
  techs: EligibleJobTech[];
  disabled?: boolean;
};

export function EquipmentAssignmentControl({ jobId, crewLeadId, employeeId, techs, disabled = false }: Props) {
  // Access is based on Manage Crews lead assignment, independent of account role.
  const isAssignedLead = Boolean(employeeId && crewLeadId && employeeId === crewLeadId);
  const [responsibleId, setResponsibleId] = useState<string | null>(null);
  const [status, setStatus] = useState("Pending Assignment");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([getJobEquipmentResponsibility(jobId), getEquipmentConfirmation(jobId)])
      .then(([task, isConfirmed]) => {
        if (!active) return;
        setResponsibleId(task?.responsible_employee_id ?? null);
        setStatus(task?.status ?? "Pending Assignment");
        setConfirmed(Boolean(isConfirmed && crewLeadId && task?.responsible_employee_id === crewLeadId));
        setError(null);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load equipment responsibility.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [jobId, crewLeadId]);

  if (!isAssignedLead || !crewLeadId) return null;

  const assignedToLead = responsibleId === crewLeadId;
  async function assignToLead() {
    if (!crewLeadId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await setJobEquipmentResponsibility(jobId, [crewLeadId], "Crew Lead is the sole equipment custodian");
      setResponsibleId(crewLeadId);
      setStatus("Assigned");
      setConfirmed(false);
      setNotice("You are now responsible for this job's equipment. Confirm before starting.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not assign equipment responsibility.");
    } finally { setSaving(false); }
  }
  async function confirm() {
    setSaving(true); setError(null); setNotice(null);
    try {
      await confirmEquipmentResponsibility(jobId);
      setConfirmed(true);
      setNotice("Crew Lead equipment responsibility confirmed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Equipment confirmation failed.");
    } finally { setSaving(false); }
  }

  return <section id={`equipment-responsibility-${jobId}`} className="rounded-lg border border-[#143d1a]/20 bg-[#f6f8f5] px-3 py-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-extrabold text-[#143d1a]">Equipment &amp; Supplies Responsibility</h3>
      <span className="rounded-full border border-[#d4af37]/50 bg-amber-50 px-2 py-0.5 text-xs font-bold text-[#71570c]">{status}</span>
    </div>
    <p className="mt-1 text-xs text-neutral-700">Responsible: <strong>{techs.find(tech => tech.employee_id === crewLeadId)?.display_name || "Assigned Crew Lead"} (you)</strong></p>
    {loading ? <p className="mt-2 text-xs">Loading…</p> : <div className="mt-2 flex flex-wrap gap-2">
      {!assignedToLead && !disabled && <button type="button" disabled={saving} className="rounded-lg bg-[#143d1a] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" onClick={() => void assignToLead()}>{saving ? "Saving…" : "Accept Equipment Responsibility"}</button>}
      {assignedToLead && !disabled && <button type="button" disabled={saving || confirmed} className="rounded-lg border border-[#143d1a] px-3 py-1.5 text-xs font-bold text-[#143d1a] disabled:opacity-50" onClick={() => void confirm()}>{confirmed ? "Responsibility Confirmed" : saving ? "Confirming…" : "Confirm Responsibility"}</button>}
      {!assignedToLead && disabled && <p className="text-xs text-amber-800">Crew Lead responsibility must be reconciled before the job starts.</p>}
    </div>}
    {notice && <p role="status" className="mt-2 text-xs font-bold text-[#143d1a]">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-xs font-bold text-red-700">{error}</p>}
  </section>;
}
