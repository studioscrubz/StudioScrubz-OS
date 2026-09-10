"use client";

import Link from "next/link";
import { PorterServiceCalculator } from "@/components/properties/PorterServiceCalculator";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { getProperties } from "@/lib/services/properties";
import { getAgreements } from "@/lib/services/agreements";
import { getActiveCrews } from "@/lib/services/crews";
import { getActiveServices } from "@/lib/services/serviceCatalog";
import { archivePropertyServicePlan, createPropertyServicePlan, deletePropertyServicePlan, listPropertyServicePlans, updatePropertyServicePlan } from "@/lib/services/propertyServicePlans";
import { PLAN_DAYS, PLAN_FREQUENCIES, PLAN_STATUSES, type PropertyServicePlanInput, type PropertyServicePlanAreaInput, type PropertyServicePlanWithAreas } from "@/types/propertyServicePlan";
import type { PropertyWithClient } from "@/types/property";
import type { AgreementWithRelations } from "@/types/agreement";
import type { CrewWithRelations } from "@/types/crew";
import type { CatalogService } from "@/types/serviceCatalog";

const field = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900";
const button = "rounded-lg border border-[#143d1a]/20 px-4 py-2 text-sm font-bold text-[#143d1a] hover:bg-[#f4f7f1] disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-[#143d1a] text-white hover:bg-[#0d2b12]`;
type Options = { properties: PropertyWithClient[]; agreements: AgreementWithRelations[]; crews: CrewWithRelations[]; services: CatalogService[] };
const emptyOptions: Options = { properties: [], agreements: [], crews: [], services: [] };
function propertyLabel(property: PropertyWithClient) { return property.property_name || property.address; }
function clientLabel(property?: PropertyWithClient) { const client = property?.client; return client ? client.company_name || [client.first_name, client.last_name].filter(Boolean).join(" ") : "Client unavailable"; }
function message(error: unknown) { return error instanceof Error ? error.message : "Property Service Plans could not be loaded or saved."; }

export function PropertyServicePlansPage() {
  const { profile } = useAuth();
  const allowed = hasPermission(profile, "propertyServicePlans.manage");
  const [plans, setPlans] = useState<PropertyServicePlanWithAreas[]>([]);
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<PropertyServicePlanWithAreas | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function refresh() { setPlans(await listPropertyServicePlans(true)); }
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    Promise.all([listPropertyServicePlans(true), getProperties(), getAgreements(), getActiveCrews(), getActiveServices()])
      .then(([rows, properties, agreements, crews, services]) => { if (active) { setPlans(rows); setOptions({ properties, agreements, crews, services }); } })
      .catch(error => { if (active) setError(message(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed]);

  async function save(input: PropertyServicePlanInput, areas: PropertyServicePlanAreaInput[]) {
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = editing ? await updatePropertyServicePlan(editing, input, areas) : await createPropertyServicePlan(input, areas);
      setPlans(rows => [saved, ...rows.filter(row => row.id !== saved.id)]);
      setEditing(undefined); setNotice("Property Service Plan saved.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  async function archive(plan: PropertyServicePlanWithAreas) {
    if (!window.confirm(`End and archive ${plan.name}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = await archivePropertyServicePlan(plan);
      setPlans(rows => rows.map(row => row.id === saved.id ? saved : row));
      setEditing(undefined); setNotice("Property Service Plan ended and archived.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  async function removePlan(plan: PropertyServicePlanWithAreas) {
    if (!window.confirm(`Permanently delete ${plan.name}? This cannot be undone.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await deletePropertyServicePlan(plan);
      setPlans(rows => rows.filter(row => row.id !== plan.id));
      if (editing?.id === plan.id) setEditing(undefined);
      setNotice("Property Service Plan permanently deleted.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  if (!allowed) return <p>Property Service Plan access is restricted to management.</p>;
  const visible = plans.filter(plan => {
    const property = options.properties.find(p => p.id === plan.property_id);
    const text = [plan.name, plan.status, property ? propertyLabel(property) : "", clientLabel(property)].join(" ");
    return (showArchived || !plan.archived_at) && text.toLowerCase().includes(search.toLowerCase());
  });
  return <>
    <Link href="/properties" className="text-sm font-bold text-[#143d1a]">Back to Properties</Link>
    <header className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b border-[#143d1a]/10 pb-7">
      <div><h1 className="text-3xl font-extrabold text-[#143d1a]">Property Service Plans</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">A Property Service Plan defines the recurring operational setup for a managed property. Jobs remain individual service events. Plans do not generate visits or jobs in V1.</p></div>
      <button type="button" className={primary} disabled={loading || busy} onClick={() => { setEditing(null); setError(""); setNotice(""); }}>Create Plan</button>
    </header>
    {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-5 rounded-lg bg-green-50 p-4 text-sm text-[#143d1a]">{notice}</p>}
    {editing !== undefined && <PlanEditor key={editing?.id ?? "new"} plan={editing} options={options} busy={busy} save={save} close={() => setEditing(undefined)} />}
    <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-5">
      <div className="flex flex-wrap items-center gap-4"><label className="flex-1 text-sm font-bold">Search plans<input className={field} type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Plan, property, client, or status"/></label><label className="text-sm"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}/> Include archived</label><button type="button" className={button} disabled={busy || loading} onClick={() => { setError(""); void refresh().catch(error => setError(message(error))); }}>Refresh</button></div>
      {loading ? <p className="py-8">Loading plans…</p> : visible.length === 0 ? <p className="py-8 text-neutral-600">No Property Service Plans match this view.</p> : <div className="mt-5 grid gap-4 lg:grid-cols-2">{visible.map(plan => {
        const property = options.properties.find(p => p.id === plan.property_id);
        return <article key={plan.id} className="rounded-xl border border-neutral-200 p-5">
          <p className="text-xs font-bold text-[#9a7a17]">{plan.archived_at ? "Archived" : plan.status}</p><h2 className="mt-1 text-xl font-extrabold text-[#143d1a]">{plan.name}</h2>
          <p className="mt-2 text-sm">{property ? propertyLabel(property) : "Property unavailable"} · {clientLabel(property)}</p>
          <p className="mt-2 text-sm text-neutral-600">{plan.frequency}{plan.service_days.length ? ` · ${plan.service_days.map(day => PLAN_DAYS[day - 1]).join(", ")}` : ""}</p>
          <p className="mt-2 text-sm text-neutral-600">{plan.start_date}{plan.end_date ? ` through ${plan.end_date}` : " · No end date"} · {plan.areas.filter(area => area.active).length} active areas</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {!plan.archived_at && <button type="button" className={button} disabled={busy} onClick={() => { setEditing(plan); setError(""); setNotice(""); }}>Edit Plan</button>}
            {!plan.archived_at && <button type="button" className={button} disabled={busy} onClick={() => void archive(plan)}>End &amp; Archive</button>}
            <button type="button" className={button} disabled={busy} onClick={() => void removePlan(plan)}>Delete Plan</button>
          </div>
        </article>;
      })}</div>}
    </section>
  </>;
}

function PlanEditor({ plan, options, busy, save, close }: { plan: PropertyServicePlanWithAreas | null; options: Options; busy: boolean; save: (input: PropertyServicePlanInput, areas: PropertyServicePlanAreaInput[]) => Promise<void>; close: () => void }) {
  const [input, setInput] = useState<PropertyServicePlanInput>(() => plan ?? {
    name: "", client_id: "", property_id: "", agreement_id: null, service_id: null, status: "Active", start_date: "", end_date: null,
    frequency: "Weekly", service_days: [], assigned_crew_id: null, notes: null,
  });
  const [areas, setAreas] = useState<PropertyServicePlanAreaInput[]>(() => plan?.areas ?? []);
  const change = <K extends keyof PropertyServicePlanInput>(key: K, value: PropertyServicePlanInput[K]) => setInput(current => ({ ...current, [key]: value }));
  function changeArea(index: number, update: Partial<PropertyServicePlanAreaInput>) { setAreas(current => current.map((area, i) => i === index ? { ...area, ...update } : area)); }
  function move(index: number, direction: number) { setAreas(current => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }); }
  const pricingDaysMismatch = Boolean(input.pricing_snapshot && input.pricing_snapshot.inputs.visitsPerWeek !== input.service_days.length);
  function submit(event: FormEvent) { event.preventDefault(); if (pricingDaysMismatch) return; void save(input, areas.map((area, index) => ({ ...area, sort_order: index }))); }
  const property = options.properties.find(p => p.id === input.property_id);
  const agreements = options.agreements.filter(a => a.property_id === input.property_id && a.client_id === input.client_id);
  return <form onSubmit={submit} className="mt-6 rounded-2xl border border-[#143d1a]/20 bg-white p-5 sm:p-7">
    <h2 className="text-xl font-extrabold text-[#143d1a]">{plan ? "Edit" : "Create"} Property Service Plan</h2>
    <fieldset disabled={busy} className="mt-5 space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-bold">Plan name<input required className={field} value={input.name} onChange={e => change("name", e.target.value)}/></label>
        <label className="text-sm font-bold">Status<select className={field} value={input.status} onChange={e => change("status", e.target.value as PropertyServicePlanInput["status"])}>{PLAN_STATUSES.map(status => <option key={status}>{status}</option>)}</select></label>
        <label className="text-sm font-bold">Property<select required className={field} value={input.property_id} onChange={e => { const selected = options.properties.find(p => p.id === e.target.value); setInput(current => ({ ...current, property_id: e.target.value, client_id: selected?.client_id ?? "", agreement_id: null })); }}><option value="">Select property</option>{options.properties.filter(p => p.client_id && (!p.archived_at || p.id === input.property_id)).map(p => <option key={p.id} value={p.id}>{propertyLabel(p)} — {clientLabel(p)}</option>)}</select></label>
        <label className="text-sm font-bold">Client (from property)<input readOnly className={field} value={property ? clientLabel(property) : "Select a property"}/></label>
        <label className="text-sm font-bold">Linked Agreement (optional)<select className={field} value={input.agreement_id ?? ""} onChange={e => change("agreement_id", e.target.value || null)}><option value="">No linked Agreement</option>{input.agreement_id && !agreements.some(a => a.id === input.agreement_id) && <option value={input.agreement_id}>Existing linked Agreement (unavailable)</option>}{agreements.map(a => <option key={a.id} value={a.id}>{a.agreement_number} · {a.status}</option>)}</select></label>
        <label className="text-sm font-bold">Service (optional)<select className={field} value={input.service_id ?? ""} onChange={e => change("service_id", e.target.value || null)}><option value="">No catalog service</option>{input.service_id && !options.services.some(s => s.id === input.service_id) && <option value={input.service_id}>Existing service (inactive)</option>}{options.services.map(s => <option key={s.id} value={s.id}>{s.service_name}</option>)}</select></label>
        <label className="text-sm font-bold">Start date<input required type="date" className={field} value={input.start_date} onChange={e => change("start_date", e.target.value)}/></label>
        <label className="text-sm font-bold">End date (optional)<input type="date" min={input.start_date} className={field} value={input.end_date ?? ""} onChange={e => change("end_date", e.target.value || null)}/></label>
        <label className="text-sm font-bold">Frequency<select className={field} value={input.frequency} onChange={e => { const frequency = e.target.value as PropertyServicePlanInput["frequency"]; setInput(current => ({ ...current, frequency, service_days: frequency === "Daily" ? [1,2,3,4,5,6,7] : frequency === "Weekly" ? current.service_days.slice(0,1) : current.service_days })); }}>{PLAN_FREQUENCIES.map(frequency => <option key={frequency}>{frequency}</option>)}</select></label>
        <label className="text-sm font-bold">Assigned crew (optional)<select className={field} value={input.assigned_crew_id ?? ""} onChange={e => change("assigned_crew_id", e.target.value || null)}><option value="">Unassigned</option>{input.assigned_crew_id && !options.crews.some(c => c.id === input.assigned_crew_id) && <option value={input.assigned_crew_id}>Existing crew (inactive)</option>}{options.crews.map(c => <option key={c.id} value={c.id}>{c.crew_name}</option>)}</select></label>
      </div>
      <fieldset><legend className="text-sm font-bold">Service days</legend><div className="mt-3 flex flex-wrap gap-4">{PLAN_DAYS.map((day, index) => <label key={day} className="text-sm"><input type="checkbox" disabled={input.frequency === "Daily"} checked={input.service_days.includes(index + 1)} onChange={e => change("service_days", e.target.checked ? input.frequency === "Weekly" ? [index + 1] : [...input.service_days, index + 1].sort((a,b) => a-b) : input.service_days.filter(value => value !== index + 1))}/> {day}</label>)}</div><p className="mt-2 text-sm text-neutral-500">Custom schedules may omit weekdays; describe the recurring requirements in notes. These settings do not schedule jobs.</p></fieldset>
      <PorterServiceCalculator snapshot={input.pricing_snapshot} visitsPerWeek={input.service_days.length} onUse={snapshot => change("pricing_snapshot", snapshot)}/>
      {pricingDaysMismatch && <p role="alert" className="text-sm text-amber-800">Service days changed. Review the calculator and select Use Pricing before saving the plan.</p>}
      <label className="block text-sm font-bold">Notes<textarea rows={3} className={field} value={input.notes ?? ""} onChange={e => change("notes", e.target.value || null)}/></label>
      <div><h3 className="text-lg font-extrabold text-[#143d1a]">Service areas</h3><p className="mt-1 text-sm text-neutral-600">Add property-specific areas such as Entryways &amp; Walkways, Trash Area, or Laundry / Mail Areas. Required and photo flags define future service requirements; they do not collect photos in V1.</p>
        <div className="mt-4 space-y-4">{areas.map((area, index) => <div key={area.id ?? `new-${index}`} className="rounded-xl border border-neutral-200 p-4">
          <div className="grid gap-3 md:grid-cols-2"><label className="text-sm font-bold">Area name<input required className={field} value={area.name} onChange={e => changeArea(index, { name: e.target.value })}/></label><label className="text-sm font-bold">Description<input className={field} value={area.description ?? ""} onChange={e => changeArea(index, { description: e.target.value || null })}/></label></div>
          <div className="mt-4 flex flex-wrap items-center gap-4">{([['is_required','Required'],['requires_photo','Photo required'],['active','Active']] as const).map(([key,label]) => <label key={key} className="text-sm"><input type="checkbox" checked={area[key]} onChange={e => changeArea(index, { [key]: e.target.checked })}/> {label}</label>)}<button type="button" className={button} aria-label={`Move ${area.name || "area"} up`} disabled={index === 0} onClick={() => move(index, -1)}>Up</button><button type="button" className={button} aria-label={`Move ${area.name || "area"} down`} disabled={index === areas.length - 1} onClick={() => move(index, 1)}>Down</button>{!area.id && <button type="button" className={button} onClick={() => setAreas(current => current.filter((_, i) => i !== index))}>Remove</button>}</div>
        </div>)}</div>
        <button type="button" className={`${button} mt-4`} onClick={() => setAreas(current => [...current, { name: "", description: null, sort_order: current.length, is_required: true, requires_photo: false, active: true }])}>Add Service Area</button>
      </div>
      <div className="flex gap-3"><button type="submit" className={primary}>{busy ? "Saving…" : "Save Plan"}</button><button type="button" className={button} onClick={close}>Cancel</button></div>
    </fieldset>
  </form>;
}
