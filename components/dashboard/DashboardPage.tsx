"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getDashboardData } from "@/lib/services/dashboard";
import type { DashboardData } from "@/types/dashboard";
import type { JobWithRelations } from "@/types/job";
import { DashboardRecurringServices } from "@/components/agreements/DashboardRecurringServices";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission, permissionForPath, type Permission } from "@/lib/auth/permissions";
import { AttentionSummaryWidget } from "@/components/attention/AttentionSummaryWidget";
import { useAttentionRefresh } from "@/components/attention/useAttentionRefresh";
import { ActiveStaffPanel } from "@/components/time/ActiveStaffPanel";
export function DashboardPage() {
  const { profile } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showActive, setShowActive] = useState(false);
  async function load() {
    setError(null);
    try {
      setData(await getDashboardData());
    } catch (x) {
      console.error("Dashboard load failed", x);
      setError(
        x instanceof Error ? x.message : "Dashboard data could not be loaded.",
      );
    }
  }
  useAttentionRefresh(load, ["estimates", "clients", "properties", "crews", "employees", "time_entries"]);
  useEffect(() => {
    let active = true;
    void getDashboardData()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((x: unknown) => {
        console.error("Dashboard load failed", x);
        if (active)
          setError(
            x instanceof Error
              ? x.message
              : "Dashboard data could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  if (!data && !error) return <Skeleton />;
  const kpis: Array<{ label: string; value: number; permission: Permission }> = data ? [
    { label: "Jobs Today", value: data.metrics.jobsToday, permission: "jobs.view" },
    { label: "Upcoming Walkthroughs", value: data.metrics.upcomingWalkthroughs, permission: "walkthroughs.view" },
    { label: "Open Estimates", value: data.metrics.openEstimates, permission: "estimates.view" },
    { label: "Pending Proposals", value: data.metrics.pendingProposals, permission: "proposals.view" },
    { label: "Past Due Invoices", value: data.metrics.pastDueInvoices, permission: "invoices.view" },
    { label: "ACTIVE Employees", value: data.metrics.employeesClockedIn, permission: "timeClock.view" },
  ] : [];
  return (
    <>
      <Header />
      {error && (
        <div className="mt-5 flex items-center justify-between rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">
          <span>{error}</span>
          <button
            onClick={() => void load()}
            className="rounded border px-3 py-1"
          >
            Retry
          </button>
        </div>
      )}
      {data && (
        <>
          <section className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-6">
            {kpis.filter((kpi) => hasPermission(profile, kpi.permission)).map((kpi) => (
              <Metric
                key={kpi.label}
                label={kpi.label}
                value={kpi.value}
                active={kpi.label === "ACTIVE Employees" ? showActive : undefined}
                onClick={kpi.label === "ACTIVE Employees" ? () => setShowActive((current) => !current) : undefined}
              />
            ))}
          </section>
          {hasPermission(profile, "attention.view") && <AttentionSummaryWidget />}
          {showActive && hasPermission(profile, "timeClock.view") && <ActiveStaffPanel entries={data.activeEmployees} />}
          {hasPermission(profile, "jobs.view") && <Panel title="Today's Operations" className="mt-6">
            {data.todaysJobs.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {data.todaysJobs.map((j) => (
                  <OperationCard key={j.id} job={j} />
                ))}
              </div>
            ) : (
              <Empty text="No jobs scheduled today." />
            )}
          </Panel>}
          {hasPermission(profile, "agreements.view") && <DashboardRecurringServices />}
          <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
            <Panel title="Attention Required">
              {data.attention.length ? (
                <div className="space-y-3">
                  {data.attention.filter((item) => hasPermission(profile, permissionForPath(item.href))).map((a) => (
                    <div
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4"
                    >
                      <div>
                        <p className="text-xs font-extrabold uppercase text-amber-800">{a.type}</p>
                        <p className="font-bold text-[#143d1a]">{a.record}</p>
                        <p className="text-sm text-neutral-600">{a.description}</p>
                      </div>
                      <Link className={secondary} href={a.href}>{a.action}</Link>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty text="No items currently require attention." />
              )}
            </Panel>
            <QuickActions />
          </section>
          <section className="mt-6 grid gap-6 xl:grid-cols-2">
            {hasPermission(profile, "walkthroughs.view") && <Upcoming rows={data.upcomingWalkthroughs} />}
            {hasPermission(profile, "proposals.view") && <ProposalPipeline data={data} />}
            {hasPermission(profile, "estimates.view") && <EstimateActivity data={data} />}
            {hasPermission(profile, "jobs.view") && <JobPipeline data={data} />}
            {hasPermission(profile, "crews.view") && <CrewStatus data={data} />}
            {hasPermission(profile, "schedule.view") && <SchedulePreview data={data} />}
          </section>
        </>
      )}
    </>
  );
}

function Header() {
  return (
    <header className="border-b border-[#143d1a]/10 pb-7">
      <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">
        Operations Command Center
      </p>
      <h1 className="text-3xl font-extrabold text-[#143d1a]">
        StudioScrubz OS
      </h1>
      <p className="mt-3 text-neutral-600">
        Live operational priorities, schedules, sales activity, and crew status.
      </p>
    </header>
  );
}
function OperationCard({
  job,
}: {
  job: JobWithRelations;
}) {
  return (
    <article className="rounded-xl border p-4">
      <div className="flex justify-between gap-3">
        <p className="text-lg font-extrabold text-[#143d1a]">
          {time(job.start_time)}
        </p>
        <Badge text={job.status} />
      </div>
      <p className="mt-2 font-bold">
        {job.job_number} · {job.client_name}
      </p>
      <p className="text-sm text-neutral-500">{job.property_name}</p>
      <p className="mt-2 text-sm">
        {job.service_name} · {job.estimated_duration ?? 0} hours
      </p>
      <p className="text-sm">
        Crew: {job.assigned_crew_name || "Unassigned"} · Lead:{" "}
        {job.crew_lead_name || "Unassigned"}
      </p>
      <div className="mt-3 flex gap-2">
        <Link href={`/jobs?jobId=${job.id}`} className={secondary}>
          Manage Job
        </Link>
      </div>
    </article>
  );
}
function Upcoming({ rows }: { rows: DashboardData["upcomingWalkthroughs"] }) {
  return (
    <Panel title="Upcoming Walkthroughs" action="/walkthroughs">
      {rows.length ? (
        <div className="space-y-3">
          {rows.map((w) => (
            <div key={w.id} className="rounded-xl bg-neutral-50 p-4">
              <div className="flex justify-between">
                <b>
                  {pretty(w.walkthrough_date)} · {time(w.walkthrough_time)}
                </b>
                <Badge text={w.status} />
              </div>
              <p className="mt-1 text-sm">
                {client(w.client)} · {w.property?.address||"Deleted Property"}
              </p>
              <p className="text-xs text-neutral-500">{w.division}</p>
            </div>
          ))}
        </div>
      ) : (
        <Empty text="No upcoming walkthroughs." />
      )}
    </Panel>
  );
}
function ProposalPipeline({ data }: { data: DashboardData }) {
  const p = data.proposal;
  return (
    <Panel title="Proposal Pipeline" action="/open-proposals">
      <Stats
        values={[
          ["Draft", p.draft],
          ["Ready for Approval", p.ready],
          ["Approved", p.approved],
          ["Sent / Viewed", p.sentViewed],
          ["Accepted", p.accepted],
        ]}
      />
      <p className="mt-4 rounded-xl bg-[#edf4ec] p-4 font-bold text-[#143d1a]">
        Acceptance Rate:{" "}
        {p.acceptanceRate === null ? "—" : `${p.acceptanceRate.toFixed(1)}%`}
      </p>
    </Panel>
  );
}
function EstimateActivity({ data }: { data: DashboardData }) {
  const e = data.estimate;
  return (
    <Panel title="Estimate Activity" action="/open-estimates">
      <Stats
        values={[
          ["Open Estimates", e.open],
          ["Residential", e.residential],
          ["Commercial", e.commercial],
          ["Created This Month", e.createdThisMonth],
        ]}
      />
    </Panel>
  );
}
function JobPipeline({ data }: { data: DashboardData }) {
  const j = data.jobs;
  return (
    <Panel title="Job Pipeline" action="/jobs">
      <Stats
        values={[
          ["Ready to Schedule", j.ready],
          ["Scheduled", j.scheduled],
          ["Crew Assigned", j.crewAssigned],
          ["In Progress", j.inProgress],
          ["Completed", j.completed],
        ]}
      />
    </Panel>
  );
}
function CrewStatus({ data }: { data: DashboardData }) {
  return (
    <Panel title="Crew Status" action="/employees">
      {data.crews.length ? (
        <div className="space-y-3">
          {data.crews.map((x) => (
            <div key={x.crew.id} className="rounded-xl border p-4">
              <div className="flex justify-between">
                <b className="text-[#143d1a]">{x.crew.crew_name}</b>
                <Badge
                  text={
                    x.inProgress
                      ? "In Progress"
                      : x.todayJobs
                        ? `Assigned Today — ${x.todayJobs} Jobs`
                        : "Available Today"
                  }
                />
              </div>
              <p className="mt-1 text-sm">
                Lead:{" "}
                {x.crew.crew_lead ? employee(x.crew.crew_lead) : "Unassigned"}
              </p>
              <p className="text-xs text-neutral-500">
                {x.crew.members.length} members
              </p>
            </div>
          ))}
        </div>
      ) : (
        <Empty text="No active crews." />
      )}
    </Panel>
  );
}
function SchedulePreview({ data }: { data: DashboardData }) {
  return (
    <Panel title="Schedule Preview" action="/schedule">
      <PreviewGroup title="Today" rows={data.preview.today} />
      <PreviewGroup title="Tomorrow" rows={data.preview.tomorrow} />
    </Panel>
  );
}
function PreviewGroup({
  title,
  rows,
}: {
  title: string;
  rows: JobWithRelations[];
}) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-extrabold uppercase text-neutral-500">
        {title}
      </h3>
      {rows.length ? (
        <div className="mt-2 space-y-2">
          {rows.map((j) => (
            <div
              key={j.id}
              className="grid grid-cols-[65px_1fr_auto] gap-2 rounded-lg bg-neutral-50 p-3 text-sm"
            >
              <b>{time(j.start_time)}</b>
              <span>
                {j.client_name} · {j.service_name}
              </span>
              <span className="text-xs text-neutral-500">
                {j.assigned_crew_name || "Unassigned"} · {j.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">No jobs scheduled.</p>
      )}
    </div>
  );
}
function QuickActions() {
  const actions = [
    ["New Client", "/clients"],
    ["New Estimate", "/estimates"],
    ["Schedule Walkthrough", "/walkthroughs"],
    ["Create Proposal", "/proposals"],
    ["View Jobs", "/jobs"],
    ["View Schedule", "/schedule"],
    ["Add Employee", "/employees"],
  ];
  return (
    <Panel title="Quick Actions">
      <div className="grid grid-cols-2 gap-2">
        {actions.map(([l, h]) => (
          <Link
            key={l}
            className="rounded-xl border p-3 text-center text-sm font-bold text-[#143d1a] hover:border-[#d4af37]"
            href={h}
          >
            {l}
          </Link>
        ))}
      </div>
    </Panel>
  );
}
function Panel({
  title,
  action,
  className = "",
  children,
}: {
  title: string;
  action?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`${className} rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-sm`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-extrabold text-[#143d1a]">{title}</h2>
        {action && (
          <Link href={action} className="text-xs font-bold text-[#9a7a17]">
            View All →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
function Metric({ label, value, active, onClick }: { label: string; value: number; active?: boolean; onClick?: () => void }) {
  const content = <>
      <p className="text-xs font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-4 text-3xl font-extrabold text-[#143d1a]">{value}</p>
    </>;
  if (onClick) return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-2xl border p-5 text-left transition ${active ? "border-emerald-400 bg-emerald-50 shadow-sm" : "bg-white hover:border-emerald-300"}`}>{content}</button>;
  return <article className="rounded-2xl border bg-white p-5">{content}</article>;
}
function Stats({ values }: { values: [string, number][] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {values.map(([l, v]) => (
        <div key={l} className="rounded-xl bg-neutral-50 p-3">
          <p className="text-xs text-neutral-500">{l}</p>
          <p className="mt-1 text-xl font-extrabold text-[#143d1a]">{v}</p>
        </div>
      ))}
    </div>
  );
}
function Badge({ text }: { text: string }) {
  return (
    <span className="rounded-full bg-[#edf4ec] px-2 py-1 text-[10px] font-bold text-[#143d1a]">
      {text}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-neutral-500">
      {text}
    </div>
  );
}
function Skeleton() {
  return (
    <>
      <Header />
      <div className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl bg-neutral-200"
          />
        ))}
      </div>
      <div className="mt-6 h-80 animate-pulse rounded-2xl bg-neutral-200" />
    </>
  );
}
function client(c: {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
} | null) {
  if (!c) return "Deleted Client";
  return (
    [c.first_name, c.last_name].filter(Boolean).join(" ") ||
    c.company_name ||
    "Client"
  );
}
function employee(e: {
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}) {
  return e.preferred_name || `${e.first_name} ${e.last_name}`;
}
function pretty(v: string | null) {
  return v
    ? new Date(`${v}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "Unscheduled";
}
function time(v: string | null) {
  if (!v) return "TBD";
  const [h, m] = v.slice(0, 5).split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
const secondary =
  "rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a]";
