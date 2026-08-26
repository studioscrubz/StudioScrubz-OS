"use client";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import {
  archiveJob,
  assignJobCrew,
  cancelJob,
  completeInProgressJob,
  finishJobAndClockOut,
  getCrewConflicts,
  getCurrentJobClockState,
  getJobs,
  isJobCompletionResult,
  scheduleJob,
  startOperationalJob,
  startOrClockInToJob,
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
import { getTimeEntries } from "@/lib/services/timeEntries";
import {
  type JobStatus,
  type JobClockOutResult,
  type JobWithRelations,
} from "@/types/job";
import type { TimeEntryWithRelations } from "@/types/timeEntry";

type Sort =
  | "Newest"
  | "Oldest"
  | "Scheduled Date"
  | "Client Name"
  | "Job Number"
  | "Price High to Low"
  | "Price Low to High";
type ScheduleFilter = "All" | "Scheduled" | "Unscheduled" | "Upcoming" | "Past";
const activeStatuses: JobStatus[] = [
  "Ready to Schedule",
  "Scheduled",
  "Crew Assigned",
  "In Progress",
];
const jobBoardStatuses: JobStatus[] = [...activeStatuses, "Completed"];
const jobPhotoCategories: readonly JobPhotoCategory[] = ["After", "Before", "Damage / Issue", "Other"];
export function JobsPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<JobWithRelations[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntryWithRelations[]>([]);
  const [activeCrews, setActiveCrews] = useState<CrewWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"All" | JobStatus>("All");
  const [division, setDivision] = useState("All");
  const [schedule, setSchedule] = useState<ScheduleFilter>("All");
  const [sort, setSort] = useState<Sort>("Newest");
  const [selected, setSelected] = useState<JobWithRelations | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  async function load() {
    const [next, entries, crews] = await Promise.all([getJobs(), getTimeEntries(), getActiveCrews()]);
    setRows(next);
    setTimeEntries(entries);
    setActiveCrews(crews);
    return next;
  }
  useOperationalRealtime(["jobs", "time_entries", "crews", "employees", "invoices", "service_occurrences"], async () => { await load(); });
  useEffect(() => {
    let active = true;
    void Promise.all([getJobs(), getTimeEntries(), getActiveCrews()])
      .then(([x, entries, crews]) => {
        if (active) {
          setRows(x);
          setTimeEntries(entries);
          setActiveCrews(crews);
          const jobId = new URLSearchParams(window.location.search).get(
            "jobId",
          );
          if (jobId) setSelected(x.find((job) => job.id === jobId && jobBoardStatuses.includes(job.status)) ?? null);
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
  }, []);
  async function mutate(
    job: JobWithRelations,
    fn: () => Promise<unknown>,
    text: string | ((result: unknown) => string),
  ) {
    setBusy(job.id);
    setError(null);
    try {
      const result = await fn();
      const next = await load();
      setSelected((current) => current?.id === job.id
        ? next.find((row) => row.id === job.id && jobBoardStatuses.includes(row.status)) ?? null
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
      setError(message(x, "Job action failed."));
    } finally {
      setBusy(null);
    }
  }
  const workflowRows = useMemo(
    () =>
      rows.filter(
        (job) =>
          job.archived_at === null &&
          jobBoardStatuses.includes(job.status),
      ),
    [rows],
  );
  const filtered = useMemo(
    () =>
      workflowRows
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
          const today = new Date().toISOString().slice(0, 10);
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
            scheduleMatch
          );
        })
        .sort((a, b) => compare(a, b, sort)),
    [division, schedule, search, sort, status, workflowRows],
  );
  const active = workflowRows.filter((job) => activeStatuses.includes(job.status));
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
            options={["All", ...jobBoardStatuses]}
          />
          <Select
            value={division}
            set={setDivision}
            options={["All", "Residential", "Commercial"]}
          />
          <Select
            value={schedule}
            set={(v) => setSchedule(v as ScheduleFilter)}
            options={["All", "Scheduled", "Unscheduled", "Upcoming", "Past"]}
          />
          <Select
            value={sort}
            set={(v) => setSort(v as Sort)}
            options={[
              "Newest",
              "Oldest",
              "Scheduled Date",
              "Client Name",
              "Job Number",
              "Price High to Low",
              "Price Low to High",
            ]}
          />
        </div>
      </section>
      {loading ? (
        <div className="mt-6 h-64 animate-pulse rounded-2xl bg-neutral-200" />
      ) : (
        <div className="mt-6 overflow-x-auto pb-5">
          <div className="grid min-w-[1300px] grid-cols-5 gap-4">
            {jobBoardStatuses.map((column) => (
              <section key={column} className="rounded-2xl bg-[#eef1ed] p-3">
                <h2 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-[#143d1a]">
                  {column}
                  <span className="float-right">
                    {filtered.filter((j) => j.status === column).length}
                  </span>
                </h2>
                {filtered
                  .filter((j) => j.status === column)
                  .map((j) => (
                    <JobCard
                      key={j.id}
                      job={j}
                      open={() => setSelected(j)}
                      timeEntries={timeEntries.filter((entry) => entry.job_id === j.id && !entry.archived_at && entry.entry_type === "Job")}
                      employeeId={profile?.employee_id ?? null}
                      assignedToJob={isEmployeeAssigned(activeCrews, profile?.employee_id ?? null, j.assigned_crew_id)}
                      role={profile?.role ?? null}
                      canComplete={hasPermission(profile, "jobs.complete")}
                      busy={busy === j.id}
                      act={(fn, text) => void mutate(j, fn, text)}
                    />
                  ))}
              </section>
            ))}
          </div>
        </div>
      )}
      {selected && (
        <JobModal
          job={selected}
          busy={busy === selected.id}
          close={() => setSelected(null)}
          mutate={(fn, text) => void mutate(selected, fn, text)}
          canEdit={hasPermission(profile, "jobs.edit")}
          canSchedule={hasPermission(profile, "jobs.schedule")}
          canArchive={hasPermission(profile, "jobs.archive")}
          canComplete={hasPermission(profile, "jobs.complete")}
          canClock={Boolean(profile && ["Master Admin", "Administrator", "Manager", "Crew Lead", "Scrub Technician"].includes(profile.role))}
          employeeId={profile?.employee_id ?? null}
          assignedToJob={isEmployeeAssigned(activeCrews, profile?.employee_id ?? null, selected.assigned_crew_id)}
          role={profile?.role ?? null}
          canDeletePhotos={Boolean(profile && ["Master Admin", "Administrator", "Manager"].includes(profile.role))}
        />
      )}
      {creating && <DirectJobModal close={() => setCreating(false)} created={async () => { setCreating(false); await load(); setNotice("Job created successfully."); }} />}
    </>
  );
}
function JobCard({ job, open, timeEntries, employeeId, assignedToJob, role, canComplete, busy, act }: { job: JobWithRelations; open: () => void; timeEntries: TimeEntryWithRelations[]; employeeId: string | null; assignedToJob: boolean; role: string | null; canComplete: boolean; busy: boolean; act: (fn: () => Promise<unknown>, text: string | ((result: unknown) => string)) => void }) {
  const activeEntries = timeEntries.filter((entry) => entry.status === "Open" && !entry.clock_out);
  const currentEntry = employeeId ? activeEntries.find((entry) => entry.employee_id === employeeId) ?? null : null;
  const canManageJobLifecycle = Boolean(role && ["Master Admin", "Administrator", "Manager"].includes(role));
  const canUsePersonalTimeClock = Boolean(employeeId && job.assigned_crew_id && assignedToJob);
  const canManagementStart = canManageJobLifecycle && Boolean(job.assigned_crew_id) && ["Scheduled", "Crew Assigned"].includes(job.status);
  const canStartWork = canUsePersonalTimeClock && ["Scheduled", "Crew Assigned"].includes(job.status) && !currentEntry;
  const canJoin = canUsePersonalTimeClock && job.status === "In Progress" && !currentEntry;
  const canEnd = job.status === "In Progress" && Boolean(currentEntry);
  const canCardComplete = job.status === "In Progress" && activeEntries.length === 0 && canComplete && (role !== "Crew Lead" || assignedToJob);
  const canCardEndJob = canComplete && (role !== "Crew Lead" || assignedToJob);
  const content = (
    <>
    <div className="text-left">
      <p className="font-extrabold text-[#143d1a]">{job.job_number}</p>
      <p className="mt-1 text-sm font-bold text-neutral-700">
        {job.client_name || "Unnamed client"}
      </p>
      <p className="text-xs text-neutral-500">{job.property_name}</p>
      <p className="mt-2 text-sm">{job.service_name}</p>
      <p className="mt-2 text-xl font-extrabold text-[#143d1a]">
        {job.financials_available === false ? "Price restricted" : money(job.price)}
      </p>
      <p className="mt-2 text-xs text-neutral-500">
        {job.scheduled_date || "Unscheduled"}{" "}
        {job.start_time?.slice(0, 5) || ""}
      </p>
      <p className="text-xs text-neutral-500">
        Crew: {job.assigned_crew_name || "Unassigned"}
      </p>
      <span className="mt-2 inline-block rounded-full bg-[#edf4ec] px-2 py-1 text-[10px] font-bold text-[#143d1a]">
        {job.division}
      </span>
      {job.status === "In Progress" && <JobCardActiveTime job={job} entries={timeEntries} />}
      {job.status === "Completed" && <JobCardCompletedTime job={job} entries={timeEntries} />}
    </div>
    <div className="mt-3 grid gap-2">
      {canManagementStart && <button type="button" disabled={busy} onClick={() => act(() => startOperationalJob(job.id), "Job started. No employee time entry was created.")} className={`${primary} w-full`}>START JOB</button>}
      {canStartWork && <button type="button" disabled={busy} onClick={() => act(() => startOrClockInToJob(job.id), "Your Job participation started.")} className={`${primary} w-full`}>START JOB WORK</button>}
      {canJoin && <button type="button" disabled={busy} onClick={() => act(() => startOrClockInToJob(job.id), "You joined the Job.")} className={`${primary} w-full`}>JOIN JOB</button>}
      {canEnd && <button type="button" disabled={busy} onClick={() => act(() => finishJobAndClockOut(job.id, 0), cardClockOutMessage)} className={`${primary} w-full`}>END MY JOB WORK</button>}
      {canCardComplete && <button type="button" disabled={busy} onClick={() => act(() => completeInProgressJob(job.id), "Job ended by supervisor.")} className={`${primary} w-full`}>END JOB</button>}
      {job.status === "In Progress" && canCardEndJob && activeEntries.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-bold text-amber-800">{activeEntries.length} crew {activeEntries.length === 1 ? "member is" : "members are"} still on Job</p>}
      <button type="button" onClick={open} className={`${secondary} w-full`}>MANAGE JOB</button>
    </div>
    </>
  );
  if (job.status === "Completed")
    return <JobInvoiceAction jobId={job.id}>{content}</JobInvoiceAction>;
  return (
    <article className="mb-3 rounded-xl bg-white p-4 shadow-sm">
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
  assignedToJob,
  role,
  canDeletePhotos,
}: {
  job: JobWithRelations;
  busy: boolean;
  close: () => void;
  mutate: (fn: () => Promise<unknown>, text: string | ((result: unknown) => string)) => void;
  canEdit: boolean;
  canSchedule: boolean;
  canArchive: boolean;
  canComplete: boolean;
  canClock: boolean;
  employeeId: string | null;
  assignedToJob: boolean;
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
  const canManageJobLifecycle = Boolean(role && ["Master Admin", "Administrator", "Manager"].includes(role));
  const canSupervisorComplete = canComplete && (role !== "Crew Lead" || assignedToJob);
  const canUsePersonalTimeClock = canClock && Boolean(employeeId && job.assigned_crew_id && assignedToJob);
  const canManagementStart = canManageJobLifecycle && Boolean(job.assigned_crew_id) && ["Scheduled", "Crew Assigned"].includes(job.status);
  const showLifecycle = ["Scheduled", "Crew Assigned", "In Progress"].includes(job.status)
    && (canManagementStart || canUsePersonalTimeClock || (job.status === "In Progress" && canSupervisorComplete));
  function clockOutMessage(result: unknown) {
    const value = result as JobClockOutResult;
    if (value.remainingActiveWorkers > 0) return `Your Job time was recorded. ${value.remainingActiveWorkers} worker${value.remainingActiveWorkers === 1 ? " remains" : "s remain"} on Job.`;
    if (value.completionPending) return "Your Job time was recorded. The Job remains In Progress until an authorized supervisor selects END JOB.";
    return "Your Job time was recorded.";
  }
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
      {job.financials_available !== false && <JobLaborSummary jobId={job.id} estimatedHours={job.labor_hours} estimatedCost={Math.max(0, job.price - (job.proposal?.result.estimatedProfit ?? 0))} price={job.price} />}
      {showLifecycle && <section className="mt-6 rounded-xl border border-[#143d1a]/20 bg-[#f6f8f5] p-4"><h3 className="font-extrabold text-[#143d1a]">Job Lifecycle</h3>{clockError && <p role="alert" className="mt-2 text-sm font-bold text-red-700">{clockError}</p>}{canManagementStart && <button disabled={busy} className={`${primary} mt-3`} onClick={() => mutate(() => startOperationalJob(job.id), "Job started. No employee time entry was created.")}>START JOB</button>}{canUsePersonalTimeClock && !clockError && (clock?.clockedIn ? <><p className="mt-2 text-sm text-neutral-700">On Job since {clock.clockedInAt ? new Date(clock.clockedInAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</p><button disabled={busy} className={`${primary} mt-3`} onClick={() => mutate(() => finishJobAndClockOut(job.id, 0), clockOutMessage)}>END MY JOB WORK</button></> : <button disabled={busy || clock === null} className={`${primary} mt-3`} onClick={() => mutate(() => startOrClockInToJob(job.id), job.status === "In Progress" ? "You joined the Job." : "Your Job participation started.")}>{job.status === "In Progress" ? "JOIN JOB" : "START JOB WORK"}</button>)}{job.status === "In Progress" && clock && <p className="mt-2 text-xs text-neutral-500">Crew members currently on Job: {clock.activeWorkerCount}</p>}{job.status === "In Progress" && canSupervisorComplete && clock && clock.activeWorkerCount > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">{clock.activeWorkerCount} crew {clock.activeWorkerCount === 1 ? "member is" : "members are"} still on Job</p>}{job.status === "In Progress" && canSupervisorComplete && clock?.activeWorkerCount === 0 && <button disabled={busy} onClick={() => mutate(() => completeInProgressJob(job.id), "Job ended by supervisor.")} className={`${primary} mt-3`}>END JOB</button>}</section>}
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
}: {
  value: string;
  set: (x: string) => void;
  options: readonly string[];
}) {
  return (
    <select
      className={input}
      value={value}
      onChange={(e) => set(e.target.value)}
    >
      {options.map((x) => (
        <option key={x}>{x}</option>
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
function compare(a: JobWithRelations, b: JobWithRelations, s: Sort) {
  if (s === "Oldest")
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  if (s === "Scheduled Date")
    return (a.scheduled_date ?? "9999").localeCompare(
      b.scheduled_date ?? "9999",
    );
  if (s === "Client Name")
    return (a.client_name ?? "").localeCompare(b.client_name ?? "");
  if (s === "Job Number") return a.job_number.localeCompare(b.job_number);
  if (s === "Price High to Low") return a.financials_available === false || b.financials_available === false ? 0 : b.price - a.price;
  if (s === "Price Low to High") return a.financials_available === false || b.financials_available === false ? 0 : a.price - b.price;
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}
function money(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(v);
}
function shortDuration(milliseconds: number) { const minutes = Math.max(0, Math.floor(milliseconds / 60_000)); return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`; }
function isEmployeeAssigned(crews: CrewWithRelations[], employeeId: string | null, crewId: string | null) { if (!employeeId || !crewId) return false; const crew = crews.find((candidate) => candidate.id === crewId); return crew?.crew_lead_id === employeeId || crew?.members.some((member) => member.employee_id === employeeId) === true; }
function cardClockOutMessage(result: unknown) { const value = result as JobClockOutResult; if (value.remainingActiveWorkers > 0) return `Job time recorded. ${value.remainingActiveWorkers} worker${value.remainingActiveWorkers === 1 ? " remains" : "s remain"} on Job.`; if (value.completionPending) return "Job time recorded. An authorized supervisor may now END JOB."; return "Job time recorded."; }
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
const secondary =
  "rounded-lg border border-neutral-200 px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50";
