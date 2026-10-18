"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { VisitDetail } from "@/components/properties/PorterVisitsPage";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { getPorterBusinessClock, porterVisitProgress } from "@/lib/porterHub";
import { getBusinessIdentitySettings } from "@/lib/services/businessSettings";
import { getPorterVisit, listPorterVisits, mutatePorterVisit } from "@/lib/services/porterVisits";
import type { PorterVisitMutation, PorterVisitWithAreas } from "@/types/porterVisit";

type SaveState = "idle" | "saving" | "saved" | "failed";
const actionClass = "inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#143D1A] px-5 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-[#0d2b12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";

export function PorterFieldWorkspace() {
  const { profile } = useAuth();
  const allowed = hasPermission(profile, "porterVisits.view");
  const management = hasPermission(profile, "porterVisits.manage");
  const [visits, setVisits] = useState<PorterVisitWithAreas[]>([]);
  const [selected, setSelected] = useState<PorterVisitWithAreas | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  const load = useCallback(async (background = false) => {
    if (!allowed) return;
    if (!background) setLoading(true);
    try {
      const [rows, settings] = await Promise.all([listPorterVisits(), getBusinessIdentitySettings()]);
      if (!settings.timezone) throw new Error("Configure the StudioScrubz business timezone before using the field workspace.");
      const date = getPorterBusinessClock(new Date(), settings.timezone).date;
      setVisits(rows);
      setBusinessDate(date);
      setSelected(current => current ? rows.find(row => row.id === current.id) ?? null : null);
      setMessage("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Field workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useOperationalRealtime(["property_service_visits", "property_service_visit_photos", "property_service_visit_issues"], () => load(true));

  const groups = useMemo(() => ({
    active: visits.filter(visit => visit.status === "In Progress"),
    today: visits.filter(visit => visit.status === "Scheduled" && visit.scheduled_date === businessDate),
    upcoming: visits.filter(visit => visit.status === "Scheduled" && visit.scheduled_date > businessDate)
      .sort((a, b) => `${a.scheduled_date} ${a.scheduled_start_time ?? ""}`.localeCompare(`${b.scheduled_date} ${b.scheduled_start_time ?? ""}`)),
  }), [visits, businessDate]);

  async function openVisit(id: string) {
    if (saveState === "saving") return;
    setSaveState("saving"); setMessage("");
    try { setSelected(await getPorterVisit(id)); setSaveState("idle"); }
    catch (cause) { setSaveState("failed"); setMessage(cause instanceof Error ? cause.message : "Visit could not be opened."); }
  }

  async function mutate(mutation: PorterVisitMutation) {
    if (!selected || saveState === "saving") return;
    setSaveState("saving"); setMessage("");
    try {
      await mutatePorterVisit(selected, mutation);
      const fresh = await getPorterVisit(selected.id);
      setSelected(fresh);
      setVisits(rows => rows.map(row => row.id === fresh.id ? fresh : row));
      setSaveState("saved"); setMessage("Saved and confirmed by the server.");
    } catch (cause) {
      setSaveState("failed");
      setMessage(`${cause instanceof Error ? cause.message : "Save failed."} Refresh the visit before retrying if another user changed it.`);
    }
  }

  if (!allowed) return <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-extrabold text-[#143D1A]">Field workspace access denied</h1><p className="mt-2 text-sm">Your active role does not include Porter Visit access.</p></div>;

  if (selected) return <div>
    <Link href="/properties/porter" className="text-sm font-bold text-[#143D1A]">Back to Porter Hub</Link>
    {saveState === "saving" && <p role="status" className="mt-4 rounded-xl bg-blue-50 p-4 text-sm font-bold text-blue-800">Saving… Please keep this visit open.</p>}
    {message && <p role={saveState === "failed" ? "alert" : "status"} className={`mt-4 rounded-xl p-4 text-sm font-bold ${saveState === "failed" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>{message}</p>}
    <VisitDetail visit={selected} crews={[]} options={[]} management={management} busy={saveState === "saving"} mutate={mutate} reload={() => openVisit(selected.id)} close={() => { setSelected(null); setSaveState("idle"); setMessage(""); }} fieldMode/>
  </div>;

  return <div className="space-y-6">
    <header className="rounded-3xl bg-[#143D1A] px-5 py-7 text-white shadow-lg sm:px-8"><p className="text-xs font-black uppercase tracking-[.2em] text-[#D4AF37]">Field technician workspace</p><h1 className="mt-2 text-3xl font-extrabold">My Visits Today</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">{management ? "Authorized field visits across today’s operation, with direct execution access." : "Your assignment-authorized Porter Visits, ready for mobile execution."}</p>{businessDate && <p className="mt-3 text-xs font-bold text-white/60">Business date: {businessDate}</p>}</header>
    <Link href="/properties/porter" className="inline-flex min-h-11 items-center font-extrabold text-[#143D1A] underline decoration-[#D4AF37] decoration-2 underline-offset-4">Porter Hub overview</Link>
    {message && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800">{message}</p>}
    {loading ? <div role="status" className="h-40 animate-pulse rounded-2xl bg-neutral-100"><span className="sr-only">Loading field visits…</span></div> : <>
      <VisitGroup title="Currently active" visits={groups.active} empty="No authorized visits are currently in progress." open={openVisit}/>
      <VisitGroup title="Today’s assigned visits" visits={groups.today} empty="No scheduled visits are assigned for today." open={openVisit}/>
      <VisitGroup title="Upcoming visits" visits={groups.upcoming} empty="No upcoming assigned visits." open={openVisit}/>
    </>}
  </div>;
}

function VisitGroup({ title, visits, empty, open }: { title: string; visits: PorterVisitWithAreas[]; empty: string; open: (id: string) => Promise<void> }) {
  return <section className="rounded-2xl border border-[#143D1A]/10 bg-white p-4 shadow-sm sm:p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-extrabold text-[#143D1A]">{title}</h2><span className="rounded-full bg-[#f4f7f1] px-3 py-1 text-xs font-black text-[#143D1A]">{visits.length}</span></div>
    {!visits.length ? <p className="mt-4 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">{empty}</p> : <div className="mt-4 grid gap-4 lg:grid-cols-2">{visits.map(visit => <FieldVisitCard key={visit.id} visit={visit} open={open}/>)}</div>}
  </section>;
}

function FieldVisitCard({ visit, open }: { visit: PorterVisitWithAreas; open: (id: string) => Promise<void> }) {
  const progress = porterVisitProgress(visit);
  const action = visit.status === "In Progress" ? "Resume" : visit.status === "Scheduled" ? "Start" : "View";
  return <article className="rounded-2xl border border-neutral-200 p-5"><p className="text-xs font-black uppercase tracking-[.12em] text-[#8a6b12]">{visit.status} · {visit.scheduled_date}{visit.scheduled_start_time ? ` at ${visit.scheduled_start_time.slice(0, 5)}` : ""}</p><h3 className="mt-2 text-xl font-extrabold text-[#143D1A]">{visit.property_label}</h3><p className="mt-2 text-sm text-neutral-600">Assigned: {visit.worker_name ?? visit.crew_name ?? "Unassigned"}{visit.manager_name ? ` · Manager: ${visit.manager_name}` : ""}</p><div className="mt-4"><div className="flex justify-between text-xs font-bold text-neutral-600"><span>Checklist progress</span><span>{progress.addressed}/{progress.total}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-[#D4AF37]" style={{ width: `${progress.percent}%` }}/></div></div><button type="button" className={`${actionClass} mt-5`} onClick={() => void open(visit.id)} aria-label={`${action} Porter Visit at ${visit.property_label}`}>{action} Visit</button></article>;
}
