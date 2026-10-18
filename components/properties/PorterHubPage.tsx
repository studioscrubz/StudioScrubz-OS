"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { getPorterBusinessClock, porterVisitProgress, summarizePorterHub } from "@/lib/porterHub";
import { getBusinessIdentitySettings } from "@/lib/services/businessSettings";
import { listPorterVisits } from "@/lib/services/porterVisits";
import type { PorterVisitWithAreas } from "@/types/porterVisit";

const linkClass = "inline-flex min-h-11 items-center justify-center rounded-xl border border-[#143D1A]/15 bg-white px-4 py-2.5 text-sm font-extrabold text-[#143D1A] shadow-sm transition hover:border-[#D4AF37] hover:bg-[#f7f8f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37]";

export function PorterHubPage() {
  const { profile } = useAuth();
  const allowed = hasPermission(profile, "porterVisits.view");
  const management = hasPermission(profile, "porterVisits.manage");
  const [visits, setVisits] = useState<PorterVisitWithAreas[]>([]);
  const [timezone, setTimezone] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (background = false) => {
    if (!allowed) return;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [rows, settings] = await Promise.all([listPorterVisits(), getBusinessIdentitySettings()]);
      if (!settings.timezone) throw new Error("Configure the StudioScrubz business timezone before using Porter Hub.");
      getPorterBusinessClock(new Date(), settings.timezone);
      setVisits(rows);
      setTimezone(settings.timezone);
      setNow(new Date());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Porter Hub could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [allowed]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useOperationalRealtime(
    ["property_service_visits", "property_service_visit_issues"],
    () => load(true),
  );

  const clock = useMemo(() => timezone ? getPorterBusinessClock(now, timezone) : null, [timezone, now]);
  const summary = useMemo(() => clock ? summarizePorterHub(visits, clock) : null, [visits, clock]);

  if (!allowed) return <AccessDenied />;

  return <div className="space-y-7">
    <header className="overflow-hidden rounded-3xl bg-[#143D1A] px-5 py-7 text-white shadow-[0_22px_55px_rgba(20,61,26,.2)] sm:px-8 sm:py-9">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[.22em] text-[#D4AF37]">Porter operations</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Porter Hub</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">
            {management ? "Today’s portfolio-wide visit activity, service progress, and issue follow-up." : "Your assigned visits, progress, and operational follow-up in one place."}
          </p>
          {clock && <p className="mt-3 text-xs font-semibold text-white/55">Business date: {clock.date} · {clock.time} · {clock.timezone}</p>}
        </div>
        <button type="button" className="min-h-11 rounded-xl border border-[#D4AF37]/60 px-4 py-2.5 text-sm font-extrabold text-[#D4AF37] transition hover:bg-white/10 disabled:opacity-50" disabled={loading || refreshing} onClick={() => void load(true)}>
          {refreshing ? "Refreshing…" : "Refresh dashboard"}
        </button>
      </div>
    </header>

    <QuickLinks management={management} />
    {error && <ErrorState message={error} retry={() => void load()} />}
    {loading && <LoadingState />}
    {!loading && !error && summary && <>
      <section aria-label="Porter Visit status summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Scheduled today" value={summary.todayScheduled.length} tone="green" />
        <SummaryCard label="In progress" value={summary.inProgress.length} tone="gold" />
        <SummaryCard label="Completed today" value={summary.completed.length} tone="green" />
        <SummaryCard label="Overdue / missed" value={summary.overdue.length} tone={summary.overdue.length ? "red" : "neutral"} />
      </section>

      {!visits.length ? <EmptyState management={management} /> : <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,.75fr)]">
        <div className="space-y-6">
          <VisitSection title="In progress" description="Visits currently being worked, including carryover from an earlier business date." visits={summary.inProgress} empty="No visits are currently in progress." />
          <VisitSection title="Today’s scheduled visits" description="Upcoming visits remaining on today’s authorized schedule." visits={summary.todayScheduled} empty="No upcoming Porter Visits remain today." />
          <VisitSection title="Overdue or missed" description="Scheduled visits whose business date or configured start time has passed." visits={summary.overdue} empty="No overdue or missed Porter Visits." urgent />
          <VisitSection title="Completed today" description="Visits scheduled for today that have reached Completed status." visits={summary.completed} empty="No Porter Visits have been completed today." />
        </div>
        <IssuePanel active={summary.activeIssues} urgentCount={summary.urgentIssues.length} />
      </div>}
    </>}
  </div>;
}

function QuickLinks({ management }: { management: boolean }) {
  return <nav aria-label="Porter Hub sections" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
    <Link className={linkClass} href="/properties/porter/my-visits">My Visits Today</Link>
    <Link className={linkClass} href="/properties/porter-visits">Visits</Link>
    <Link className={linkClass} href="/properties/porter-routes">Routes</Link>
    {management && <Link className={linkClass} href="/properties/service-plans">Plans</Link>}
    {management && <Link className={linkClass} href="/properties/service-reports">Reports</Link>}
  </nav>;
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "green" | "gold" | "red" | "neutral" }) {
  const styles = tone === "red" ? "border-red-200 bg-red-50 text-red-800" : tone === "gold" ? "border-[#D4AF37]/40 bg-[#fffaf0] text-[#72570d]" : tone === "green" ? "border-[#143D1A]/15 bg-[#f4f7f1] text-[#143D1A]" : "border-neutral-200 bg-white text-neutral-700";
  return <article className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${styles}`}><p className="text-2xl font-black sm:text-3xl">{value}</p><p className="mt-1 text-xs font-extrabold uppercase tracking-[.12em] sm:text-sm">{label}</p></article>;
}

function VisitSection({ title, description, visits, empty, urgent = false }: { title: string; description: string; visits: PorterVisitWithAreas[]; empty: string; urgent?: boolean }) {
  return <section className="rounded-2xl border border-[#143D1A]/10 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-extrabold text-[#143D1A]">{title}</h2><p className="mt-1 text-sm leading-6 text-neutral-600">{description}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${urgent && visits.length ? "bg-red-100 text-red-800" : "bg-[#f4f7f1] text-[#143D1A]"}`}>{visits.length}</span></div>
    {!visits.length ? <p className="mt-5 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">{empty}</p> : <div className="mt-5 grid gap-4 md:grid-cols-2">{visits.map(visit => <VisitCard key={visit.id} visit={visit} />)}</div>}
  </section>;
}

function VisitCard({ visit }: { visit: PorterVisitWithAreas }) {
  const progress = porterVisitProgress(visit);
  const openIssues = (visit.issues ?? []).filter(issue => issue.status !== "Resolved");
  const urgent = openIssues.some(issue => issue.severity === "Urgent");
  const assignee = visit.worker_name ?? visit.crew_name ?? "Unassigned";
  return <article className="rounded-2xl border border-neutral-200 p-4">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-extrabold uppercase tracking-[.12em] text-[#8a6b12]">{visit.status} · {visit.scheduled_date}{visit.scheduled_start_time ? ` at ${visit.scheduled_start_time.slice(0, 5)}` : ""}</p><h3 className="mt-2 font-extrabold text-[#143D1A]">{visit.property_label}</h3><p className="mt-1 text-sm text-neutral-600">{visit.plan_name}</p></div>{urgent && <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-black text-red-800">Urgent issue</span>}</div>
    <p className="mt-3 text-sm"><span className="font-bold">Assigned:</span> {assignee}{visit.manager_name ? ` · Manager: ${visit.manager_name}` : ""}</p>
    <div className="mt-4" aria-label={`${progress.addressed} of ${progress.total} service areas addressed`}><div className="flex justify-between text-xs font-bold text-neutral-600"><span>Service areas</span><span>{progress.addressed}/{progress.total}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-[#D4AF37]" style={{ width: `${progress.percent}%` }} /></div></div>
    <div className="mt-4 flex items-center justify-between gap-3"><p className={`text-xs font-bold ${urgent ? "text-red-700" : "text-neutral-500"}`}>{openIssues.length} open / acknowledged issue{openIssues.length === 1 ? "" : "s"}</p><Link className={linkClass} href={`/properties/porter-visits?visit=${encodeURIComponent(visit.id)}`}>Open visit</Link></div>
  </article>;
}

function IssuePanel({ active, urgentCount }: { active: ReturnType<typeof summarizePorterHub>["activeIssues"]; urgentCount: number }) {
  return <aside className="h-fit rounded-2xl border border-[#D4AF37]/35 bg-[#fffdf7] p-5 shadow-sm sm:p-6">
    <p className="text-xs font-black uppercase tracking-[.18em] text-[#8a6b12]">Issue center</p><h2 className="mt-2 text-xl font-extrabold text-[#143D1A]">Open and urgent issues</h2>
    <div className="mt-4 grid grid-cols-2 gap-3"><SummaryCard label="Open" value={active.length} tone="gold" /><SummaryCard label="Urgent" value={urgentCount} tone={urgentCount ? "red" : "neutral"} /></div>
    {!active.length ? <p className="mt-5 text-sm text-neutral-600">No open or acknowledged issues in your authorized visits.</p> : <ul className="mt-5 space-y-3">{active.slice(0, 8).map(({ visit, issue }) => <li key={issue.id} className="rounded-xl border border-[#D4AF37]/20 bg-white p-3"><p className={`text-xs font-black uppercase ${issue.severity === "Urgent" ? "text-red-700" : "text-[#8a6b12]"}`}>{issue.severity} · {issue.status}</p><p className="mt-1 font-bold text-[#143D1A]">{issue.title}</p><p className="mt-1 text-xs text-neutral-600">{visit.property_label}</p><Link className="mt-2 inline-block text-sm font-extrabold text-[#143D1A] underline decoration-[#D4AF37] decoration-2 underline-offset-4" href={`/properties/porter-visits?visit=${encodeURIComponent(visit.id)}`}>Review issue</Link></li>)}</ul>}
    {active.length > 8 && <p className="mt-4 text-xs text-neutral-500">Showing 8 of {active.length} active issues. Open Visits to review all.</p>}
  </aside>;
}

function LoadingState() { return <div role="status" className="grid gap-4 sm:grid-cols-2"><div className="h-36 animate-pulse rounded-2xl bg-neutral-100" /><div className="h-36 animate-pulse rounded-2xl bg-neutral-100" /><span className="sr-only">Loading Porter Hub…</span></div>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900"><p className="font-bold">Porter Hub could not be loaded.</p><p className="mt-1 text-sm">{message}</p><button type="button" className="mt-4 min-h-11 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold" onClick={retry}>Try again</button></div>; }
function EmptyState({ management }: { management: boolean }) { return <section className="rounded-2xl border border-dashed border-[#143D1A]/25 bg-white p-8 text-center"><h2 className="text-xl font-extrabold text-[#143D1A]">No Porter Visits are available</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-600">{management ? "Create and assign visits from Porter Visits after an active Property Service Plan is ready." : "You do not currently have any assigned Porter Visits. Contact your manager if you expected an assignment."}</p>{management && <Link className={`${linkClass} mt-5`} href="/properties/porter-visits">Open Porter Visits</Link>}</section>; }
function AccessDenied() { return <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-extrabold text-[#143D1A]">Porter Hub access denied</h1><p className="mt-2 text-sm text-neutral-700">Your active StudioScrubz role does not include Porter Visit access.</p></div>; }
