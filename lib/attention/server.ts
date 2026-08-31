import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { buildAttentionItems, type AttentionRuleInput } from "@/lib/services/attention";
import type { UserProfile } from "@/types/auth";
import type { JobWithRelations } from "@/types/job";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type Snapshot = Omit<AttentionRuleInput, "profile" | "states" | "jobRouteIds" | "agreementProposalIds" | "contractJobIds"> & {
  states: AttentionRuleInput["states"];
  agreementProposalIds: Array<string | null>;
  contractJobIds: Set<string>;
  crewIdsByEmployee: Map<string, Set<string>>;
};

export async function loadAttentionServerSnapshot(db: AdminClient, now = new Date()): Promise<Snapshot> {
  const [estimates, jobs, walkthroughs, proposals, agreements, invoices, communications, timeEntries, states, settings, crewMembers, crews, occurrences, invoiceLines] = await Promise.all([
    query(db.from("estimates").select("*, client:clients!estimates_client_id_fkey(*), property:properties!estimates_property_id_fkey(*)")),
    query(db.from("jobs").select("*, proposal:proposals!jobs_proposal_id_fkey(*), client:clients!jobs_client_id_fkey(*), property:properties!jobs_property_id_fkey(*)")),
    query(db.from("walkthroughs").select("*, client:clients!walkthroughs_client_id_fkey(*), property:properties!walkthroughs_property_id_fkey(*), estimate:estimates!walkthroughs_estimate_id_fkey(*)")),
    query(db.from("proposals").select("*, client:clients!proposals_client_id_fkey(*), property:properties!proposals_property_id_fkey(*), estimate:estimates!proposals_estimate_id_fkey(*), walkthrough:walkthroughs!proposals_walkthrough_id_fkey(*)")),
    query(db.from("service_agreements").select("*, client:clients!service_agreements_client_id_fkey(*), property:properties!service_agreements_property_id_fkey(*), proposal:proposals!service_agreements_proposal_id_fkey(*), crew:crews!service_agreements_assigned_crew_id_fkey(*)").is("archived_at", null)),
    query(db.from("invoices").select("*, job_lines:invoice_job_lines(*), job:jobs!invoices_job_id_fkey(*), agreement:service_agreements!invoices_service_agreement_id_fkey(*), proposal:proposals!invoices_proposal_id_fkey(*), client:clients!invoices_client_id_fkey(*), property:properties!invoices_property_id_fkey(*)")),
    query(db.from("client_communications").select("*").is("archived_at", null)),
    query(db.from("time_entries").select("*, employee:employees!time_entries_employee_id_fkey(*), job:jobs!time_entries_job_id_fkey(*), crew:crews!time_entries_crew_id_fkey(*)").eq("status", "Open").not("job_id", "is", null).is("clock_out", null).is("archived_at", null)),
    query(db.from("attention_item_states").select("*")),
    query(db.from("business_settings").select("timezone").limit(1)),
    query(db.from("crew_members").select("crew_id,employee_id")),
    query(db.from("crews").select("id,crew_lead_id").is("archived_at", null)),
    query(db.from("service_occurrences").select("job_id,agreement:service_agreements!service_occurrences_agreement_id_fkey(billing_type)")),
    query(db.from("invoice_job_lines").select("job_id")),
  ]);
  const crewIdsByEmployee = new Map<string, Set<string>>();
  for (const member of crewMembers as Array<{ crew_id: string; employee_id: string }>) addCrew(crewIdsByEmployee, member.employee_id, member.crew_id);
  for (const crew of crews as Array<{ id: string; crew_lead_id: string | null }>) if (crew.crew_lead_id) addCrew(crewIdsByEmployee, crew.crew_lead_id, crew.id);
  const contractJobIds = new Set((occurrences as Array<{ job_id: string | null; agreement: { billing_type: string } | null }>).filter((row) => row.job_id && row.agreement?.billing_type !== "Per Visit").map((row) => row.job_id!));
  const financiallyResolvedJobIds = [...new Set([
    ...(invoices as Array<{ job_id: string | null; status: string }>).filter((row) => row.job_id && !["Cancelled", "Archived"].includes(row.status)).map((row) => row.job_id!),
    ...(invoiceLines as Array<{ job_id: string }>).map((row) => row.job_id), ...contractJobIds,
  ])];
  return { estimates, jobs, walkthroughs, proposals, agreements, invoices, financiallyResolvedJobIds, communications, timeEntries, states, timezone: (settings[0] as { timezone?: string | null } | undefined)?.timezone ?? null, agreementProposalIds: (agreements as Array<{ proposal_id: string | null }>).map((row) => row.proposal_id), contractJobIds, crewIdsByEmployee, now } as unknown as Snapshot;
}

export function attentionItemsForProfile(profile: UserProfile, snapshot: Snapshot) {
  if (!hasPermission(profile, "attention.view")) return [];
  const management = ["Master Admin", "Administrator", "Manager"].includes(profile.role);
  const crewIds = profile.employee_id ? snapshot.crewIdsByEmployee.get(profile.employee_id) ?? new Set<string>() : new Set<string>();
  const visibleJobs = hasPermission(profile, "jobs.view")
    ? snapshot.jobs.filter((job) => management || Boolean(job.assigned_crew_id && crewIds.has(job.assigned_crew_id))).map((job) => profile.role === "Master Admin" ? job : operationalJob(job)) : [];
  const visibleTimeEntries = hasPermission(profile, "timeClock.view") ? snapshot.timeEntries.filter((entry) => management || entry.employee_id === profile.employee_id || Boolean(entry.crew_id && crewIds.has(entry.crew_id))) : [];
  const input: AttentionRuleInput = {
    profile,
    estimates: hasPermission(profile, "estimates.view") ? snapshot.estimates : [],
    jobs: visibleJobs,
    walkthroughs: hasPermission(profile, "walkthroughs.view") ? snapshot.walkthroughs : [],
    proposals: hasPermission(profile, "proposals.view") ? snapshot.proposals : [],
    agreements: hasPermission(profile, "agreements.view") ? snapshot.agreements : [],
    invoices: hasPermission(profile, "invoices.view") ? snapshot.invoices : [],
    financiallyResolvedJobIds: hasPermission(profile, "jobs.view") && hasPermission(profile, "invoices.view") ? snapshot.financiallyResolvedJobIds : [],
    communications: hasPermission(profile, "communications.view") ? snapshot.communications : [],
    timeEntries: visibleTimeEntries,
    states: snapshot.states.filter((state) => state.user_id === profile.id), timezone: snapshot.timezone,
    jobRouteIds: visibleJobs.map((job) => job.proposal_id).filter((id): id is string => Boolean(id)),
    agreementProposalIds: hasPermission(profile, "agreements.view") ? snapshot.agreementProposalIds : [],
    contractJobIds: snapshot.contractJobIds, now: snapshot.now,
  };
  return buildAttentionItems(input, "Active").items;
}

async function query(builder: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) { const { data, error } = await builder; if (error) throw new Error(`Attention push source query failed: ${error.message}`); return data ?? []; }
function addCrew(map: Map<string, Set<string>>, employeeId: string, crewId: string) { const ids = map.get(employeeId) ?? new Set<string>(); ids.add(crewId); map.set(employeeId, ids); }
function operationalJob(job: JobWithRelations): JobWithRelations { return { ...job, price: null, deposit: null, balance: null, labor_hours: null, recommended_crew_size: null, photos: [], financials_available: false, proposal: null, client: null, property: null }; }
