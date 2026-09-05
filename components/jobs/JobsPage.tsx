"use client";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { canPermanentlyDelete, hasPermission } from "@/lib/auth/permissions";
import {
  archiveJob,
  assignJobCrew,
  cancelJob,
  completeInProgressJob,
  getCrewConflicts,
  getCurrentJobClockState,
  getArchivedJobs,
  getJobs,
  joinJob,
  permanentlyDeleteCancelledJob,
  isJobCompletionResult,
  scheduleJob,
  startOperationalJob,
  updateJobStatus,
} from "@/lib/services/jobs";
import { getActiveCrews } from "@/lib/services/crews";
import { JobInvoiceAction } from "@/components/invoices/JobInvoiceAction";
import { JobMileageSummary } from "@/components/vehicles/JobMileageSummary";
import { JobLaborSummary } from "@/components/time/JobLaborSummary";
import type { CrewWithRelations } from "@/types/crew";
import { PhotoUploader } from "@/components/photos/PhotoUploader";
import type { JobPhotoCategory } from "@/types/photo";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { DirectJobModal } from "@/components/jobs/DirectJobModal";
import { ContractServiceRecordAction } from "@/components/jobs/ContractServiceRecord";
import { JobTimeSummary } from "@/components/jobs/JobTimeSummary";
import { JobCalendarStatus } from "@/components/jobs/JobCalendarStatus";
import { getTimeEntries } from "@/lib/services/timeEntries";
import {
  JOB_STATUSES,
  type JobStatus,
  type JobWithRelations,
} from "@/types/job";
import type { TimeEntryWithRelations } from "@/types/timeEntry";
import { getJobScopeV1, type JobScopeItem, type JobScopeV1 } from "@/lib/services/jobScope";
import { canCreateFieldDiscovery, canReviewFieldDiscovery, createFieldDiscovery, getFieldDiscoveriesForJob, getFieldDiscoveryMedia, updateFieldDiscoveryStatus, uploadFieldDiscoveryMedia, type VisibleFieldDiscovery } from "@/lib/services/fieldDiscoveries";
import type { FieldDiscoveryMediaWithUrl, FieldDiscoveryStatus } from "@/types/fieldDiscovery";
import { addChangeRequestItem, canManageChangeRequests, createChangeRequest, getChangeRequestsForJob, sendChangeRequest, updateChangeRequestDraft } from "@/lib/services/changeRequests";
import type { VisibleChangeRequest } from "@/types/changeRequest";
import { canCreateJobEvidence, createJobEvidence, uploadJobEvidenceMedia } from "@/lib/services/jobEvidence";
import { getJobScopeTimeline } from "@/lib/services/jobScopeTimeline";
import { JOB_EVIDENCE_TYPES, type JobEvidenceType } from "@/types/jobEvidence";
import type { JobScopeTimeline } from "@/types/jobScopeTimeline";
import { checkScopeAdvisory } from "@/lib/services/scopeAdvisory";
import type { ScopeAdvisoryResult } from "@/types/scopeAdvisory";

type ScheduleFilter = "All" | "Scheduled" | "Unscheduled" | "Upcoming" | "Past";
const activeStatuses: JobStatus[] = [
  "Ready to Schedule",
  "Scheduled",
  "Crew Assigned",
  "In Progress",
];
const terminalStatuses: JobStatus[] = ["Completed", "Cancelled", "Archived"];
const jobPhotoCategories: readonly JobPhotoCategory[] = ["After", "Before", "Damage / Issue", "Other"];
export function JobsPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<JobWithRelations[]>([]);
  const [archivedRows, setArchivedRows] = useState<JobWithRelations[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntryWithRelations[]>([]);
  const [activeCrews, setActiveCrews] = useState<CrewWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"All" | JobStatus>("All");
  const [division, setDivision] = useState("All");
  const [crew, setCrew] = useState("All");
  const [schedule, setSchedule] = useState<ScheduleFilter>("All");
  const [selected, setSelected] = useState<JobWithRelations | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<JobWithRelations | null>(null);
  const canViewArchived = Boolean(profile && ["Master Admin", "Administrator"].includes(profile.role));
  async function load() {
    const [next, entries, crews, nextArchived] = await Promise.all([
      getJobs(),
      getTimeEntries(),
      getActiveCrews(),
      canViewArchived ? getArchivedJobs() : Promise.resolve([]),
    ]);
    setRows(next);
    setArchivedRows(nextArchived);
    setTimeEntries(entries);
    setActiveCrews(crews);
    return next;
  }
  useOperationalRealtime(["jobs", "time_entries", "crews", "employees", "invoices", "service_occurrences"], async () => { await load(); });
  useEffect(() => {
    let active = true;
    void Promise.all([
      getJobs(),
      getTimeEntries(),
      getActiveCrews(),
      canViewArchived ? getArchivedJobs() : Promise.resolve([]),
    ])
      .then(([x, entries, crews, archivedJobs]) => {
        if (active) {
          setRows(x);
          setArchivedRows(archivedJobs);
          setTimeEntries(entries);
          setActiveCrews(crews);
          const jobId = new URLSearchParams(window.location.search).get(
            "jobId",
          );
          if (jobId) setSelected([...x, ...archivedJobs].find((job) => job.id === jobId) ?? null);
        }
      })
      .catch((x: unknown) => {
        console.error("Jobs load failed", x);
        if (active) setError(message(x, "Jobs could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canViewArchived]);
  async function mutate(
    job: JobWithRelations,
    fn: () => Promise<unknown>,
    text: string | ((result: unknown) => string),
    onError?: (detail: string) => void,
  ) {
    setBusy(job.id);
    setError(null);
    try {
      const result = await fn();
      const next = await load();
      setSelected((current) => current?.id === job.id
        ? next.find((row) => row.id === job.id) ?? null
        : current);
      if (isJobCompletionResult(result)) {
        if (result.invoiceError) {
          setNotice(null);
          setError(result.invoiceError);
        } else if (result.invoice) {
          setNotice(result.invoiceCreated
            ? `Job completed and Invoice ${result.invoice.invoice_number} created.`
            : `Job completed. Invoice ${result.invoice.invoice_number} already exists.`);
        } else {
          setNotice("Job completed.");
        }
      } else {
        setNotice(typeof text === "function" ? text(result) : text);
      }
    } catch (x) {
      console.error("Job mutation failed", x);
      const detail = message(x, "Job action failed.");
      setError(detail);
      onError?.(detail);
    } finally {
      setBusy(null);
    }
  }
  async function removeCancelledJob(job: JobWithRelations) {
    setBusy(job.id);
    setError(null);
    setNotice(null);
    try {
      await permanentlyDeleteCancelledJob(job.id);
      setRows((current) => current.filter((row) => row.id !== job.id));
      setSelected((current) => current?.id === job.id ? null : current);
      setConfirmingDelete(null);
      setNotice(`${job.job_number} permanently deleted.`);
    } catch (cause) {
      console.error("Cancelled Job permanent deletion failed", cause);
      setError(message(cause, "The Cancelled Job could not be permanently deleted."));
      setConfirmingDelete(null);
    } finally {
      setBusy(null);
    }
  }
  const availableRows = useMemo(() => [...rows, ...archivedRows], [archivedRows, rows]);
  const filtered = useMemo(
    () =>
      availableRows
        .filter((j) => {
          const hay = [
            j.job_number,
            j.client_name,
            j.property_name,
            j.service_name,
            j.assigned_crew_name,
            j.crew_lead_name,
            ...j.assigned_team,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          const date = j.scheduled_date;
          const today = localDateKey(new Date());
          const scheduleMatch =
            schedule === "All" ||
            (schedule === "Scheduled" && Boolean(date)) ||
            (schedule === "Unscheduled" && !date) ||
            (schedule === "Upcoming" && Boolean(date && date >= today)) ||
            (schedule === "Past" && Boolean(date && date < today));
          return (
            (!search || hay.includes(search.toLowerCase())) &&
            (status === "All" || j.status === status) &&
            (division === "All" || j.division === division) &&
            (crew === "All" || j.assigned_crew_id === crew) &&
            scheduleMatch
          );
        })
        .sort(compareSchedule),
    [availableRows, crew, division, schedule, search, status],
  );
  const scheduledGroups = useMemo(() => groupScheduledJobs(filtered), [filtered]);
  const unscheduled = filtered.filter((job) => !job.scheduled_date && !terminalStatuses.includes(job.status));
  const completed = filtered.filter((job) => job.status === "Completed").sort(compareRecent);
  const cancelled = filtered.filter((job) => job.status === "Cancelled").sort(compareRecent);
  const archived = filtered.filter((job) => job.status === "Archived" || job.archived_at !== null).sort(compareRecent);
  const active = rows.filter((job) => job.archived_at === null && activeStatuses.includes(job.status));
  const metrics = [
    ["Total Jobs", active.length],
    [
      "Ready to Schedule",
      active.filter((j) => j.status === "Ready to Schedule").length,
    ],
    [
      "Scheduled",
      active.filter(
        (j) => j.status === "Scheduled" || j.status === "Crew Assigned",
      ).length,
    ],
    ["In Progress", active.filter((j) => j.status === "In Progress").length],
  ] as const;
  const renderJob = (job: JobWithRelations) => (
    <JobCard
      key={job.id}
      job={job}
      open={() => setSelected(job)}
      timeEntries={timeEntries.filter((entry) => entry.job_id === job.id && !entry.archived_at && entry.entry_type === "Job")}
      employeeId={profile?.employee_id ?? null}
      role={profile?.role ?? null}
      canComplete={hasPermission(profile, "jobs.complete")}
      canDelete={job.status === "Cancelled" && canPermanentlyDelete(profile)}
      busy={busy === job.id}
      requestDelete={() => setConfirmingDelete(job)}
      act={(fn, text, onError) => void mutate(job, fn, text, onError)}
    />
  );
  return (
    <>
      <Header canCreate={hasPermission(profile, "jobs.create")} create={() => setCreating(true)} />
      {notice && <Alert text={notice} success />}
      {error && <Alert text={error} />}
      <section className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <Metric key={label} label={label} value={loading ? "—" : value} />
        ))}
      </section>
      <section className="mt-6 rounded-2xl border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input
            className={input}
            placeholder="Search jobs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            value={status}
            set={(v) => setStatus(v as typeof status)}
            options={["All", ...JOB_STATUSES]}
          />
          <Select
            value={division}
            set={setDivision}
            options={["All", "Residential", "Commercial"]}
          />
          <Select
            value={crew}
            set={setCrew}
            options={["All", ...activeCrews.map((candidate) => candidate.id)]}
            labels={new Map(activeCrews.map((candidate) => [candidate.id, candidate.crew_name]))}
          />
          <Select
            value={schedule}
            set={(v) => setSchedule(v as ScheduleFilter)}
            options={["All", "Scheduled", "Unscheduled", "Upcoming", "Past"]}
          />
        </div>
      </section>
      {loading ? (
        <div className="mt-6 h-64 animate-pulse rounded-2xl bg-neutral-200" />
      ) : (
        <div className="mt-6 space-y-7 pb-5">
          {scheduledGroups.map(([date, jobs]) => (
            <JobSection key={date} title={dateHeading(date)} count={jobs.length} jobs={jobs} renderJob={renderJob} />
          ))}
          <JobSection title="Unscheduled" count={unscheduled.length} jobs={unscheduled} renderJob={renderJob} muted />
          <JobSection title="Completed" count={completed.length} jobs={completed} renderJob={renderJob} muted />
          <JobSection title="Cancelled" count={cancelled.length} jobs={cancelled} renderJob={renderJob} muted />
          <JobSection title="Archived" count={archived.length} jobs={archived} renderJob={renderJob} muted />
          {filtered.length === 0 && <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-neutral-500">No jobs match the current filters.</div>}
        </div>
      )}
      {selected && (
        <JobModal
          job={selected}
          busy={busy === selected.id}
          close={() => setSelected(null)}
          mutate={(fn, text, onError) => void mutate(selected, fn, text, onError)}
          canEdit={hasPermission(profile, "jobs.edit")}
          canSchedule={hasPermission(profile, "jobs.schedule")}
          canArchive={hasPermission(profile, "jobs.archive")}
          canComplete={hasPermission(profile, "jobs.complete")}
          canClock={Boolean(profile && ["Master Admin", "Administrator", "Manager", "Crew Lead", "Scrub Technician"].includes(profile.role))}
          employeeId={profile?.employee_id ?? null}
          role={profile?.role ?? null}
          canDeletePhotos={Boolean(profile && ["Master Admin", "Administrator", "Manager"].includes(profile.role))}
        />
      )}
      {creating && <DirectJobModal close={() => setCreating(false)} created={async () => { setCreating(false); await load(); setNotice("Job created successfully."); }} />}
      {confirmingDelete && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-[#07190a]/70 p-5">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-cancelled-job-title" className="w-full max-w-lg rounded-2xl bg-white p-6">
            <h2 id="delete-cancelled-job-title" className="text-xl font-extrabold text-red-800">Permanently delete this Cancelled Job?</h2>
            <p className="mt-3 text-sm text-neutral-700">This deletion cannot be undone. Jobs with invoice, payment, service, time, mileage, expense, or other protected history will be retained.</p>
            <p className="mt-3 rounded-xl bg-red-50 p-3 font-bold text-red-800">{confirmingDelete.job_number} — {confirmingDelete.client_name || "Unnamed client"}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button className={secondary} onClick={() => setConfirmingDelete(null)}>Cancel</button>
              <button disabled={busy === confirmingDelete.id} className={danger} onClick={() => void removeCancelledJob(confirmingDelete)}>Confirm Permanent Delete</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
type JobAction = (fn: () => Promise<unknown>, text: string | ((result: unknown) => string), onError?: (detail: string) => void) => void;
function JobCard({ job, open, timeEntries, employeeId, role, canComplete, canDelete, busy, requestDelete, act }: { job: JobWithRelations; open: () => void; timeEntries: TimeEntryWithRelations[]; employeeId: string | null; role: string | null; canComplete: boolean; canDelete: boolean; busy: boolean; requestDelete: () => void; act: JobAction }) {
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const activeEntries = timeEntries.filter((entry) => entry.status === "Open" && !entry.clock_out);
  const currentEntry = employeeId ? activeEntries.find((entry) => entry.employee_id === employeeId) ?? null : null;
  const eligibility = jobLifecycleEligibility(job, employeeId, role);
  const canCardComplete = job.status === "In Progress" && canComplete;
  const canCardEndJob = canComplete;
  const lifecycleAct = (fn: () => Promise<unknown>, text: string) => { setLifecycleError(null); act(fn, text, setLifecycleError); };
  const content = (
    <>
    <div className="grid gap-4 text-left md:grid-cols-[7rem_minmax(0,1.4fr)_minmax(12rem,1fr)_auto] md:items-start">
      <div>
        <p className="text-xl font-extrabold text-[#143d1a]">{formatJobTime(job.start_time)}</p>
        <p className="mt-1 text-xs font-bold text-neutral-500">{job.job_number}</p>
      </div>
      <div className="min-w-0">
        <p className="font-extrabold text-neutral-800">{job.client_name || "Unnamed client"}</p>
        <p className="mt-0.5 text-sm text-neutral-600">{job.property_name || "Property not specified"}</p>
        <p className="mt-2 text-sm font-bold text-[#143d1a]">{job.service_name || "Service not specified"}</p>
      </div>
      <div className="text-sm text-neutral-600">
        <p><span className="font-bold text-neutral-800">Crew:</span> {job.assigned_crew_name || "Unassigned"}</p>
        <p className="mt-1"><span className="font-bold text-neutral-800">Lead:</span> {job.crew_lead_name || "Not assigned"}</p>
        <p className="mt-1 text-xs">{job.financials_available === false ? "Price restricted" : money(job.price)}</p>
      </div>
      <div className="flex flex-wrap gap-2 md:max-w-40 md:justify-end">
        <span className="rounded-full bg-[#edf4ec] px-2.5 py-1 text-[10px] font-bold text-[#143d1a]">{job.division}</span>
        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold text-neutral-700">{job.status}</span>
      </div>
    </div>
    <div className="text-left">
      {job.status === "In Progress" && <JobCardActiveTime job={job} entries={timeEntries} />}
      {job.status === "Completed" && <JobCardCompletedTime job={job} entries={timeEntries} />}
    </div>
    <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
      {eligibility.showStart && <button type="button" disabled={busy} onClick={() => lifecycleAct(() => startOperationalJob(job.id), "Job started. Join the Job separately to begin your payroll time.")} className={`${primary} w-full`}>START JOB</button>}
      {eligibility.canJoin && <button type="button" disabled={busy || Boolean(currentEntry)} onClick={() => lifecycleAct(() => joinJob(job.id), "You joined the Job.")} className={`${currentEntry ? joined : primary} w-full`}>{currentEntry ? "ALREADY JOINED" : "JOIN JOB"}</button>}
      {lifecycleError && <p role="alert" className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{lifecycleError}</p>}
      {canCardComplete && <button type="button" disabled={busy} onClick={() => act(() => completeInProgressJob(job.id), "Job ended by supervisor.")} className={`${primary} w-full`}>END JOB</button>}
      {job.status === "In Progress" && canCardEndJob && activeEntries.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-bold text-amber-800">END JOB will stop payroll for all {activeEntries.length} joined crew {activeEntries.length === 1 ? "member" : "members"}.</p>}
      <button type="button" onClick={open} className={secondary}>MANAGE JOB</button>
      {canDelete && <button type="button" disabled={busy} onClick={requestDelete} className={danger}>PERMANENTLY DELETE</button>}
    </div>
    </>
  );
  if (job.status === "Completed")
    return <JobInvoiceAction jobId={job.id}>{content}</JobInvoiceAction>;
  return (
    <article className="mb-3 rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
      {content}
    </article>
  );
}
function JobCardActiveTime({ job, entries }: { job: JobWithRelations; entries: TimeEntryWithRelations[] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(id); };
  }, []);
  const active = entries.filter((entry) => entry.status === "Open" && !entry.clock_out);
  const startedAt = job.operational_started_at;
  return <div className={`mt-3 rounded-lg p-2 text-xs font-bold ${active.length ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}><p>IN PROGRESS · {active.length ? `${active.length} ${active.length === 1 ? "Tech" : "Techs"} On Job` : "No Techs On Job"}</p>{startedAt ? <><p className="mt-1 font-medium">Started {displayTime(startedAt)}</p><p className="font-medium">Elapsed {shortDuration((now ?? Date.parse(startedAt)) - Date.parse(startedAt))}</p></> : <p className="mt-1 font-medium">Operational start unavailable</p>}</div>;
}
function JobCardCompletedTime({ job, entries }: { job: JobWithRelations; entries: TimeEntryWithRelations[] }) {
  const completedEntries = entries.filter((entry) => ["Completed", "Approved"].includes(entry.status) && Boolean(entry.clock_out));
  const totalLabor = completedEntries.reduce((sum, entry) => sum + Number(entry.total_hours || 0), 0);
  const actualDuration = job.operational_started_at && job.operational_ended_at ? shortDuration(Date.parse(job.operational_ended_at) - Date.parse(job.operational_started_at)) : "—";
  return <div className="mt-3 rounded-lg bg-[#f6f8f5] p-2 text-xs text-neutral-700"><p className="font-extrabold text-[#143d1a]">COMPLETED</p><p className="mt-1">{job.operational_started_at ? `Started ${displayTime(job.operational_started_at)}` : "Start time unavailable"}</p><p>{job.operational_ended_at ? `Ended ${displayTime(job.operational_ended_at)}` : "End time unavailable"}</p><p className="mt-1">Actual {actualDuration} · Total labor {shortDuration(totalLabor * 3_600_000)}</p></div>;
}
function JobModal({
  job,
  busy,
  close,
  mutate,
  canEdit,
  canSchedule,
  canArchive,
  canComplete,
  canClock,
  employeeId,
  role,
  canDeletePhotos,
}: {
  job: JobWithRelations;
  busy: boolean;
  close: () => void;
  mutate: JobAction;
  canEdit: boolean;
  canSchedule: boolean;
  canArchive: boolean;
  canComplete: boolean;
  canClock: boolean;
  employeeId: string | null;
  role: string | null;
  canDeletePhotos: boolean;
}) {
  const [date, setDate] = useState(job.scheduled_date ?? "");
  const [time, setTime] = useState(job.start_time?.slice(0, 5) ?? "");
  const [duration, setDuration] = useState(job.estimated_duration ?? 0);
  const [crews, setCrews] = useState<CrewWithRelations[]>([]);
  const [crewId, setCrewId] = useState(job.assigned_crew_id ?? "");
  const [warning, setWarning] = useState<string | null>(null);
  const [clock, setClock] = useState<Awaited<ReturnType<typeof getCurrentJobClockState>> | null>(null);
  const [clockError, setClockError] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [tab, setTab] = useState<"Overview" | "Scope" | "Discoveries" | "Changes" | "Timeline">("Overview");
  const [changePrefill, setChangePrefill] = useState<VisibleFieldDiscovery | null>(null);
  const [discoveryPrefill, setDiscoveryPrefill] = useState<string | null>(null);
  async function refreshClock() {
    if (!canClock && !canComplete) { setClock(null); return; }
    try { setClock(await getCurrentJobClockState(job.id)); setClockError(null); }
    catch (cause) { console.error("Job clock state load failed", cause); setClockError(message(cause, "Time clock state could not be loaded.")); }
  }
  useEffect(() => {
    if (!canClock && !canComplete) return;
    let active = true;
    void getCurrentJobClockState(job.id)
      .then((next) => { if (active) { setClock(next); setClockError(null); } })
      .catch((cause: unknown) => { if (active) { console.error("Job clock state load failed", cause); setClockError(message(cause, "Time clock state could not be loaded.")); } });
    return () => { active = false; };
  }, [job.id, job.status, canClock, canComplete]);
  useOperationalRealtime(["time_entries"], refreshClock);
  useEffect(() => {
    void getActiveCrews()
      .then(setCrews)
      .catch((x: unknown) => {
        console.error("Crew load failed", x);
        setWarning("Active crews could not be loaded.");
      });
  }, []);
  function status(next: JobStatus) {
    if (next === "Scheduled" && !job.scheduled_date) return;
    mutate(() => updateJobStatus(job.id, next), `Job moved to ${next}.`);
  }
  async function assign() {
    const crew = crews.find((c) => c.id === crewId);
    if (!crew) return;
    const conflicts = await getCrewConflicts(
      job.id,
      crew.id,
      date,
      time || null,
    );
    setWarning(
      conflicts.length
        ? "This crew may already be assigned during this time."
        : null,
    );
    await assignJobCrew(job.id, crew, Boolean(job.scheduled_date || date));
  }
  const eligibility = jobLifecycleEligibility(job, employeeId, role);
  const canSupervisorComplete = canComplete;
  const showLifecycle = ["Scheduled", "Crew Assigned", "In Progress"].includes(job.status)
    && (eligibility.showStart || (canClock && eligibility.canJoin) || (job.status === "In Progress" && canSupervisorComplete));
  const lifecycleAct = (fn: () => Promise<unknown>, text: string) => { setLifecycleError(null); mutate(fn, text, setLifecycleError); };
  return (
    <Modal title={job.job_number} close={close}>
      <div className="mb-5 flex gap-2 border-b border-neutral-200" role="tablist" aria-label="Job details">
        {(["Overview", "Scope", "Discoveries", "Changes", "Timeline"] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`border-b-2 px-3 py-2 text-sm font-bold ${tab === item ? "border-[#9a7a17] text-[#143d1a]" : "border-transparent text-neutral-500"}`}>{item}</button>
        ))}
      </div>
      {tab === "Overview" ? <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Details
          title="Relationships"
          rows={[
            ["Client", job.client_name || "—"],
            ["Property", job.property_name || "—"],
            ["Proposal", job.proposal?.proposal_number ?? "—"],
            ["Estimate", job.estimate_id || "—"],
            ["Walkthrough", job.walkthrough_id || "—"],
          ]}
        />
        <Details
          title="Service"
          rows={[
            ["Service", job.service_name || "—"],
            ["Frequency", job.frequency],
            ["Division", job.division],
            ["Price", job.financials_available === false ? "Restricted" : money(job.price)],
            ["Labor Hours", String(job.labor_hours)],
            ["Recommended Crew", String(job.recommended_crew_size)],
          ]}
        />
      </div>
      {((job.contracted_addons??job.pricing_snapshot?.addons)?.length??0)>0?<><h3 className="mt-6 font-extrabold text-[#143d1a]">Purchased Add-Ons</h3><ul className="mt-2 list-disc pl-5 text-sm">{(job.contracted_addons??job.pricing_snapshot!.addons).map((item)=><li key={item.id}>{item.pricingType==="Per Unit"?`${item.label} — ${item.quantity} ${item.unitName}${item.quantity===1?"":"s"}`:item.label}</li>)}</ul></>:(job.proposal?.result.adjustments??[]).length>0&&<><h3 className="mt-6 font-extrabold text-[#143d1a]">Purchased Add-Ons</h3><ul className="mt-2 list-disc pl-5 text-sm">{(job.proposal?.result.adjustments??[]).map((item)=><li key={item.id}>{item.label}</li>)}</ul></>}
      <h3 className="mt-6 font-extrabold text-[#143d1a]">Operational Scope / Instructions</h3>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {job.scope.map((x) => (
          <li key={x.id}>{x.text}</li>
        ))}
      </ul>
      {canSchedule && !["Completed", "Cancelled", "Archived"].includes(job.status) && <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <Field label="Scheduled Date" type="date" value={date} set={setDate} />
        <Field label="Start Time" type="time" value={time} set={setTime} />
        <Field
          label="Estimated Duration"
          type="number"
          value={String(duration)}
          set={(v) => setDuration(Number(v))}
        />
        <button
          disabled={busy}
          onClick={() =>
            mutate(
              () =>
                scheduleJob(job.id, date, time, duration || null, job.status),
              "Schedule saved.",
            )
          }
          className={primary}
        >
          Save Schedule
        </button>
      </section>}
      {canSchedule && (job.status === "Ready to Schedule" ||
        job.status === "Scheduled" ||
        job.status === "Crew Assigned") && (
        <section className="mt-6">
          <label className="text-sm font-bold">
            Assigned Crew
            <select
              className={`${input} mt-2`}
              value={crewId}
              onChange={(e) => setCrewId(e.target.value)}
            >
              <option value="">Select active crew</option>
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.crew_name}
                </option>
              ))}
            </select>
          </label>
          {warning && (
            <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">
              {warning}
            </p>
          )}
          <button
            disabled={busy || !crewId}
            onClick={() => mutate(assign, "Crew assignment saved.")}
            className={`${primary} mt-3`}
          >
            Assign Crew
          </button>
        </section>
      )}
      <Details
        title="Crew Snapshot"
        rows={[
          ["Assigned Crew", job.assigned_crew_name || "—"],
          ["Crew Lead", job.crew_lead_name || "—"],
          ["Assigned Team", job.assigned_team.join(", ") || "—"],
        ]}
      />
      <Details
        title="Job Notes"
        rows={[
          ["Access", job.access_instructions || "—"],
          ["Internal Notes", job.internal_notes || "—"],
          ["Status", job.status],
          [
            "Completed",
            job.completed_at
              ? new Date(job.completed_at).toLocaleString()
              : "—",
          ],
        ]}
      />
      <PhotoUploader recordType="jobs" recordId={job.id} categories={jobPhotoCategories} canDelete={canDeletePhotos} title="Finished Photos & Job Documentation" featuredCategory="After" featuredTitle="Finished Photos" cameraLabel="Take Finished Photo" libraryLabel="Upload Finished Photos" uploadLabel="Save Finished / Job Photos" />
      <JobMileageSummary jobId={job.id} />
      <JobTimeSummary job={job} />
      <JobCalendarStatus jobId={job.id} />
      {job.financials_available !== false && <JobLaborSummary jobId={job.id} estimatedHours={job.labor_hours} estimatedCost={Math.max(0, job.price - (job.proposal?.result.estimatedProfit ?? 0))} price={job.price} />}
      {showLifecycle && (
        <section className="mt-6 rounded-xl border border-[#143d1a]/20 bg-[#f6f8f5] p-4">
          <h3 className="font-extrabold text-[#143d1a]">Job Lifecycle</h3>
          {clockError && <p role="alert" className="mt-2 text-sm font-bold text-red-700">{clockError}</p>}
          {eligibility.showStart && <button disabled={busy} className={`${primary} mt-3`} onClick={() => lifecycleAct(() => startOperationalJob(job.id), "Job started. Join the Job separately to begin your payroll time.")}>START JOB</button>}
          {canClock && eligibility.canJoin && !clockError && (
            <>
              <button
                disabled={busy || clock === null || Boolean(clock?.clockedIn)}
                className={`${clock?.clockedIn ? joined : primary} mt-3`}
                onClick={() => lifecycleAct(() => joinJob(job.id), "You joined the Job.")}
              >
                {clock?.clockedIn ? "ALREADY JOINED" : "JOIN JOB"}
              </button>
              {clock?.clockedIn && <p className="mt-2 text-sm text-neutral-700">On Job since {clock.clockedInAt ? new Date(clock.clockedInAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</p>}
            </>
          )}
          {lifecycleError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{lifecycleError}</p>}
          {job.status === "In Progress" && clock && <p className="mt-2 text-xs text-neutral-500">Crew members currently on Job: {clock.activeWorkerCount}</p>}
          {job.status === "In Progress" && canSupervisorComplete && clock && clock.activeWorkerCount > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">END JOB will stop payroll for all {clock.activeWorkerCount} joined crew {clock.activeWorkerCount === 1 ? "member" : "members"} at the same time.</p>}
          {job.status === "In Progress" && canSupervisorComplete && <button disabled={busy} onClick={() => mutate(() => completeInProgressJob(job.id), "Job ended. Payroll stopped for everyone joined, who remain Active on the platform.")} className={`${primary} mt-3`}>END JOB</button>}
        </section>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        <ContractServiceRecordAction jobId={job.id} />
        {canEdit && nextStatuses(job.status).filter((next) => next !== "In Progress" && next !== "Completed").map((x) => (
          <button
            key={x}
            disabled={busy}
            onClick={() => status(x)}
            className={secondary}
          >
            {x}
          </button>
        ))}
        {canEdit && !["Cancelled", "Archived"].includes(job.status) && (
          <button
            disabled={busy}
            onClick={() => {
              const note = window.prompt("Cancellation note") ?? "";
              mutate(() => cancelJob(job.id, note), "Job cancelled.");
            }}
            className={secondary}
          >
            Cancel
          </button>
        )}
        {canArchive && job.status !== "Archived" && (
          <button
            disabled={busy}
            onClick={() => mutate(() => archiveJob(job.id), "Job archived.")}
            className={secondary}
          >
            Archive
          </button>
        )}
      </div>
      </> : tab === "Scope" ? <JobScopePanel jobId={job.id} recordDiscovery={(question) => { setDiscoveryPrefill(question); setTab("Discoveries"); }} /> : tab === "Discoveries" ? <JobDiscoveriesPanel jobId={job.id} role={role} prefillDescription={discoveryPrefill} clearPrefill={() => setDiscoveryPrefill(null)} createChange={(discovery) => { setChangePrefill(discovery); setTab("Changes"); }} /> : tab === "Changes" ? <JobChangesPanel jobId={job.id} role={role} prefill={changePrefill} clearPrefill={() => setChangePrefill(null)} /> : <JobTimelinePanel jobId={job.id} role={role} />}
    </Modal>
  );
}
function JobScopePanel({ jobId, recordDiscovery }: { jobId: string; recordDiscovery: (question: string) => void }) {
  const [scope, setScope] = useState<JobScopeV1 | null>(null);
  const [loadingScope, setLoadingScope] = useState(true);
  const [scopeError, setScopeError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getJobScopeV1(jobId)
      .then((next) => { if (active) { setScope(next); setScopeError(null); } })
      .catch((cause: unknown) => { if (active) { console.error("Job Scope V1 load failed", cause); setScopeError("The locked scope could not be loaded."); } })
      .finally(() => { if (active) setLoadingScope(false); });
    return () => { active = false; };
  }, [jobId]);

  if (loadingScope) return <p className="rounded-xl border bg-[#f6f8f5] p-4 text-sm text-neutral-600">Loading locked scope…</p>;
  if (scopeError) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{scopeError}</p>;
  if (!scope) return null;
  if (!scope.snapshot && scope.items.length === 0) return <section><p className="rounded-xl border bg-[#f6f8f5] p-4 text-sm text-neutral-600">No locked scope snapshot is available for this Job.</p><ScopeAdvisory jobId={jobId} recordDiscovery={recordDiscovery}/><AuthorizedChanges jobId={jobId}/></section>;

  const groups = scope.items.reduce<Record<string, JobScopeItem[]>>((result, item) => {
    (result[item.item_type] ??= []).push(item);
    return result;
  }, {});
  const groupNames = ["Service", "Scope", "Add-On", ...Object.keys(groups).filter((name) => !["Service", "Scope", "Add-On"].includes(name))];
  const pricing = scope.snapshot?.pricing ?? {};
  const pricingRows = [
    ["Base estimate", pricingNumber(pricing.baseEstimateAmount)],
    ["Additional labor", pricingNumber(pricing.additionalLabor)],
    ["Additional materials", pricingNumber(pricing.additionalMaterials)],
    ["Manual discount", pricingNumber(pricing.manualDiscount)],
    ["Taxes", pricingNumber(pricing.taxes)],
    ["Per-visit total", pricingNumber(pricing.perVisitTotal)],
    ["Monthly total", pricingNumber(pricing.monthlyTotal)],
  ] as const;

  return <section>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-lg font-extrabold text-[#143d1a]">Accepted Scope — V{scope.snapshot?.version ?? 1}</h3>
        <p className="mt-1 text-sm text-neutral-600">This is the scope accepted by the client when the Proposal became the Job.</p>
      </div>
      <span className="rounded-full border border-[#9a7a17]/40 bg-amber-50 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#71570c]">Locked</span>
    </div>
    {scope.snapshot && <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500"><span>{scope.snapshot.snapshot_type}</span>{scope.snapshot.accepted_at && <span>Accepted {new Date(scope.snapshot.accepted_at).toLocaleString()}</span>}</div>}
    <ScopeAdvisory jobId={jobId} recordDiscovery={recordDiscovery} />
    <div className="mt-5 grid gap-4">
      {groupNames.filter((name) => groups[name]?.length).map((name) => <section key={name} className="rounded-xl border border-neutral-200 bg-white p-4">
        <h4 className="font-extrabold text-[#143d1a]">{name}</h4>
        <div className="mt-3 grid gap-3">{groups[name].map((item) => <article key={item.id} className="rounded-lg bg-[#f6f8f5] p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-bold text-neutral-900">{item.name}</p>{scope.financialsAvailable && item.line_total != null && <p className="font-extrabold text-[#143d1a]">{money(item.line_total)}</p>}</div>
          {item.description && <p className="mt-1 text-neutral-600">{item.description}</p>}
          {(item.quantity !== null || (scope.financialsAvailable && item.unit_price != null)) && <p className="mt-2 text-xs text-neutral-500">{item.quantity !== null && <>Quantity: {item.quantity}{item.unit ? ` ${item.unit}` : ""}</>}{item.quantity !== null && scope.financialsAvailable && item.unit_price != null && " · "}{scope.financialsAvailable && item.unit_price != null && <>Unit price: {money(item.unit_price)}</>}</p>}
        </article>)}</div>
      </section>)}
    </div>
    {scope.financialsAvailable && pricingRows.some(([, value]) => value !== null) && <section className="mt-5 rounded-xl border border-[#143d1a]/20 bg-[#f6f8f5] p-4"><h4 className="font-extrabold text-[#143d1a]">Accepted Pricing</h4><dl className="mt-3 grid gap-2 sm:grid-cols-2">{pricingRows.filter(([, value]) => value !== null).map(([label, value]) => <div key={label} className="flex justify-between gap-4 text-sm"><dt className="text-neutral-600">{label}</dt><dd className="font-bold text-neutral-900">{money(value!)}</dd></div>)}</dl></section>}
    <AuthorizedChanges jobId={jobId} />
    {scope.snapshot?.proposal_notes && <section className="mt-5 rounded-xl border border-neutral-200 bg-white p-4"><h4 className="font-extrabold text-[#143d1a]">Proposal Notes</h4><p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{scope.snapshot.proposal_notes}</p></section>}
  </section>;
}
function AuthorizedChanges({jobId}:{jobId:string}){const[changes,setChanges]=useState<VisibleChangeRequest[]|null>(null);useEffect(()=>{let active=true;void getChangeRequestsForJob(jobId).then((rows)=>{if(active)setChanges(rows.filter(row=>row.status==="Approved"))}).catch((cause)=>console.error("Authorized Changes load failed",cause));return()=>{active=false}},[jobId]);if(!changes?.length)return null;return <section className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4"><h4 className="font-extrabold text-green-900">Authorized Changes</h4><div className="mt-3 grid gap-3">{changes.map(change=><article key={change.id} className="rounded-lg bg-white p-3 text-sm"><div className="flex justify-between gap-3"><b className="text-[#143d1a]">{change.change_request_number} — Approved</b>{change.price_impact!=null&&<b>{money(change.price_impact)}</b>}</div><p className="mt-1">{change.title}</p>{change.area&&<p className="text-neutral-500">{change.area}</p>}<p className="text-neutral-500">+{change.time_impact_minutes} minutes</p></article>)}</div></section>}
function ScopeAdvisory({jobId,recordDiscovery}:{jobId:string;recordDiscovery:(question:string)=>void}){const[question,setQuestion]=useState(""),[result,setResult]=useState<ScopeAdvisoryResult|null>(null),[checking,setChecking]=useState(false),[error,setError]=useState<string|null>(null);async function check(){setChecking(true);setError(null);try{setResult(await checkScopeAdvisory(jobId,question))}catch(cause){setResult(null);setError(message(cause,"The scope check could not be completed."))}finally{setChecking(false)}}const needsDiscovery=result?.classification==="Possibly Included"||result?.classification==="Not Clearly Included";return <section className="mt-5 rounded-xl border border-[#d4af37]/40 bg-amber-50/50 p-4"><h4 className="font-extrabold text-[#143d1a]">Was This Included?</h4><p className="mt-1 text-sm text-neutral-600">Describe the work or condition you found and compare it with the locked scope and approved changes.</p><textarea className={`${input} mt-3 min-h-24`} value={question} onChange={event=>setQuestion(event.target.value)} placeholder="Describe the work or condition…"/><button type="button" disabled={checking||question.trim().length<5} onClick={()=>void check()} className={`${primary} mt-3`}>{checking?"Checking…":"Check Scope"}</button>{error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}{result&&<div className="mt-4 rounded-xl border bg-white p-4"><span className={`rounded-full px-3 py-1 text-xs font-extrabold ${result.classification==="Clearly Included"?"bg-green-100 text-green-800":result.classification==="Possibly Included"?"bg-amber-100 text-amber-800":"bg-neutral-200 text-neutral-800"}`}>{result.classification}</span><p className="mt-3 text-sm text-neutral-700">{result.summary}</p>{result.matches.length>0&&<div className="mt-4"><h5 className="text-sm font-extrabold text-[#143d1a]">Relevant matches</h5><div className="mt-2 grid gap-2">{result.matches.map((match,index)=><article key={`${match.sourceType}-${match.sourceId}-${index}`} className="rounded-lg bg-[#f6f8f5] p-3 text-sm"><p className="text-xs font-extrabold uppercase tracking-wide text-[#9a7a17]">{match.sourceType}</p><p className="mt-1 font-bold">{match.title}</p>{match.area&&<p className="text-neutral-500">Area: {match.area}</p>}{match.description&&<p className="mt-1 text-neutral-600">{match.description}</p>}<p className="mt-2 text-xs text-neutral-500">{match.matchReason}</p></article>)}</div></div>}<p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">{result.advisoryNotice}</p>{needsDiscovery&&<button type="button" className={`${secondary} mt-3`} onClick={()=>recordDiscovery(question.trim())}>Record Field Discovery</button>}</div>}</section>}
function JobDiscoveriesPanel({ jobId, role, prefillDescription, clearPrefill, createChange }: { jobId: string; role: string | null; prefillDescription: string | null; clearPrefill: () => void; createChange: (discovery: VisibleFieldDiscovery) => void }) {
  const [discoveries, setDiscoveries] = useState<VisibleFieldDiscovery[]>([]);
  const [media, setMedia] = useState<Record<string, FieldDiscoveryMediaWithUrl[]>>({});
  const [loadingDiscoveries, setLoadingDiscoveries] = useState(true);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [notice, setDiscoveryNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(Boolean(prefillDescription));
  const [savingDiscovery, setSavingDiscovery] = useState(false);
  const [area, setArea] = useState("");
  const [description, setDescription] = useState(prefillDescription ?? "");
  const [minutes, setMinutes] = useState("");
  const [amount, setAmount] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const mayCreate = canCreateFieldDiscovery(role);
  const mayReview = canReviewFieldDiscovery(role);
  const isMaster = role === "Master Admin";

  async function loadDiscoveries() {
    const next = await getFieldDiscoveriesForJob(jobId);
    const mediaPairs = await Promise.all(next.map(async (item) => [item.id, await getFieldDiscoveryMedia(item.id)] as const));
    setDiscoveries(next);
    setMedia(Object.fromEntries(mediaPairs));
  }
  useEffect(() => {
    let active = true;
    void getFieldDiscoveriesForJob(jobId).then(async (next) => {
      const mediaPairs = await Promise.all(next.map(async (item) => [item.id, await getFieldDiscoveryMedia(item.id)] as const));
      if (active) { setDiscoveries(next); setMedia(Object.fromEntries(mediaPairs)); setDiscoveryError(null); }
    }).catch((cause: unknown) => { if (active) { console.error("Field Discoveries load failed", cause); setDiscoveryError("Field Discoveries could not be loaded."); } }).finally(() => { if (active) setLoadingDiscoveries(false); });
    return () => { active = false; };
  }, [jobId]);

  async function submitDiscovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!description.trim()) return setDiscoveryError("Description is required.");
    setSavingDiscovery(true); setDiscoveryError(null); setDiscoveryNotice(null);
    let discoveryId: string | null = null;
    try {
      discoveryId = await createFieldDiscovery({ jobId, area: area.trim() || null, description: description.trim(), estimatedExtraMinutes: minutes === "" ? null : Number(minutes), estimatedExtraAmount: isMaster && amount !== "" ? Number(amount) : null });
      if (files.length) await uploadFieldDiscoveryMedia(discoveryId, files);
      await loadDiscoveries();
      setArea(""); setDescription(""); setMinutes(""); setAmount(""); setFiles([]); setShowForm(false); clearPrefill();
      setDiscoveryNotice("Field Discovery saved.");
    } catch (cause) {
      console.error("Field Discovery save failed", cause);
      if (discoveryId) {
        try { await loadDiscoveries(); } catch (refreshCause) { console.error("Field Discovery refresh failed", refreshCause); }
        setDiscoveryError(`The discovery was saved, but some media could not be uploaded. ${message(cause, "Retry the photo upload later.")}`);
      } else setDiscoveryError(message(cause, "The Field Discovery could not be saved."));
    } finally { setSavingDiscovery(false); }
  }

  async function changeStatus(id: string, status: Exclude<FieldDiscoveryStatus, "Converted to Change Request">) {
    try { await updateFieldDiscoveryStatus(id, status); await loadDiscoveries(); setDiscoveryError(null); }
    catch (cause) { console.error("Field Discovery status update failed", cause); setDiscoveryError(message(cause, "The discovery status could not be updated.")); }
  }

  return <section>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-extrabold text-[#143d1a]">Field Discoveries</h3><p className="mt-1 text-sm text-neutral-600">Document unexpected conditions or work found on site. A discovery does not authorize additional work.</p></div>{mayCreate && <button type="button" className={primary} onClick={() => setShowForm((current) => !current)}>+ Add Discovery</button>}</div>
    {discoveryError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{discoveryError}</p>}
    {notice && <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</p>}
    {showForm && <form onSubmit={submitDiscovery} className="mt-5 grid gap-4 rounded-xl border border-[#143d1a]/20 bg-[#f6f8f5] p-4 sm:grid-cols-2">
      <label className="text-sm font-bold">Area<input className={`${input} mt-2`} value={area} onChange={(event) => setArea(event.target.value)} placeholder="Optional area or room" /></label>
      <label className="text-sm font-bold">Estimated Extra Time (minutes)<input className={`${input} mt-2`} type="number" min="0" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
      {isMaster && <label className="text-sm font-bold">Estimated Extra Amount<input className={`${input} mt-2`} type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>}
      <label className="text-sm font-bold">Photos<input className={`${input} mt-2`} type="file" accept="image/*" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>
      <label className="text-sm font-bold sm:col-span-2">Description<textarea className={`${input} mt-2 min-h-28`} required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="flex gap-2 sm:col-span-2"><button className={primary} disabled={savingDiscovery}>{savingDiscovery ? "Saving…" : "Save Discovery"}</button><button type="button" className={secondary} disabled={savingDiscovery} onClick={() => { setShowForm(false); clearPrefill(); }}>Cancel</button></div>
    </form>}
    {loadingDiscoveries ? <p className="mt-5 rounded-xl border bg-[#f6f8f5] p-4 text-sm text-neutral-600">Loading Field Discoveries…</p> : discoveries.length === 0 ? <p className="mt-5 rounded-xl border bg-[#f6f8f5] p-4 text-sm text-neutral-600">No field discoveries have been recorded for this Job.</p> : <div className="mt-5 grid gap-4">{discoveries.map((item) => <article key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-[#71570c]">{item.status}</span>{item.area && <h4 className="mt-3 font-extrabold text-[#143d1a]">{item.area}</h4>}</div><time className="text-xs text-neutral-500">{new Date(item.created_at).toLocaleString()}</time></div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-800">{item.description}</p>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-600">{item.estimated_extra_minutes !== null && <span>Estimated extra time: {item.estimated_extra_minutes} minutes</span>}{isMaster && item.estimated_extra_amount != null && <span>Estimated extra amount: {money(item.estimated_extra_amount)}</span>}</div>
      {(media[item.id]?.length ?? 0) > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{media[item.id].map((photo) => <a key={photo.id} href={photo.signedUrl ?? undefined} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border bg-neutral-100">{photo.signedUrl ? <img src={photo.signedUrl} alt="Field Discovery" className="aspect-[4/3] size-full object-cover" /> : <span className="grid aspect-[4/3] place-items-center p-2 text-xs text-neutral-500">Preview unavailable</span>}</a>)}</div>}
      {mayReview && <div className="mt-4 flex flex-wrap gap-2">{(["Open", "Reviewed", "Dismissed"] as const).filter((status) => status !== item.status).map((status) => <button key={status} type="button" className={secondary} onClick={() => void changeStatus(item.id, status)}>Mark {status}</button>)}</div>}
      {mayReview && (item.status === "Open" || item.status === "Reviewed") && <button type="button" className={`${primary} mt-3`} onClick={() => createChange(item)}>Create Change Request</button>}
    </article>)}</div>}
  </section>;
}
function JobChangesPanel({ jobId, role, prefill, clearPrefill }: { jobId:string; role:string|null; prefill:VisibleFieldDiscovery|null; clearPrefill:()=>void }) {
  const [requests,setRequests]=useState<VisibleChangeRequest[]>([]),[loadingChanges,setLoadingChanges]=useState(true),[changeError,setChangeError]=useState<string|null>(null),[changeNotice,setChangeNotice]=useState<string|null>(null),[showCreate,setShowCreate]=useState(Boolean(prefill)),[saving,setSaving]=useState(false);
  const [title,setTitle]=useState(prefill?`Additional work${prefill.area?` — ${prefill.area}`:""}`:""),[description,setChangeDescription]=useState(prefill?.description??""),[area,setChangeArea]=useState(prefill?.area??""),[timeImpact,setTimeImpact]=useState(prefill?.estimated_extra_minutes?.toString()??"0"),[priceImpact,setPriceImpact]=useState(role==="Master Admin"&&prefill?.estimated_extra_amount!=null?String(prefill.estimated_extra_amount):"0");
  const mayManage=canManageChangeRequests(role),isMaster=role==="Master Admin";
  async function loadChanges(){setRequests(await getChangeRequestsForJob(jobId));}
  useEffect(()=>{let active=true;void getChangeRequestsForJob(jobId).then((next)=>{if(active){setRequests(next);setChangeError(null)}}).catch((cause:unknown)=>{if(active){console.error("Change Requests load failed",cause);setChangeError("Change Requests could not be loaded.")}}).finally(()=>{if(active)setLoadingChanges(false)});return()=>{active=false}},[jobId]);
  async function create(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setSaving(true);setChangeError(null);try{await createChangeRequest({jobId,fieldDiscoveryId:prefill?.id??null,title,description,area:area||null,priceImpact:isMaster?Number(priceImpact||0):0,timeImpactMinutes:Number(timeImpact||0)});await loadChanges();setShowCreate(false);setTitle("");setChangeDescription("");setChangeArea("");setTimeImpact("0");setPriceImpact("0");clearPrefill();setChangeNotice("Draft Change Request created.")}catch(cause){console.error("Change Request creation failed",cause);setChangeError(message(cause,"The Change Request could not be created."))}finally{setSaving(false)}}
  async function send(id:string){try{await sendChangeRequest(id);await loadChanges();setChangeError(null);setChangeNotice("Change Request sent and commercial terms locked.")}catch(cause){setChangeError(message(cause,"The Change Request could not be sent."))}}
  function clientUrl(request:VisibleChangeRequest){return request.public_token?`${window.location.origin}/change-request/${request.public_token}`:null}
  return <section><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-extrabold text-[#143d1a]">Change Requests</h3><p className="mt-1 text-sm text-neutral-600">Formal additional work requests sent to the client for approval.</p></div>{mayManage&&!showCreate&&<button className={primary} onClick={()=>setShowCreate(true)}>+ Create Change Request</button>}</div>
    {changeError&&<p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{changeError}</p>}{changeNotice&&<p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{changeNotice}</p>}
    {showCreate&&mayManage&&<form onSubmit={create} className="mt-5 grid gap-4 rounded-xl border border-[#143d1a]/20 bg-[#f6f8f5] p-4 sm:grid-cols-2"><label className="text-sm font-bold">Title<input required className={`${input} mt-2`} value={title} onChange={(event)=>setTitle(event.target.value)}/></label><label className="text-sm font-bold">Area<input className={`${input} mt-2`} value={area} onChange={(event)=>setChangeArea(event.target.value)}/></label><label className="text-sm font-bold">Time Impact (minutes)<input type="number" min="0" step="1" className={`${input} mt-2`} value={timeImpact} onChange={(event)=>setTimeImpact(event.target.value)}/></label>{isMaster&&<label className="text-sm font-bold">Price Impact<input type="number" min="0" step="0.01" className={`${input} mt-2`} value={priceImpact} onChange={(event)=>setPriceImpact(event.target.value)}/></label>}<label className="text-sm font-bold sm:col-span-2">Description<textarea required className={`${input} mt-2 min-h-28`} value={description} onChange={(event)=>setChangeDescription(event.target.value)}/></label><div className="flex gap-2 sm:col-span-2"><button disabled={saving} className={primary}>{saving?"Saving…":"Create Draft"}</button><button type="button" className={secondary} onClick={()=>{setShowCreate(false);clearPrefill()}}>Cancel</button></div></form>}
    {loadingChanges?<p className="mt-5 rounded-xl border bg-[#f6f8f5] p-4 text-sm text-neutral-600">Loading Change Requests…</p>:requests.length===0?<p className="mt-5 rounded-xl border bg-[#f6f8f5] p-4 text-sm text-neutral-600">No Change Requests have been created for this Job.</p>:<div className="mt-5 grid gap-4">{requests.map((request)=><article key={request.id} className="rounded-xl border border-neutral-200 bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="text-xs font-extrabold uppercase tracking-wide text-[#9a7a17]">{request.change_request_number}</p><h4 className="mt-1 font-extrabold text-[#143d1a]">{request.title}</h4></div><span className="h-fit rounded-full bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-[#71570c]">{request.status}</span></div>{request.area&&<p className="mt-2 text-sm font-bold text-neutral-600">Area: {request.area}</p>}<p className="mt-3 whitespace-pre-wrap text-sm text-neutral-700">{request.description}</p><div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-500"><span>Time impact: {request.time_impact_minutes} minutes</span>{isMaster&&request.price_impact!=null&&<span>Price impact: {money(request.price_impact)}</span>}<span>Created {new Date(request.created_at).toLocaleString()}</span>{request.sent_at&&<span>Sent {new Date(request.sent_at).toLocaleString()}</span>}{request.decided_at&&<span>Decided {new Date(request.decided_at).toLocaleString()}</span>}</div>{isMaster&&request.items&&request.items.length>0&&<div className="mt-4 grid gap-2">{request.items.map((item)=><div key={item.id} className="flex justify-between rounded-lg bg-[#f6f8f5] p-3 text-sm"><span>{item.description}{item.quantity!=null?` — ${item.quantity}${item.unit?` ${item.unit}`:""}`:""}</span>{item.line_total!=null&&<b>{money(item.line_total)}</b>}</div>)}</div>}{isMaster&&request.status==="Draft"&&<MasterChangeDraftControls request={request} refresh={loadChanges} fail={setChangeError}/>} {isMaster&&request.status==="Draft"&&<button className={`${primary} mt-4`} onClick={()=>void send(request.id)}>Send Change Request</button>}{isMaster&&request.status!=="Draft"&&clientUrl(request)&&<div className="mt-4 flex gap-2"><button className={secondary} onClick={()=>void navigator.clipboard.writeText(clientUrl(request)!)}>Copy Client Link</button><a className={secondary} href={clientUrl(request)!} target="_blank" rel="noreferrer">Open Client Link</a></div>}</article>)}</div>}
  </section>
}
function MasterChangeDraftControls({request,refresh,fail}:{request:VisibleChangeRequest;refresh:()=>Promise<void>;fail:(value:string|null)=>void}){const[editing,setEditing]=useState(false),[title,setTitle]=useState(request.title),[description,setDescription]=useState(request.description),[area,setArea]=useState(request.area??""),[price,setPrice]=useState(String(request.price_impact??0)),[minutes,setMinutes]=useState(String(request.time_impact_minutes)),[itemDescription,setItemDescription]=useState(""),[quantity,setQuantity]=useState(""),[unit,setUnit]=useState(""),[unitPrice,setUnitPrice]=useState(""),[lineTotal,setLineTotal]=useState("");async function saveTerms(){try{await updateChangeRequestDraft({id:request.id,title,description,area:area||null,priceImpact:Number(price||0),timeImpactMinutes:Number(minutes||0)});await refresh();setEditing(false);fail(null)}catch(cause){fail(message(cause,"Draft terms could not be saved."))}}async function addItem(){try{await addChangeRequestItem(request.id,{description:itemDescription,quantity:quantity===""?null:Number(quantity),unit:unit||null,unit_price:unitPrice===""?null:Number(unitPrice),line_total:lineTotal===""?null:Number(lineTotal)});await refresh();setItemDescription("");setQuantity("");setUnit("");setUnitPrice("");setLineTotal("");fail(null)}catch(cause){fail(message(cause,"The line item could not be added."))}}return <div className="mt-4 rounded-lg border border-[#143d1a]/20 p-3">{editing?<div className="grid gap-2 sm:grid-cols-2"><input className={input} value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="Title"/><input className={input} value={area} onChange={(e)=>setArea(e.target.value)} placeholder="Area"/><input className={input} type="number" min="0" step="0.01" value={price} onChange={(e)=>setPrice(e.target.value)} placeholder="Price impact"/><input className={input} type="number" min="0" step="1" value={minutes} onChange={(e)=>setMinutes(e.target.value)} placeholder="Time impact"/><textarea className={`${input} sm:col-span-2`} value={description} onChange={(e)=>setDescription(e.target.value)}/><button className={primary} onClick={()=>void saveTerms()}>Save Terms</button><button className={secondary} onClick={()=>setEditing(false)}>Cancel</button></div>:<button className={secondary} onClick={()=>setEditing(true)}>Edit Terms / Pricing</button>}<div className="mt-4 grid gap-2 sm:grid-cols-5"><input className={`${input} sm:col-span-2`} value={itemDescription} onChange={(e)=>setItemDescription(e.target.value)} placeholder="Line item description"/><input className={input} type="number" min="0" value={quantity} onChange={(e)=>setQuantity(e.target.value)} placeholder="Qty"/><input className={input} value={unit} onChange={(e)=>setUnit(e.target.value)} placeholder="Unit"/><input className={input} type="number" min="0" step="0.01" value={unitPrice} onChange={(e)=>setUnitPrice(e.target.value)} placeholder="Unit price"/><input className={input} type="number" min="0" step="0.01" value={lineTotal} onChange={(e)=>setLineTotal(e.target.value)} placeholder="Line total"/><button disabled={!itemDescription.trim()} className={secondary} onClick={()=>void addItem()}>Add Line Item</button></div></div>}
function JobTimelinePanel({jobId,role}:{jobId:string;role:string|null}){const[timeline,setTimeline]=useState<JobScopeTimeline|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[showForm,setShowForm]=useState(false),[saving,setSaving]=useState(false),[evidenceType,setEvidenceType]=useState<JobEvidenceType>("During"),[area,setArea]=useState(""),[description,setDescription]=useState(""),[changeId,setChangeId]=useState(""),[discoveryId,setDiscoveryId]=useState(""),[files,setFiles]=useState<File[]>([]);const mayCreate=canCreateJobEvidence(role);async function load(){setTimeline(await getJobScopeTimeline(jobId))}useEffect(()=>{let active=true;void getJobScopeTimeline(jobId).then(value=>{if(active){setTimeline(value);setError(null)}}).catch(cause=>{if(active){console.error("Scope Timeline load failed",cause);setError("The Scope Timeline could not be loaded.")}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[jobId]);async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setSaving(true);setError(null);setNotice(null);let evidenceId:string|null=null;try{evidenceId=await createJobEvidence({jobId,evidenceType,area:area||null,description:description||null,changeRequestId:changeId||null,fieldDiscoveryId:discoveryId||null});if(files.length)await uploadJobEvidenceMedia(evidenceId,files);await load();setArea("");setDescription("");setChangeId("");setDiscoveryId("");setFiles([]);setShowForm(false);setNotice("Job evidence saved.")}catch(cause){console.error("Job evidence save failed",cause);if(evidenceId){try{await load()}catch(refreshCause){console.error("Timeline refresh failed",refreshCause)}setError(`The evidence was saved, but some media could not be uploaded. ${message(cause,"Retry the photo upload later.")}`)}else setError(message(cause,"The Job evidence could not be saved."))}finally{setSaving(false)}}return <section><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-extrabold text-[#143d1a]">Scope Timeline</h3><p className="mt-1 text-sm text-neutral-600">A chronological record of the accepted scope, field discoveries, authorized changes, and work evidence for this Job.</p></div>{mayCreate&&<button className={primary} onClick={()=>setShowForm(current=>!current)}>+ Add Evidence</button>}</div>{error&&<p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}{notice&&<p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{notice}</p>}{showForm&&timeline&&<form onSubmit={submit} className="mt-5 grid gap-4 rounded-xl border border-[#143d1a]/20 bg-[#f6f8f5] p-4 sm:grid-cols-2"><label className="text-sm font-bold">Evidence Type<select className={`${input} mt-2`} value={evidenceType} onChange={event=>setEvidenceType(event.target.value as JobEvidenceType)}>{JOB_EVIDENCE_TYPES.map(type=><option key={type}>{type}</option>)}</select></label><label className="text-sm font-bold">Area<input className={`${input} mt-2`} value={area} onChange={event=>setArea(event.target.value)}/></label><label className="text-sm font-bold">Related Approved Change Request<select className={`${input} mt-2`} value={changeId} onChange={event=>setChangeId(event.target.value)}><option value="">None</option>{timeline.approvedChanges.map(change=><option key={change.id} value={change.id}>{change.change_request_number} — {change.title}</option>)}</select></label><label className="text-sm font-bold">Related Field Discovery<select className={`${input} mt-2`} value={discoveryId} onChange={event=>setDiscoveryId(event.target.value)}><option value="">None</option>{timeline.discoveries.map(discovery=><option key={discovery.id} value={discovery.id}>{discovery.area||discovery.description.slice(0,50)}</option>)}</select></label><label className="text-sm font-bold sm:col-span-2">Description<textarea className={`${input} mt-2 min-h-24`} value={description} onChange={event=>setDescription(event.target.value)}/></label><label className="text-sm font-bold sm:col-span-2">Photos<input type="file" accept="image/*" multiple className={`${input} mt-2`} onChange={event=>setFiles(Array.from(event.target.files??[]))}/></label><div className="flex gap-2 sm:col-span-2"><button disabled={saving} className={primary}>{saving?"Saving…":"Save Evidence"}</button><button type="button" className={secondary} onClick={()=>setShowForm(false)}>Cancel</button></div></form>}{loading?<p className="mt-5 rounded-xl border bg-[#f6f8f5] p-4 text-sm text-neutral-600">Loading Scope Timeline…</p>:timeline&&timeline.events.length?<ol className="relative mt-6 ml-3 border-l-2 border-[#d4af37]/50 pl-6">{timeline.events.map(event=><li key={event.id} className="relative mb-6 rounded-xl border bg-white p-4 before:absolute before:-left-[31px] before:top-5 before:size-3 before:rounded-full before:bg-[#143d1a]"><time className="text-xs text-neutral-500">{new Date(event.occurredAt).toLocaleString()}</time><div className="mt-1 flex flex-wrap items-center gap-2"><h4 className="font-extrabold text-[#143d1a]">{event.title}</h4>{event.status&&<span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-[#71570c]">{event.status}</span>}{event.financialImpact!=null&&<span className="text-sm font-extrabold text-[#143d1a]">+{money(event.financialImpact)}</span>}</div>{event.area&&<p className="mt-1 text-sm font-semibold text-neutral-600">Area: {event.area}</p>}{event.description&&<p className="mt-2 text-sm text-neutral-700">{event.description}</p>}{event.media&&event.media.length>0&&<div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{event.media.map(photo=><a key={photo.id} href={photo.signedUrl??undefined} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border bg-neutral-100">{photo.signedUrl?<img src={photo.signedUrl} alt={`${event.title} evidence`} className="aspect-[4/3] size-full object-cover"/>:<span className="grid aspect-[4/3] place-items-center text-xs text-neutral-500">Preview unavailable</span>}</a>)}</div>}</li>)}</ol>:!loading&&<p className="mt-5 rounded-xl border bg-[#f6f8f5] p-4 text-sm text-neutral-600">No Scope Timeline events are available for this Job.</p>}</section>}
function pricingNumber(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function Header({ canCreate, create }: { canCreate: boolean; create: () => void }) {
  return (
    <header className="flex flex-col gap-5 border-b border-[#143d1a]/10 pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div>
      <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">
        Operations workspace
      </p>
      <h1 className="text-3xl font-extrabold text-[#143d1a]">Jobs</h1>
      <p className="mt-3 text-neutral-600">
        Manage active StudioScrubz service jobs.
      </p>
      </div>
      {canCreate && <button type="button" onClick={create} className="rounded-lg bg-[#143d1a] px-5 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(20,61,26,.18)]">Create Job</button>}
    </header>
  );
}
function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <article className="rounded-2xl border bg-white p-5">
      <p className="text-xs font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-4 text-3xl font-extrabold text-[#143d1a]">{value}</p>
    </article>
  );
}
function Select({
  value,
  set,
  options,
  labels,
}: {
  value: string;
  set: (x: string) => void;
  options: readonly string[];
  labels?: ReadonlyMap<string, string>;
}) {
  return (
    <select
      className={input}
      value={value}
      onChange={(e) => set(e.target.value)}
    >
      {options.map((x) => (
        <option key={x} value={x}>{labels?.get(x) ?? (x === "All" && labels ? "All crews" : x)}</option>
      ))}
    </select>
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
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-[#07190a]/70 p-5">
      <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6">
        <button onClick={close} className="float-right text-xl">
          ×
        </button>
        <h2 className="mb-6 text-xl font-extrabold text-[#143d1a]">{title}</h2>
        {children}
      </section>
    </div>
  );
}
function Details({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <section className="mt-5">
      <h3 className="font-extrabold text-[#143d1a]">{title}</h3>
      {rows.map(([a, b]) => (
        <div key={a} className="mt-2 flex justify-between gap-4 text-sm">
          <span className="text-neutral-500">{a}</span>
          <b className="text-right">{b}</b>
        </div>
      ))}
    </section>
  );
}
function Field({
  label,
  value,
  set,
  type = "text",
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="text-xs font-bold text-neutral-600">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={`${input} mt-2`}
      />
    </label>
  );
}
function Alert({ text, success }: { text: string; success?: boolean }) {
  return (
    <div
      className={`mt-5 rounded-xl border p-4 text-sm font-bold ${success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}
    >
      {text}
    </div>
  );
}
function nextStatuses(status: JobStatus): JobStatus[] {
  if (status === "Ready to Schedule") return ["Scheduled"];
  if (status === "Scheduled") return ["Crew Assigned"];
  if (status === "Crew Assigned") return ["In Progress"];
  if (status === "In Progress") return ["Completed"];
  return [];
}
function compareSchedule(a: JobWithRelations, b: JobWithRelations) {
  const date = (a.scheduled_date ?? "9999-12-31").localeCompare(b.scheduled_date ?? "9999-12-31");
  if (date) return date;
  const time = (a.start_time ?? "99:99:99").localeCompare(b.start_time ?? "99:99:99");
  return time || a.job_number.localeCompare(b.job_number);
}
function compareRecent(a: JobWithRelations, b: JobWithRelations) {
  return (b.scheduled_date ?? b.created_at).localeCompare(a.scheduled_date ?? a.created_at) || compareSchedule(a, b);
}
function groupScheduledJobs(jobs: JobWithRelations[]) {
  const groups = new Map<string, JobWithRelations[]>();
  for (const job of jobs) {
    if (!job.scheduled_date || terminalStatuses.includes(job.status) || job.archived_at) continue;
    const group = groups.get(job.scheduled_date) ?? [];
    group.push(job);
    groups.set(job.scheduled_date, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
function dateHeading(date: string) {
  const value = new Date(`${date}T12:00:00`);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const label = date === localDateKey(today) ? "Today" : date === localDateKey(tomorrow) ? "Tomorrow" : null;
  const formatted = value.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: value.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
  return label ? `${label} — ${formatted}` : formatted;
}
function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function formatJobTime(value: string | null) {
  if (!value) return "Time TBD";
  const [hour, minute] = value.split(":").map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function JobSection({ title, count, jobs, renderJob, muted = false }: { title: string; count: number; jobs: JobWithRelations[]; renderJob: (job: JobWithRelations) => React.ReactNode; muted?: boolean }) {
  if (!count) return null;
  return <section className={`rounded-2xl border p-3 sm:p-4 ${muted ? "bg-[#f6f7f5]" : "bg-[#eef1ed]"}`}><header className="mb-3 flex items-center justify-between gap-4"><h2 className="text-sm font-extrabold text-[#143d1a] sm:text-base">{title}</h2><span className="rounded-full bg-white px-2.5 py-1 text-xs font-extrabold text-[#143d1a]">{count}</span></header><div>{jobs.map(renderJob)}</div></section>;
}
function money(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(v);
}
function shortDuration(milliseconds: number) { const minutes = Math.max(0, Math.floor(milliseconds / 60_000)); return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`; }
function jobLifecycleEligibility(job: JobWithRelations, employeeId: string | null, role: string | null) {
  const canStartByRole = Boolean(role && ["Master Admin", "Administrator", "Manager", "Crew Lead"].includes(role));
  const canParticipate = Boolean(role && ["Master Admin", "Administrator", "Manager", "Crew Lead", "Scrub Technician"].includes(role));
  const showStart = Boolean(job.assigned_crew_id) && ["Scheduled", "Crew Assigned"].includes(job.status) && canStartByRole;
  return {
    showStart,
    canJoin: job.status === "In Progress" && Boolean(job.assigned_crew_id) && Boolean(employeeId) && canParticipate,
  };
}
function displayTime(value: string) { return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function message(x: unknown, f: string) {
  if (x instanceof Error) return x.message;
  if (x && typeof x === "object" && "message" in x && typeof x.message === "string") return x.message;
  return f;
}
const input =
  "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#d4af37]";
const primary =
  "rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const joined =
  "cursor-not-allowed rounded-lg bg-neutral-200 px-4 py-2.5 text-sm font-bold text-neutral-500";
const secondary =
  "rounded-lg border border-neutral-200 px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50";
const danger =
  "rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50";
