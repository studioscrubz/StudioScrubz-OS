"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getMyLeadRepresentativeLeads } from "@/lib/services/leadRepresentative";
import type { LeadRepresentativeLead } from "@/types/leadRepresentative";

export function LeadRepresentativePortal({ view }: { view: "home" | "leads" }) {
  const [leads, setLeads] = useState<LeadRepresentativeLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getMyLeadRepresentativeLeads()
      .then((rows) => { if (active) { setLeads(rows); setError(null); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Your leads could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const summary = useMemo(() => ({
    active: leads.filter((lead) => !["Declined", "Cancelled", "Completed / Paid"].includes(lead.lifecycle_stage)).length,
    booked: leads.filter((lead) => lead.booked).length,
    completedPaid: leads.filter((lead) => lead.lifecycle_stage === "Completed / Paid").length,
  }), [leads]);
  const rows = view === "home" ? leads.slice(0, 6) : leads;

  return <>
    <header className="border-b pb-7">
      <p className="text-sm font-extrabold uppercase tracking-[.2em] text-[#9a7a16]">Lead Representative Portal</p>
      <h1 className="mt-2 text-3xl font-extrabold text-[#143d1a]">{view === "home" ? "Home" : "My Leads"}</h1>
      <p className="mt-3 text-neutral-600">{view === "home" ? "A secure view of your attributed StudioScrubz leads." : "Track each of your attributed leads from submission through completion and payment."}</p>
    </header>
    {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}
    {view === "home" && <section className="mt-6 grid gap-4 sm:grid-cols-3">
      <SummaryCard label="Active Leads" value={summary.active}/>
      <SummaryCard label="Booked Leads" value={summary.booked}/>
      <SummaryCard label="Completed / Paid" value={summary.completedPaid}/>
    </section>}
    <section className="mt-7 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-extrabold text-[#143d1a]">{view === "home" ? "Recent Leads" : "Lead Progress"}</h2>
        {view === "home" && <Link href="/lead-rep/leads" className="text-sm font-bold text-[#143d1a] underline">View all</Link>}
      </div>
      {loading ? <div className="mt-5 h-36 animate-pulse rounded-xl bg-neutral-100"/> : rows.length ? <div className="mt-5 grid gap-4">{rows.map((lead) => <LeadCard key={lead.estimate_id} lead={lead}/>)}</div> : <p className="mt-5 rounded-xl bg-neutral-50 p-5 text-sm text-neutral-500">No attributed leads yet.</p>}
    </section>
  </>;
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-neutral-500">{label}</p><p className="mt-2 text-3xl font-black text-[#143d1a]">{value}</p></div>;
}

function LeadCard({ lead }: { lead: LeadRepresentativeLead }) {
  return <article className="rounded-xl border border-neutral-200 p-4">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div><h3 className="font-extrabold text-[#143d1a]">{lead.customer_name}</h3><p className="mt-1 text-sm text-neutral-500">{lead.estimate_number} · {lead.service_name}</p></div>
      <span className="w-fit rounded-full bg-[#edf4ec] px-3 py-1 text-xs font-extrabold text-[#143d1a]">{lead.lifecycle_stage}</span>
    </div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <Detail label="Submitted" value={new Date(lead.submitted_at).toLocaleDateString()}/>
      <Detail label="Assessment" value={lead.walkthrough_status ?? "Not started"}/>
      <Detail label="Proposal" value={lead.proposal_status ?? "Not created"}/>
      <Detail label="Job" value={lead.job_status ?? "Not created"}/>
      <Detail label="Phone" value={lead.customer_phone ?? "Not provided"}/>
      <Detail label="Email" value={lead.customer_email ?? "Not provided"}/>
      <Detail label="Booked" value={lead.booked ? "Yes" : "No"}/>
      <Detail label="Paid" value={lead.paid ? "Yes" : "No"}/>
    </dl>
    {lead.terminal_reason && <p className="mt-4 rounded-lg bg-neutral-50 p-3 text-sm"><b>Outcome reason:</b> {lead.terminal_reason}</p>}
  </article>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-bold uppercase tracking-wide text-neutral-400">{label}</dt><dd className="mt-1 break-words font-semibold text-neutral-700">{value}</dd></div>;
}
