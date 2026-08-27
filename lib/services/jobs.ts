import { getSupabaseClient } from "@/lib/supabase/client";
import type {
  CrewConflict,
  Job,
  JobStatus,
  JobUpdate,
  JobWithRelations,
  DirectJobInput,
  JobClockInResult,
  JobClockOutResult,
  JobClockState,
} from "@/types/job";
import type { CrewWithRelations } from "@/types/crew";
import { getCurrentProfile } from "@/lib/services/auth";
import { canPermanentlyDelete, isMasterAdmin } from "@/lib/auth/permissions";
import { employeeName } from "@/types/employee";
import { getTimeEntriesForJob } from "@/lib/services/timeEntries";
import type { Invoice } from "@/types/invoice";
import { notifyAttentionRefresh } from "@/lib/attentionEvents";

export type JobCompletionResult = {
  job: JobWithRelations;
  invoice: Pick<Invoice, "id" | "invoice_number"> | null;
  invoiceCreated: boolean;
  invoiceSkipped: boolean;
  invoiceError: string | null;
};

export function isJobCompletionResult(value: unknown): value is JobCompletionResult {
  return Boolean(value && typeof value === "object" && "invoiceSkipped" in value);
}

const select =
  "*, proposal:proposals!jobs_proposal_id_fkey(*), client:clients!jobs_client_id_fkey(*), property:properties!jobs_property_id_fkey(*)";
export async function getJobs(): Promise<JobWithRelations[]> {
  if (!(await master())) {
    const { data, error } = await getSupabaseClient().rpc("get_operational_jobs", {});
    if (error) throw error;
    return data.map(operationalJob);
  }
  const { data: ids, error: idsError } = await getSupabaseClient().rpc("get_operational_job_ids", {});
  if (idsError) throw idsError;
  if (!ids.length) return [];
  const jobsResult = await getSupabaseClient().from("jobs").select(select).in("id", ids).order("created_at", { ascending: false });
  if (jobsResult.error) throw jobsResult.error;
  return jobsResult.data as JobWithRelations[];
}
export async function getJobsForDateRange(
  start: string,
  end: string,
): Promise<JobWithRelations[]> {
  if (!(await master())) {
    const { data, error } = await getSupabaseClient().rpc("get_operational_jobs", { p_start: start, p_end: end });
    if (error) throw error;
    return data.map(operationalJob).filter((job) => !job.archived_at && job.status !== "Archived").sort((a,b)=>(a.scheduled_date??"").localeCompare(b.scheduled_date??"")||(a.start_time??"").localeCompare(b.start_time??""));
  }
  const { data: ids, error: idsError } = await getSupabaseClient().rpc("get_operational_job_ids", { p_start: start, p_end: end });
  if (idsError) throw idsError;
  if (!ids.length) return [];
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .select(select)
    .in("id", ids)
    .order("scheduled_date")
    .order("start_time");
  if (error) throw error;
  return data as JobWithRelations[];
}
export async function getJobById(id: string): Promise<JobWithRelations> {
  if (!(await master())) {
    const jobs = await getJobs(); const job = jobs.find((row) => row.id === id);
    if (!job) throw new Error("Job not found or access denied."); return attachOccurrenceBilling(job);
  }
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .select(select)
    .eq("id", id)
    .single();
  if (error) throw error;
  return attachOccurrenceBilling(data as JobWithRelations);
}
async function attachOccurrenceBilling(job:JobWithRelations){if(!job.service_occurrence_id)return job;const{data,error}=await getSupabaseClient().from("service_occurrences").select("agreement:service_agreements!service_occurrences_agreement_id_fkey(billing_type,agreement_number)").eq("id",job.service_occurrence_id).maybeSingle();if(error)throw error;return{...job,service_occurrence:data as JobWithRelations["service_occurrence"]}}
export async function getJobForProposal(
  proposalId: string,
): Promise<JobWithRelations | null> {
  if (!(await master())) return (await getJobs()).find((job)=>job.proposal_id===proposalId)??null;
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .select(select)
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as JobWithRelations | null;
}
export async function getJobProposalIds(): Promise<string[]> {
  if (!(await master())) {
    const { data, error } = await getSupabaseClient().rpc("get_operational_jobs", {});
    if (error) throw error;
    return [...new Set(data.map((job) => job.proposal_id).filter((id): id is string => Boolean(id)))];
  }
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .select("proposal_id")
    .is("archived_at", null);
  if (error) throw error;
  return [
    ...new Set(
      (data ?? [])
        .map((row) => row.proposal_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}
export async function createJobFromProposal(
  proposalId: string,
): Promise<JobWithRelations> {
  const { data, error } = await getSupabaseClient().rpc("create_job_from_accepted_proposal", {
    p_proposal_id: proposalId,
  });
  if (error) throw new Error(safeDatabaseMessage(error, "Job could not be created."));
  if (!data) throw new Error("The Job creation result was empty.");
  const visible = await getJobForProposal(proposalId).catch(() => null);
  return visible ?? fullJob(data);
}
export async function createDirectJob(input: DirectJobInput): Promise<JobWithRelations> {
  const { data, error } = await getSupabaseClient().rpc("create_direct_operational_job", {
    p_client_id: input.client_id,
    p_property_id: input.property_id,
    p_service_id: input.service_id,
    p_addon_ids: input.addon_ids,
    p_scheduled_date: input.scheduled_date,
    p_start_time: input.start_time,
    p_estimated_duration: input.estimated_duration,
    p_assigned_crew_id: input.assigned_crew_id,
    p_labor_hours: input.labor_hours,
    p_access_instructions: input.access_instructions,
    p_internal_notes: input.internal_notes,
    p_master_price_override: input.price_override ?? null,
  });
  if (error) throw new Error(safeDatabaseMessage(error, "Job could not be created."));
  if (!data) throw new Error("The Job creation result was empty.");
  return getJobById(data.id).catch(() => fullJob(data));
}
export async function updateJob(id: string, input: JobUpdate): Promise<JobWithRelations> {
  if (!(await master())) {
    const forbidden = ["price","deposit","balance","labor_hours","recommended_crew_size","proposal_id","client_id","property_id"] as const;
    if (forbidden.some((field) => field in input)) throw new Error("This role cannot change Job financial or relationship fields.");
    const { data, error } = await getSupabaseClient().rpc("update_operational_job", {
      p_job_id:id,p_scheduled_date:input.scheduled_date,p_start_time:input.start_time,
      p_estimated_duration:input.estimated_duration,p_assigned_crew_id:input.assigned_crew_id,
      p_internal_notes:input.internal_notes,p_status:input.status,
    });
    if (error) throw error; return operationalJob(data);
  }
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return fullJob(data);
}
export async function updateJobStatus(id: string, status: JobStatus) {
  if (status === "Scheduled") {
    const job = await getJobById(id);
    if (!job.scheduled_date)
      throw new Error(
        "Set a scheduled date before moving this job to Scheduled.",
      );
  }
  if (status === "Completed") {
    const job = await updateJob(id, { status, completed_at: new Date().toISOString() });
    return createCompletedJobInvoice(job);
  }
  return updateJob(id, { status, completed_at: null });
}

async function createCompletedJobInvoice(job: JobWithRelations): Promise<JobCompletionResult> {
  try {
    // Dynamic loading avoids a runtime jobs <-> invoices module cycle while keeping
    // completion and its invoice handoff in the shared workflow service.
    const { createCompletedJobInvoice: createAuthorizedInvoice } = await import("@/lib/services/invoices");
    const result = await createAuthorizedInvoice(job.id);
    if (result.skipped) {
      return { job, invoice: null, invoiceCreated: false, invoiceSkipped: true, invoiceError: null };
    }
    if (!result.invoice_id || !result.invoice_number) throw new Error("The completed Job invoice was not returned.");
    return {
      job,
      invoice: { id: result.invoice_id, invoice_number: result.invoice_number },
      invoiceCreated: result.created,
      invoiceSkipped: false,
      invoiceError: null,
    };
  } catch (cause) {
    console.error("Completed Job invoice creation failed", cause);
    const detail = errorMessage(cause);
    return {
      job,
      invoice: null,
      invoiceCreated: false,
      invoiceSkipped: false,
      invoiceError: `Job was completed, but its Invoice could not be created${detail ? `: ${detail}` : "."}`,
    };
  }
}
export async function assignJobCrew(
  id: string,
  crew: CrewWithRelations,
  hasScheduledDate: boolean,
) {
  const current = await getJobById(id);
  return updateJob(id, {
    assigned_crew_id: crew.id,
    assigned_crew_name: crew.crew_name,
    crew_lead_name: crew.crew_lead ? employeeName(crew.crew_lead) : null,
    assigned_team: crew.members.map((m) => employeeName(m.employee)),
    status:
      hasScheduledDate && Boolean(current.scheduled_date)
        ? "Crew Assigned"
        : undefined,
  });
}
export async function findCrewConflicts(
  jobId: string,
  crewId: string,
  date: string,
  startTime: string,
  duration: number,
): Promise<CrewConflict[]> {
  if (!crewId || !date || !startTime) return [];
  if (!(await master())) {
    return (await getJobs())
      .filter((job) => job.id !== jobId && job.assigned_crew_id === crewId && job.scheduled_date === date && !job.archived_at && !["Cancelled", "Archived"].includes(job.status))
      .filter((job) => {
        if (!job.start_time) return false;
        const start = minutes(startTime), end = start + Math.max(duration, 0) * 60;
        const otherStart = minutes(job.start_time), otherEnd = otherStart + Math.max(job.estimated_duration ?? 0, 0) * 60;
        return start < otherEnd && otherStart < end;
      })
      .map(({ id, job_number, client_name, property_name, scheduled_date, start_time, estimated_duration }) => ({ id, job_number, client_name, property_name, scheduled_date, start_time, estimated_duration }));
  }
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .select(select)
    .eq("assigned_crew_id", crewId)
    .eq("scheduled_date", date)
    .neq("id", jobId)
    .is("archived_at", null)
    .not("status", "in", "(Cancelled,Archived)");
  if (error) throw error;
  const start = minutes(startTime);
  const end = start + Math.max(duration, 0) * 60;
  return (data as JobWithRelations[])
    .filter((job) => {
      if (!job.start_time) return false;
      const otherStart = minutes(job.start_time);
      const otherEnd =
        otherStart + Math.max(job.estimated_duration ?? 0, 0) * 60;
      return start < otherEnd && otherStart < end;
    })
    .map(
      ({
        id,
        job_number,
        client_name,
        property_name,
        scheduled_date,
        start_time,
        estimated_duration,
      }) => ({
        id,
        job_number,
        client_name,
        property_name,
        scheduled_date,
        start_time,
        estimated_duration,
      }),
    );
}
export const getCrewConflicts = (
  jobId: string,
  crewId: string,
  date: string,
  time: string | null,
) => findCrewConflicts(jobId, crewId, date, time ?? "", 0.01);
export async function scheduleJob(
  id: string,
  date: string,
  time: string,
  duration: number | null,
  current: JobStatus,
) {
  if (!date) throw new Error("Scheduled date is required.");
  return updateJob(id, {
    scheduled_date: date,
    start_time: time || null,
    estimated_duration: duration,
    status: current === "Ready to Schedule" ? "Scheduled" : current,
  });
}
export async function rescheduleJob(
  id: string,
  date: string,
  time: string,
  duration: number | null,
  crew: CrewWithRelations | null,
  current: JobStatus,
) {
  if (!date || !time)
    throw new Error("Scheduled date and start time are required.");
  const crewFields = crew
    ? {
        assigned_crew_id: crew.id,
        assigned_crew_name: crew.crew_name,
        crew_lead_name: crew.crew_lead ? employeeName(crew.crew_lead) : null,
        assigned_team: crew.members.map((m) => employeeName(m.employee)),
      }
    : {};
  const next: JobStatus = crew
    ? "Crew Assigned"
    : current === "Ready to Schedule"
      ? "Scheduled"
      : current === "Crew Assigned"
        ? "Scheduled"
        : current;
  return updateJob(id, {
    scheduled_date: date,
    start_time: time,
    estimated_duration: duration,
    ...crewFields,
    status: next,
  });
}
export async function getCurrentJobClockState(jobId: string): Promise<JobClockState> {
  const profile = await getCurrentProfile();
  const open = (await getTimeEntriesForJob(jobId)).filter((entry) => entry.status === "Open" && !entry.clock_out && !entry.archived_at);
  const current = profile?.employee_id
    ? open.find((entry) => entry.employee_id === profile.employee_id) ?? null
    : null;
  return { clockedIn: Boolean(current), clockedInAt: current?.clock_in ?? null, timeEntryId: current?.id ?? null, activeWorkerCount: open.length };
}
export async function startOrClockInToJob(id: string): Promise<JobClockInResult> {
  const { data, error } = await getSupabaseClient().rpc("start_or_clock_in_to_job", { p_job_id: id });
  if (error) throw new Error(safeDatabaseMessage(error, "Job clock-in failed."));
  return data as JobClockInResult;
}
export async function startOperationalJob(id: string): Promise<JobWithRelations> {
  const { data, error } = await getSupabaseClient().rpc("start_operational_job", { p_job_id: id });
  if (error) throw new Error(safeDatabaseMessage(error, "Job could not be started."));
  return operationalJob(data);
}
export async function finishJobAndClockOut(id: string, breakMinutes = 0): Promise<JobClockOutResult> {
  const { data, error } = await getSupabaseClient().rpc("finish_job_and_clock_out", { p_job_id: id, p_break_minutes: breakMinutes });
  if (error) throw new Error(safeDatabaseMessage(error, "Job clock-out failed."));
  return data as JobClockOutResult;
}
export async function completeInProgressJob(id: string): Promise<JobCompletionResult> {
  const { data, error } = await getSupabaseClient().rpc("complete_in_progress_job", { p_job_id: id });
  if (error) throw new Error(safeDatabaseMessage(error, "Job completion failed."));
  return createCompletedJobInvoice(operationalJob(data));
}
export const startJob = startOrClockInToJob;
export const updateJobInternalNotes = (id: string, notes: string) =>
  updateJob(id, { internal_notes: notes || null });
export const completeJob = completeInProgressJob;
export const cancelJob = (id: string, note: string) =>
  updateJob(id, { status: "Cancelled", internal_notes: note || null });
export async function archiveJob(id: string): Promise<JobWithRelations> {
  const { data, error } = await getSupabaseClient().rpc("archive_operational_job", { p_job_id: id });
  if (error) throw new Error(safeDatabaseMessage(error, "Job could not be archived."));
  return operationalJob(data);
}
export async function getArchivedJobs(): Promise<JobWithRelations[]> {
  const { data, error } = await getSupabaseClient().rpc("get_archived_operational_jobs");
  if (error) throw new Error(safeDatabaseMessage(error, "Archived Jobs could not be loaded."));
  return data.map(operationalJob);
}
export async function permanentlyDeleteCancelledJob(id: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!canPermanentlyDelete(profile)) throw new Error("Master Admin authorization is required for permanent deletion.");
  const { error } = await getSupabaseClient().rpc("master_admin_permanently_delete_cancelled_job", { p_job_id: id });
  if (error) throw new Error(safeDatabaseMessage(error, "The Cancelled Job could not be permanently deleted."));
  notifyAttentionRefresh();
}
export async function restoreArchivedJob(id: string): Promise<JobWithRelations> {
  const { data, error } = await getSupabaseClient().rpc("restore_archived_operational_job", { p_job_id: id });
  if (error) throw new Error(safeDatabaseMessage(error, "Job could not be restored."));
  return operationalJob(data);
}

async function master(){ return isMasterAdmin(await getCurrentProfile()); }
function operationalJob(row:Omit<Job,"price"|"deposit"|"balance"|"labor_hours"|"recommended_crew_size"|"photos">):JobWithRelations{return{...row,price:null,deposit:null,balance:null,labor_hours:null,recommended_crew_size:null,photos:[],financials_available:false,proposal:null,client:null,property:null}}
function fullJob(row:Job):JobWithRelations{return{...row,financials_available:true,proposal:null,client:null,property:null}}
function errorMessage(cause:unknown){if(cause instanceof Error)return cause.message;if(cause&&typeof cause==="object"&&"message" in cause&&typeof cause.message==="string")return cause.message;return""}
function safeDatabaseMessage(cause:unknown,fallback:string){const detail=errorMessage(cause).trim();return detail&&!/jwt|token|secret|authorization header|service[_ -]?role/i.test(detail)?detail:fallback}
function minutes(value: string) {
  const [h, m] = value.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}
