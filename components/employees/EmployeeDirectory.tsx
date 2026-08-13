"use client";
import { useEffect, useMemo, useState } from "react";
import {
  archiveEmployee,
  createEmployee,
  getEmployees,
  updateEmployee,
} from "@/lib/services/employees";
import { getCrews } from "@/lib/services/crews";
import { CrewManager } from "./CrewManager";
import { EmployeeTimeSummary } from "@/components/time/EmployeeTimeSummary";
import {
  EMPLOYEE_DEPARTMENTS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  employeeName,
  type Employee,
  type EmployeeDepartment,
  type EmployeeInput,
  type EmploymentStatus,
  type EmploymentType,
} from "@/types/employee";
import type { CrewWithRelations } from "@/types/crew";
export function EmployeeDirectory({
  departments,
  title = "Employee Directory",
  description = "Manage StudioScrubz employees, departments, and crews.",
  directory = true,
}: {
  departments?: EmployeeDepartment[];
  title?: string;
  description?: string;
  directory?: boolean;
}) {
  const [rows, setRows] = useState<Employee[]>([]);
  const [crews, setCrews] = useState<CrewWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("All");
  const [status, setStatus] = useState("All");
  const [type, setType] = useState("All");
  const [editing, setEditing] = useState<Employee | null | "new">(null);
  const [detail, setDetail] = useState<Employee | null>(null);
  const [manageCrews, setManageCrews] = useState(false);
  async function load() {
    const [e, c] = await Promise.all([getEmployees(), getCrews()]);
    setRows(e);
    setCrews(c);
  }
  useEffect(() => {
    let active = true;
    void Promise.all([getEmployees(), getCrews()])
      .then(([e, c]) => {
        if (active) {
          setRows(e);
          setCrews(c);
        }
      })
      .catch((x: unknown) => {
        console.error("Employee load failed", x);
        if (active) setError(message(x));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const visible = useMemo(
    () =>
      rows.filter(
        (e) =>
          (!departments || departments.includes(e.department)) &&
          (department === "All" || e.department === department) &&
          (status === "All" || e.employment_status === status) &&
          (type === "All" || e.employment_type === type) &&
          (!search ||
            [
              e.employee_number,
              e.first_name,
              e.last_name,
              e.preferred_name,
              e.email,
              e.phone,
              e.job_title,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(search.toLowerCase())),
      ),
    [department, departments, rows, search, status, type],
  );
  const active = rows.filter((e) => !e.archived_at);
  const metrics = [
    ["Total Employees", active.length],
    [
      "Scrub Technicians",
      active.filter((e) => e.department === "Scrub Technicians").length,
    ],
    ["Sales", active.filter((e) => e.department === "Sales").length],
    [
      "Administration / Management",
      active.filter(
        (e) =>
          e.department === "Administration" || e.department === "Management",
      ).length,
    ],
    [
      "Active Crews",
      crews.filter((c) => c.status === "Active" && !c.archived_at).length,
    ],
  ];
  return (
    <>
      <Header
        title={title}
        description={description}
        actions={
          directory ? (
            <>
              <button className={primary} onClick={() => setEditing("new")}>
                Add Employee
              </button>
              <button
                className={secondary}
                onClick={() => setManageCrews(true)}
              >
                Manage Crews
              </button>
            </>
          ) : null
        }
      />
      {notice && <Alert text={notice} good />}
      {error && <Alert text={error} />}{" "}
      {directory && (
        <section className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-5">
          {metrics.map(([l, v]) => (
            <Metric key={String(l)} l={String(l)} v={loading ? "—" : v} />
          ))}
        </section>
      )}
      <section className="mt-6 rounded-2xl border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            className={input}
            placeholder="Search employees"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {directory && (
            <Select
              value={department}
              set={setDepartment}
              values={["All", ...EMPLOYEE_DEPARTMENTS]}
            />
          )}
          <Select
            value={status}
            set={setStatus}
            values={["All", ...EMPLOYMENT_STATUSES]}
          />
          <Select
            value={type}
            set={setType}
            values={["All", ...EMPLOYMENT_TYPES]}
          />
        </div>
      </section>
      {loading ? (
        <div className="mt-6 h-60 animate-pulse rounded-2xl bg-neutral-200" />
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((e) => (
            <button
              key={e.id}
              onClick={() => setDetail(e)}
              className="rounded-2xl border bg-white p-5 text-left shadow-sm"
            >
              <div className="flex justify-between">
                <p className="font-extrabold text-[#143d1a]">
                  {employeeName(e)}
                </p>
                <span className="text-xs font-bold text-[#9a7a17]">
                  {e.employee_number}
                </span>
              </div>
              <p className="mt-2 text-sm">{e.job_title || e.department}</p>
              <p className="text-xs text-neutral-500">
                {e.department} · {e.employment_status}
              </p>
            </button>
          ))}
          {!visible.length && (
            <p className="col-span-full rounded-2xl border border-dashed p-10 text-center text-neutral-500">
              No employees found.
            </p>
          )}
        </section>
      )}
      {editing && (
        <EmployeeForm
          employee={editing === "new" ? null : editing}
          close={() => setEditing(null)}
          saved={async () => {
            setEditing(null);
            await load();
            setNotice("Employee saved.");
          }}
        />
      )}
      {detail && (
        <EmployeeDetail
          employee={detail}
          crews={crews}
          close={() => setDetail(null)}
          edit={() => {
            setEditing(detail);
            setDetail(null);
          }}
          archived={async () => {
            await archiveEmployee(detail.id);
            setDetail(null);
            await load();
            setNotice("Employee archived.");
          }}
        />
      )}
      {manageCrews && (
        <CrewManager
          employees={rows}
          close={() => setManageCrews(false)}
          changed={load}
        />
      )}
    </>
  );
}
function EmployeeForm({
  employee,
  close,
  saved,
}: {
  employee: Employee | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [f, setF] = useState<EmployeeInput>(
    employee
      ? pick(employee)
      : {
          first_name: "",
          last_name: "",
          preferred_name: null,
          email: null,
          phone: null,
          department: "Scrub Technicians",
          job_title: null,
          employment_status: "Active",
          employment_type: "Full-Time",
          hourly_rate: 0,
          overtime_rate: 0,
          commission_rate: 0,
          hire_date: null,
          notes: null,
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!f.first_name.trim() || !f.last_name.trim())
      return setError("First and last name are required.");
    setSaving(true);
    try {
      if (employee) await updateEmployee(employee.id, f);
      else await createEmployee(f);
      await saved();
    } catch (x) {
      console.error("Employee save failed", x);
      setError(message(x));
      setSaving(false);
    }
  }
  return (
    <Modal title={employee ? "Edit Employee" : "Add Employee"} close={close}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          l="First Name"
          v={f.first_name}
          set={(v) => setF({ ...f, first_name: v })}
        />
        <Field
          l="Last Name"
          v={f.last_name}
          set={(v) => setF({ ...f, last_name: v })}
        />
        <Field
          l="Preferred Name"
          v={f.preferred_name ?? ""}
          set={(v) => setF({ ...f, preferred_name: v || null })}
        />
        <Field
          l="Email"
          type="email"
          v={f.email ?? ""}
          set={(v) => setF({ ...f, email: v || null })}
        />
        <Field
          l="Phone"
          v={f.phone ?? ""}
          set={(v) => setF({ ...f, phone: v || null })}
        />
        <SelectField
          l="Department"
          v={f.department}
          values={EMPLOYEE_DEPARTMENTS}
          set={(v) => setF({ ...f, department: v as EmployeeDepartment })}
        />
        <Field
          l="Job Title"
          v={f.job_title ?? ""}
          set={(v) => setF({ ...f, job_title: v || null })}
        />
        <SelectField
          l="Employment Status"
          v={f.employment_status}
          values={EMPLOYMENT_STATUSES}
          set={(v) => setF({ ...f, employment_status: v as EmploymentStatus })}
        />
        <SelectField
          l="Employment Type"
          v={f.employment_type ?? ""}
          values={EMPLOYMENT_TYPES}
          set={(v) => setF({ ...f, employment_type: v as EmploymentType })}
        />
        <Field
          l="Hourly Rate"
          type="number"
          v={String(f.hourly_rate)}
          set={(v) => setF({ ...f, hourly_rate: Number(v) })}
        />
        <Field
          l="Overtime Rate"
          type="number"
          v={String(f.overtime_rate ?? 0)}
          set={(v) => setF({ ...f, overtime_rate: Number(v) })}
        />
        <Field
          l="Commission Rate"
          type="number"
          v={String(f.commission_rate)}
          set={(v) => setF({ ...f, commission_rate: Number(v) })}
        />
        <Field
          l="Hire Date"
          type="date"
          v={f.hire_date ?? ""}
          set={(v) => setF({ ...f, hire_date: v || null })}
        />
        <label className="sm:col-span-2 text-sm font-bold">
          Notes
          <textarea
            className={`${input} mt-2 h-24 py-3`}
            value={f.notes ?? ""}
            onChange={(e) => setF({ ...f, notes: e.target.value || null })}
          />
        </label>
      </div>
      {error && <Alert text={error} />}
      <button
        disabled={saving}
        onClick={() => void submit()}
        className={`${primary} mt-5`}
      >
        {saving ? "Saving…" : "Save Employee"}
      </button>
    </Modal>
  );
}
function EmployeeDetail({
  employee,
  crews,
  close,
  edit,
  archived,
}: {
  employee: Employee;
  crews: CrewWithRelations[];
  close: () => void;
  edit: () => void;
  archived: () => Promise<void>;
}) {
  const current =
    crews
      .filter((c) => c.members.some((m) => m.employee_id === employee.id))
      .map((c) => c.crew_name)
      .join(", ") || "Unassigned";
  return (
    <Modal title={employeeName(employee)} close={close}>
      <Details
        rows={[
          ["Employee Number", employee.employee_number],
          ["Email", employee.email || "—"],
          ["Phone", employee.phone || "—"],
          ["Department", employee.department],
          ["Job Title", employee.job_title || "—"],
          ["Status", employee.employment_status],
          ["Type", employee.employment_type || "—"],
          ["Hourly Rate", money(employee.hourly_rate)],
          ["Overtime Rate", money(employee.overtime_rate || employee.hourly_rate * 1.5)],
          ["Commission", `${employee.commission_rate}%`],
          ["Hire Date", employee.hire_date || "—"],
          ["Current Crew", current],
          ["Notes", employee.notes || "—"],
          ["Created", new Date(employee.created_at).toLocaleDateString()],
          ["Updated", new Date(employee.updated_at).toLocaleDateString()],
        ]}
      />
      <EmployeeTimeSummary employeeId={employee.id} />
      <div className="mt-5 flex gap-2">
        <button className={primary} onClick={edit}>
          Edit
        </button>
        {!employee.archived_at && (
          <button className={secondary} onClick={() => void archived()}>
            Archive
          </button>
        )}
      </div>
    </Modal>
  );
}
function pick(e: Employee): EmployeeInput {
  const {
    id: _,
    employee_number: __,
    created_at: ___,
    updated_at: ____,
    archived_at: _____,
    ...input
  } = e;
  void _;
  void __;
  void ___;
  void ____;
  void _____;
  return input;
}
function Header({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-7">
      <div>
        <h1 className="text-3xl font-extrabold text-[#143d1a]">{title}</h1>
        <p className="mt-3 text-neutral-600">{description}</p>
      </div>
      <div className="flex gap-2">{actions}</div>
    </header>
  );
}
function Metric({ l, v }: { l: string; v: string | number }) {
  return (
    <article className="rounded-2xl border bg-white p-5">
      <p className="text-xs font-bold uppercase text-neutral-500">{l}</p>
      <p className="mt-3 text-3xl font-extrabold text-[#143d1a]">{v}</p>
    </article>
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
      <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6">
        <button onClick={close} className="float-right text-xl">
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
        className={`${input} mt-2`}
        type={type}
        value={v}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function SelectField({
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
      <select
        className={`${input} mt-2`}
        value={v}
        onChange={(e) => set(e.target.value)}
      >
        {values.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </label>
  );
}
function Select({
  value,
  set,
  values,
}: {
  value: string;
  set: (v: string) => void;
  values: readonly string[];
}) {
  return (
    <select
      className={input}
      value={value}
      onChange={(e) => set(e.target.value)}
    >
      {values.map((x) => (
        <option key={x}>{x}</option>
      ))}
    </select>
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
function message(x: unknown) {
  return x instanceof Error ? x.message : "Operation failed.";
}
function money(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(v);
}
const input =
  "h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm";
const primary =
  "rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary =
  "rounded-lg border px-4 py-2.5 text-sm font-bold text-[#143d1a]";
