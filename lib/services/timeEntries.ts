import { getSupabaseClient } from "@/lib/supabase/client";
import {
  allocateDailyOvertime,
  calculatePaidHours,
  calculatePay,
} from "@/lib/payroll/timeCalculations";
import { employeeName } from "@/types/employee";
import type {
  CrewLaborSummary,
  EmployeeTimeSummary,
  JobLaborSummary,
  JobProfitabilitySummary,
  TimeEntry,
  TimeEntryInput,
  TimeEntryWithRelations,
  OperationalActiveTimeEntry,
} from "@/types/timeEntry";
import { getCurrentProfile } from "@/lib/services/auth";
import { isMasterAdmin } from "@/lib/auth/permissions";
const select =
  "*, employee:employees!time_entries_employee_id_fkey(*), job:jobs!time_entries_job_id_fkey(*), crew:crews!time_entries_crew_id_fkey(*)";
export async function getTimeEntries(): Promise<TimeEntryWithRelations[]> {
  if (!(await master())) return getOperationalTimeEntries();
  const { data, error } = await getSupabaseClient()
    .from("time_entries")
    .select(select)
    .order("clock_in", { ascending: false });
  if (error) throw error;
  return data as TimeEntryWithRelations[];
}
export async function getOpenTimeEntries() {
  if (!(await master())) return (await getOperationalTimeEntries()).filter((entry)=>entry.status==="Open"&&!entry.clock_out&&!entry.archived_at);
  const { data, error } = await getSupabaseClient()
    .from("time_entries")
    .select(select)
    .eq("status", "Open")
    .is("clock_out", null)
    .is("archived_at", null)
    .order("clock_in");
  if (error) throw error;
  return data as TimeEntryWithRelations[];
}
export async function getOperationalActiveTimeEntries(): Promise<OperationalActiveTimeEntry[]> {
  const { data, error } = await getSupabaseClient().rpc("get_operational_time_entries");
  if (error) throw error;
  return (data ?? [])
    .filter((entry) => entry.status === "Open" && !entry.clock_out && !entry.archived_at && Boolean(entry.employee_id))
    .sort((a, b) => Date.parse(a.clock_in) - Date.parse(b.clock_in))
    .map((entry) => ({
      id: entry.id,
      employee_id: entry.employee_id as string,
      employee_name: entry.employee_name,
      clock_in: entry.clock_in,
      job_id: entry.job_id,
      job_number: entry.job_number,
    }));
}
export async function clockInCurrentEmployeeGeneral() {
  const profile = await getCurrentProfile();
  if (!profile?.employee_id) throw new Error("Your user profile is not linked to an Employee.");
  const { data, error } = await getSupabaseClient().rpc("clock_in_operational", {
    p_employee_id: profile.employee_id,
    p_job_id: null,
    p_crew_id: null,
    p_entry_type: "Other",
    p_clock_in: new Date().toISOString(),
    p_notes: "General work clock-in from Dashboard",
  });
  if (error) throw new Error(safeOperationalMessage(error, "Clock-in failed. Please try again."));
  return data;
}
export async function clockOutCurrentEmployeeGeneral(timeEntryId: string, breakMinutes: number) {
  const profile = await getCurrentProfile();
  if (!profile?.employee_id) throw new Error("Your user profile is not linked to an Employee.");
  const current = (await getOperationalActiveTimeEntries()).find((entry) => entry.employee_id === profile.employee_id);
  if (!current || current.id !== timeEntryId) throw new Error("Your active time entry could not be confirmed.");
  if (current.job_id) throw new Error("End Job participation from the Job workflow.");
  const { data, error } = await getSupabaseClient().rpc("clock_out_operational", {
    p_time_entry_id: timeEntryId,
    p_clock_out: new Date().toISOString(),
    p_break_minutes: breakMinutes,
  });
  if (error) throw new Error(safeOperationalMessage(error, "Clock-out failed. Please try again."));
  return data;
}
export async function getTimeEntriesForEmployee(employeeId: string) {
  return filtered("employee_id", employeeId);
}
export async function getTimeEntriesForJob(jobId: string) {
  return filtered("job_id", jobId);
}
export async function clockInEmployee(
  input: Omit<TimeEntryInput, "clock_out" | "break_minutes">,
): Promise<TimeEntry> {
  if (!(await master())) {
    const {data,error}=await getSupabaseClient().rpc("clock_in_operational",{p_employee_id:input.employee_id,p_job_id:input.job_id,p_crew_id:input.crew_id,p_entry_type:input.entry_type,p_clock_in:input.clock_in,p_notes:input.notes});
    if(error)throw error;return operationalEntry(data);
  }
  const existing = await getOpenForEmployee(input.employee_id);
  if (existing)
    throw new Error(
      `${employeeName(existing.employee)} is already clocked in.`,
    );
  for (let i = 0; i < 5; i++) {
    const { data, error } = await getSupabaseClient()
      .from("time_entries")
      .insert({
        ...input,
        clock_out: null,
        break_minutes: 0,
        time_entry_number: number(),
        status: "Open",
      })
      .select()
      .single();
    if (!error) return data;
    if (error.code === "23505") {
      const open = await getOpenForEmployee(input.employee_id);
      if (open)
        throw new Error(
          `${employeeName(open.employee)} is already clocked in.`,
        );
      continue;
    }
    throw error;
  }
  throw new Error("A unique time entry number could not be generated.");
}
export async function clockOutEmployee(
  id: string,
  clockOut: string,
  breakMinutes: number,
) {
  if (!(await master())) {
    const {data,error}=await getSupabaseClient().rpc("clock_out_operational",{p_time_entry_id:id,p_clock_out:clockOut,p_break_minutes:breakMinutes});
    if(error)throw error;return operationalEntry(data);
  }
  const entry = await getById(id);
  if (entry.status !== "Open" || entry.clock_out)
    throw new Error("This time entry is not currently open.");
  calculatePaidHours(entry.clock_in, clockOut, breakMinutes);
  const { error } = await getSupabaseClient()
    .from("time_entries")
    .update({
      clock_out: clockOut,
      break_minutes: breakMinutes,
      status: "Completed",
    })
    .eq("id", id);
  if (error) throw error;
  await recalculateEmployeeDay(entry.employee_id, entry.work_date);
  return getById(id);
}
export async function createManualTimeEntry(input: TimeEntryInput) {
  if (!(await master())) return saveOperational(null,input);
  if (!input.clock_out)
    throw new Error("Manual completed entries require a clock-out time.");
  calculatePaidHours(input.clock_in, input.clock_out, input.break_minutes ?? 0);
  for (let i = 0; i < 5; i++) {
    const employee = await employeeRow(input.employee_id),
      ot = employee.overtime_rate || employee.hourly_rate * 1.5;
    const { data, error } = await getSupabaseClient()
      .from("time_entries")
      .insert({
        ...input,
        time_entry_number: number(),
        status: "Completed",
        hourly_rate_snapshot: employee.hourly_rate,
        overtime_rate_snapshot: ot,
      })
      .select()
      .single();
    if (!error) {
      await recalculateEmployeeDay(input.employee_id, input.work_date);
      return getById(data.id);
    }
    if (error.code !== "23505") throw error;
  }
  throw new Error("A unique time entry number could not be generated.");
}
export async function updateTimeEntry(id: string, input: TimeEntryInput) {
  if (!(await master())) return saveOperational(id,input);
  const before = await getById(id);
  if (input.clock_out)
    calculatePaidHours(
      input.clock_in,
      input.clock_out,
      input.break_minutes ?? 0,
    );
  const status = input.clock_out
    ? before.status === "Approved"
      ? "Approved"
      : "Completed"
    : "Open";
  if (status === "Open") {
    const existing = await getOpenForEmployee(input.employee_id);
    if (existing && existing.id !== id)
      throw new Error(
        `${employeeName(existing.employee)} is already clocked in.`,
      );
  }
  const { error } = await getSupabaseClient()
    .from("time_entries")
    .update({ ...input, status })
    .eq("id", id);
  if (error) throw error;
  await recalculateEmployeeDay(before.employee_id, before.work_date);
  if (
    before.employee_id !== input.employee_id ||
    before.work_date !== input.work_date
  )
    await recalculateEmployeeDay(input.employee_id, input.work_date);
  return getById(id);
}
export async function approveTimeEntry(id: string) {
  if (!(await master())) return reviewOperational(id,"Approved",null);
  const entry = await getById(id);
  if (!entry.clock_out)
    throw new Error("Clock out this entry before approval.");
  const { error } = await getSupabaseClient()
    .from("time_entries")
    .update({
      status: "Approved",
      approved_at: new Date().toISOString(),
      approved_by: "Master Admin",
    })
    .eq("id", id);
  if (error) throw error;
  await recalculateEmployeeDay(entry.employee_id, entry.work_date);
  return getById(id);
}
export async function rejectTimeEntry(id: string, notes: string) {
  if (!(await master())) return reviewOperational(id,"Rejected",notes);
  const entry = await getById(id);
  const { error } = await getSupabaseClient()
    .from("time_entries")
    .update({
      status: "Rejected",
      notes: notes || entry.notes,
      approved_at: null,
      approved_by: null,
    })
    .eq("id", id);
  if (error) throw error;
  await recalculateEmployeeDay(entry.employee_id, entry.work_date);
  return getById(id);
}
export async function archiveTimeEntry(id: string) {
  if (!(await master())) return reviewOperational(id,"Archived",null);
  const entry = await getById(id);
  const { error } = await getSupabaseClient()
    .from("time_entries")
    .update({ status: "Archived", archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  await recalculateEmployeeDay(entry.employee_id, entry.work_date);
  return getById(id);
}
export async function recalculateEmployeeDay(
  employeeId: string | null,
  workDate: string,
) {
  if (!employeeId) return;
  const employee = await employeeRow(employeeId);
  const { data, error } = await getSupabaseClient()
    .from("time_entries")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("work_date", workDate)
    .in("status", ["Completed", "Approved"])
    .is("archived_at", null)
    .order("clock_in");
  if (error) throw error;
  let regularAllocated = 0;
  for (const entry of data as TimeEntry[]) {
    if (!entry.clock_out) continue;
    const total = calculatePaidHours(
        entry.clock_in,
        entry.clock_out,
        entry.break_minutes,
      ),
      allocation = allocateDailyOvertime(total, regularAllocated),
      hourly = entry.hourly_rate_snapshot || employee.hourly_rate,
      ot =
        entry.overtime_rate_snapshot || employee.overtime_rate || hourly * 1.5,
      pay = calculatePay(
        allocation.regularHours,
        allocation.overtimeHours,
        hourly,
        ot,
      );
    regularAllocated += allocation.regularHours;
    const { error: updateError } = await getSupabaseClient()
      .from("time_entries")
      .update({
        total_hours: total,
        regular_hours: allocation.regularHours,
        overtime_hours: allocation.overtimeHours,
        hourly_rate_snapshot: hourly,
        overtime_rate_snapshot: ot,
        regular_pay: pay.regularPay,
        overtime_pay: pay.overtimePay,
        gross_pay: pay.grossPay,
      })
      .eq("id", entry.id);
    if (updateError) throw updateError;
  }
}
export async function getEmployeeTimeSummary(
  employeeId: string,
): Promise<EmployeeTimeSummary> {
  const rows = await getTimeEntriesForEmployee(employeeId),
    active = rows.filter(paid),
    now = new Date(),
    week = startOfWeek(now),
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return {
    currentWeekHours: sum(
      active.filter((x) => x.work_date >= week),
      "total_hours",
    ),
    currentMonthHours: sum(
      active.filter((x) => x.work_date >= month),
      "total_hours",
    ),
    regularHours: sum(active, "regular_hours"),
    overtimeHours: sum(active, "overtime_hours"),
    estimatedGrossPay: sum(active, "gross_pay"),
    recent: rows.slice(0, 5),
  };
}
export async function getJobLaborSummary(
  jobId: string,
): Promise<JobLaborSummary> {
  const rows = (await getTimeEntriesForJob(jobId)).filter(paid);
  return {
    employeesWorked: new Set(rows.map((x) => x.employee_id)).size,
    regularHours: sum(rows, "regular_hours"),
    overtimeHours: sum(rows, "overtime_hours"),
    totalHours: sum(rows, "total_hours"),
    actualLaborCost: sum(rows, "gross_pay"),
  };
}
export async function getJobProfitabilitySummary(
  jobId: string,
): Promise<JobProfitabilitySummary> {
  const labor = await getJobLaborSummary(jobId),
    db = getSupabaseClient();
  const [
    { data: invoices, error: invoiceError },
    { data: expenses, error: expenseError },
  ] = await Promise.all([
    db
      .from("invoices")
      .select("id")
      .eq("job_id", jobId)
      .not("status", "in", "(Cancelled,Archived)")
      .is("archived_at", null),
    db
      .from("expenses")
      .select("amount")
      .eq("job_id", jobId)
      .eq("status", "Active")
      .is("archived_at", null),
  ]);
  if (invoiceError) throw invoiceError;
  if (expenseError) throw expenseError;
  const ids = (invoices ?? []).map((x) => x.id);
  let collectedRevenue = 0;
  if (ids.length) {
    const { data, error } = await db
      .from("payments")
      .select("amount")
      .in("invoice_id", ids);
    if (error) throw error;
    collectedRevenue = (data ?? []).reduce((n, x) => n + Number(x.amount), 0);
  }
  const expenseTotal = (expenses ?? []).reduce(
      (n, x) => n + Number(x.amount),
      0,
    ),
    grossProfit = collectedRevenue - expenseTotal - labor.actualLaborCost;
  return {
    ...labor,
    collectedRevenue,
    expenses: expenseTotal,
    grossProfit,
    grossMargin: collectedRevenue
      ? (grossProfit / collectedRevenue) * 100
      : null,
  };
}
export async function getCrewLaborSummary(
  crewId: string,
): Promise<CrewLaborSummary> {
  const rows = (await filtered("crew_id", crewId)).filter(paid),
    now = new Date(),
    week = startOfWeek(now),
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return {
    currentWeekHours: sum(
      rows.filter((x) => x.work_date >= week),
      "total_hours",
    ),
    currentMonthHours: sum(
      rows.filter((x) => x.work_date >= month),
      "total_hours",
    ),
    jobsWorked: new Set(rows.map((x) => x.job_id).filter(Boolean)).size,
    estimatedGrossLaborCost: sum(rows, "gross_pay"),
  };
}
async function filtered(
  column: "employee_id" | "job_id" | "crew_id",
  id: string,
) {
  if (!(await master())) return (await getOperationalTimeEntries()).filter((entry)=>entry[column]===id);
  const { data, error } = await getSupabaseClient()
    .from("time_entries")
    .select(select)
    .eq(column, id)
    .order("clock_in", { ascending: false });
  if (error) throw error;
  return data as TimeEntryWithRelations[];
}
async function getById(id: string) {
  if (!(await master())) {const entry=(await getOperationalTimeEntries()).find((row)=>row.id===id);if(!entry)throw new Error("Time entry not found or access denied.");return entry}
  const { data, error } = await getSupabaseClient()
    .from("time_entries")
    .select(select)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as TimeEntryWithRelations;
}
async function getOpenForEmployee(id: string) {
  const { data, error } = await getSupabaseClient()
    .from("time_entries")
    .select(select)
    .eq("employee_id", id)
    .eq("status", "Open")
    .is("clock_out", null)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as TimeEntryWithRelations | null;
}
async function employeeRow(id: string) {
  const { data, error } = await getSupabaseClient()
    .from("employees")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}
function paid(x: TimeEntry) {
  return ["Completed", "Approved"].includes(x.status) && !x.archived_at;
}
function sum(
  rows: TimeEntry[],
  key: "total_hours" | "regular_hours" | "overtime_hours" | "gross_pay",
) {
  return rows.reduce((n, x) => n + Number(x[key]), 0);
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  return local(x);
}
function local(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function number() {
  const d = new Date();
  return `TIME-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}
async function master(){return isMasterAdmin(await getCurrentProfile())}
async function getOperationalTimeEntries(){const{data,error}=await getSupabaseClient().rpc("get_operational_time_entries");if(error)throw error;return data.map(operationalEntry)}
function operationalEntry(row:Omit<TimeEntry,"hourly_rate_snapshot"|"overtime_rate_snapshot"|"regular_pay"|"overtime_pay"|"gross_pay">&{employee_number:string;employee_name:string;job_number:string|null;crew_name:string|null}):TimeEntryWithRelations{return{...row,hourly_rate_snapshot:0,overtime_rate_snapshot:0,regular_pay:0,overtime_pay:0,gross_pay:0,employee:row.employee_id?{id:row.employee_id,employee_number:row.employee_number,first_name:row.employee_name,last_name:"",preferred_name:null,email:null,phone:null,department:"Scrub Technicians",job_title:null,employment_status:"Active",employment_type:null,hourly_rate:0,overtime_rate:0,commission_rate:0,hire_date:null,notes:null,created_at:row.created_at,updated_at:row.updated_at,archived_at:null}:null,job:null,crew:null}}
async function saveOperational(id:string|null,input:TimeEntryInput){const{data,error}=await getSupabaseClient().rpc("save_operational_time_entry",{p_time_entry_id:id,p_employee_id:input.employee_id,p_job_id:input.job_id,p_crew_id:input.crew_id,p_entry_type:input.entry_type,p_clock_in:input.clock_in,p_clock_out:input.clock_out??null,p_break_minutes:input.break_minutes??0,p_notes:input.notes});if(error)throw error;return operationalEntry(data)}
function safeOperationalMessage(cause: unknown, fallback: string) { const detail = cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" ? cause.message.trim() : ""; return detail && !/jwt|token|secret|authorization header|service[_ -]?role/i.test(detail) ? detail : fallback; }
async function reviewOperational(id:string,status:"Approved"|"Rejected"|"Archived",notes:string|null){const{data,error}=await getSupabaseClient().rpc("review_operational_time_entry",{p_time_entry_id:id,p_status:status,p_notes:notes});if(error)throw error;return operationalEntry(data)}
