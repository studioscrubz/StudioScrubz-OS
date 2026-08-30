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
      {eligibility.showStart && <><button type="button" disabled={busy || !eligibility.canStart} onClick={() => lifecycleAct(() => startOperationalJob(job.id), "Job started. You joined automatically and your Job payroll began.")} className={`${primary} w-full`}>START JOB</button>{eligibility.missingEmployeeLink && <p className="w-full rounded-lg bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">Your user profile must be linked to an Employee before starting jobs.</p>}</>}
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
      {(job.proposal?.result.adjustments??[]).length>0&&<><h3 className="mt-6 font-extrabold text-[#143d1a]">Purchased Add-Ons</h3><ul className="mt-2 list-disc pl-5 text-sm">{(job.proposal?.result.adjustments??[]).map((item)=><li key={item.id}>{item.label}</li>)}</ul></>}
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
          {eligibility.showStart && <><button disabled={busy || !eligibility.canStart} className={`${primary} mt-3`} onClick={() => lifecycleAct(() => startOperationalJob(job.id), "Job started. You joined automatically and your Job payroll began.")}>START JOB</button>{eligibility.missingEmployeeLink && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">Your user profile must be linked to an Employee before starting jobs.</p>}</>}
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
    </Modal>
  );
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
    canStart: showStart && Boolean(employeeId),
    missingEmployeeLink: showStart && !employeeId,
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
