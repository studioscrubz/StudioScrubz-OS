import { getSupabaseClient } from "@/lib/supabase/client";
import { getProposalById } from "@/lib/services/proposals";
import { catalogAgreementPricing, proposalAgreementPricing } from "@/lib/pricing/agreementPricing";
import { getServiceCatalog } from "@/lib/services/serviceCatalog";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import { estimatedMonthlyTotal, isRecurringFrequency } from "@/lib/scheduling/frequency";
import type {
  AgreementFinancialSummary,
  AgreementInput,
  AgreementUpdate,
  AgreementWithRelations,
  ServiceAgreement,
} from "@/types/agreement";
import { AGREEMENT_BILLING_TYPES } from "@/types/agreement";
import type { Client } from "@/types/client";
import type { Property } from "@/types/property";
import type { CatalogService } from "@/types/serviceCatalog";
const select =
  "*, client:clients!service_agreements_client_id_fkey(*), property:properties!service_agreements_property_id_fkey(*), proposal:proposals!service_agreements_proposal_id_fkey(*), crew:crews!service_agreements_assigned_crew_id_fkey(*)";
export async function getAgreements(): Promise<AgreementWithRelations[]> {
  const { data, error } = await getSupabaseClient()
    .from("service_agreements")
    .select(select)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as AgreementWithRelations[];
}
export async function getAgreementById(
  id: string,
): Promise<AgreementWithRelations> {
  const { data, error } = await getSupabaseClient()
    .from("service_agreements")
    .select(select)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as AgreementWithRelations;
}
export async function getAgreementForProposal(id: string) {
  const { data, error } = await getSupabaseClient()
    .from("service_agreements")
    .select(select)
    .eq("proposal_id", id)
    .is("archived_at", null)
    .not("status", "in", "(Cancelled,Archived)")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as AgreementWithRelations | null;
}
export async function createAgreement(input: AgreementInput) {
  if (input.proposal_id) {
    const old = await getAgreementForProposal(input.proposal_id);
    if (old) return old;
  }
  let prepared = input;
  if (!input.proposal_id && !input.pricing_snapshot) {
    const catalog = await getServiceCatalog();
    const service = catalog.services.find((row) => row.service_name === input.service_name && (row.division === input.division || row.division === "Both"));
    if (!service) throw new Error("Select an active Service Catalog service before creating the agreement.");
    const pricing = catalogAgreementPricing({ standardPrice:input.billing_amount, frequency:input.frequency, serviceId:service.id, rules:catalog.recurringRules });
    prepared = { ...input, billing_amount:pricing.final_per_visit_price, pricing_snapshot:pricing };
  }
  for (let i = 0; i < 5; i++) {
    const { data, error } = await getSupabaseClient()
      .from("service_agreements")
      .insert({ ...prepared, agreement_number: num() })
      .select(select)
      .single();
    if (!error) return data as AgreementWithRelations;
    if (error.code === "23505" && input.proposal_id) {
      const old = await getAgreementForProposal(input.proposal_id);
      if (old) return old;
    }
    if (error.code !== "23505") throw error;
  }
  throw new Error("A unique agreement number could not be generated.");
}
export async function createAgreementFromProposal(proposalId: string) {
  const [p, settings] = await Promise.all([getProposalById(proposalId), getBusinessSettings()]);
  if (p.status !== "Accepted" || !isRecurringFrequency(p.frequency))
    throw new Error("Only accepted recurring proposals can create agreements.");
  const pricing = proposalAgreementPricing(p);
  const startDate = p.requested_date ?? today();
  const startDay = new Date(`${startDate}T12:00:00`).getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  return createAgreement({
    client_id: p.client_id,
    property_id: p.property_id,
    proposal_id: p.id,
    division: p.division,
    agreement_name: `${p.result.serviceName} Service Agreement`,
    service_name: p.result.serviceName,
    frequency: p.frequency,
    days_of_week: ["Weekly", "Biweekly"].includes(p.frequency) ? [startDay] : [],
    interval_weeks: p.frequency === "Biweekly" ? 2 : 1,
    day_of_month: p.frequency === "Monthly" ? new Date(`${startDate}T12:00:00`).getDate() : null,
    custom_interval_days: null,
    start_date: startDate,
    end_date: null,
    auto_renew: false,
    billing_type: "Per Visit",
    billing_amount: pricing.final_per_visit_price,
    pricing_snapshot: pricing,
    payment_terms: p.result.terms.paymentTerms,
    agreement_terms: settings.default_service_agreement_terms,
    cancellation_terms: null,
    scope: p.result.scope,
    special_instructions: p.result.terms.accessRequirements,
    assigned_crew_id: null,
    default_start_time: null,
    estimated_duration: p.result.estimatedDuration,
    status: "Draft",
    notes: p.notes,
  });
}
export async function updateAgreement(id: string, input: AgreementUpdate) {
  const { data, error } = await getSupabaseClient()
    .from("service_agreements")
    .update(input)
    .eq("id", id)
    .select(select)
    .single();
  if (error) throw error;
  return data as AgreementWithRelations;
}
async function transition(id: string, allowed: ServiceAgreement["status"][], status: ServiceAgreement["status"], extra: AgreementUpdate = {}) {
  const current = await getAgreementById(id);
  if (!allowed.includes(current.status)) throw new Error(`A ${current.status} agreement cannot be changed to ${status}.`);
  return updateAgreement(id, { ...extra, status });
}
export async function markAgreementSent(id: string, sentTo: string, sentBy: string, token: string, tokenExpiresAt: string) {
  if (!sentTo.trim()) throw new Error("A client email address is required.");
  if (!token) throw new Error("A secure agreement access token is required.");
  return transition(id, ["Draft", "Sent"], "Sent", { sent_at: new Date().toISOString(), sent_to: sentTo.trim(), sent_by: sentBy.trim() || null, client_access_token: token, client_access_token_expires_at: tokenExpiresAt });
}
export const markAgreementAccepted = (id: string) => transition(id, ["Sent"], "Accepted", { accepted_at: new Date().toISOString() });
export async function activateAgreement(id: string) {
  const agreement = await getAgreementById(id);
  if (agreement.status !== "Accepted") throw new Error(`A ${agreement.status} agreement cannot be changed to Active.`);
  const catalog = await getServiceCatalog();
  const service = catalog.services.find((row) => row.service_name === agreement.service_name && (row.division === agreement.division || row.division === "Both"));
  const validation = validateAgreementConfiguration(agreement, agreement.client, agreement.property, service, true);
  if (validation) throw new Error(validation);
  return updateAgreement(id, { status: "Active" });
}
export const pauseAgreement = (id: string) => transition(id, ["Active"], "Paused");
export const resumeAgreement = (id: string) => transition(id, ["Paused"], "Active");
export const completeAgreement = (id: string) => transition(id, ["Active"], "Completed");
export const cancelAgreement = (id: string) => transition(id, ["Active", "Paused"], "Cancelled");
export const archiveAgreement = (id: string) =>
  updateAgreement(id, {
    status: "Archived",
    archived_at: new Date().toISOString(),
  });
export async function getAgreementFinancialSummary(
  id: string,
): Promise<AgreementFinancialSummary> {
  const db = getSupabaseClient(),
    { data: occ, error } = await db
      .from("service_occurrences")
      .select("job_id")
      .eq("agreement_id", id);
  if (error) throw error;
  const occurrenceRows=(occ??[]) as {job_id:string|null}[];const jobIds = occurrenceRows
    .map((x) => x.job_id)
    .filter((x): x is string => !!x);
  if (!jobIds.length)
    return {
      jobsGenerated: 0,
      completedJobs: 0,
      invoiced: 0,
      collected: 0,
      outstanding: 0,
    };
  const { data: inv, error: ie } = await db
    .from("invoices")
    .select("id,total,balance_due")
    .in("job_id", jobIds)
    .not("status", "in", "(Cancelled,Archived)");
  if (ie) throw ie;
  const invoiceIds = (inv ?? []).map((x) => x.id);
  let collected = 0;
  if (invoiceIds.length) {
    const { data, error: pe } = await db
      .from("payments")
      .select("amount")
      .in("invoice_id", invoiceIds);
    if (pe) throw pe;
    collected = (data ?? []).reduce((n, x) => n + Number(x.amount), 0);
  }
  return {
    jobsGenerated: jobIds.length,
    completedJobs: await completedJobs(jobIds),
    invoiced: (inv ?? []).reduce((n, x) => n + Number(x.total), 0),
    collected,
    outstanding: (inv ?? []).reduce((n, x) => n + Number(x.balance_due), 0),
  };
}
async function completedJobs(ids:string[]){const{count,error}=await getSupabaseClient().from("jobs").select("id",{count:"exact",head:true}).in("id",ids).eq("status","Completed");if(error)throw error;return count??0}
export function monthlyRecurringRevenue(a: ServiceAgreement) {
  if (a.status !== "Active") return 0;
  return estimatedMonthlyAmount(a);
}
export function estimatedMonthlyAmount(a: ServiceAgreement) {
  if (a.pricing_snapshot?.estimated_monthly_total !== null && a.pricing_snapshot?.estimated_monthly_total !== undefined)
    return a.pricing_snapshot.estimated_monthly_total;
  if (a.billing_type === "Monthly") return a.billing_amount;
  if (a.billing_type === "Weekly") return (a.billing_amount * 52) / 12;
  if (a.billing_type === "Biweekly") return (a.billing_amount * 26) / 12;
  if (a.billing_type === "Per Visit") {
    const shared=estimatedMonthlyTotal(a.billing_amount,a.frequency);
    if(shared!==null&&shared>0)return shared;
    const visits =
      a.frequency === "Weekly"
        ? 52 / 12
        : a.frequency === "Daily"
          ? 365 / 12
        : a.frequency === "Biweekly"
          ? 26 / 12
          : a.frequency === "Every 4 Weeks"
            ? 13 / 12
            : a.frequency === "Monthly"
              ? 1
              : a.frequency === "Multiple Days Per Week"
                ? (a.days_of_week.length * 52) / 12
                : 0;
    return a.billing_amount * visits;
  }
  return 0;
}
export function validateAgreementConfiguration(
  agreement: AgreementInput | ServiceAgreement,
  client: Client | null | undefined,
  property: Property | null | undefined,
  service: CatalogService | null | undefined,
  activation = false,
) {
  if (!agreement.agreement_name.trim()) return "Agreement name is required.";
  if (!client) return "Select an active client.";
  if (!property) return "Select an active property or service site.";
  if (property.client_id !== client.id) return "The selected property or site does not belong to the selected client.";
  if (client.client_type !== agreement.division) return `Select a ${agreement.division} client for this agreement.`;
  if (property.property_type !== agreement.division) return `Select a ${agreement.division} property or site for this agreement.`;
  if (agreement.division === "Commercial" && !client.company_name?.trim()) return "Commercial agreements require a client with a company or business name.";
  if (!service) return `Select an active service compatible with the ${agreement.division} division.`;
  if (!agreement.start_date) return "Start date is required.";
  if (agreement.end_date && agreement.end_date < agreement.start_date) return "End date must be on or after the start date.";
  if (!AGREEMENT_BILLING_TYPES.includes(agreement.billing_type)) return "Select a valid billing type.";
  if (!Number.isFinite(agreement.billing_amount) || agreement.billing_amount < 0) return "Billing amount must be zero or greater.";
  const weekdayFrequency = ["Weekly", "Biweekly", "Every 4 Weeks", "Multiple Days Per Week"].includes(agreement.frequency);
  if (weekdayFrequency && !agreement.days_of_week.length) return `Select at least one service day for ${agreement.frequency}.`;
  if (agreement.frequency === "Multiple Days Per Week" && (!Number.isInteger(agreement.interval_weeks) || agreement.interval_weeks < 1)) return "Interval weeks must be at least 1.";
  if (agreement.frequency === "Monthly" && (!agreement.day_of_month || agreement.day_of_month < 1 || agreement.day_of_month > 31)) return "Select a monthly service day from 1 through 31.";
  if (agreement.frequency === "Custom" && (!agreement.custom_interval_days || agreement.custom_interval_days < 1)) return "Custom interval days must be at least 1.";
  if (activation && !agreement.default_start_time) return "A default service start time is required before activation.";
  if (activation && agreement.division === "Commercial" && !agreement.assigned_crew_id) return "Assign a crew before activating a Commercial agreement.";
  if (activation && agreement.division === "Commercial" && ["Monthly", "Flat Contract"].includes(agreement.billing_type)) return `${agreement.billing_type} Commercial agreements can be stored, but cannot be activated until contract billing is implemented without per-occurrence charges.`;
  return null;
}
function num() {
  const d = new Date();
  return `AGR-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
