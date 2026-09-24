"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { getJobApplications, updateJobApplication } from "@/lib/services/jobApplications";
import { JOB_APPLICATION_STATUSES, type JobApplication, type JobApplicationStatus } from "@/types/jobApplication";

const field = "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";
const applicationTypes = ["All Applications", "Lead/Sales", "Scrub Tech", "Administration"] as const;
type ApplicationType = (typeof applicationTypes)[number];
type Opening = { type: Exclude<ApplicationType, "All Applications">; subtitle: string };

const openingDetails: Record<string, Opening> = {
  "lead-generator": {
    type: "Lead/Sales",
    subtitle: "Lead generation and appointment setting — StudioScrubz management handles final estimates and closing.",
  },
  "scrub-tech": { type: "Scrub Tech", subtitle: "Scrub Technician application." },
  administration: { type: "Administration", subtitle: "Administration application." },
};

export function JobApplicationsPage() {
  const { profile } = useAuth();
  const allowed = hasPermission(profile, "jobApplications.manage");
  const [rows, setRows] = useState<JobApplication[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [applicationType, setApplicationType] = useState<ApplicationType>("All Applications");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() { setRows(await getJobApplications()); }

  useEffect(() => {
    if (allowed) void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Applications could not be loaded."));
  }, [allowed]);

  const visible = useMemo(() => rows.filter((application) => {
    const query = search.toLowerCase();
    const opening = openingDetails[application.opening_identifier];
    return (!query || [application.full_name, application.email, application.phone, application.city, application.status, opening?.type].join(" ").toLowerCase().includes(query))
      && (status === "All" || application.status === status)
      && (applicationType === "All Applications" || opening?.type === applicationType)
      && (!date || application.created_at.slice(0, 10) === date);
  }), [applicationType, date, rows, search, status]);

  async function save(application: JobApplication, next: JobApplicationStatus, notes: string) {
    setBusy(true); setError("");
    try { await updateJobApplication(application.id, next, notes); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Application could not be updated."); }
    finally { setBusy(false); }
  }

  if (!allowed) return <p>Applications are restricted to management.</p>;
  return <section>
    <h1 className="text-3xl font-extrabold text-[#143d1a]">Applications</h1>
    <p className="mt-2 text-neutral-600">Review and manage employment and independent-contractor applications.</p>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    <div className="mt-6 flex flex-wrap gap-3">
      <select aria-label="Filter by application type" className={field} value={applicationType} onChange={(event) => setApplicationType(event.target.value as ApplicationType)}>
        {applicationTypes.map((value) => <option key={value}>{value}</option>)}
      </select>
      <input aria-label="Search applications" className={`${field} min-w-64 flex-1`} placeholder="Applicant, category, city, email, phone, or status" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select aria-label="Filter by status" className={field} value={status} onChange={(event) => setStatus(event.target.value)}>
        <option>All</option>{JOB_APPLICATION_STATUSES.map((value) => <option key={value}>{value}</option>)}
      </select>
      <input aria-label="Filter by submission date" type="date" className={field} value={date} onChange={(event) => setDate(event.target.value)} />
    </div>
    <div className="mt-6 space-y-4">
      {visible.map((application) => <ApplicationCard key={application.id} application={application} busy={busy} save={save} />)}
      {!visible.length && <p className="rounded-xl border bg-white p-6 text-neutral-500">No applications match these filters.</p>}
    </div>
  </section>;
}

function ApplicationCard({ application, busy, save }: { application: JobApplication; busy: boolean; save: (application: JobApplication, status: JobApplicationStatus, notes: string) => Promise<void> }) {
  const [next, setNext] = useState(application.status);
  const [notes, setNotes] = useState(application.internal_notes ?? "");
  const isCurrent = application.submission_version >= 2;
  const opening = openingDetails[application.opening_identifier];
  return <article className="rounded-2xl border bg-white p-5">
    <div className="flex flex-wrap justify-between gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[#9a7a17]">{application.status} · {new Date(application.created_at).toLocaleString()}</p>
        <p className="mt-2 text-sm font-extrabold text-[#143d1a]">{opening?.type ?? application.opening_identifier}</p>
        {opening?.subtitle && <p className="mt-1 max-w-3xl text-sm text-neutral-600">{opening.subtitle}</p>}
        <h2 className="mt-3 text-xl font-extrabold text-[#143d1a]">{application.full_name}</h2>
        <p className="text-sm text-neutral-600">{application.city} · prefers {application.preferred_contact_method}</p>
        <div className="mt-3 flex gap-3 text-sm font-bold"><a className="text-[#143d1a] underline" href={`mailto:${application.email}`}>Email</a><a className="text-[#143d1a] underline" href={`tel:${application.phone}`}>Call</a></div>
      </div>
      <div className="min-w-60"><label className="text-sm font-bold">Status<select className={`${field} mt-1 w-full`} value={next} onChange={(event) => setNext(event.target.value as JobApplicationStatus)}>{JOB_APPLICATION_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></label></div>
    </div>
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      {isCurrent ? <><Detail title="Relevant experience" text={application.relevant_experience_boolean ? "Yes" : "No"}/><Detail title="Contact interests" text={(application.contact_interests ?? []).join("\n")}/></> : <><Detail title="Experience" text={application.relevant_experience ?? "Not provided"}/><Detail title="Networks" text={application.reachable_networks ?? "Not provided"}/>{application.weekly_availability && <Detail title="Weekly availability" text={application.weekly_availability}/>}</>}
      <Detail title="Why they’re a fit" text={application.fit_reason}/>
    </div>
    <label className="mt-5 block text-sm font-bold">Internal notes<textarea className={`${field} mt-1 min-h-24 w-full`} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)}/></label>
    <button disabled={busy} className="mt-4 rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-60" onClick={() => void save(application, next, notes)}>Save status and notes</button>
    <details className="mt-4 text-sm"><summary className="cursor-pointer font-bold text-[#143d1a]">Audit history ({application.events.length})</summary><ul className="mt-2 space-y-1 text-neutral-600">{application.events.map((event) => <li key={event.id}>{new Date(event.created_at).toLocaleString()} — {event.event_type}{event.from_status !== event.to_status ? ` (${event.from_status ?? "None"} → ${event.to_status})` : ""}</li>)}</ul></details>
  </article>;
}

function Detail({ title, text }: { title: string; text: string }) { return <div><h3 className="text-sm font-extrabold text-[#143d1a]">{title}</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{text}</p></div>; }
