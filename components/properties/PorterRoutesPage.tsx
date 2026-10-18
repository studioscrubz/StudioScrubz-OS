"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { getPorterBusinessClock } from "@/lib/porterHub";
import { buildPorterCrewWorkloads, type PorterCrewWorkload } from "@/lib/porterRoutePlanning";
import { getBusinessIdentitySettings } from "@/lib/services/businessSettings";
import { getActiveCrews } from "@/lib/services/crews";
import { listPorterVisits } from "@/lib/services/porterVisits";
import { createPorterRoute, getPorterRoute, listPorterRoutes, mutatePorterRoute } from "@/lib/services/porterRoutes";
import { eligibleRouteVisits, PORTER_ROUTE_STATUSES, routeProgress, type CreatePorterRouteInput, type PorterRouteWithStops, type RouteMutation } from "@/types/porterRoute";
import type { PorterVisitWithAreas } from "@/types/porterVisit";
import type { CrewWithRelations } from "@/types/crew";

const button = "rounded-lg border border-[#143d1a]/20 px-3 py-2 text-sm font-bold text-[#143d1a] hover:bg-[#f4f7f1] disabled:opacity-50";
const field = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";
const errorText = (error: unknown) => error instanceof Error ? error.message : "Porter Route request failed.";

export function PorterRoutesPage() {
  const { profile } = useAuth();
  const allowed = hasPermission(profile, "porterVisits.view");
  const management = hasPermission(profile, "porterVisits.manage");
  const [routes, setRoutes] = useState<PorterRouteWithStops[]>([]);
  const [visits, setVisits] = useState<PorterVisitWithAreas[]>([]);
  const [crews, setCrews] = useState<CrewWithRelations[]>([]);
  const [selected, setSelected] = useState<PorterRouteWithStops | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");
  const [crew, setCrew] = useState("");
  const [draftDefaults, setDraftDefaults] = useState<{ date: string; crewId: string } | null>(null);
  useEffect(() => {
    if (!allowed) return;
    const id = new URLSearchParams(window.location.search).get("route");
    if (!id) return;
    let active = true;
    getPorterRoute(id).then(route => { if (active) setSelected(route); })
      .catch(error => { if (active) setError(errorText(error)); });
    return () => { active = false; };
  }, [allowed]);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    Promise.all([listPorterRoutes(), management ? listPorterVisits() : Promise.resolve([]), management ? getActiveCrews() : Promise.resolve([]), management ? getBusinessIdentitySettings() : Promise.resolve(null)])
      .then(([r,v,c,settings]) => { if (active) { setRoutes(r); setVisits(v); setCrews(c); if (settings?.timezone) setDate(current => current || getPorterBusinessClock(new Date(), settings.timezone!).date); } })
      .catch(error => { if (active) setError(errorText(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed, management]);
  async function refresh(background = false) {
    if (!allowed) return;
    if (!background) { setBusy(true); setError(""); }
    try {
      const rows = await listPorterRoutes(); setRoutes(rows);
      // Never advance the version under an unsaved editor. Saving it will reject stale data.
      if (!editing) setSelected(current => rows.find(row => row.id === current?.id) ?? null);
      if (management) { setVisits(await listPorterVisits()); if (!background) setCrews(await getActiveCrews()); }
      if (editing) setNotice("Route data refreshed. Close and reopen the editor to load a newer version; stale saves are rejected.");
    } catch (error) { setError(errorText(error)); }
    finally { if (!background) setBusy(false); }
  }
  useOperationalRealtime(["property_service_routes", "property_service_route_stops", "property_service_visits"], () => refresh(true));
  async function open(id: string) {
    setBusy(true); setError(""); setNotice("");
    try { setSelected(await getPorterRoute(id)); setEditing(false); setCreating(false); setDraftDefaults(null); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function save(input: CreatePorterRouteInput) {
    setBusy(true); setError("");
    try {
      const id = selected && editing ? await mutatePorterRoute(selected, { action: "edit", data: { route_name: input.route_name, notes: input.notes, stops: input.stops } }) : await createPorterRoute(input);
      setSelected(await getPorterRoute(id)); setRoutes(await listPorterRoutes()); setEditing(false); setCreating(false); setNotice("Route saved.");
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function mutate(mutation: RouteMutation) {
    if (!selected) return;
    if (mutation.action === "cancel" && !window.confirm("Cancel this route? Its Porter Visits will remain unchanged.")) return;
    setBusy(true); setError("");
    try { const id = await mutatePorterRoute(selected, mutation); setSelected(await getPorterRoute(id)); setRoutes(await listPorterRoutes()); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  if (!allowed) return <p>Porter Route access denied.</p>;
  const today = routes.find(route => route.business_today)?.business_today;
  const workloads = buildPorterCrewWorkloads(visits, routes, crews, date);
  const filtered = routes.filter(route => (!date || route.route_date === date) && (!status || route.status === status) && (!crew || route.assigned_crew_id === crew)
    && [route.route_name, route.crew_name, ...route.stops.map(stop => stop.visit?.property_label)].join(" ").toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => {
      const rank = (route: PorterRouteWithStops) => ["Completed", "Cancelled"].includes(route.status) ? 3 : today && route.route_date === today ? 0 : today && route.route_date > today ? 1 : 2;
      return rank(a)-rank(b) || a.route_date.localeCompare(b.route_date) || a.id.localeCompare(b.id);
    });
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-extrabold text-[#143d1a]">Porter Routes</h1><p className="mt-2 text-sm text-neutral-600">Organize existing Porter Visits by date, crew, and stop order.</p></div><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => void refresh()}>Refresh</button>{management && <button className={button} disabled={busy} onClick={() => { setDraftDefaults({ date, crewId: crew }); setCreating(true); setSelected(null); setEditing(false); }}>Create Route</button>}</div></header>
    {error && <p role="alert" className="text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-neutral-600">{notice}</p>}
    {(creating || editing) && management ? <RouteEditor key={selected?.id ?? `new-${draftDefaults?.date}-${draftDefaults?.crewId}`} route={editing ? selected : null} defaults={editing ? null : draftDefaults} {...{ routes, visits, crews, busy }} save={save} close={() => { setCreating(false); setEditing(false); setDraftDefaults(null); if (selected) void open(selected.id); }}/>
      : selected ? <RouteDetail route={selected} {...{ management, busy, mutate }} edit={() => setEditing(true)} close={() => setSelected(null)}/>
      : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-bold">Search<input className={field} value={search} onChange={event => setSearch(event.target.value)} placeholder="Route or property"/></label><label className="text-sm font-bold">Service date<input type="date" className={field} value={date} onChange={event => setDate(event.target.value)}/></label><label className="text-sm font-bold">Status<select className={field} value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{PORTER_ROUTE_STATUSES.map(value => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-bold">Crew<select className={field} value={crew} onChange={event => setCrew(event.target.value)}><option value="">All visible crews</option>{Array.from(new Map([...crews.map(item => [item.id, item.crew_name] as const), ...routes.map(route => [route.assigned_crew_id, route.crew_name] as const)]).entries()).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
        {management && <RoutePlanningSummary workloads={crew ? workloads.filter(item => item.crewId === crew) : workloads} serviceDate={date} busy={busy} plan={(date, crewId) => { setDraftDefaults({ date, crewId }); setCreating(true); setSelected(null); setEditing(false); }} />}
        {loading ? <p>Loading Porter Routes...</p> : !filtered.length ? <p>No Porter Routes match this view.</p> : <div className="grid gap-4 lg:grid-cols-2">{filtered.map(route => {
          const progress = routeProgress(route);
          return <article key={route.id} className="rounded-xl border border-neutral-200 bg-white p-5"><p className="text-sm font-bold text-[#9a7a17]">{route.route_date === today ? "Today | " : ""}{route.route_date} | {route.status}</p><h2 className="mt-2 text-xl font-bold text-[#143d1a]">{route.route_name || "Porter Route"}</h2><p>{route.crew_name}</p><RouteProgress progress={progress} /><button className={`${button} mt-3`} disabled={busy} onClick={() => void open(route.id)}>View Route</button></article>;
        })}</div>}
      </>}
  </div>;
}

function RoutePlanningSummary({ workloads, serviceDate, busy, plan }: { workloads: PorterCrewWorkload[]; serviceDate: string; busy: boolean; plan: (date: string, crewId: string) => void }) {
  if (!serviceDate) return <section className="rounded-xl border border-dashed border-[#143d1a]/25 bg-white p-5"><h2 className="font-bold text-[#143d1a]">Crew workload</h2><p className="mt-1 text-sm text-neutral-600">Choose a service date to review scheduled, routed, and unrouted visits.</p></section>;
  return <section aria-labelledby="route-planning-heading" className="rounded-2xl border border-[#143d1a]/15 bg-[#f7f9f5] p-4 sm:p-5">
    <div><h2 id="route-planning-heading" className="text-lg font-extrabold text-[#143d1a]">Crew workload for {serviceDate}</h2><p className="mt-1 text-sm text-neutral-600">Planning warnings are informational. Route assignment remains manual and server validation remains authoritative.</p></div>
    {!workloads.length ? <p className="mt-4 rounded-xl bg-white p-4 text-sm text-neutral-600">No crew-assigned Scheduled visits or active routes exist for this date.</p> : <div className="mt-4 grid gap-4 xl:grid-cols-2">{workloads.map(workload => <article key={workload.crewId} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-extrabold text-[#143d1a]">{workload.crewName}</h3><p className="mt-1 text-sm text-neutral-600">{workload.routeCount} route{workload.routeCount === 1 ? "" : "s"}</p></div><button type="button" className={button} disabled={busy} onClick={() => plan(serviceDate, workload.crewId)}>Plan route</button></div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center"><WorkloadMetric label="Scheduled" value={workload.totalScheduled}/><WorkloadMetric label="Routed" value={workload.routed}/><WorkloadMetric label="Unrouted" value={workload.unrouted.length} warning={workload.unrouted.length > 0}/></dl>
      {workload.duplicateStarts.map(conflict => <div role="status" key={conflict.startTime} className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-bold">Duplicate start warning: {conflict.startTime}</p><p className="mt-1">{conflict.visits.map(visit => visit.property_label).join(", ")}</p></div>)}
      {!!workload.unrouted.length && <div className="mt-4"><p className="text-xs font-black uppercase tracking-[.12em] text-[#8a6b12]">Outstanding unrouted visits</p><ul className="mt-2 space-y-2">{workload.unrouted.map(visit => <li key={visit.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm"><span><span className="font-bold text-[#143d1a]">{visit.property_label}</span>{visit.scheduled_start_time ? ` · ${visit.scheduled_start_time.slice(0, 5)}` : " · Start time unavailable"}</span><Link className="font-bold text-[#143d1a] underline decoration-[#d4af37] decoration-2 underline-offset-4" href={`/properties/porter-visits?visit=${encodeURIComponent(visit.id)}`}>View visit</Link></li>)}</ul></div>}
    </article>)}</div>}
    <p className="mt-4 text-xs text-neutral-500">Duration-based overlap warnings are not shown because Porter Visits do not store a reliable visit duration.</p>
  </section>;
}

function WorkloadMetric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div className={`rounded-lg border p-3 ${warning ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"}`}><dt className="text-xs font-bold text-neutral-600">{label}</dt><dd className="mt-1 text-xl font-black text-[#143d1a]">{value}</dd></div>;
}

function RouteProgress({ progress }: { progress: ReturnType<typeof routeProgress> }) {
  return <div className="mt-3" aria-label={`${progress.percentage}% route completion`}>
    <div className="flex flex-wrap justify-between gap-2 text-sm"><p>{progress.total} Total · {progress.completed} Completed · {progress.remaining} Remaining · {progress.cancelled} Cancelled</p><p className="font-bold text-[#143d1a]">{progress.percentage}%</p></div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-[#d4af37] transition-[width] motion-reduce:transition-none" style={{ width: `${progress.percentage}%` }} /></div>
  </div>;
}

function RouteDetail({ route, management, busy, mutate, edit, close }: { route: PorterRouteWithStops; management: boolean; busy: boolean; mutate: (mutation: RouteMutation) => Promise<void>; edit: () => void; close: () => void }) {
  const progress = routeProgress(route);
  return <section className="space-y-4 rounded-xl border bg-white p-5"><header><h2 className="text-xl font-bold text-[#143d1a]">{route.route_name || "Porter Route"}</h2><p>{route.route_date} | {route.crew_name} | {route.status}</p><p className="mt-2 whitespace-pre-wrap text-sm">{route.notes}</p><RouteProgress progress={progress} /></header>
    <div className="flex flex-wrap gap-2"><button className={button} onClick={close}>Back to Routes</button>{management && route.status === "Planned" && <><button className={button} disabled={busy} onClick={edit}>Edit Route / Stops</button><button className={button} disabled={busy || !progress.total} onClick={() => void mutate({ action: "start" })}>Start Route</button></>}{management && route.status === "In Progress" && <button className={button} disabled={busy || progress.remaining > 0} onClick={() => void mutate({ action: "complete" })}>Complete Route</button>}{management && ["Planned","In Progress"].includes(route.status) && <button className={button} disabled={busy} onClick={() => void mutate({ action: "cancel" })}>Cancel Route</button>}</div>
    {route.status === "In Progress" && <p className="text-sm">Route structure is locked. Complete or cancel each visit in Porter Visits before completing this route.</p>}
    {[...route.stops].sort((a,b) => a.stop_order-b.stop_order).map(stop => <article key={stop.id} className="rounded-lg border p-4"><p className="text-sm font-bold text-[#9a7a17]">Stop {stop.stop_order}</p>{stop.visit ? <><h3 className="font-bold text-[#143d1a]">{stop.visit.property_label}</h3><p className="text-sm">{stop.visit.plan_name} | {stop.visit.status}</p><p className="mt-2 whitespace-pre-wrap text-sm">{stop.visit.visit_notes}</p>{stop.stop_notes && <p className="mt-2 whitespace-pre-wrap text-sm">Stop notes: {stop.stop_notes}</p>}<Link className={`${button} mt-3 inline-block`} href={`/properties/porter-visits?visit=${encodeURIComponent(stop.visit_id)}`}>Open Visit</Link></> : <p>Visit is no longer available to your crew.</p>}</article>)}
    {!progress.total && <p>No stops. Add existing Scheduled visits before starting.</p>}
  </section>;
}

function RouteEditor({ route, defaults, routes, visits, crews, busy, save, close }: { route: PorterRouteWithStops | null; defaults: { date: string; crewId: string } | null; routes: PorterRouteWithStops[]; visits: PorterVisitWithAreas[]; crews: CrewWithRelations[]; busy: boolean; save: (input: CreatePorterRouteInput) => Promise<void>; close: () => void }) {
  const [input, setInput] = useState<CreatePorterRouteInput>(() => ({ route_date: route?.route_date ?? defaults?.date ?? "", assigned_crew_id: route?.assigned_crew_id ?? defaults?.crewId ?? "", route_name: route?.route_name ?? null, notes: route?.notes ?? null, stops: route?.stops.map(stop => ({ visit_id: stop.visit_id, stop_notes: stop.stop_notes })) ?? [] }));
  const candidates = eligibleRouteVisits(visits, routes, input.route_date, input.assigned_crew_id, route?.id).filter(visit => !input.stops.some(stop => stop.visit_id === visit.id));
  function move(index: number, direction: number) {
    setInput(current => { const stops = [...current.stops]; const target = index+direction; if (target < 0 || target >= stops.length) return current; [stops[index],stops[target]]=[stops[target],stops[index]]; return { ...current, stops }; });
  }
  function submit(event: FormEvent) { event.preventDefault(); void save(input); }
  return <form onSubmit={submit} className="rounded-xl border bg-white p-5"><h2 className="text-xl font-bold text-[#143d1a]">{route ? "Edit Route" : "Create Route"}</h2><fieldset disabled={busy} className="mt-4 space-y-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Date<input required disabled={Boolean(route)} type="date" className={field} value={input.route_date} onChange={event => setInput(current => ({ ...current, route_date: event.target.value, stops: [] }))}/></label><label className="text-sm font-bold">Crew<select required disabled={Boolean(route)} className={field} value={input.assigned_crew_id} onChange={event => setInput(current => ({ ...current, assigned_crew_id: event.target.value, stops: [] }))}><option value="">Choose active crew</option>{route && !crews.some(crew => crew.id === route.assigned_crew_id) && <option value={route.assigned_crew_id}>{route.crew_name}</option>}{crews.map(crew => <option key={crew.id} value={crew.id}>{crew.crew_name}</option>)}</select></label></div><p className="text-xs text-neutral-600">Only Scheduled visits already assigned to this date and crew can be added. Date and crew remain fixed after creation.</p><label className="block text-sm font-bold">Route name (optional)<input className={field} value={input.route_name ?? ""} onChange={event => setInput(current => ({ ...current, route_name: event.target.value || null }))}/></label><label className="block text-sm font-bold">Route notes<textarea className={field} value={input.notes ?? ""} onChange={event => setInput(current => ({ ...current, notes: event.target.value || null }))}/></label>
    <h3 className="font-bold">Ordered Stops</h3>{input.stops.map((stop,index) => <div key={stop.visit_id} className="rounded-lg border p-3"><p className="font-bold">{index+1}. {visits.find(visit => visit.id === stop.visit_id)?.property_label || route?.stops.find(item => item.visit_id === stop.visit_id)?.visit?.property_label || "Porter Visit"}</p><label className="block text-sm">Stop notes<input className={field} value={stop.stop_notes ?? ""} onChange={event => setInput(current => ({ ...current, stops: current.stops.map(item => item.visit_id === stop.visit_id ? { ...item, stop_notes: event.target.value || null } : item) }))}/></label><div className="mt-2 flex gap-2"><button type="button" className={button} disabled={index===0} onClick={() => move(index,-1)}>Move Up</button><button type="button" className={button} disabled={index===input.stops.length-1} onClick={() => move(index,1)}>Move Down</button><button type="button" className={button} onClick={() => setInput(current => ({ ...current, stops: current.stops.filter(item => item.visit_id !== stop.visit_id) }))}>Remove</button></div></div>)}
    <label className="block text-sm font-bold">Add Stop<select className={field} value="" onChange={event => { const id=event.target.value; if (id) setInput(current => ({ ...current, stops: [...current.stops, { visit_id: id, stop_notes: null }] })); }}><option value="">Select an eligible visit</option>{candidates.map(visit => <option key={visit.id} value={visit.id}>{visit.property_label} | {visit.plan_name}</option>)}</select></label>{!candidates.length && <p className="text-sm text-neutral-600">No additional eligible visits. Create or assign Scheduled visits in Porter Visits first.</p>}<div className="flex gap-3"><button className={button} type="submit">Save Route</button><button className={button} type="button" onClick={close}>Cancel Editing</button></div></fieldset></form>;
}
