"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  approveTimeEntry,
  archiveTimeEntry,
  clockInEmployee,
  clockOutEmployee,
  createManualTimeEntry,
  getTimeEntries,
  rejectTimeEntry,
  updateTimeEntry,
} from "@/lib/services/timeEntries";
import { getEmployees } from "@/lib/services/employees";
import { getCrews } from "@/lib/services/crews";
import { getJobs } from "@/lib/services/jobs";
import {
  TIME_ENTRY_STATUSES,
  TIME_ENTRY_TYPES,
  type TimeEntryInput,
  type TimeEntryWithRelations,
} from "@/types/timeEntry";
import { employeeName, type Employee } from "@/types/employee";
import type { CrewWithRelations } from "@/types/crew";
import type { JobWithRelations } from "@/types/job";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
export function TimeClockPage() {
  const { profile } = useAuth();
  const canReviewPayroll = hasPermission(profile, "payrollPrep.view");
  const canCorrectTime = hasPermission(profile, "employees.manage");
  const [rows, setRows] = useState<TimeEntryWithRelations[]>([]),
    [employees, setEmployees] = useState<Employee[]>([]),
    [crews, setCrews] = useState<CrewWithRelations[]>([]),
    [jobs, setJobs] = useState<JobWithRelations[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [modal, setModal] = useState<
      "clock" | "manual" | TimeEntryWithRelations | null
    >(null),
    [employee, setEmployee] = useState("All"),
    [crew, setCrew] = useState("All"),
    [type, setType] = useState("All"),
    [status, setStatus] = useState("All"),
    [date, setDate] = useState("This Week"),
    [sort, setSort] = useState("Newest"),
    [search, setSearch] = useState("");
  async function load() {
    const [t, e, c, j] = await Promise.all([
      getTimeEntries(),
      getEmployees(),
      getCrews(),
      getJobs(),
    ]);
    setRows(t);
    setEmployees(e.filter((x) => !x.archived_at));
    setCrews(c.filter((x) => !x.archived_at));
    setJobs(j);
  }
  useEffect(() => {
    let active = true;
    void Promise.all([getTimeEntries(), getEmployees(), getCrews(), getJobs()])
      .then(([t, e, c, j]) => {
        if (active) {
          setRows(t);
          setEmployees(e.filter((x) => !x.archived_at));
          setCrews(c.filter((x) => !x.archived_at));
          setJobs(j);
        }
      })
      .catch((x) => setError(msg(x)))
      .finally(() => setLoading(false));
    return () => {
      active = false;
    };
  }, []);
  const open = rows.filter(
      (x) => x.status === "Open" && !x.clock_out && !x.archived_at,
    ),
    visible = useMemo(
      () =>
        rows
          .filter((x) => {
            const hay = [
              employeeName(x.employee),
              x.employee?.employee_number,
              x.time_entry_number,
              x.job?.job_number,
              x.crew?.crew_name,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return (
              (!search || hay.includes(search.toLowerCase())) &&
              (employee === "All" || x.employee_id === employee) &&
              (crew === "All" || x.crew_id === crew) &&
              (type === "All" || x.entry_type === type) &&
              (status === "All" || x.status === status) &&
              dateMatch(x.work_date, date)
            );
          })
          .sort((a, b) => sortRows(a, b, sort)),
      [crew, date, employee, rows, search, sort, status, type],
    );
  async function act(fn: () => Promise<unknown>, text: string) {
    try {
      await fn();
      await load();
      setNotice(text);
      setError(null);
    } catch (x) {
      setError(msg(x));
    }
  }
  return (
    <>
      <header className="border-b pb-7">
        <h1 className="text-3xl font-extrabold text-[#143d1a]">Time Clock</h1>
        <p className="mt-3 text-neutral-600">
          Track StudioScrubz employee hours and job labor.
        </p>
        <div className="mt-5 flex gap-2">
          <button className={primary} onClick={() => setModal("clock")}>
            Clock In Employee
          </button>
          {canCorrectTime && <button className={secondary} onClick={() => setModal("manual")}>
            Add Time Entry
          </button>}
        </div>
      </header>
      {error && <Alert text={error} />} {notice && <Alert text={notice} good />}
      <section className="mt-7">
        <h2 className="text-xl font-extrabold text-[#143d1a]">
          Currently Clocked In
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {open.map((x) => (
            <article key={x.id} className="rounded-2xl border bg-white p-5">
              <b>{employeeName(x.employee)}</b>
              <p className="text-sm text-neutral-500">
                {x.job?.job_number || x.entry_type} ·{" "}
                {x.crew?.crew_name || "No crew"}
              </p>
              <p className="mt-3 text-xl font-extrabold text-[#143d1a]">
                <Elapsed start={x.clock_in} />
              </p>
              <p className="text-xs">
                Clocked in {new Date(x.clock_in).toLocaleString()}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  className={primary}
                  onClick={() => {
                    const value = window.prompt("Break minutes", "0");
                    if (value !== null)
                      void act(
                        () =>
                          clockOutEmployee(
                            x.id,
                            new Date().toISOString(),
                            Number(value),
                          ),
                        "Employee clocked out.",
                      );
                  }}
                >
                  Clock Out
                </button>
                {x.job_id && (
                  <Link className={secondary} href={`/jobs?jobId=${x.job_id}`}>
                    View Job
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
        {!open.length && !loading && (
          <Empty text="No employees are currently clocked in." />
        )}
      </section>
      <section className="mt-8 grid gap-2 rounded-2xl border bg-white p-4 md:grid-cols-3 xl:grid-cols-7">
        <input
          className={input}
          placeholder="Search time entries"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          v={employee}
          set={setEmployee}
          rows={[
            ["All", "All Employees"],
            ...employees.map((x) => [x.id, employeeName(x)]),
          ]}
        />
        <Select
          v={crew}
          set={setCrew}
          rows={[
            ["All", "All Crews"],
            ...crews.map((x) => [x.id, x.crew_name]),
          ]}
        />
        <Select
          v={type}
          set={setType}
          rows={["All", ...TIME_ENTRY_TYPES].map((x) => [x, x])}
        />
        <Select
          v={status}
          set={setStatus}
          rows={["All", ...TIME_ENTRY_STATUSES].map((x) => [x, x])}
        />
        <Select
          v={date}
          set={setDate}
          rows={[
            "Today",
            "This Week",
            "Last Week",
            "This Month",
            "All Time",
          ].map((x) => [x, x])}
        />
        <Select
          v={sort}
          set={setSort}
          rows={[
            "Newest",
            "Oldest",
            "Employee",
            "Hours High to Low",
            "Gross Pay High to Low",
          ].map((x) => [x, x])}
        />
      </section>
      <div className="mt-5 overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full min-w-[1300px] text-sm">
          <thead>
            <tr>
              {[
                "Entry",
                "Date",
                "Employee",
                "Job",
                "Crew",
                "Clock In",
                "Clock Out",
                "Regular",
                "OT",
                "Total",
                "Gross Pay",
                "Status",
                "Actions",
              ].map((x) => (
                <th className="p-3 text-left" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((x) => (
              <tr className="border-t" key={x.id}>
                <td className="p-3 font-bold">{x.time_entry_number}</td>
                <td className="p-3">{x.work_date}</td>
                <td className="p-3">{employeeName(x.employee)}</td>
                <td className="p-3">{x.job?.job_number || "—"}</td>
                <td className="p-3">{x.crew?.crew_name || "—"}</td>
                <td className="p-3">{time(x.clock_in)}</td>
                <td className="p-3">
                  {x.clock_out ? time(x.clock_out) : "Open"}
                </td>
                <td className="p-3">{n(x.regular_hours)}</td>
                <td className="p-3">{n(x.overtime_hours)}</td>
                <td className="p-3 font-bold">{n(x.total_hours)}</td>
                <td className="p-3">{canReviewPayroll ? money(x.gross_pay) : "—"}</td>
                <td className="p-3">{x.status}</td>
                <td className="p-3">
                  <div className="flex gap-1">
                    {canCorrectTime && ["Open", "Completed"].includes(x.status) && (
                      <button className={secondary} onClick={() => setModal(x)}>
                        Edit
                      </button>
                    )}
                    {canReviewPayroll && x.status === "Completed" && (
                      <>
                        <button
                          className={secondary}
                          onClick={() =>
                            void act(
                              () => approveTimeEntry(x.id),
                              "Time entry approved.",
                            )
                          }
                        >
                          Approve
                        </button>
                        <button
                          className={secondary}
                          onClick={() => {
                            const note = window.prompt("Correction note") ?? "";
                            void act(
                              () => rejectTimeEntry(x.id, note),
                              "Time entry rejected.",
                            );
                          }}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {canReviewPayroll && x.status !== "Archived" && (
                      <button
                        className={secondary}
                        onClick={() =>
                          void act(
                            () => archiveTimeEntry(x.id),
                            "Time entry archived.",
                          )
                        }
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <Empty text="No time entries match the selected filters." />
        )}
      </div>
      {modal && (
        <EntryForm
          mode={modal}
          employees={employees}
          crews={crews}
          jobs={jobs}
          close={() => setModal(null)}
          saved={async () => {
            setModal(null);
            await load();
            setNotice("Time entry saved.");
          }}
        />
      )}
    </>
  );
}
function EntryForm({
  mode,
  employees,
  crews,
  jobs,
  close,
  saved,
}: {
  mode: "clock" | "manual" | TimeEntryWithRelations;
  employees: Employee[];
  crews: CrewWithRelations[];
  jobs: JobWithRelations[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const existing = typeof mode === "object" ? mode : null,
    isClock = mode === "clock",
    [v, setV] = useState<TimeEntryInput>(
      existing
        ? pick(existing)
        : {
            employee_id: employees[0]?.id ?? "",
            job_id: null,
            crew_id: null,
            work_date: today(),
            clock_in: toLocalInput(new Date()),
            clock_out: isClock ? null : toLocalInput(new Date()),
            break_minutes: 0,
            entry_type: "Job",
            notes: null,
          },
    ),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  function set<K extends keyof TimeEntryInput>(k: K, value: TimeEntryInput[K]) {
    setV((x) => ({ ...x, [k]: value }));
  }
  function job(id: string | null) {
    const j = jobs.find((x) => x.id === id);
    setV((x) => ({
      ...x,
      job_id: id,
      crew_id: j?.assigned_crew_id ?? x.crew_id,
    }));
  }
  async function submit() {
    if (!v.employee_id) return setError("Employee is required.");
    setSaving(true);
    try {
      const input = {
        ...v,
        clock_in: new Date(v.clock_in).toISOString(),
        clock_out: v.clock_out ? new Date(v.clock_out).toISOString() : null,
      };
      if (existing) await updateTimeEntry(existing.id, input);
      else if (isClock)
        await clockInEmployee({
          ...input,
        });
      else await createManualTimeEntry(input);
      await saved();
    } catch (x) {
      setError(msg(x));
      setSaving(false);
    }
  }
  return (
    <Modal
      title={
        existing
          ? `Edit ${existing.time_entry_number}`
          : isClock
            ? "Clock In Employee"
            : "Add Time Entry"
      }
      close={close}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Assoc
          l="Employee"
          v={v.employee_id}
          set={(x) => set("employee_id", x ?? "")}
          rows={employees.map((x) => [
            x.id,
            `${employeeName(x)} · ${x.employee_number}`,
          ])}
        />
        <Assoc
          l="Job (optional)"
          v={v.job_id}
          set={job}
          rows={jobs.map((x) => [
            x.id,
            `${x.job_number} · ${x.client_name || "Client"} · ${x.property_name || "Property"}`,
          ])}
        />
        <Assoc
          l="Crew (optional)"
          v={v.crew_id}
          set={(x) => set("crew_id", x)}
          rows={crews.map((x) => [x.id, x.crew_name])}
        />
        <LabeledSelect
          l="Entry Type"
          v={v.entry_type}
          set={(x) => set("entry_type", x as TimeEntryInput["entry_type"])}
          values={TIME_ENTRY_TYPES}
        />
        <Field
          l="Work Date"
          type="date"
          v={v.work_date}
          set={(x) => set("work_date", x)}
        />
        <Field
          l="Clock In"
          type="datetime-local"
          v={v.clock_in}
          set={(x) => set("clock_in", x)}
        />
        {!isClock && (
          <>
            <Field
              l="Clock Out"
              type="datetime-local"
              v={v.clock_out ?? ""}
              set={(x) => set("clock_out", x || null)}
            />
            <Field
              l="Break Minutes"
              type="number"
              v={String(v.break_minutes)}
              set={(x) => set("break_minutes", Number(x))}
            />
          </>
        )}
      </div>
      <label className="mt-3 block">
        Notes
        <textarea
          className={`${input} h-24`}
          value={v.notes ?? ""}
          onChange={(e) => set("notes", e.target.value || null)}
        />
      </label>
      {error && <Alert text={error} />}
      <button
        disabled={saving}
        className={`${primary} mt-4`}
        onClick={() => void submit()}
      >
        {saving ? "Saving…" : isClock ? "Clock In" : "Save Time Entry"}
      </button>
    </Modal>
  );
}
function Elapsed({ start }: { start: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const mins = now === null ? 0 : Math.max(0, Math.floor((now - Date.parse(start)) / 60000));
  return (
    <>
      {Math.floor(mins / 60)}h {mins % 60}m
    </>
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
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4">
      <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6">
        <button className="float-right" onClick={close}>
          ×
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
  type = "text",
}: {
  l: string;
  v: string;
  set: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="text-sm font-bold">
      {l}
      <input
        className={input}
        type={type}
        min={type === "number" ? 0 : undefined}
        value={v}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function Assoc({
  l,
  v,
  set,
  rows,
}: {
  l: string;
  v: string | null;
  set: (v: string | null) => void;
  rows: string[][];
}) {
  return (
    <label className="text-sm font-bold">
      {l}
      <select
        className={input}
        value={v ?? ""}
        onChange={(e) => set(e.target.value || null)}
      >
        <option value="">None</option>
        {rows.map((x) => (
          <option key={x[0]} value={x[0]}>
            {x[1]}
          </option>
        ))}
      </select>
    </label>
  );
}
function LabeledSelect({
  l,
  v,
  set,
  values,
}: {
  l: string;
  v: string;
  set: (v: string) => void;
  values: readonly string[];
}) {
  return (
    <label className="text-sm font-bold">
      {l}
      <select className={input} value={v} onChange={(e) => set(e.target.value)}>
        {values.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </label>
  );
}
function Select({
  v,
  set,
  rows,
}: {
  v: string;
  set: (v: string) => void;
  rows: string[][];
}) {
  return (
    <select className={input} value={v} onChange={(e) => set(e.target.value)}>
      {rows.map((x) => (
        <option key={x[0]} value={x[0]}>
          {x[1]}
        </option>
      ))}
    </select>
  );
}
function Alert({ text, good }: { text: string; good?: boolean }) {
  return (
    <p className={`mt-4 rounded-lg p-3 ${good ? "bg-green-50" : "bg-red-50"}`}>
      {text}
    </p>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="p-8 text-center text-neutral-500">{text}</p>;
}
function pick(x: TimeEntryWithRelations): TimeEntryInput {
  return {
    employee_id: x.employee_id ?? "",
    job_id: x.job_id,
    crew_id: x.crew_id,
    work_date: x.work_date,
    clock_in: toLocalInput(new Date(x.clock_in)),
    clock_out: x.clock_out ? toLocalInput(new Date(x.clock_out)) : null,
    break_minutes: x.break_minutes,
    entry_type: x.entry_type,
    notes: x.notes,
  };
}
function dateMatch(d: string, f: string) {
  const now = new Date(),
    todayValue = today();
  if (f === "Today") return d === todayValue;
  if (f === "This Month") return d.startsWith(todayValue.slice(0, 7));
  const start = new Date(now);
  start.setDate(
    start.getDate() - start.getDay() + (f === "Last Week" ? -7 : 0),
  );
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return f === "All Time" || (d >= local(start) && d <= local(end));
}
function sortRows(
  a: TimeEntryWithRelations,
  b: TimeEntryWithRelations,
  s: string,
) {
  if (s === "Oldest") return a.clock_in.localeCompare(b.clock_in);
  if (s === "Employee")
    return employeeName(a.employee).localeCompare(employeeName(b.employee));
  if (s === "Hours High to Low") return b.total_hours - a.total_hours;
  if (s === "Gross Pay High to Low") return b.gross_pay - a.gross_pay;
  return b.clock_in.localeCompare(a.clock_in);
}
function time(x: string) {
  return new Date(x).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
function n(x: number) {
  return Number(x).toFixed(2);
}
function money(x: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(x);
}
function toLocalInput(d: Date) {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}
function today() {
  return local(new Date());
}
function local(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function msg(x: unknown) {
  console.error(x);
  return x instanceof Error ? x.message : "Time operation failed.";
}
const input = "mt-1 h-11 w-full rounded-lg border px-3";
const primary =
  "rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
const secondary =
  "rounded-lg border px-3 py-2 text-xs font-bold text-[#143d1a]";
