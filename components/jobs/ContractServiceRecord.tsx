"use client";

import { useEffect, useState } from "react";
import { getJobById } from "@/lib/services/jobs";
import type { JobWithRelations } from "@/types/job";

export function ContractServiceRecordAction({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobWithRelations | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void getJobById(jobId)
      .then((value) => { if (active) setJob(value); })
      .catch((cause: unknown) => console.error("Contract service record eligibility load failed", cause));
    return () => { active = false; };
  }, [jobId]);

  const billingType = job?.service_occurrence?.agreement.billing_type;
  if (!job || job.status !== "Completed" || !billingType || !["Monthly", "Flat Contract"].includes(billingType)) return null;

  return <>
    <button type="button" className="rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a]" onClick={() => setOpen(true)}>View / Download Service Record</button>
    {open && <ServiceRecordModal job={job} close={() => setOpen(false)}/>} 
  </>;
}

function ServiceRecordModal({ job, close }: { job: JobWithRelations; close: () => void }) {
  const agreement = job.service_occurrence!.agreement;
  const coverage = agreement.billing_type === "Monthly" ? "Covered by Monthly Contract Billing." : "Covered by Flat Contract Billing.";
  return <div className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-black/60 p-4 print:static print:block print:bg-white print:p-0">
    <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-6 print:max-h-none print:max-w-none print:overflow-visible print:p-0">
      <button type="button" className="float-right text-xl print:hidden" onClick={close}>×</button>
      <article className="document-print-root mx-auto max-w-3xl bg-white p-6 text-sm text-neutral-800 print:max-w-none print:p-0">
        <header className="border-b-4 border-[#d4af37] pb-5">
          <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#9a7a17]">StudioScrubz</p>
          <h1 className="mt-2 text-3xl font-extrabold uppercase text-[#143d1a]">Service Completion Record</h1>
          <p className="mt-2 font-bold text-[#143d1a]">Contract service documentation — not an Invoice</p>
        </header>
        <section className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="font-extrabold text-green-900">{coverage}</p>
          <p className="mt-1 text-green-800">This service is billed under the associated Service Agreement and does not represent a separate charge.</p>
        </section>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <Details title="Record" rows={[["Service Record / Job Number",job.job_number],["Agreement Number",agreement.agreement_number],["Contract Billing Type",agreement.billing_type],["Status",job.status]]}/>
          <Details title="Client & Site" rows={[["Client / Company",job.client_name||"—"],["Property / Site",job.property_name||"—"],["Service",job.service_name||"—"]]}/>
          <Details title="Service Visit" rows={[["Service Date",formatDate(job.scheduled_date)],["Service Time",formatTime(job.start_time)],["Completion Date",formatDateTime(job.completed_at)]]}/>
          <Details title="Crew" rows={[["Assigned Crew",job.assigned_crew_name||"—"],["Crew Lead",job.crew_lead_name||"—"],["Team",job.assigned_team.join(", ")||"—"]]}/>
        </div>
        <RecordList title="Scope of Work" rows={job.scope.map((item) => item.text)}/>
        <RecordList title="Completion Checklist" rows={job.checklist.map((item) => `${item.completed ? "Completed" : "Not completed"}: ${item.label}`)}/>
        <div className="mt-6"><Details title="Service Notes" rows={[["Special / Access Instructions",job.access_instructions||"—"],["Job / Completion Notes",job.internal_notes||"—"]]}/></div>
        <footer className="mt-8 border-t pt-4 text-xs text-neutral-500">Contract service visit documentation only. {coverage} This record is not an Invoice and does not request payment.</footer>
      </article>
      <div className="mt-5 flex gap-3 print:hidden">
        <button type="button" className="rounded-lg bg-[#143d1a] px-4 py-2 font-bold text-white" onClick={() => window.print()}>Print / Save PDF</button>
        <button type="button" className="rounded-lg border px-4 py-2 font-bold text-[#143d1a]" onClick={close}>Close</button>
      </div>
    </section>
  </div>;
}

function Details({ title, rows }: { title: string; rows: string[][] }) { return <section><h2 className="font-extrabold text-[#143d1a]">{title}</h2><div className="mt-2">{rows.map(([label,value]) => <div key={label} className="flex justify-between gap-4 border-b py-2"><span className="text-neutral-500">{label}</span><b className="text-right">{value}</b></div>)}</div></section>; }
function RecordList({ title, rows }: { title: string; rows: string[] }) { return <section className="mt-6"><h2 className="font-extrabold text-[#143d1a]">{title}</h2>{rows.length?<ul className="mt-2 list-disc space-y-1 pl-5">{rows.map((row,index)=><li key={`${index}-${row}`}>{row}</li>)}</ul>:<p className="mt-2 text-neutral-500">None recorded.</p>}</section>; }
function formatDate(value:string|null){return value?new Date(`${value}T12:00:00`).toLocaleDateString():"—"}
function formatTime(value:string|null){if(!value)return"—";const[hours,minutes]=value.slice(0,5).split(":").map(Number);return new Date(2000,0,1,hours,minutes).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
function formatDateTime(value:string|null){return value?new Date(value).toLocaleString():"—"}
