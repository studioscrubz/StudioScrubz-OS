import { getSupabaseClient } from "@/lib/supabase/client";
import { addProposalHistory, getProposalById } from "@/lib/services/proposals";
import { catalogAgreementPricing, proposalAgreementPricing } from "@/lib/pricing/agreementPricing";
import { getServiceCatalog } from "@/lib/services/serviceCatalog";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import { getCurrentProfile } from "@/lib/services/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { estimatedMonthlyTotal, isRecurringFrequency } from "@/lib/scheduling/frequency";
import type {
  AgreementBillingType,
  AgreementFrequency,
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
import type { ProposalScopeItem, ProposalWithRelations } from "@/types/proposal";
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
    const pricing = catalogAgreementPricing({ standardPrice:input.billing_amount, frequency:input.frequency, serviceId:service.id, rules:catalog.recurringRules, serviceDescription:service.description });
    prepared = { ...input, billing_amount:input.billing_type !== "Per Visit" ? input.billing_amount : pricing.final_per_visit_price, pricing_snapshot:pricing };
  }
  for (let i = 0; i < 5; i++) {
    const { data, error } = await getSupabaseClient()
      .from("service_agreements")
      .insert({ ...prepared, agreement_number: num() })
      .select(select)
      .single();
    if (!error) {
      if (input.proposal_id) {
        await addProposalHistory(
          input.proposal_id,
          "Service Agreement Created",
          "Accepted",
          "Accepted",
          `Service Agreement ${data.agreement_number} created.`,
        );
      }
      return data as AgreementWithRelations;
    }
    if (error.code === "23505" && input.proposal_id) {
      const old = await getAgreementForProposal(input.proposal_id);
      if (old) return old;
    }
    if (error.code !== "23505") throw error;
  }
  throw new Error("A unique agreement number could not be generated.");
}
export type ProposalAgreementReview = {
  startDate: string;
  endDate: string | null;
  daysOfWeek: (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
  intervalWeeks: number;
  dayOfMonth: number | null;
  customIntervalDays: number | null;
  billingType: AgreementBillingType;
  billingAmount: number | null;
  assignedCrewId: string | null;
  defaultStartTime: string | null;
  scope: ProposalScopeItem[];
};

export function agreementScopeFromProposal(proposal: ProposalWithRelations): ProposalScopeItem[] {
  const proposalScope = normalizeAgreementScope(proposal.result.scope);
  if (proposalScope.length) return proposalScope;

  const walkthroughScope = normalizeAgreementScope(
    (proposal.walkthrough?.scope ?? []).map((item) => ({ id: item.id, text: item.label })),
  );
  if (walkthroughScope.length) return walkthroughScope;

  return normalizeAgreementScope(
    (proposal.estimate?.result.scope ?? []).map((text, index) => ({ id: `estimate-scope-${index + 1}`, text })),
  );
}

export function agreementServiceDescriptionFromProposal(proposal: ProposalWithRelations, services: CatalogService[] = []): string | null {
  const description = proposal.result.serviceDescription?.trim()
    || proposal.walkthrough?.measurements.serviceDescription?.trim()
    || proposal.estimate?.result.serviceDescription?.trim();
  if (description) return description;
  return services.find((service) => service.is_active && !service.archived_at && service.service_name === proposal.result.serviceName && (service.division === proposal.division || service.division === "Both"))?.description?.trim() || null;
}

function normalizeAgreementScope(scope: ProposalScopeItem[] | null | undefined): ProposalScopeItem[] {
  return (scope ?? []).flatMap((item, index) => {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    return text ? [{ id: item.id || `scope-${index + 1}`, text }] : [];
  });
}

export async function createAgreementFromProposal(proposalId: string, review: ProposalAgreementReview) {
  const [p, settings, catalog] = await Promise.all([getProposalById(proposalId), getBusinessSettings(), getServiceCatalog()]);
  if (p.status !== "Accepted" || !p.accepted || !isRecurringFrequency(p.frequency))
    throw new Error("Only accepted recurring proposals can create agreements.");
  if (!p.client_id || !p.property_id)
    throw new Error("This Proposal has a deleted Client or Property relationship and cannot create an Agreement.");
  if (!review.startDate) throw new Error("Confirm the Agreement Start Date.");
  if (!AGREEMENT_BILLING_TYPES.includes(review.billingType)) throw new Error("Select a Billing Type.");
  const pricing = { ...proposalAgreementPricing(p), service_description: agreementServiceDescriptionFromProposal(p, catalog.services) };
  const billingAmount = review.billingType === "Per Visit" ? pricing.final_per_visit_price : Number(review.billingAmount);
  if (!Number.isFinite(billingAmount) || billingAmount <= 0)
    throw new Error(`Enter the ${review.billingType === "Weekly" ? "Weekly Contract Amount" : review.billingType === "Biweekly" ? "Biweekly Contract Amount" : review.billingType === "Monthly" ? "Monthly Contract Amount" : review.billingType === "Flat Contract" ? "Contract Value" : "Billing Amount"}.`);
  const frequency = p.frequency as AgreementFrequency;
  const candidate = {
    frequency,
    days_of_week: review.daysOfWeek,
    interval_weeks: review.intervalWeeks,
    day_of_month: review.dayOfMonth,
    custom_interval_days: review.customIntervalDays,
    start_date: review.startDate,
    end_date: review.endDate,
  };
  const scheduleError = validateSchedule(candidate);
  if (scheduleError) throw new Error(scheduleError);
  return createAgreement({
    client_id: p.client_id,
    property_id: p.property_id,
    proposal_id: p.id,
    division: p.division,
    agreement_name: `${p.result.serviceName} Service Agreement`,
    service_name: p.result.serviceName,
    frequency,
    days_of_week: review.daysOfWeek,
    interval_weeks: review.intervalWeeks,
    day_of_month: review.dayOfMonth,
    custom_interval_days: review.customIntervalDays,
    start_date: review.startDate,
    end_date: review.endDate,
    auto_renew: false,
    billing_type: review.billingType,
    billing_amount: billingAmount,
    pricing_snapshot: pricing,
    payment_terms: p.result.terms.paymentTerms,
    agreement_terms: settings.default_service_agreement_terms,
    cancellation_terms: settings.default_cancellation_terms,
    scope: normalizeAgreementScope(review.scope),
    special_instructions: p.result.terms.accessRequirements,
    assigned_crew_id: review.assignedCrewId,
    default_start_time: review.defaultStartTime,
    estimated_duration: p.result.estimatedDuration,
    status: "Draft",
    notes: p.notes,
  });
}

function validateSchedule(input: Pick<AgreementInput, "frequency" | "days_of_week" | "interval_weeks" | "day_of_month" | "custom_interval_days" | "start_date" | "end_date">) {
  if (input.end_date && input.end_date < input.start_date) return "End date must be on or after the start date.";
  if (["Weekly", "Biweekly", "Every 4 Weeks", "Multiple Days Per Week"].includes(input.frequency) && !input.days_of_week.length)
    return `Select at least one service day for ${input.frequency}.`;
  if (input.frequency === "Monthly" && (!input.day_of_month || input.day_of_month < 1 || input.day_of_month > 31))
    return "Select a monthly service day from 1 through 31.";
  return null;
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
export async function saveAgreementEdits(id: string, input: AgreementUpdate) {
  const [current, profile] = await Promise.all([getAgreementById(id), getCurrentProfile()]);
  if (!hasPermission(profile, "agreements.manage")) throw new Error("Agreement management permission is required.");
  if (current.status === "Draft") return updateAgreement(id, input);
  if (!["Sent", "Accepted", "Active", "Paused"].includes(current.status)) throw new Error(`A ${current.status} agreement cannot be edited.`);
  // Non-Draft edits are operational only. Preserve the contractual source,
  // accepted pricing, billing configuration, and lifecycle state.
  const operationalUpdate: AgreementUpdate = {
    ...input,
    client_id: current.client_id,
    property_id: current.property_id,
    proposal_id: current.proposal_id,
    division: current.division,
    billing_type: current.billing_type,
    billing_amount: current.billing_amount,
    pricing_snapshot: current.pricing_snapshot,
    payment_terms: current.payment_terms,
    agreement_terms: current.agreement_terms,
    cancellation_terms: current.cancellation_terms,
    status: current.status,
    service_name: current.client_signed_at ? current.service_name : input.service_name,
    scope: current.client_signed_at ? current.scope : input.scope,
  };
  const candidate = { ...current, ...operationalUpdate } as ServiceAgreement;
  const catalog = await getServiceCatalog();
  const service = catalog.services.find((row) => row.service_name === candidate.service_name && (row.division === candidate.division || row.division === "Both"));
  const validation = validateAgreementConfiguration(candidate, current.client, current.property, service, ["Active", "Paused"].includes(current.status));
  if (validation) throw new Error(validation);
  const updated = await updateAgreement(id, operationalUpdate);
  if (["Active", "Paused"].includes(updated.status)) {
    const { reconcileFutureOccurrences } = await import("@/lib/services/serviceOccurrences");
    await reconcileFutureOccurrences(updated.id);
  }
  return updated;
}
async function transition(id: string, allowed: ServiceAgreement["status"][], status: ServiceAgreement["status"], extra: AgreementUpdate = {}) {
  const current = await getAgreementById(id);
  if (!allowed.includes(current.status)) throw new Error(`A ${current.status} agreement cannot be changed to ${status}.`);
  return updateAgreement(id, { ...extra, status });
}
export async function markAgreementSent(id: string, sentTo: string, sentBy: string, token: string, tokenExpiresAt: string) {
  if (!sentTo.trim()) throw new Error("A client delivery recipient is required.");
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
async function transitionAndReconcile(id:string,allowed:ServiceAgreement["status"][],status:ServiceAgreement["status"]){const updated=await transition(id,allowed,status);const{reconcileFutureOccurrences}=await import("@/lib/services/serviceOccurrences");await reconcileFutureOccurrences(id);return updated}
export const pauseAgreement = (id: string) => transitionAndReconcile(id, ["Active"], "Paused");
export const resumeAgreement = (id: string) => transitionAndReconcile(id, ["Paused"], "Active");
export const completeAgreement = (id: string) => transitionAndReconcile(id, ["Active"], "Completed");
export const cancelAgreement = (id: string) => transitionAndReconcile(id, ["Active", "Paused"], "Cancelled");
export const archiveAgreement = (id: string) =>
  updateAgreement(id, {
    status: "Archived",
    archived_at: new Date().toISOString(),
  });
export async function getAgreementFinancialSummary(
  id: string,
): Promise<AgreementFinancialSummary> {
  const db = getSupabaseClient(), agreement=await getAgreementById(id),
    { data: occ, error } = await db
      .from("service_occurrences")
      .select("job_id")
      .eq("agreement_id", id);
  if (error) throw error;
  const occurrenceRows=(occ??[]) as {job_id:string|null}[];const jobIds = occurrenceRows
    .map((x) => x.job_id)
    .filter((x): x is string => !!x);
  let invoiceQuery=db.from("invoices").select("id,total,amount_paid,balance_due").not("status","in","(Cancelled,Archived)").is("archived_at",null);
  invoiceQuery=agreement.billing_type!=="Per Visit"?invoiceQuery.eq("service_agreement_id",id):jobIds.length?invoiceQuery.in("job_id",jobIds):invoiceQuery.eq("service_agreement_id",id);
  const { data: inv, error: ie } = await invoiceQuery;
  if (ie) throw ie;
  const invoiced=roundMoney((inv??[]).reduce((n,x)=>n+Number(x.total),0));
  return {
    billingType:agreement.billing_type,
    contractAmount:Number(agreement.billing_amount),
    jobsGenerated: jobIds.length,
    completedJobs: jobIds.length?await completedJobs(jobIds):0,
    invoiced,
    paid:roundMoney((inv??[]).reduce((n,x)=>n+Number(x.amount_paid),0)),
    outstanding:roundMoney((inv??[]).reduce((n,x)=>n+Number(x.balance_due),0)),
    remaining:agreement.billing_type==="Flat Contract"?Math.max(0,roundMoney(Number(agreement.billing_amount)-invoiced)):null,
  };
}
async function completedJobs(ids:string[]){const{count,error}=await getSupabaseClient().from("jobs").select("id",{count:"exact",head:true}).in("id",ids).eq("status","Completed");if(error)throw error;return count??0}
export function monthlyRecurringRevenue(a: ServiceAgreement) {
  if (a.status !== "Active") return 0;
  return estimatedMonthlyAmount(a);
}
export function estimatedMonthlyAmount(a: ServiceAgreement) {
  if (a.billing_type === "Monthly") return a.billing_amount;
  if (a.billing_type === "Weekly") return (a.billing_amount * 52) / 12;
  if (a.billing_type === "Biweekly") return (a.billing_amount * 26) / 12;
  if (a.billing_type === "Flat Contract") return 0;
  if (a.pricing_snapshot?.estimated_monthly_total !== null && a.pricing_snapshot?.estimated_monthly_total !== undefined)
    return a.pricing_snapshot.estimated_monthly_total;
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
  if (activation && agreement.billing_type !== "Per Visit" && agreement.billing_amount <= 0) return `${agreement.billing_type} agreements require a contract amount greater than zero.`;
  return null;
}
const roundMoney=(value:number)=>Math.round(value*100)/100;
function num() {
  const d = new Date();
  return `AGR-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
}
