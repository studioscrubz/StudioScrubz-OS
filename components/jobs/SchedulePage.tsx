"use client";
import { useJobCommunication } from "@/components/communications/LogCommunicationModal";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { UserProfile } from "@/types/auth";
import { hasPermission } from "@/lib/auth/permissions";
import {
  cancelJob,
  displayJobStatus,
  findCrewConflicts,
  findIndividualTechConflicts,
  getEligibleJobTechs,
  getCalendarJobs,
  jobAssignmentLabel,
  jobWorkerTarget,
  rescheduleJob,
  updateJobInternalNotes,
} from "@/lib/services/jobs";
import { getScheduledWalkthroughs } from "@/lib/services/walkthroughs";
import { getActiveCrews } from "@/lib/services/crews";
import type { CrewWithRelations } from "@/types/crew";
import type {
  CrewConflict,
  EligibleJobTech,
  JobAssignmentKind,
  JobStatus,
  JobWithRelations,
  JobWorkerTarget,
} from "@/types/job";
import type { WalkthroughWithRelations } from "@/types/walkthrough";
import { ScheduleOccurrences } from "@/components/agreements/ScheduleOccurrences";
import { getUpcomingOccurrences, isDeletedOccurrence } from "@/lib/services/serviceOccurrences";
import type { ServiceOccurrenceWithRelations } from "@/types/serviceOccurrence";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { ContractServiceRecordAction } from "@/components/jobs/ContractServiceRecord";
import { JobTimeSummary } from "@/components/jobs/JobTimeSummary";
import {
  InternalEventDetails,
  InternalEventDialog,
} from "@/components/jobs/InternalEventDialog";
import {
  getInternalEventAccessLevel,
  getInternalScheduleEvents,
} from "@/lib/services/internalScheduleEvents";
import type {
  InternalEventAccessLevel,
  InternalScheduleEvent,
} from "@/types/internalScheduleEvent";
type View = "Day" | "Week" | "Month" | "List";
type EventSource = "All Events" | "Jobs" | "Recurring Services" | "Walkthroughs" | "Internal Events";
type CrewDisplayOption = { id: string; crew_name: string };
type ScheduleEvent =
  | { kind: "Recurring Service"; id: string; date: string; time: string | null; occurrence: ServiceOccurrenceWithRelations }
  | {
      kind: "Job";
      id: string;
      date: string | null;
      time: string | null;
      job: JobWithRelations;
    }
  | {
      kind: "Walkthrough";
      id: string;
      date: string;
      time: string | null;
      walkthrough: WalkthroughWithRelations;
    }
  | {
      kind: "Internal Event";
      id: string;
      date: string;
      time: string;
      internalEvent: InternalScheduleEvent;
    };
const statuses = [
  "All",
  "Ready to Schedule",
  "Scheduled",
  "Crew Assigned",
  "In Progress",
  "Completed",
  "Cancelled",
] as const;
const internalEventCandidateRoles = new Set([
  "Master Admin",
  "Administrator",
  "Sales",
  "Lead Representative",
]);
function internalAccessDiagnostic(
  profile: UserProfile | null,
  level: InternalEventAccessLevel,
) {
  if (
    level !== "None" ||
    !profile?.is_active ||
    !internalEventCandidateRoles.has(profile.role)
  )
    return null;
  if (!profile.employee_id)
    return profile.role === "Master Admin"
      ? "Internal Event access could not be verified for this Master Admin account. Refresh the page or contact support."
      : "Internal Event access requires this account to be linked to an active employee. Ask a Master Admin to update the account's employee link.";
  return "Internal Event access is not enabled for this account's active employee link. Ask a Master Admin to verify the employee status and assigned role.";
}
function byEventTime(a: ScheduleEvent, b: ScheduleEvent) {
  if (a.kind === "Job" && b.kind === "Job") return byTime(a.job, b.job);
  return (a.time ?? "99").localeCompare(b.time ?? "99");
}
function walkthroughClient(walkthrough: WalkthroughWithRelations) {
  return (
    walkthrough.client?.company_name ||
    [walkthrough.client?.first_name, walkthrough.client?.last_name]
      .filter(Boolean)
      .join(" ") ||
    walkthrough.contact_name ||
    "Deleted Client"
  );
}
export function SchedulePage() {
  const communication = useJobCommunication();
  const { profile } = useAuth();
  const canViewWalkthroughs = hasPermission(profile, "walkthroughs.view");
  const canEditSchedule = hasPermission(profile, "schedule.edit");
  const canViewJobTime = hasPermission(profile, "jobs.view");
  const salesReadOnly = profile?.role === "Sales";
  const [jobs, setJobs] = useState<JobWithRelations[]>([]);
  const [occurrences, setOccurrences] = useState<ServiceOccurrenceWithRelations[]>([]);
  const [walkthroughs, setWalkthroughs] = useState<WalkthroughWithRelations[]>(
    [],
  );
  const [internalEvents, setInternalEvents] = useState<InternalScheduleEvent[]>(
    [],
  );
  const [internalAccess, setInternalAccess] =
    useState<InternalEventAccessLevel>("None");
  const [internalAccessError, setInternalAccessError] = useState<string | null>(
    null,
  );
  const [crews, setCrews] = useState<CrewWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<View>("Week");
  const [selectedDate, setSelectedDate] = useState(today());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof statuses)[number]>("All");
  const [division, setDivision] = useState("All");
  const [crew, setCrew] = useState("All");
  const [source, setSource] = useState<EventSource>("All Events");
  const [edit, setEdit] = useState<JobWithRelations | null>(null);
  const [detail, setDetail] = useState<JobWithRelations | null>(null);
  const [internalDetail, setInternalDetail] =
    useState<InternalScheduleEvent | null>(null);
  const [internalEdit, setInternalEdit] = useState<
    InternalScheduleEvent | "new" | null
  >(null);

  async function load() {
    const [j, w, c, i, o] = await Promise.all([
      getCalendarJobs(),
      canViewWalkthroughs ? getScheduledWalkthroughs() : Promise.resolve([]),
      salesReadOnly ? Promise.resolve([]) : getActiveCrews(),
      internalAccess !== "None"
        ? getInternalScheduleEvents()
        : Promise.resolve([]),
      getUpcomingOccurrences(addDays(today(), -1), addDays(today(), 365)),
    ]);
    setJobs(j.filter((x) => !x.archived_at));
    setOccurrences(o);
    setWalkthroughs(w);
    setCrews(c);
    setInternalEvents(i);
  }

  useOperationalRealtime(["jobs", "walkthroughs", "crews", "employees", "service_occurrences", "service_agreements"], load);

  useEffect(() => {
    let active = true;
    void getInternalEventAccessLevel()
      .then((level) => {
        if (active) {
          setInternalAccess(level);
          setInternalAccessError(internalAccessDiagnostic(profile, level));
        }
      })
      .catch((x) => {
        console.error("Internal event authorization failed", x);
        if (active) {
          setInternalAccess("None");
          if (
            profile?.is_active &&
            profile.employee_id &&
            internalEventCandidateRoles.has(profile.role)
          ) {
            setInternalAccessError(
              "Internal event access could not be verified. Refresh the page or contact the Master Admin.",
            );
          } else setInternalAccessError(null);
        }
      });
    return () => {
      active = false;
    };
  }, [profile]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getCalendarJobs(),
      canViewWalkthroughs ? getScheduledWalkthroughs() : Promise.resolve([]),
      salesReadOnly ? Promise.resolve([]) : getActiveCrews(),
      internalAccess !== "None"
        ? getInternalScheduleEvents()
        : Promise.resolve([]),
      getUpcomingOccurrences(addDays(today(), -1), addDays(today(), 365)),
    ])
      .then(([j, w, c, i, o]) => {
        if (active) {
          setJobs(j.filter((x) => !x.archived_at));
          setOccurrences(o);
          setWalkthroughs(w);
          setCrews(c);
          setInternalEvents(i);
        }
      })
      .catch((x: unknown) => {
        console.error("Schedule load failed", x);
        if (active) setError(msg(x));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canViewWalkthroughs, internalAccess, salesReadOnly]);

  const crewFilterOptions = useMemo<CrewDisplayOption[]>(
    () =>
      salesReadOnly
        ? [
            ...new Map(
              jobs
                .filter((job) => job.assigned_crew_id && job.assigned_crew_name)
                .map((job) => [
                  job.assigned_crew_id!,
                  {
                    id: job.assigned_crew_id!,
                    crew_name: job.assigned_crew_name!,
                  },
                ]),
            ).values(),
          ].sort((a, b) => a.crew_name.localeCompare(b.crew_name))
        : crews.map(({ id, crew_name }) => ({ id, crew_name })),
    [crews, jobs, salesReadOnly],
  );

  const filteredJobs = useMemo(
    () =>
      jobs.filter((j) => {
        const hay = [
          j.job_number,
          j.client_name,
          j.property_name,
          j.service_name,
          j.assigned_employee_name,
          j.assigned_crew_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return (
          source !== "Walkthroughs" &&
          source !== "Recurring Services" &&
          source !== "Internal Events" &&
          (!search || hay.includes(search.toLowerCase())) &&
          (status === "All" || j.status === status) &&
          (division === "All" || j.division === division) &&
          (crew === "All" || j.assigned_crew_id === crew) &&
          j.status !== "Cancelled" &&
          j.status !== "Archived"
        );
      }),
    [
      crew,
      division,
      jobs,
      search,
      source,
      status,
    ],
  );
  const filteredWalkthroughs = useMemo(
    () =>
      walkthroughs.filter((w) => {
        const hay = [
          walkthroughClient(w),
          w.property?.address,
          w.contact_name,
          w.assigned_to,
          "Walkthrough",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return (
          source !== "Jobs" &&
          source !== "Recurring Services" &&
          source !== "Internal Events" &&
          (!search || hay.includes(search.toLowerCase())) &&
          (status === "All" || status === "Scheduled") &&
          (division === "All" || w.division === division) &&
          crew === "All"
        );
      }),
    [crew, division, search, source, status, walkthroughs],
  );
  const filteredInternalEvents = useMemo(
    () =>
      internalEvents.filter((event) => {
        const hay = [
          event.title,
          event.description,
          event.category,
          event.meeting_mode,
          event.location,
          event.vendor_name,
          event.prospect?.company_name,
          "Internal Event",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return (
          source !== "Jobs" &&
          source !== "Recurring Services" &&
          source !== "Walkthroughs" &&
          (!search || hay.includes(search.toLowerCase())) &&
          (status === "All" ||
            (status === "Scheduled" && event.status === "Scheduled") ||
            (status === "Cancelled" && event.status === "Canceled")) &&
          event.status !== "Canceled"
        );
      }),
    [internalEvents, search, source, status],
  );
  const filteredOccurrences = useMemo(() => occurrences.filter(row => !isDeletedOccurrence(row) && !row.job_id && row.status === "Scheduled" && row.agreement.status === "Active" && (source === "All Events" || source === "Recurring Services") && (status === "All" || status === "Scheduled") && (division === "All" || row.agreement.division === division) && (crew === "All" || row.assigned_crew_id === crew) && (!search || [row.agreement.service_name, row.agreement.agreement_number, row.agreement.client?.company_name, row.agreement.client?.first_name, row.agreement.client?.last_name].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()))), [occurrences, source, status, division, crew, search]);
  const events = useMemo<ScheduleEvent[]>(
    () => [
      ...filteredOccurrences.map((occurrence) => ({ kind: "Recurring Service" as const, id: occurrence.id, date: occurrence.scheduled_date, time: occurrence.scheduled_start_time, occurrence })),
      ...filteredJobs.map((job) => ({
        kind: "Job" as const,
        id: job.id,
        date: job.scheduled_date,
        time: job.start_time,
        job,
      })),
      ...filteredWalkthroughs.map((walkthrough) => ({
        kind: "Walkthrough" as const,
        id: walkthrough.id,
        date: walkthrough.walkthrough_date!,
        time: walkthrough.walkthrough_time,
        walkthrough,
      })),
      ...filteredInternalEvents.map((internalEvent) => ({
        kind: "Internal Event" as const,
        id: internalEvent.id,
        date: internalEventDate(internalEvent),
        time: internalEventTime(internalEvent),
        internalEvent,
      })),
    ],
    [filteredInternalEvents, filteredJobs, filteredWalkthroughs, filteredOccurrences],
  );
  const week = weekDates(selectedDate);
  const monthStart = `${selectedDate.slice(0, 7)}-01`;
  const monthOffset = new Date(`${monthStart}T12:00:00`).getDay();
  const monthCells = Array.from({ length: Math.ceil((monthOffset + new Date(Number(selectedDate.slice(0, 4)), Number(selectedDate.slice(5, 7)), 0).getDate()) / 7) * 7 }, (_, index) => addDays(monthStart, index - monthOffset));
  const dated = events.filter((event) => event.date);
  const unscheduled = filteredJobs.filter(
    (job) => !job.scheduled_date || job.status === "Ready to Schedule",
  );
  function move(direction: number) {
    if (view === "Month") {
      const [year, month] = selectedDate.split("-").map(Number);
      const target = new Date(year, month - 1 + direction, 1);
      setSelectedDate(`${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-01`);
      return;
    }
    setSelectedDate(
      addDays(selectedDate, direction * (view === "Week" ? 7 : 1)),
    );
  }

  return (
    <>
      {communication.composer}
      <Header
        createInternal={
          internalAccess === "Management" || internalAccess === "Sales" ? () => setInternalEdit("new") : null
        }
      />
      {internalAccessError && <Alert text={internalAccessError} />}
      <section aria-label="Calendar navigation" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm sm:p-5">
        <div className="flex rounded-xl bg-[#edf1eb] p-1">
          {(["Day", "Week", "Month", "List"] as View[]).map((v) => (
            <button
              type="button"
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-4 py-2 text-sm font-bold ${view === v ? "bg-white text-[#143d1a] shadow" : "text-neutral-500"}`}
            >
              {v}
            </button>
          ))}
        </div>
        {view !== "List" && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={secondary}
              onClick={() => move(-1)}
            >
              Previous{view === "Week" ? " Week" : view === "Month" ? " Month" : ""}
            </button>
            <button
              type="button"
              className={secondary}
              onClick={() => setSelectedDate(today())}
            >
              {view === "Week" ? "This Week" : view === "Month" ? "This Month" : "Today"}
            </button>
            <button type="button" className={secondary} onClick={() => move(1)}>
              Next{view === "Week" ? " Week" : view === "Month" ? " Month" : ""}
            </button>
          </div>
        )}
        <p className="font-extrabold text-[#143d1a]">
          {view === "Month"
            ? new Date(`${monthStart}T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })
            : view === "Week"
            ? `${pretty(week[0])} - ${pretty(week[6])}`
            : view === "Day"
              ? pretty(selectedDate)
              : "All scheduled work"}
        </p>
      </section>
      <Filters
        search={search}
        setSearch={setSearch}
        status={status}
        setStatus={setStatus}
        division={division}
        setDivision={setDivision}
        crew={crew}
        setCrew={setCrew}
        crews={crewFilterOptions}
        source={source}
        setSource={setSource}
      />
      {notice && <Alert text={notice} good />}
      {error && <Alert text={error} />}{" "}
      {loading ? (
        <div className="mt-6 h-64 animate-pulse rounded-2xl bg-neutral-200" />
      ) : (
        <>
          {view === "Day" && (
            <Day
              date={selectedDate}
              events={dated.filter((event) => event.date === selectedDate)}
              openJob={setDetail}
              openInternal={setInternalDetail}
            />
          )}{" "}
          {view === "Week" && (
            <div className="mt-6 overflow-x-auto">
              <div className="grid grid-cols-1 gap-0 sm:min-w-[1000px] sm:grid-cols-7 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-[#143d1a]/20">
                {week.map((date) => (
                  <Day
                    key={date}
                    date={date}
                    events={dated.filter((event) => event.date === date)}
                    openJob={setDetail}
                    openInternal={setInternalDetail}
                  />
                ))}
              </div>
            </div>
          )}
          {view === "Month" && (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-[#143d1a]/20">
              <div className="grid min-w-[700px] grid-cols-7 bg-[#143d1a] text-center text-xs font-bold text-white">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="p-3">{day}</div>)}
              </div>
              <div className="grid min-w-[700px] grid-cols-7">
                {monthCells.map((date) => {
                  const dayEvents = dated.filter((event) => event.date === date).sort(byEventTime);
                  const inMonth = date.slice(0, 7) === selectedDate.slice(0, 7);
                  return (
                    <div key={date} className={`min-h-32 border-b border-r p-2 ${inMonth ? "bg-white" : "bg-neutral-100"}`}>
                      <button type="button" onClick={() => { setSelectedDate(date); setView("Day"); }} className={`mb-2 rounded-full px-2 py-1 text-sm font-bold hover:bg-[#edf4ec] ${date === today() ? "bg-[#143d1a] text-white hover:text-[#143d1a]" : inMonth ? "text-[#143d1a]" : "text-neutral-400"}`} aria-label={`View ${pretty(date)}`}>{Number(date.slice(8))}</button>
                      <div className="space-y-1">
                        {dayEvents.slice(0, 3).map((event) => (
                          <button key={`${event.kind}-${event.id}`} type="button" onClick={() => { if (event.kind === "Job") setDetail(event.job); else if (event.kind === "Internal Event") setInternalDetail(event.internalEvent); else { setSelectedDate(date); setView("Day"); } }} className="block w-full truncate rounded bg-[#edf4ec] px-2 py-1 text-left text-[11px] text-[#143d1a]" title={event.kind === "Job" ? (event.job.client_name ?? "Job") : event.kind === "Internal Event" ? event.internalEvent.title : event.kind === "Recurring Service" ? (event.occurrence.agreement.client?.company_name || event.occurrence.agreement.service_name) : walkthroughClient(event.walkthrough)}>{event.time ? `${formatTime(event.time)} ` : ""}{event.kind === "Job" ? event.job.client_name : event.kind === "Internal Event" ? event.internalEvent.title : event.kind === "Recurring Service" ? (event.occurrence.agreement.client?.company_name || event.occurrence.agreement.service_name) : walkthroughClient(event.walkthrough)}</button>
                        ))}
                        {dayEvents.length > 3 && <button type="button" onClick={() => { setSelectedDate(date); setView("Day"); }} className="text-xs font-semibold text-[#143d1a]">+${dayEvents.length - 3} more</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {view === "List" && (
            <ListView
              events={events}
              openJob={setDetail}
              openInternal={setInternalDetail}
            />
          )}{" "}
        </>
      )}
      <ScheduleOccurrences />
      {canEditSchedule && edit && (
        <ScheduleModal
          job={edit}
          crews={crews}
          close={() => setEdit(null)}
          saved={async (text, job) => {
            void communication.expose(job, "service_scheduled");
            setEdit(null);
            await load();
            setNotice(text);
          }}
        />
      )}
      {detail && (
        <QuickDetail
          job={detail}
          canEdit={canEditSchedule}
          canViewJobTime={canViewJobTime}
          close={() => setDetail(null)}
          reschedule={() => {
            setEdit(detail);
            setDetail(null);
          }}
          saved={async (text, actionError) => {
            setDetail(null);
            await load();
            if (actionError) {
              setNotice(null);
              setError(actionError);
            } else setNotice(text);
          }}
        />
      )}
      {(internalAccess === "Management" || internalAccess === "Sales") && profile && internalEdit && (
        <InternalEventDialog
          event={internalEdit === "new" ? null : internalEdit}
          access={internalAccess}
          profile={profile}
          close={() => setInternalEdit(null)}
          saved={async (text) => {
            setInternalEdit(null);
            await load();
            setNotice(text);
          }}
        />
      )}
      {internalAccess !== "None" && profile && internalDetail && (
        <InternalEventDetails
          event={internalDetail}
          access={internalAccess}
          profile={profile}
          close={() => setInternalDetail(null)}
          edit={() => {
            setInternalEdit(internalDetail);
            setInternalDetail(null);
          }}
          saved={async (text) => {
            setInternalDetail(null);
            await load();
            setNotice(text);
          }}
        />
      )}
    </>
  );
}
function Header({ createInternal }: { createInternal: (() => void) | null }) {
  return <PageHeader title="Schedule" description="Manage StudioScrubz upcoming jobs, walkthroughs, internal events, and crew assignments." actions={createInternal ? <button type="button" className={primary} onClick={createInternal}>Create Internal Event</button> : undefined} />;
}
function Filters(p: {
  search: string;
  setSearch: (v: string) => void;
  status: string;
  setStatus: (v: (typeof statuses)[number]) => void;
  division: string;
  setDivision: (v: string) => void;
  crew: string;
  setCrew: (v: string) => void;
  crews: CrewDisplayOption[];
  source: EventSource;
  setSource: (v: EventSource) => void;
}) {
  return (
    <section aria-label="Schedule filters" className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm sm:p-5">
      <div className="mb-3"><h2 className="text-sm font-extrabold text-[var(--brand-green)]">Filter calendar</h2><p className="mt-1 text-xs text-[var(--muted)]">Narrow events by type, job status, division, or assigned crew.</p></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <input
          className={input}
          value={p.search}
          onChange={(e) => p.setSearch(e.target.value)}
          placeholder="Search schedule"
        />
        <select
          className={input}
          value={p.source}
          onChange={(e) => p.setSource(e.target.value as EventSource)}
        >
          {(
            [
              "All Events",
              "Jobs",
              "Recurring Services",
              "Walkthroughs",
              "Internal Events",
            ] as EventSource[]
          ).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          className={input}
          value={p.status}
          onChange={(e) =>
            p.setStatus(e.target.value as (typeof statuses)[number])
          }
        >
          {statuses.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          className={input}
          value={p.division}
          onChange={(e) => p.setDivision(e.target.value)}
        >
          <option>All</option>
          <option>Residential</option>
          <option>Commercial</option>
        </select>
        <select
          className={input}
          value={p.crew}
          onChange={(e) => p.setCrew(e.target.value)}
        >
          <option value="All">All Crews</option>
          {p.crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.crew_name}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
function Day({
  date,
  events,
  openJob,
  openInternal,
}: {
  date: string;
  events: ScheduleEvent[];
  openJob: (job: JobWithRelations) => void;
  openInternal: (event: InternalScheduleEvent) => void;
}) {
  return (
    <section className="mt-6 min-h-44 rounded-2xl bg-[#eef1ed] p-3 [&+&]:border-t [&+&]:border-[#143d1a]/20 [&+&]:pt-6 sm:mt-0 sm:rounded-none sm:[&+&]:border-t-0 sm:[&+&]:border-l sm:[&+&]:border-l-[#143d1a]/15 sm:[&+&]:pt-3">
      <h2 className="text-sm font-extrabold text-[#143d1a]">{pretty(date)}</h2>
      <div className="mt-3 space-y-2">
        {[...events].sort(byEventTime).map((event) => (
          <EventCard
            key={`${event.kind}-${event.id}`}
            event={event}
            openJob={openJob}
            openInternal={openInternal}
          />
        ))}
      </div>
    </section>
  );
}
function EventCard({
  event,
  openJob,
  openInternal,
}: {
  event: ScheduleEvent;
  openJob: (job: JobWithRelations) => void;
  openInternal: (event: InternalScheduleEvent) => void;
}) {
  if (event.kind === "Recurring Service") return <Link href="/agreements" className="block w-full rounded-xl border-l-4 border-emerald-600 bg-emerald-50 p-3 text-left shadow-sm"><b className="text-[#143d1a]">{event.time || "Time not set"}</b><p className="mt-1 text-xs font-extrabold">{event.occurrence.agreement.client?.company_name || [event.occurrence.agreement.client?.first_name, event.occurrence.agreement.client?.last_name].filter(Boolean).join(" ") || "Client"}</p><p className="text-xs">{event.occurrence.agreement.service_name}</p><p className="text-[11px] text-neutral-600">Recurring service · Awaiting Job creation</p></Link>;
  if (event.kind === "Job")
    return <JobCard job={event.job} open={() => openJob(event.job)} />;
  if (event.kind === "Walkthrough")
    return <WalkthroughCard walkthrough={event.walkthrough} />;
  return (
    <InternalEventCard
      event={event.internalEvent}
      open={() => openInternal(event.internalEvent)}
    />
  );
}
function InternalEventCard({
  event,
  open,
}: {
  event: InternalScheduleEvent;
  open: () => void;
}) {
  return (
    <button
      type="button"
      onClick={open}
      className="w-full rounded-xl border-l-4 border-sky-600 bg-sky-50 p-3 text-left shadow-sm hover:bg-sky-100"
    >
      <div className="flex justify-between gap-2">
        <b className="text-[#143d1a]">{internalEventTimeLabel(event)}</b>
        <span className="rounded-full bg-sky-200 px-2 py-0.5 text-[10px] font-extrabold text-sky-900">
          Internal
        </span>
      </div>
      <p className="mt-1 text-xs font-extrabold">{event.title}</p>
      <p className="truncate text-[11px] text-neutral-600">
        {event.category} | {event.meeting_mode}
      </p>
      <p className="mt-2 text-[11px] text-neutral-500">
        {event.visibility} | {event.status}
      </p>
    </button>
  );
}
function WalkthroughCard({
  walkthrough,
}: {
  walkthrough: WalkthroughWithRelations;
}) {
  return (
    <Link
      href={`/walkthroughs?walkthroughId=${encodeURIComponent(walkthrough.id)}`}
      className="block w-full rounded-xl border-l-4 border-[#d4af37] bg-[#fff9df] p-3 text-left shadow-sm hover:bg-[#fff5c6]"
    >
      <div className="flex justify-between gap-2">
        <b className="text-[#143d1a]">
          {formatTime(walkthrough.walkthrough_time)}
        </b>
        <span className="rounded-full bg-[#d4af37]/25 px-2 py-0.5 text-[10px] font-extrabold text-[#6f560d]">
          Walkthrough
        </span>
      </div>
      <p className="mt-1 text-xs font-extrabold">
        {walkthroughClient(walkthrough)}
      </p>
      <p className="truncate text-[11px] text-neutral-600">
        {walkthrough.property?.address || "Deleted Property"}
      </p>
      <p className="mt-2 text-[11px] text-neutral-500">
        {walkthrough.division} | {walkthrough.status}
      </p>
    </Link>
  );
}
function JobCard({ job, open }: { job: JobWithRelations; open: () => void }) {
  return (
    <button
      onClick={open}
      className="w-full rounded-xl border border-neutral-200 border-l-4 border-l-[#143d1a] bg-white p-3 text-left shadow-sm transition-colors hover:bg-[#f5f8f3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#143d1a]"
    >
      <div className="flex justify-between gap-2">
        <b className="text-[#143d1a]">{formatTime(job.start_time)}</b>
        <span className="text-[10px] font-bold text-[#9a7a17]">
          {job.division}
        </span>
      </div>
      <p className="mt-1 text-xs font-extrabold">{job.job_number}</p>
      <p className="text-xs">{job.client_name}</p>
      <p className="truncate text-[11px] text-neutral-500">
        {job.property_name}
      </p>
      {job.property?.address && <p className="mt-1 flex items-start gap-1 text-[11px] text-neutral-600"><span aria-hidden="true">📍</span><span className="min-w-0 break-words">{[job.property.address, job.property.address_line_2, [job.property.city, job.property.state].filter(Boolean).join(", "), job.property.zip].filter(Boolean).join(" · ")}</span></p>}
      <p className="mt-2 text-xs">
        {job.service_name} | {job.estimated_duration ?? 0}h
      </p>
      <p className="text-[11px] text-neutral-500">{jobAssignmentLabel(job)}</p>
      <div className="mt-2"><StatusBadge status={job.status} label={displayJobStatus(job.status)} /></div>
    </button>
  );
}
function Unscheduled({
  jobs,
  schedule,
}: {
  jobs: JobWithRelations[];
  schedule: (j: JobWithRelations) => void;
}) {
  return (
    <section className="mt-7 rounded-2xl border border-dashed border-[#143d1a]/25 bg-white p-5">
      <h2 className="font-extrabold text-[#143d1a]">Unscheduled Jobs</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {jobs.map((j) => (
          <article key={j.id} className="rounded-xl bg-neutral-50 p-4">
            <b>{j.job_number}</b>
            <p className="text-sm">
              {j.client_name} | {j.service_name}
            </p>
            <button className={`${primary} mt-3`} onClick={() => schedule(j)}>
              Schedule Job
            </button>
          </article>
        ))}
        {!jobs.length && (
          <p className="text-sm text-neutral-500">No unscheduled jobs.</p>
        )}
      </div>
    </section>
  );
}
function ListView({
  events,
  openJob,
  openInternal,
}: {
  events: ScheduleEvent[];
  openJob: (job: JobWithRelations) => void;
  openInternal: (event: InternalScheduleEvent) => void;
}) {
  const t = today();
  const groups = [
    ["Today", events.filter((event) => event.date === t)],
    ["Upcoming", events.filter((event) => event.date && event.date > t)],
    ["Unscheduled", events.filter((event) => !event.date)],
    ["Past", events.filter((event) => event.date && event.date < t)],
  ] as const;
  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-2">
      {groups.map(([title, rows]) => (
        <section key={title} aria-label={`${title} events`} className={`overflow-hidden rounded-2xl border shadow-sm ${title === "Today" ? "border-[#143d1a]/25 bg-[#eef1ed]" : title === "Upcoming" ? "border-sky-200 bg-sky-50/40" : title === "Unscheduled" ? "border-amber-200 bg-amber-50/40" : "border-neutral-200 bg-neutral-50"}`}>
          <div className="border-b border-inherit px-4 py-3">
          <h2 className="flex items-center justify-between gap-3 font-extrabold text-[#143d1a]">
            {title} <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs">{rows.length}</span>
          </h2>
          </div>
          <div className="grid gap-2 p-4">
            {[...rows].sort(byEventTime).map((event) => (
              <EventCard
                key={`${event.kind}-${event.id}`}
                event={event}
                openJob={openJob}
                openInternal={openInternal}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
function ScheduleModal({
  job,
  crews,
  close,
  saved,
}: {
  job: JobWithRelations;
  crews: CrewWithRelations[];
  close: () => void;
  saved: (text: string, job: JobWithRelations) => Promise<void>;
}) {
  const [date, setDate] = useState(job.scheduled_date ?? today()),
    [time, setTime] = useState(job.start_time?.slice(0, 5) ?? "09:00"),
    [duration, setDuration] = useState(job.estimated_duration ?? 2);
  const initial = jobWorkerTarget(job),
    [kind, setKind] = useState<JobAssignmentKind>(initial.kind),
    [employeeId, setEmployeeId] = useState(
      initial.kind === "individual" ? initial.employeeId : "",
    ),
    [crewId, setCrewId] = useState(
      initial.kind === "crew" ? initial.crewId : "",
    );
  const [techOptions, setTechOptions] = useState<EligibleJobTech[]>([]),
    [conflicts, setConflicts] = useState<CrewConflict[]>([]),
    [confirm, setConfirm] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getEligibleJobTechs()
      .then(setTechOptions)
      .catch((x) => setError(msg(x)));
  }, []);
  const selected = crews.find((c) => c.id === crewId) ?? null;
  const target: JobWorkerTarget =
    kind === "individual"
      ? { kind, employeeId }
      : kind === "crew"
        ? { kind, crewId }
        : { kind: "unassigned" };
  async function submit(override = false) {
    setSaving(true);
    setError(null);
    try {
      const found =
        kind === "crew" && crewId
          ? await findCrewConflicts(job.id, crewId, date, time, duration)
          : kind === "individual" && employeeId
            ? await findIndividualTechConflicts(
                job.id,
                employeeId,
                date,
                time,
                duration,
              )
            : [];
      if (found.length && !override) {
        setConflicts(found);
        setConfirm(true);
        setSaving(false);
        return;
      }
      const updated = await rescheduleJob(
        job.id,
        date,
        time,
        duration,
        target,
        job.status,
      );
      await saved(job.scheduled_date ? "Job rescheduled." : "Job scheduled.", {
        ...updated,
        client: job.client,
        property: job.property,
      });
    } catch (x) {
      console.error("Schedule update failed", x);
      setError(msg(x));
      setSaving(false);
    }
  }
  return (
    <Modal
      title={job.scheduled_date ? "Reschedule Job" : "Schedule Job"}
      close={close}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field l="Scheduled Date" type="date" v={date} set={setDate} />
        <Field l="Start Time" type="time" v={time} set={setTime} />
        <Field
          l="Estimated Duration"
          type="number"
          v={String(duration)}
          set={(v) => setDuration(Number(v))}
        />
        <label className="text-sm font-bold">
          Worker Target
          <select
            className={`${input} mt-2`}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as JobAssignmentKind);
              setEmployeeId("");
              setCrewId("");
            }}
          >
            <option value="unassigned">Unassigned</option>
            <option value="individual">Individual Tech</option>
            <option value="crew">Crew</option>
          </select>
        </label>
        {kind === "individual" && (
          <label className="text-sm font-bold">
            Individual Tech
            <select
              className={`${input} mt-2`}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Select active Tech</option>
              {techOptions.map((t) => (
                <option key={t.employee_id} value={t.employee_id}>
                  {t.display_name} - {t.operational_role}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "crew" && (
          <label className="text-sm font-bold">
            Crew
            <select
              className={`${input} mt-2`}
              value={crewId}
              onChange={(e) => setCrewId(e.target.value)}
            >
              <option value="">Select active Crew</option>
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.crew_name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {selected && (
        <div className="mt-4 rounded-xl bg-neutral-50 p-4 text-sm">
          <p>
            <b>Crew Lead:</b>{" "}
            {selected.crew_lead ? name(selected.crew_lead) : "Unassigned"}
          </p>
          <p>
            <b>Crew Members:</b>{" "}
            {selected.members.map((m) => name(m.employee)).join(", ") || "None"}
          </p>
        </div>
      )}
      {confirm && (
        <ConflictWarning
          rows={conflicts}
          cancel={() => {
            setConfirm(false);
            setConflicts([]);
          }}
          anyway={() => void submit(true)}
        />
      )}{" "}
      {error && <Alert text={error} />}{" "}
      {!confirm && (
        <button
          disabled={
            saving ||
            (kind === "individual" && !employeeId) ||
            (kind === "crew" && !crewId)
          }
          className={`${primary} mt-5`}
          onClick={() => void submit()}
        >
          {saving ? "Saving..." : "Save Schedule"}
        </button>
      )}
    </Modal>
  );
}
function ConflictWarning({
  rows,
  cancel,
  anyway,
}: {
  rows: CrewConflict[];
  cancel: () => void;
  anyway: () => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-extrabold text-amber-900">
        This crew is already assigned to another job during this time.
      </p>
      {rows.map((j) => (
        <div key={j.id} className="mt-3 text-sm">
          <b>{j.job_number}</b> | {j.client_name} | {j.property_name}
          <br />
          {formatTime(j.start_time)} for {j.estimated_duration ?? 0} hours
        </div>
      ))}
      <div className="mt-4 flex gap-2">
        <button className={secondary} onClick={cancel}>
          Cancel
        </button>
        <button className={primary} onClick={anyway}>
          Schedule Anyway
        </button>
      </div>
    </div>
  );
}
function QuickDetail({
  job,
  canEdit,
  canViewJobTime,
  close,
  reschedule,
  saved,
}: {
  job: JobWithRelations;
  canEdit: boolean;
  canViewJobTime: boolean;
  close: () => void;
  reschedule: () => void;
  saved: (text: string, error?: string | null) => Promise<void>;
}) {
  const [notes, setNotes] = useState(job.internal_notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, text: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await saved(text);
    } catch (x) {
      console.error("Job operation failed", x);
      setError(msg(x));
      setBusy(false);
    }
  }
  return (
    <Modal title={job.job_number} close={close}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Details
          rows={[
            ["Client", job.client_name || "-"],
            ["Property", job.property_name || "-"],
            ["Service", job.service_name || "-"],
            ["Date", job.scheduled_date || "Unscheduled"],
            ["Time", formatTime(job.start_time)],
            ["Duration", `${job.estimated_duration ?? 0} hours`],
            ["Status", job.status],
          ]}
        />
        <Details
          rows={[
            ["Crew", job.assigned_crew_name || "Unassigned"],
            ["Crew Lead", job.crew_lead_name || "Unassigned"],
            ["Team", job.assigned_team.join(", ") || "Unassigned"],
            ["Proposal", job.proposal?.proposal_number ?? "-"],
            ["Estimate", job.estimate_id || "-"],
            ["Walkthrough", job.walkthrough_id || "-"],
          ]}
        />
      </div>
      {canViewJobTime && <JobTimeSummary job={job} />}
      <h3 className="mt-5 font-extrabold text-[#143d1a]">Scope</h3>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {job.scope.map((x) => (
          <li key={x.id}>{x.text}</li>
        ))}
      </ul>
      {canEdit && (
        <>
          <label className="mt-5 block text-sm font-bold">
            Internal Notes
            <textarea
              className={`${input} mt-2 h-24 py-3`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {error && <Alert text={error} />}
          <div className="mt-5 flex flex-wrap gap-2">
            <ContractServiceRecordAction jobId={job.id} />
            <Link href={`/jobs?jobId=${job.id}`} className={primary}>
              Manage Job Time
            </Link>
            <button disabled={busy} className={secondary} onClick={reschedule}>
              Reschedule
            </button>
            <button
              disabled={busy}
              className={secondary}
              onClick={() =>
                void run(
                  () => updateJobInternalNotes(job.id, notes),
                  "Internal notes saved.",
                )
              }
            >
              Save Notes
            </button>
            {!(["Completed", "Cancelled"] as JobStatus[]).includes(
              job.status,
            ) && (
              <button
                disabled={busy}
                className={secondary}
                onClick={() =>
                  void run(() => cancelJob(job.id, notes), "Job cancelled.")
                }
              >
                Cancel Job
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[95] grid place-items-center overflow-y-auto bg-[#07190a]/70 p-5">
      <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6">
        <button onClick={close} className="float-right text-xl">
          x
        </button>
        <h2 className="mb-5 text-xl font-extrabold text-[#143d1a]">{title}</h2>
        {children}
      </section>
    </div>
  );
}
function Field({
  l,
  v,
  set,
  type,
}: {
  l: string;
  v: string;
  set: (v: string) => void;
  type: string;
}) {
  return (
    <label className="text-sm font-bold">
      {l}
      <input
        className={`${input} mt-2`}
        type={type}
        value={v}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function Details({ rows }: { rows: string[][] }) {
  return (
    <div>
      {rows.map(([a, b]) => (
        <div
          key={a}
          className="flex justify-between gap-4 border-b py-2 text-sm"
        >
          <span className="text-neutral-500">{a}</span>
          <b className="text-right">{b}</b>
        </div>
      ))}
    </div>
  );
}
function Alert({ text, good }: { text: string; good?: boolean }) {
  return (
    <p
      className={`mt-4 rounded-xl p-3 text-sm font-bold ${good ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
    >
      {text}
    </p>
  );
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekDates(date: string) {
  const d = new Date(`${date}T12:00:00`);
  const offset = (d.getDay() + 6) % 7;
  const start = addDays(date, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
function pretty(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function formatTime(v: string | null) {
  if (!v) return "Time TBD";
  const [h, m] = v.slice(0, 5).split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
function internalEventParts(event: InternalScheduleEvent) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: event.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(event.starts_at));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}
function internalEventDate(event: InternalScheduleEvent) {
  return internalEventParts(event).date;
}
function internalEventTime(event: InternalScheduleEvent) {
  return internalEventParts(event).time;
}
function internalEventTimeLabel(event: InternalScheduleEvent) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: event.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.starts_at));
}
function byTime(a: JobWithRelations, b: JobWithRelations) {
  return (a.start_time ?? "99").localeCompare(b.start_time ?? "99");
}
function name(e: {
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}) {
  return e.preferred_name || `${e.first_name} ${e.last_name}`;
}
function msg(x: unknown) {
  if (x instanceof Error) return x.message;
  if (
    x &&
    typeof x === "object" &&
    "message" in x &&
    typeof x.message === "string"
  )
    return x.message;
  return "Operation failed.";
}
const input =
  "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm";
const primary =
  "rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary =
  "rounded-lg border px-4 py-2.5 text-sm font-bold text-[#143d1a] disabled:opacity-50";
