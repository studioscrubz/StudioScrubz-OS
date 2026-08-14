"use client";
import { useEffect, useMemo, useState } from "react";
import {
  archiveJob,
  assignJobCrew,
  cancelJob,
  getCrewConflicts,
  getJobs,
  scheduleJob,
  updateJobStatus,
} from "@/lib/services/jobs";
import { getActiveCrews } from "@/lib/services/crews";
import { JobInvoiceAction } from "@/components/invoices/JobInvoiceAction";
import { JobMileageSummary } from "@/components/vehicles/JobMileageSummary";
import { JobLaborSummary } from "@/components/time/JobLaborSummary";
import type { CrewWithRelations } from "@/types/crew";
import {
  type JobStatus,
  type JobWithRelations,
} from "@/types/job";

type Sort =
  | "Newest"
  | "Oldest"
  | "Scheduled Date"
  | "Client Name"
  | "Job Number"
  | "Price High to Low"
  | "Price Low to High";
type ScheduleFilter = "All" | "Scheduled" | "Unscheduled" | "Upcoming" | "Past";
const columns: JobStatus[] = [
  "Ready to Schedule",
  "Scheduled",
  "Crew Assigned",
  "In Progress",
  "Completed",
  "Cancelled",
];
export function JobsPage() {
  const [rows, setRows] = useState<JobWithRelations[]>([]);
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
  async function load() {
    setRows(await getJobs());
  }
  useEffect(() => {
    let active = true;
    void getJobs()
      .then((x) => {
        if (active) {
          setRows(x);
          const jobId = new URLSearchParams(window.location.search).get(
            "jobId",
          );
          if (jobId) setSelected(x.find((job) => job.id === jobId) ?? null);
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
    text: string,
  ) {
    setBusy(job.id);
    setError(null);
    try {
      await fn();
      await load();
      setSelected(null);
      setNotice(text);
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
          columns.includes(job.status),
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
  const active = workflowRows;
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
    ["Completed", active.filter((j) => j.status === "Completed").length],
  ] as const;
  return (
    <>
      <Header />
      {notice && <Alert text={notice} success />}
      {error && <Alert text={error} />}
      <section className="mt-7 grid grid-cols-2 gap-4 xl:grid-cols-5">
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
            options={["All", ...columns]}
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
          <div className="grid min-w-[1580px] grid-cols-6 gap-4">
            {columns.map((column) => (
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
                    <JobCard key={j.id} job={j} open={() => setSelected(j)} />
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
        />
      )}
    </>
  );
}
function JobCard({ job, open }: { job: JobWithRelations; open: () => void }) {
  const content = (
    <button type="button" onClick={open} className="w-full text-left">
      <p className="font-extrabold text-[#143d1a]">{job.job_number}</p>
      <p className="mt-1 text-sm font-bold text-neutral-700">
        {job.client_name || "Unnamed client"}
      </p>
      <p className="text-xs text-neutral-500">{job.property_name}</p>
      <p className="mt-2 text-sm">{job.service_name}</p>
      <p className="mt-2 text-xl font-extrabold text-[#143d1a]">
        {money(job.price)}
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
    </button>
  );
  if (job.status === "Completed")
    return <JobInvoiceAction jobId={job.id}>{content}</JobInvoiceAction>;
  return (
    <article className="mb-3 rounded-xl bg-white p-4 shadow-sm">
      {content}
    </article>
  );
}
function JobModal({
  job,
  busy,
  close,
  mutate,
}: {
  job: JobWithRelations;
  busy: boolean;
  close: () => void;
  mutate: (fn: () => Promise<unknown>, text: string) => void;
}) {
  const [date, setDate] = useState(job.scheduled_date ?? "");
  const [time, setTime] = useState(job.start_time?.slice(0, 5) ?? "");
  const [duration, setDuration] = useState(job.estimated_duration ?? 0);
  const [crews, setCrews] = useState<CrewWithRelations[]>([]);
  const [crewId, setCrewId] = useState(job.assigned_crew_id ?? "");
  const [warning, setWarning] = useState<string | null>(null);
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
            ["Price", money(job.price)],
            ["Labor Hours", String(job.labor_hours)],
            ["Recommended Crew", String(job.recommended_crew_size)],
          ]}
        />
      </div>
      <h3 className="mt-6 font-extrabold text-[#143d1a]">Scope</h3>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {job.scope.map((x) => (
          <li key={x.id}>{x.text}</li>
        ))}
      </ul>
      <section className="mt-6 grid gap-3 sm:grid-cols-3">
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
      </section>
      {(job.status === "Ready to Schedule" ||
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
      <JobMileageSummary jobId={job.id} />
      <JobLaborSummary jobId={job.id} estimatedHours={job.labor_hours} estimatedCost={Math.max(0, job.price - (job.proposal?.result.estimatedProfit ?? 0))} price={job.price} />
      <div className="mt-6 flex flex-wrap gap-2">
        {nextStatuses(job.status).map((x) => (
          <button
            key={x}
            disabled={busy}
            onClick={() => status(x)}
            className={secondary}
          >
            {x}
          </button>
        ))}
        {!["Cancelled", "Archived"].includes(job.status) && (
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
        {job.status !== "Archived" && (
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
function Header() {
  return (
    <header className="border-b border-[#143d1a]/10 pb-7">
      <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">
        Operations workspace
      </p>
      <h1 className="text-3xl font-extrabold text-[#143d1a]">Jobs</h1>
      <p className="mt-3 text-neutral-600">
        Manage active StudioScrubz service jobs.
      </p>
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
  if (s === "Price High to Low") return b.price - a.price;
  if (s === "Price Low to High") return a.price - b.price;
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}
function money(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(v);
}
function message(x: unknown, f: string) {
  return x instanceof Error ? x.message : f;
}
const input =
  "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-[#d4af37]";
const primary =
  "rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary =
  "rounded-lg border border-neutral-200 px-3 py-2 text-xs font-bold text-[#143d1a] disabled:opacity-50";
