"use client";
import { useEffect, useState } from "react";
import { getEligibleJobTechs } from "@/lib/services/jobs";
import { getJobCrewTechnicians, setJobCrewTechnicians } from "@/lib/services/crews";
import type { EligibleJobTech } from "@/types/job";

export function JobCrewTechnicianPicker({ jobId, capacity, leadEmployeeId, onSaved }: { jobId: string; capacity: number; leadEmployeeId:string; onSaved:()=>void }) {
  const [people, setPeople] = useState<EligibleJobTech[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.all([getEligibleJobTechs(), getJobCrewTechnicians(jobId)])
      .then(([options, assigned]) => {
        if (!active) return;
        setPeople(options.filter(p => p.operational_role === "Scrub Technician" && p.employee_id !== leadEmployeeId));
        setChosen(assigned);
      }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Could not load technicians."); }).finally(()=>{if(active)setLoading(false);});
    return () => { active = false; };
  }, [jobId,leadEmployeeId]);
  return <section className="mt-3 rounded-xl border border-neutral-200 bg-white p-4">
    <h3 className="font-bold text-[#143d1a]">Assign technicians to this job</h3>
    <p className="mt-1 text-xs text-neutral-600">Only this job&apos;s Crew Lead can save the roster. {chosen.length} of {capacity} technician slots selected, excluding the Crew Lead.</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
      {people.map(p => <label key={p.employee_id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={chosen.includes(p.employee_id)} disabled={loading || busy || (!chosen.includes(p.employee_id) && chosen.length >= capacity)}
          onChange={e => { setSaved(false); setChosen(prev => e.target.checked ? [...prev, p.employee_id] : prev.filter(id => id !== p.employee_id)); }} />
        {p.display_name}
      </label>)}
    </div>
    {chosen.filter(id=>!people.some(person=>person.employee_id===id)).map(id=><label key={id} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked disabled={busy||loading} onChange={()=>setChosen(current=>current.filter(value=>value!==id))}/>Previously assigned technician (no longer eligible)</label>)}
    <button type="button" disabled={loading || busy || chosen.length > capacity}
      className="mt-3 rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
      onClick={() => { setBusy(true); setError(""); void setJobCrewTechnicians(jobId, chosen).then(() => {setSaved(true);onSaved();}).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not save roster.")).finally(() => setBusy(false)); }}>
      {busy ? "Saving…" : "Save job technicians"}
    </button>
    {saved && <p className="mt-2 text-xs text-[#143d1a]">Job technician roster saved.</p>}
  </section>;
}
