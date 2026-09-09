"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { getActiveCrews } from "@/lib/services/crews";
import { listPropertyServicePlans } from "@/lib/services/propertyServicePlans";
import { createPorterVisit, getPorterVisit, listPorterVisits, mutatePorterVisit } from "@/lib/services/porterVisits";
import { VISIT_AREA_STATUSES, VISIT_STATUSES, type CreatePorterVisitInput, type PorterVisitArea, type PorterVisitMutation, type PorterVisitWithAreas } from "@/types/porterVisit";
import type { PropertyServicePlanWithAreas } from "@/types/propertyServicePlan";
import type { CrewWithRelations } from "@/types/crew";

const button = "rounded-lg border border-[#143d1a]/20 px-4 py-2 text-sm font-bold text-[#143d1a] hover:bg-[#f4f7f1] disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-[#143d1a] text-white hover:bg-[#0d2b12]`;
const field = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900";
function errorText(error: unknown) { return error instanceof Error ? error.message : "Porter Visit request failed."; }

export function PorterVisitsPage() {
  const { profile } = useAuth();
  const allowed = hasPermission(profile, "porterVisits.view");
  const management = hasPermission(profile, "porterVisits.manage");
  const [visits, setVisits] = useState<PorterVisitWithAreas[]>([]);
  const [plans, setPlans] = useState<PropertyServicePlanWithAreas[]>([]);
  const [crews, setCrews] = useState<CrewWithRelations[]>([]);
  const [selected, setSelected] = useState<PorterVisitWithAreas | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [date, setDate] = useState("");
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    Promise.all([listPorterVisits(), management ? listPropertyServicePlans() : Promise.resolve([]), management ? getActiveCrews() : Promise.resolve([])])
      .then(([rows, planRows, crewRows]) => { if (active) { setVisits(rows); setPlans(planRows.filter(plan => plan.status === "Active" && !plan.archived_at)); setCrews(crewRows); } })
      .catch(error => { if (active) setError(errorText(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed, management]);
  async function refresh() {
    setBusy(true); setError("");
    try {
      const rows = await listPorterVisits(); setVisits(rows);
      if (selected) setSelected(rows.find(row => row.id === selected.id) ?? null);
      if (management) { const [planRows, crewRows] = await Promise.all([listPropertyServicePlans(), getActiveCrews()]); setPlans(planRows.filter(plan => plan.status === "Active" && !plan.archived_at)); setCrews(crewRows); }
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    setBusy(true); setError(""); setNotice("");
    try { setSelected(await getPorterVisit(id)); setCreating(false); }
    catch (error) { setSelected(null); setError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function create(input: CreatePorterVisitInput) {
    setBusy(true); setError(""); setNotice("");
    try {
      const id = await createPorterVisit(input);
      setCreating(false); setNotice("Porter Visit created. Use Refresh if it is not shown yet.");
      const visit = await getPorterVisit(id); setSelected(visit); setVisits(rows => [visit, ...rows]);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function mutate(mutation: PorterVisitMutation) {
    if (!selected) return;
    if (mutation.action === "cancel" && !window.confirm("Cancel this Porter Visit? Cancelled visits cannot be reopened.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const id = await mutatePorterVisit(selected, mutation);
      setNotice("Porter Visit updated. Use Refresh to reload the latest saved state.");
      const visit = await getPorterVisit(id); setSelected(visit); setVisits(rows => rows.map(row => row.id === id ? visit : row));
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  if (!allowed) return <p>Porter Visit access denied.</p>;
  const filtered = visits.filter(visit => (status === "All" || visit.status === status) && (!date || visit.scheduled_date === date)
    && [visit.plan_name, visit.property_label, visit.crew_name, visit.scheduled_date].join(" ").toLowerCase().includes(search.toLowerCase()));
  return <>
    <Link href="/properties" className="text-sm font-bold text-[#143d1a]">Back to Properties</Link>
    <header className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b border-[#143d1a]/10 pb-7"><div><h1 className="text-3xl font-extrabold text-[#143d1a]">Porter Visits</h1><p className="mt-2 text-sm text-neutral-600">Scheduled service occurrences with a saved checklist from the Property Service Plan.</p></div>{management && <button className={primary} disabled={busy || loading} onClick={() => { setCreating(true); setSelected(null); setError(""); setNotice(""); }}>New Porter Visit</button>}</header>
    {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-5 rounded-lg bg-green-50 p-4 text-sm text-[#143d1a]">{notice}</p>}
    {creating && management && <CreateVisit plans={plans} crews={crews} busy={busy} submit={create} close={() => setCreating(false)}/>}
    {selected && <VisitDetail key={`${selected.id}:${selected.updated_at}`} visit={selected} crews={crews} management={management} busy={busy} mutate={mutate} close={() => setSelected(null)}/>}
    <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-5">
      <div className="grid gap-4 md:grid-cols-[1fr_180px_180px_auto]"><label className="text-sm font-bold">Search<input type="search" className={field} value={search} onChange={e => setSearch(e.target.value)} placeholder="Property, plan, or crew"/></label><label className="text-sm font-bold">Status<select className={field} value={status} onChange={e => setStatus(e.target.value)}>{["All", ...VISIT_STATUSES].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-bold">Scheduled date<input className={field} type="date" value={date} onChange={e => setDate(e.target.value)}/></label><button className={`${button} self-end`} disabled={busy || loading} onClick={() => void refresh()}>Refresh</button></div>
      {loading ? <p className="py-8">Loading Porter Visits…</p> : filtered.length === 0 ? <p className="py-8 text-neutral-600">No Porter Visits match this view.</p> : <div className="mt-5 grid gap-4 lg:grid-cols-2">{filtered.map(visit => <article key={visit.id} className="rounded-xl border border-neutral-200 p-5"><p className="text-xs font-bold text-[#9a7a17]">{visit.status} · {visit.scheduled_date}</p><h2 className="mt-2 text-xl font-extrabold text-[#143d1a]">{visit.property_label}</h2><p className="mt-2 text-sm">{visit.plan_name}</p><p className="mt-2 text-sm text-neutral-600">{visit.crew_name ?? "Unassigned crew"}</p><button className={`${button} mt-4`} disabled={busy} onClick={() => void open(visit.id)}>Open Visit</button></article>)}</div>}
    </section>
  </>;
}

function CrewOptions({ crews, value }: { crews: CrewWithRelations[]; value: string | null }) {
  return <>{value && !crews.some(crew => crew.id === value) && <option value={value}>Existing assigned crew</option>}{crews.map(crew => <option key={crew.id} value={crew.id}>{crew.crew_name}</option>)}</>;
}
function CreateVisit({ plans, crews, busy, submit, close }: { plans: PropertyServicePlanWithAreas[]; crews: CrewWithRelations[]; busy: boolean; submit: (input: CreatePorterVisitInput) => Promise<void>; close: () => void }) {
  const [input, setInput] = useState<CreatePorterVisitInput>({ plan_id: "", scheduled_date: "", assigned_crew_id: null, visit_notes: null });
  function save(event: FormEvent) { event.preventDefault(); void submit(input); }
  return <form onSubmit={save} className="mt-6 rounded-2xl border bg-white p-6"><h2 className="text-xl font-extrabold text-[#143d1a]">New Porter Visit</h2><fieldset disabled={busy} className="mt-4 space-y-4">
    <label className="block text-sm font-bold">Active Property Service Plan<select required className={field} value={input.plan_id} onChange={e => { const plan = plans.find(plan => plan.id === e.target.value); setInput(current => ({ ...current, plan_id: e.target.value, assigned_crew_id: plan?.assigned_crew_id ?? null })); }}><option value="">Select plan</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
    {!plans.length && <p className="text-sm text-neutral-600">Create or activate a plan in <Link className="underline" href="/properties/service-plans">Property Service Plans</Link> first.</p>}
    <label className="block text-sm font-bold">Scheduled date<input required type="date" className={field} value={input.scheduled_date} onChange={e => setInput(current => ({ ...current, scheduled_date: e.target.value }))}/></label>
    <label className="block text-sm font-bold">Crew<select className={field} value={input.assigned_crew_id ?? ""} onChange={e => setInput(current => ({ ...current, assigned_crew_id: e.target.value || null }))}><option value="">Use plan default (unassigned if none)</option><CrewOptions crews={crews} value={input.assigned_crew_id}/></select></label>
    <label className="block text-sm font-bold">Visit notes<textarea rows={3} className={field} value={input.visit_notes ?? ""} onChange={e => setInput(current => ({ ...current, visit_notes: e.target.value || null }))}/></label>
    <p className="text-sm text-neutral-500">The property, client, and active service areas are copied from the plan when the visit is created. Later plan edits do not change this visit.</p>
    <div className="flex gap-3"><button className={primary} type="submit">{busy ? "Creating…" : "Create Visit"}</button><button className={button} type="button" onClick={close}>Cancel</button></div>
  </fieldset></form>;
}

function VisitDetail({ visit, crews, management, busy, mutate, close }: { visit: PorterVisitWithAreas; crews: CrewWithRelations[]; management: boolean; busy: boolean; mutate: (mutation: PorterVisitMutation) => Promise<void>; close: () => void }) {
  const [notes, setNotes] = useState(visit.visit_notes ?? "");
  const [date, setDate] = useState(visit.scheduled_date);
  const [crew, setCrew] = useState(visit.assigned_crew_id ?? "");
  const terminal = visit.status === "Completed" || visit.status === "Cancelled";
  const canEditSchedule = management && visit.status === "Scheduled";
  const blocked = visit.areas.some(area => area.is_required && area.status === "Pending");
  return <section className="mt-6 rounded-2xl border border-[#143d1a]/20 bg-white p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold text-[#9a7a17]">{visit.status} · {visit.scheduled_date}</p><h2 className="mt-2 text-2xl font-extrabold text-[#143d1a]">{visit.property_label}</h2><p className="mt-2">{visit.plan_name} · {visit.crew_name ?? "Unassigned crew"}</p></div><button className={button} disabled={busy} onClick={close}>Close</button></div>
    <fieldset disabled={busy || terminal} className="mt-5 space-y-4">
      {canEditSchedule && <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-bold">Scheduled date<input type="date" className={field} value={date} onChange={e => setDate(e.target.value)}/></label><label className="text-sm font-bold">Crew<select className={field} value={crew} onChange={e => setCrew(e.target.value)}><option value="">Unassigned</option><CrewOptions crews={crews} value={crew}/></select></label></div>}
      <label className="block text-sm font-bold">Visit notes<textarea rows={3} className={field} value={notes} onChange={e => setNotes(e.target.value)}/></label>
      {!terminal && <button className={button} onClick={() => void mutate(canEditSchedule ? { action: "edit", data: { scheduled_date: date, assigned_crew_id: crew || null, visit_notes: notes || null } } : { action: "notes", data: { visit_notes: notes || null } })}>Save {canEditSchedule ? "Visit Details" : "Notes"}</button>}
    </fieldset>
    <h3 className="mt-7 text-lg font-extrabold text-[#143d1a]">Service Areas</h3>
    <p className="mt-2 text-sm text-neutral-500">Saved from the plan at creation. Photo requirements are shown for reference; V1 does not collect photos. Save each area before moving to another action.</p>
    {!visit.areas.length && <p className="mt-4 text-sm">This visit has no snapshotted service areas.</p>}
    <div className="mt-4 space-y-4">{visit.areas.map(area => <AreaEditor key={area.id} area={area} disabled={busy || visit.status !== "In Progress"} editable={visit.status === "In Progress"} save={(status, notes) => mutate({ action: "area", data: { area_id: area.id, status, notes } })}/>)}</div>
    {!terminal && <div className="mt-6 flex flex-wrap gap-3">{visit.status === "Scheduled" && <button className={primary} disabled={busy} onClick={() => void mutate({ action: "start" })}>Start Visit</button>}{visit.status === "In Progress" && <button className={primary} disabled={busy || blocked} onClick={() => void mutate({ action: "complete" })}>Complete Visit</button>}{management && <button className={button} disabled={busy} onClick={() => void mutate({ action: "cancel" })}>Cancel Visit</button>}</div>}
    {visit.status === "In Progress" && blocked && <p className="mt-3 text-sm text-neutral-600">Required Pending areas must be marked Completed or Unable to Complete before completing the visit.</p>}
    {terminal && <p className="mt-5 text-sm text-neutral-500">This visit is historical and read-only.</p>}
  </section>;
}
function AreaEditor({ area, disabled, editable, save }: { area: PorterVisitArea; disabled: boolean; editable: boolean; save: (status: PorterVisitArea["status"], notes: string | null) => Promise<void> }) {
  const [status, setStatus] = useState(area.status);
  const [notes, setNotes] = useState(area.notes ?? "");
  return <fieldset disabled={disabled} className="rounded-xl border border-neutral-200 p-4"><legend className="px-1 font-bold text-[#143d1a]">{area.name}</legend>{area.description && <p className="text-sm text-neutral-600">{area.description}</p>}<p className="mt-2 text-xs font-bold text-[#9a7a17]">{area.is_required ? "Required" : "Optional"}{area.requires_photo ? " · Photo required (future phase)" : ""}</p><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-sm font-bold">Status<select className={field} value={status} onChange={e => setStatus(e.target.value as PorterVisitArea["status"])}>{VISIT_AREA_STATUSES.map(value => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-bold">Area notes<textarea className={field} value={notes} onChange={e => setNotes(e.target.value)}/></label></div>{editable && <button className={`${button} mt-3`} onClick={() => void save(status, notes || null)}>Save Area</button>}</fieldset>;
}
