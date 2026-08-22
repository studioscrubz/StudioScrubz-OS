import { addProposalHistory, getProposalById } from "@/lib/services/proposals";
import { getSupabaseClient } from "@/lib/supabase/client";
import type {
  CrewConflict,
  Job,
  JobStatus,
  JobInsert,
  JobUpdate,
  JobWithRelations,
  DirectJobInput,
} from "@/types/job";
import type { CrewWithRelations } from "@/types/crew";
import { employeeName } from "@/types/employee";
import { getCurrentProfile } from "@/lib/services/auth";
import { isMasterAdmin } from "@/lib/auth/permissions";
import { hasPermission } from "@/lib/auth/permissions";
import { getClientById } from "@/lib/services/clients";
import { getPropertyById } from "@/lib/services/properties";
import { getServiceCatalog, getAvailableServiceAddons } from "@/lib/services/serviceCatalog";
import { getCrewById } from "@/lib/services/crews";
import { calculateAddons, calculateServicePrice } from "@/lib/pricing/pricingEngine";
import type { Invoice } from "@/types/invoice";

export type JobCompletionResult = {
  job: Job;
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
const workflowStatuses: Exclude<JobStatus, "Archived">[] = [
  "Ready to Schedule",
  "Scheduled",
  "Crew Assigned",
  "In Progress",
  "Completed",
  "Cancelled",
];
export async function getJobs(): Promise<JobWithRelations[]> {
  if (!(await master())) {
    const [{ data, error }, invoicesResult] = await Promise.all([
      getSupabaseClient().rpc("get_operational_jobs", {}),
      getSupabaseClient().from("invoices").select("job_id").is("archived_at", null).neq("status", "Cancelled"),
    ]);
    if (error) throw error;
    if (invoicesResult.error) throw invoicesResult.error;
    const invoiced = new Set((invoicesResult.data ?? []).map((row) => row.job_id));
    return data.map(operationalJob).filter((job) => !job.archived_at && job.status !== "Archived" && (job.status !== "Completed" || !invoiced.has(job.id)));
  }
  const [jobsResult, invoicesResult] = await Promise.all([
    getSupabaseClient().from("jobs").select(select).is("archived_at", null).in("status", workflowStatuses).order("created_at", { ascending: false }),
    getSupabaseClient().from("invoices").select("job_id").is("archived_at", null).neq("status", "Cancelled"),
  ]);
  if (jobsResult.error) throw jobsResult.error;
  if (invoicesResult.error) throw invoicesResult.error;
  const invoicedJobIds = new Set((invoicesResult.data ?? []).map((invoice) => invoice.job_id));
  return (jobsResult.data as JobWithRelations[]).filter((job) => job.status !== "Completed" || !invoicedJobIds.has(job.id));
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
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .select(select)
    .is("archived_at", null)
    .gte("scheduled_date", start)
    .lte("scheduled_date", end)
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
  if (!(await master())) return [...new Set((await getJobs()).map((job)=>job.proposal_id).filter((id):id is string=>Boolean(id)))];
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .select("proposal_id");
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
  const proposal = await getProposalById(proposalId);
  if (proposal.status !== "Accepted" || !proposal.accepted)
    throw new Error("Only accepted proposals can create jobs.");
  if (proposal.frequency !== "One-Time")
    throw new Error("Recurring proposals must create a Service Agreement.");
  if (!proposal.client_id || !proposal.property_id)
    throw new Error("This Proposal has a deleted Client or Property relationship and cannot create a Job.");
  const existing = await getJobForProposal(proposalId);
  if (existing) return existing;
  const input = {
    proposal_id: proposal.id,
    service_occurrence_id: null,
    estimate_id: proposal.estimate_id,
    walkthrough_id: proposal.walkthrough_id,
    client_id: proposal.client_id,
    property_id: proposal.property_id,
    division: proposal.division,
    client_name: proposal.client_name,
    property_name: proposal.property_name,
    service_name: proposal.result.serviceName,
    frequency: proposal.frequency,
    status: "Ready to Schedule" as const,
    scheduled_date: proposal.requested_date,
    start_time: null,
    estimated_duration: proposal.result.estimatedDuration,
    assigned_crew_id: null,
    assigned_crew_name: null,
    crew_lead_name: null,
    assigned_team: [],
    price: proposal.result.perVisitTotal,
    deposit: 0,
    balance: proposal.result.perVisitTotal,
    labor_hours: proposal.result.laborHours,
    recommended_crew_size: proposal.result.crewRecommendation,
    scope: proposal.result.scope,
    checklist: [],
    photos: [],
    access_instructions:
      proposal.result.terms.accessRequirements ||
      proposal.property?.access_instructions || null,
    internal_notes: proposal.notes,
    completed_at: null,
  };
  for (let i = 0; i < 5; i++) {
    const { data, error } = await getSupabaseClient()
      .from("jobs")
      .insert({ ...input, job_number: jobNumber() })
      .select(select)
      .single();
    if (!error) {
      await addProposalHistory(
        proposal.id,
        "Job Created",
        "Accepted",
        "Accepted",
        `Job ${data.job_number} created.`,
      );
      return data as JobWithRelations;
    }
    if (error.code === "23505") {
      const duplicate = await getJobForProposal(proposalId);
      if (duplicate) return duplicate;
      continue;
    }
    throw error;
  }
  throw new Error("A unique job number could not be generated.");
}
export async function createDirectJob(input: DirectJobInput): Promise<JobWithRelations> {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile, "jobs.create")) throw new Error("You do not have permission to create Jobs.");
  const [client, property, catalog, crew] = await Promise.all([
    getClientById(input.client_id),
    getPropertyById(input.property_id),
    getServiceCatalog(),
    input.assigned_crew_id ? getCrewById(input.assigned_crew_id) : Promise.resolve(null),
  ]);
  if (client.archived_at) throw new Error("Select an active Client.");
  if (property.archived_at || property.client_id !== client.id) throw new Error("The selected Property does not belong to the selected Client.");
  const service = catalog.services.find((row) => row.id === input.service_id);
  if (!service) throw new Error("Select an active Service Catalog service.");
  const division = property.property_type;
  if (service.division !== "Both" && service.division !== division) throw new Error("The selected Service is not available for this Property division.");
  const availableAddons = getAvailableServiceAddons(catalog, service.id, division);
  const selectedAddons = input.addon_ids.map((id) => availableAddons.find((row) => row.id === id));
  if (selectedAddons.some((row) => !row)) throw new Error("One or more selected Add-Ons are not available for this Service.");
  const quantity = property.square_feet && property.square_feet > 0 ? property.square_feet : 1;
  const basePrice = calculateServicePrice(service, quantity, catalog.tiers);
  if (basePrice == null) throw new Error("This Service uses custom pricing and cannot be used for a direct Job without configured catalog pricing.");
  const addonAdjustments = calculateAddons(selectedAddons.map((row) => row!.addon_name), availableAddons);
  const price = Math.round((basePrice + addonAdjustments.reduce((sum, row) => sum + row.amount, 0)) * 100) / 100;
  const scheduled = Boolean(input.scheduled_date);
  const status: JobStatus = scheduled ? (crew ? "Crew Assigned" : "Scheduled") : "Ready to Schedule";
  const scope = [
    ...(service.description ? [{ id: crypto.randomUUID(), text: service.description }] : []),
    ...selectedAddons.map((addon) => ({ id: crypto.randomUUID(), text: `Add-On: ${addon!.addon_name}${addon!.description ? ` — ${addon!.description}` : ""}` })),
  ];
  const payload: JobInsert = {
    proposal_id: null, estimate_id: null, walkthrough_id: null, service_occurrence_id: null,
    client_id: client.id, property_id: property.id, division,
    client_name: client.company_name || [client.first_name, client.last_name].filter(Boolean).join(" ") || "Client",
    property_name: property.property_name || property.address, service_name: service.service_name,
    frequency: "One-Time", status, scheduled_date: input.scheduled_date,
    start_time: input.scheduled_date ? input.start_time : null,
    estimated_duration: input.estimated_duration, assigned_crew_id: crew?.id ?? null,
    assigned_crew_name: crew?.crew_name ?? null,
    crew_lead_name: crew?.crew_lead ? employeeName(crew.crew_lead) : null,
    assigned_team: crew?.members.map((member) => employeeName(member.employee)) ?? [],
    price, deposit: 0, balance: price, labor_hours: Math.max(0, input.labor_hours),
    recommended_crew_size: Math.max(crew?.members.length ?? 1, 1), scope, checklist: [], photos: [],
    access_instructions: input.access_instructions || property.access_instructions || null,
    internal_notes: input.internal_notes, completed_at: null,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await getSupabaseClient().from("jobs").insert({ ...payload, job_number: jobNumber() }).select(select).single();
    if (!error) return data as JobWithRelations;
    if (error.code !== "23505") throw error;
  }
  throw new Error("A unique Job number could not be generated.");
}
export async function updateJob(id: string, input: JobUpdate): Promise<Job> {
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
  return data;
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

async function createCompletedJobInvoice(job: Job): Promise<JobCompletionResult> {
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
export const startJob = (id: string) => updateJobStatus(id, "In Progress");
export const updateJobInternalNotes = (id: string, notes: string) =>
  updateJob(id, { internal_notes: notes || null });
export const completeJob = (id: string) => updateJobStatus(id, "Completed");
export const cancelJob = (id: string, note: string) =>
  updateJob(id, { status: "Cancelled", internal_notes: note || null });
export const archiveJob = (id: string) =>
  updateJob(id, { status: "Archived", archived_at: new Date().toISOString() });

async function master(){ return isMasterAdmin(await getCurrentProfile()); }
function operationalJob(row:Omit<Job,"price"|"deposit"|"balance"|"labor_hours"|"recommended_crew_size"|"photos">):JobWithRelations{return{...row,price:0,deposit:0,balance:0,labor_hours:0,recommended_crew_size:0,photos:[],proposal:null,client:null,property:null}}
function errorMessage(cause:unknown){if(cause instanceof Error)return cause.message;if(cause&&typeof cause==="object"&&"message" in cause&&typeof cause.message==="string")return cause.message;return""}
function jobNumber() {
  const d = new Date();
  return `JOB-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}
function minutes(value: string) {
  const [h, m] = value.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}
