import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentProfile } from "@/lib/services/auth";
import { getJobProposalIds, getJobs } from "@/lib/services/jobs";
import { getProposals } from "@/lib/services/proposals";
import { getAgreements } from "@/lib/services/agreements";
import { getFinanciallyResolvedJobIds, getInvoices } from "@/lib/services/invoices";
import { getAllClientCommunications } from "@/lib/services/clientCommunications";
import { getOpenTimeEntries } from "@/lib/services/timeEntries";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import { getAssignedFieldWalkthroughs } from "@/lib/services/fieldWalkthroughs";
import { getWalkthroughs } from "@/lib/services/walkthroughs";
import { getEstimates } from "@/lib/services/estimates";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { AttentionItem, AttentionStateRecord, AttentionSummary, AttentionView } from "@/types/attention";
import { getPublicSiteUrl } from "@/lib/publicSiteUrl";
import type { CommunicationComposerContext } from "@/types/clientCommunication";
import { isRecurringFrequency } from "@/lib/scheduling/frequency";
import { withImmediateAttentionPush } from "@/lib/push/client";
import { canReviewFieldDiscovery } from "@/lib/services/fieldDiscoveries";
import type { FieldDiscovery } from "@/types/fieldDiscovery";
import type { ChangeRequest } from "@/types/changeRequest";

const GOOGLE_REVIEW_URL = "https://g.page/r/CT2X4ZAN1E8oEAI/review";

export const ATTENTION_REALTIME_TABLES = [
  "estimates",
  "walkthroughs",
  "proposals",
  "service_agreements",
  "jobs",
  "invoices",
  "service_occurrences",
  "payments",
  "attention_item_states",
  "client_communications",
  "time_entries",
] as const;

export async function getAttentionItems(view: AttentionView = "Active"): Promise<AttentionItem[]> {
  const profile = await getCurrentProfile();
  if (!profile?.is_active) throw new Error("An active StudioScrubz profile is required.");
  const [estimates, jobs, walkthroughs, proposals, agreements, invoices, financiallyResolvedJobIds, communications, timeEntries, states, settings] = await Promise.all([
    hasPermission(profile, "estimates.view") ? getEstimates() : Promise.resolve([]),
    hasPermission(profile, "jobs.view") ? getJobs() : Promise.resolve([]),
    hasPermission(profile, "walkthroughs.view") ? getWalkthroughs() : Promise.resolve([]),
    hasPermission(profile, "proposals.view") ? getProposals() : Promise.resolve([]),
    hasPermission(profile, "agreements.view") ? getAgreements() : Promise.resolve([]),
    hasPermission(profile, "invoices.view") ? getInvoices() : Promise.resolve([]),
    hasPermission(profile, "jobs.view") && hasPermission(profile, "invoices.view") ? getFinanciallyResolvedJobIds() : Promise.resolve([]),
    hasPermission(profile, "communications.view") ? getAllClientCommunications() : Promise.resolve([]),
    hasPermission(profile, "timeClock.view") ? getOpenTimeEntries() : Promise.resolve([]),
    getAttentionItemStates(),
    getBusinessSettings().catch(() => null),
  ]);
  const [jobRouteIds, agreementRoutes] = await Promise.all([
    hasPermission(profile, "jobs.view")
      ? getJobProposalIds()
      : Promise.resolve([]),
    hasPermission(profile, "agreements.view")
      ? getSupabaseClient().from("service_agreements").select("proposal_id").not("proposal_id", "is", null).is("archived_at", null).not("status", "in", "(Cancelled,Archived)")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (agreementRoutes.error) throw agreementRoutes.error;
  const {data:contractOccurrences,error:contractOccurrenceError}=jobs.length?await getSupabaseClient().from("service_occurrences").select("job_id,agreement:service_agreements!service_occurrences_agreement_id_fkey(billing_type)").in("job_id",jobs.map(row=>row.id)):{data:[],error:null};
  if(contractOccurrenceError)throw contractOccurrenceError;
  const contractJobIds=new Set((contractOccurrences??[]).filter(row=>{const type=(row.agreement as {billing_type:string}|null)?.billing_type;return Boolean(type&&type!=="Per Visit")}).map(row=>row.job_id).filter((id): id is string => Boolean(id)));
  const fieldRows = hasPermission(profile, "walkthroughs.field") && profile.employee_id ? await getAssignedFieldWalkthroughs() : [];
  const assignedWalkthroughs: AssignedWalkthroughAttention[] = Array.isArray(fieldRows) ? fieldRows.flatMap(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || typeof row.walkthrough_date !== "string") return [];
    return [{ id: row.id, employeeId: profile.employee_id!, date: row.walkthrough_date, time: typeof row.walkthrough_time === "string" ? row.walkthrough_time : null }];
  }) : [];
  const operationalEmployee = Boolean(profile.employee_id && ["Crew Lead", "Scrub Technician"].includes(profile.role));
  const [discoveries, decisions] = await Promise.all([
    jobs.length && canReviewFieldDiscovery(profile.role)
      ? getSupabaseClient().from("field_discoveries_operational").select("id,job_id,status,created_at").eq("status", "Open").in("job_id", jobs.map(job => job.id))
      : Promise.resolve({ data: [], error: null }),
    jobs.length && operationalEmployee
      ? getSupabaseClient().from("change_requests_operational").select("id,job_id,status,decided_at").in("status", ["Approved", "Declined"]).not("decided_at", "is", null).in("job_id", jobs.map(job => job.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (discoveries.error) throw discoveries.error;
  if (decisions.error) throw decisions.error;
  const input: AttentionRuleInput = { fieldDiscoveries: discoveries.data ?? [], changeRequestDecisions: decisions.data ?? [], assignedWalkthroughs, profile, estimates, jobs, walkthroughs, proposals, agreements, invoices, financiallyResolvedJobIds, communications, timeEntries, states, timezone: settings?.timezone ?? null, jobRouteIds, agreementProposalIds: (agreementRoutes.data ?? []).map((row) => row.proposal_id), contractJobIds };
  const result = buildAttentionItems(input, view);
  const actionableKeys = new Set(result.allKeys);
  await removeResolvedAttentionStates(profile.id, states.filter((state) => !actionableKeys.has(state.attention_key)));
  return result.items;
}

export type AssignedWalkthroughAttention = { id: string; employeeId: string; date: string; time: string | null };

export type AttentionRuleInput = {
  fieldDiscoveries?: Pick<FieldDiscovery, "id" | "job_id" | "status" | "created_at">[];
  changeRequestDecisions?: Pick<ChangeRequest, "id" | "job_id" | "status" | "decided_at">[];
  assignedWalkthroughs?: AssignedWalkthroughAttention[];
  profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>;
  estimates: Awaited<ReturnType<typeof getEstimates>>;
  jobs: Awaited<ReturnType<typeof getJobs>>;
  walkthroughs: Awaited<ReturnType<typeof getWalkthroughs>>;
  proposals: Awaited<ReturnType<typeof getProposals>>;
  agreements: Awaited<ReturnType<typeof getAgreements>>;
  invoices: Awaited<ReturnType<typeof getInvoices>>;
  financiallyResolvedJobIds: Awaited<ReturnType<typeof getFinanciallyResolvedJobIds>>;
  communications: Awaited<ReturnType<typeof getAllClientCommunications>>;
  timeEntries: Awaited<ReturnType<typeof getOpenTimeEntries>>;
  states: AttentionStateRecord[];
  timezone: string | null;
  jobRouteIds: string[];
  agreementProposalIds: Array<string | null>;
  contractJobIds: Set<string>;
  now?: Date;
};

export function buildAttentionItems(input: AttentionRuleInput, view: AttentionView = "Active"): { items: AttentionItem[]; allKeys: string[] } {
  const { profile, estimates, jobs, walkthroughs, proposals, agreements, invoices, communications, timeEntries, states, contractJobIds } = input;
  const canManageCommunications = hasPermission(profile, "communications.view") && hasPermission(profile, "communications.create");
  const clock = businessClock(input.timezone, input.now);
  const today = clock.date, inSeven = addDays(today, 7), inThirty = addDays(today, 30), items: AttentionItem[] = [];
  const routedProposalIds = new Set([...input.jobRouteIds, ...input.agreementProposalIds].filter((id): id is string => Boolean(id)));
  const financiallyResolvedJobs = new Set(input.financiallyResolvedJobIds);

  if (profile.is_active && hasPermission(profile, "jobs.view")) {
    const activeJobs = new Map(jobs.filter(job => !job.archived_at && !["Completed", "Cancelled", "Archived"].includes(job.status)).map(job => [job.id, job]));
    if (canReviewFieldDiscovery(profile.role)) {
      for (const discovery of input.fieldDiscoveries ?? []) {
        const job = activeJobs.get(discovery.job_id);
        if (!job || discovery.status !== "Open") continue;
        items.push(item(`field-discovery:${discovery.id}:submitted`, "Field Discovery Submitted", "Attention", "Jobs", "Field Discovery Submitted", "A field discovery requires review. Open the Job Discoveries tab.", "Job", job.id, null, job.job_number || "Job", null, null, discovery.created_at, `/jobs?jobId=${job.id}`, "Open Job"));
      }
    }
    if (profile.employee_id && ["Crew Lead", "Scrub Technician"].includes(profile.role)) {
      for (const decision of input.changeRequestDecisions ?? []) {
        const job = activeJobs.get(decision.job_id);
        if (!job?.assigned_crew_id || !decision.decided_at || (decision.status !== "Approved" && decision.status !== "Declined")) continue;
        const title = decision.status === "Approved" ? "Change Request Approved" : "Change Request Declined";
        items.push(item(`change-request:${decision.id}:${decision.status}:${profile.employee_id}`, title, "Attention", "Jobs", title, `${title}. Open the Job to review Scope and Changes.`, "Job", job.id, null, job.job_number || "Job", null, null, decision.decided_at, `/jobs?jobId=${job.id}`, "Open Job"));
      }
    }
  }

  // Global lifecycle timestamps are separate from employee Join/payroll entries.
  if (profile.is_active && hasPermission(profile, "jobs.view") && profile.employee_id && ["Crew Lead", "Scrub Technician"].includes(profile.role)) {
    for (const job of jobs) {
      if (!job.assigned_crew_id || job.archived_at || ["Cancelled", "Archived"].includes(job.status)) continue;
      const label = job.job_number || "Job";
      if (job.status === "In Progress" && job.operational_started_at) {
        items.push(item(`job:${job.id}:started:${profile.employee_id}`, "Job Started", "Attention", "Jobs", "Job Started", "The Job has started.", "Job", job.id, null, label, null, null, job.operational_started_at, `/jobs?jobId=${job.id}`, "Open Job"));
      }
      if (job.status === "Completed" && job.completed_at) {
        items.push(item(`job:${job.id}:completed:${profile.employee_id}`, "Job Completed", "Info", "Jobs", "Job Completed", "The Job has been completed.", "Job", job.id, null, label, null, null, job.completed_at, `/jobs?jobId=${job.id}`, "Open Job"));
      }
    }
  }

  // Both loaders restrict operational employees' jobs to their assigned crews.
  if (profile.is_active && hasPermission(profile, "jobs.view") && profile.employee_id && ["Crew Lead", "Scrub Technician"].includes(profile.role)) {
    for (const job of jobs) {
      if (!job.assigned_crew_id || job.archived_at || ["Completed", "Cancelled", "Archived"].includes(job.status)) continue;
      const label = job.job_number || "Job";
      const description = `${label}${job.service_name ? ` - ${job.service_name}` : ""}${job.scheduled_date ? ` - ${friendlyDate(job.scheduled_date)}${job.start_time ? ` at ${friendlyTime(job.start_time)}` : ""}` : ""}`;
      items.push(item(`job:${job.id}:assigned:${profile.employee_id}:${job.assigned_crew_id}`, "Job Assigned", "Attention", "Jobs", "Job Assigned", description, "Job", job.id, null, label, null, job.scheduled_date, job.created_at, `/jobs?jobId=${job.id}`, "Open Job"));
    }
  }

  if (hasPermission(profile, "walkthroughs.field") && profile.employee_id) {
    for (const walkthrough of input.assignedWalkthroughs ?? []) {
      if (walkthrough.employeeId !== profile.employee_id || !walkthrough.date) continue;
      const date = friendlyDate(walkthrough.date);
      const time = walkthrough.time ? friendlyTime(walkthrough.time) : null;
      const description = `You have a StudioScrubz walkthrough scheduled for ${date}${time ? ` at ${time}` : ""}.`;
      const key = `walkthrough:${walkthrough.id}:assigned:${profile.employee_id}`;
      items.push(item(key, "Walkthrough Assigned", "Info", "Walkthroughs", "Walkthrough Assigned", description, "Walkthrough", walkthrough.id, null, null, null, walkthrough.date, walkthrough.date, "/field-walkthroughs", "View Walkthrough"));
      if (withinReminderWindow(walkthrough.date, walkthrough.time, clock.now)) {
        items.push(item(`walkthrough:${walkthrough.id}:reminder:${profile.employee_id}:${walkthrough.date}:${walkthrough.time || "09:00"}`, "Upcoming Walkthrough", "Attention", "Walkthroughs", "Upcoming Walkthrough", `Reminder: ${description}`, "Walkthrough", walkthrough.id, null, null, null, walkthrough.date, walkthrough.date, "/field-walkthroughs", "View Walkthrough"));
      }
    }
  }

  for (const estimate of estimates.filter((row) => !row.archived_at && row.result.submission?.source === "Customer Self-Service")) {
    const submission = estimate.result.submission!;
    const customer = estimate.division === "Commercial" && estimate.client?.company_name
      ? estimate.client.company_name
      : [estimate.customer_first_name, estimate.customer_last_name].filter(Boolean).join(" ") || "Customer";
    const city = estimate.property?.city?.trim();
    const context = [
      `${customer} requested a ${estimate.division} estimate.`,
      estimate.service_name || estimate.result.serviceName,
      city,
      `Prefers ${submission.preferredContactMethod}`,
      `Submitted ${friendlyDate(submission.submittedAt.slice(0, 10))}`,
    ].filter(Boolean).join(" · ");
    items.push(item(`estimate:${estimate.id}:public-request`, "New Estimate Request", "Attention", "Estimates", "New Estimate Request", context, "Estimate", estimate.id, estimate.client_id, estimate.estimate_number, null, null, submission.submittedAt || estimate.created_at, `/open-estimates?estimateId=${estimate.id}`, "Open Estimate"));
  }

  for (const walkthrough of walkthroughs.filter((row) => row.status === "New" && !row.walkthrough_date && !row.archived_at && row.measurements.requestSource === "Public Estimate")) {
    const requestedAt = walkthrough.measurements.requestedAt ?? walkthrough.created_at;
    const client = walkthrough.client?.company_name || [walkthrough.client?.first_name, walkthrough.client?.last_name].filter(Boolean).join(" ") || walkthrough.contact_name || "Deleted Client";
    const property = walkthrough.property ? [walkthrough.property.address, walkthrough.property.city].filter(Boolean).join(", ") : "Deleted Property";
    const service = walkthrough.measurements.serviceType || walkthrough.estimate?.service_name || "Service";
    const estimateNumber = walkthrough.measurements.estimateNumber || walkthrough.estimate?.estimate_number || "Estimate";
    const contact = walkthrough.measurements.preferredContactMethod || "Not specified";
    items.push(item(`walkthrough:${walkthrough.id}:requested`, "Walkthrough Requested", "Attention", "Walkthroughs", "Walkthrough requested", `${client} · ${property} · ${service} · ${estimateNumber} · Prefers ${contact} · Requested ${friendlyDate(requestedAt.slice(0, 10))}`, "Walkthrough", walkthrough.id, walkthrough.client_id, estimateNumber, null, null, requestedAt, `/walkthroughs?walkthroughId=${walkthrough.id}`, "Open Walkthrough"));
  }

  if (["Sales", "Administrator", "Master Admin"].includes(profile.role) && hasPermission(profile, "walkthroughs.view") && hasPermission(profile, "proposals.create")) {
    const proposedWalkthroughIds = new Set(proposals.filter((proposal) => !proposal.archived_at).map((proposal) => proposal.walkthrough_id));
    const proposedEstimateIds = new Set(proposals.filter((proposal) => !proposal.archived_at).map((proposal) => proposal.estimate_id).filter(Boolean));
    for (const walkthrough of walkthroughs) {
      if (walkthrough.archived_at || walkthrough.status !== "Completed" || walkthrough.pricing_review || walkthrough.pricing_reviewed_at) continue;
      if (proposedWalkthroughIds.has(walkthrough.id) || (walkthrough.estimate_id && proposedEstimateIds.has(walkthrough.estimate_id))) continue;
      items.push(item(`walkthrough:${walkthrough.id}:pricing-review`, "Pricing Review Needed", "Attention", "Walkthroughs", "Pricing Review Needed", "A completed sales assessment is ready for pricing review.", "Walkthrough", walkthrough.id, walkthrough.client_id, null, null, null, walkthrough.updated_at, `/walkthroughs?walkthroughId=${walkthrough.id}`, "Review Pricing"));
    }
  }

  for (const job of jobs) {
    const label = job.job_number;
    if (job.status === "Completed" && job.financials_available !== false && job.price > 0 && !financiallyResolvedJobs.has(job.id) && !contractJobIds.has(job.id)) items.push(item(`job:${job.id}:invoice`, "Completed Job Needs Invoice", "Urgent", "Invoices", "Completed job needs an invoice", `${label} - ${job.service_name || "Service"} - ${job.client_name || "Deleted Client"}`, "Job", job.id, job.client_id, label, null, job.scheduled_date, job.created_at, `/jobs?jobId=${job.id}`, "Create Invoice"));
    if (job.status === "Ready to Schedule" && !job.scheduled_date) items.push(item(`job:${job.id}:unscheduled`, "Unscheduled Job", "Attention", "Jobs", "Job needs scheduling", `${label} · ${job.service_name || "Service"} — ${job.client_name || "Deleted Client"}`, "Job", job.id, job.client_id, label, null, null, job.created_at, `/jobs?jobId=${job.id}`, "Schedule Job"));
    if (["Scheduled", "Ready to Schedule"].includes(job.status) && job.scheduled_date && !job.assigned_crew_id) items.push(item(`job:${job.id}:crew`, "Job Needs Crew", "Attention", "Jobs", "Job needs crew assignment", `${label} · ${job.service_name || "Service"} — ${job.client_name || "Deleted Client"}`, "Job", job.id, job.client_id, label, null, job.scheduled_date, job.created_at, `/jobs?jobId=${job.id}`, "Assign Crew"));
    if (job.scheduled_date && job.scheduled_date >= today && job.scheduled_date <= inSeven && !["Completed", "Cancelled", "Archived"].includes(job.status) && !job.archived_at) items.push(item(`job:${job.id}:upcoming`, "Upcoming Job", "Info", "Jobs", "Upcoming job", `${label} · ${job.service_name || "Service"} — ${job.client_name || "Deleted Client"}`, "Job", job.id, job.client_id, label, null, job.scheduled_date, job.created_at, `/jobs?jobId=${job.id}`, "Open Job"));
    if (canManageCommunications && job.client_id && job.scheduled_date && withinReminderWindow(job.scheduled_date, job.start_time, clock.now) && !["Completed", "Cancelled", "Archived"].includes(job.status) && !job.archived_at && !reminderWasSent(communications, "Job", job.id, job.scheduled_date)) {
      const date = friendlyDate(job.scheduled_date), time = job.start_time ? friendlyTime(job.start_time) : null, location = job.property?.address ?? job.property_name;
      items.push(item(`service-reminder:${job.id}:${job.scheduled_date}`, "Service Reminder Due", "Info", "Communications", "Service reminder due", `${label} · ${job.service_name || "Service"} — ${job.client_name || "Deleted Client"}`, "Job", job.id, job.client_id, label, null, job.scheduled_date, job.created_at, `/jobs?jobId=${job.id}`, "Open Job", composer({ clientId: job.client_id, propertyId: job.property_id, jobId: job.id, communicationType: "Service Reminder", client: job.client, fallbackName: job.client_name, email: job.client?.email, phone: job.client?.phone, subject: `Reminder ? Upcoming StudioScrubz Service`, message: [!(job.client?.first_name?.trim() || job.client?.company_name?.trim() || job.client_name?.trim()) ? "Hello," : `Hello ${greeting(job.client, job.client_name)},`, "", "This is a reminder that your StudioScrubz service is coming up.", "", ...(job.service_name ? [`Service: ${job.service_name}`] : []), `Date: ${date}`, ...(time ? [`Time: ${time}`] : []), ...(location ? ["", "Property:", location] : []), "", "Please make sure our team will have access to the service areas at the scheduled time.", "", "If you need to update any access information or have questions before your appointment, please contact us.", "", "We look forward to taking care of your space.", "", "No mess. No stress.", "", "StudioScrubz"].join("\n"), sourceType: "Job", sourceId: job.id, metadata: { source: "Job", source_id: job.id, scheduled_date: job.scheduled_date, service_name: job.service_name || "Service" } })));
    }
  }
  for (const proposal of proposals.filter((row) => !row.archived_at && row.status !== "Archived")) {
    const recurring = isRecurringFrequency(proposal.frequency);
    const canRoute = recurring ? hasPermission(profile, "agreements.manage") : hasPermission(profile, "jobs.create");
    if (proposal.status === "Accepted" && proposal.accepted && canRoute && !routedProposalIds.has(proposal.id)) {
      items.push(item(`proposal:${proposal.id}:route`, "Accepted Proposal Needs Routing", "Urgent", "Proposals", recurring ? "Accepted proposal needs a Service Agreement" : "Accepted proposal needs a Job", `${proposal.proposal_number} - ${proposal.client_name || "Deleted Client"}`, "Proposal", proposal.id, proposal.client_id, proposal.proposal_number, null, null, proposal.accepted_at ?? proposal.created_at, `/open-proposals?proposalId=${proposal.id}`, recurring ? "Create Agreement" : "Create Job"));
    }
    if (proposal.approval_status === "Pending Approval") items.push(item(`proposal:${proposal.id}:approval`, "Proposal Awaiting Approval", "Attention", "Proposals", "Proposal awaiting approval", `${proposal.proposal_number} · ${proposal.client_name || "Deleted Client"}`, "Proposal", proposal.id, proposal.client_id, proposal.proposal_number, null, null, proposal.created_at, `/open-proposals?proposalId=${proposal.id}`, "Review Proposal"));
    if (proposal.approval_status === "Approved" && ["Approved", "Sent", "Viewed"].includes(proposal.status) && !proposal.accepted) items.push(item(`proposal:${proposal.id}:client`, "Proposal Awaiting Client", "Attention", "Proposals", "Proposal awaiting client acceptance", `${proposal.proposal_number} · ${proposal.client_name || "Deleted Client"}${lastFollowup(communications, "proposal_id", proposal.id)}`, "Proposal", proposal.id, proposal.client_id, proposal.proposal_number, proposal.expiration_date, null, proposal.created_at, `/open-proposals?proposalId=${proposal.id}`, "Open Proposal", composer({ clientId: proposal.client_id, propertyId: proposal.property_id, proposalId: proposal.id, communicationType: "Proposal", client: proposal.client, fallbackName: proposal.client_name, email: proposal.customer_email ?? proposal.client?.email, phone: proposal.customer_phone ?? proposal.client?.phone, subject: `Following Up on Your StudioScrubz Proposal`, message: `Hello ${greeting(proposal.client, proposal.client_name)},\n\nI wanted to follow up on the StudioScrubz proposal we sent for your property or project.\n\nIf you have any questions about the scope, pricing, or next steps, I?d be happy to help.\n\nIf everything looks good, you can continue using the secure proposal link previously provided.\n\nWe appreciate the opportunity to work with you and look forward to hearing from you.\n\nNo mess. No stress.\n\nStudioScrubz`, sourceType: "Proposal", sourceId: proposal.id, metadata: { proposal_number: proposal.proposal_number } })));
  }
  for (const agreement of agreements) {
    const label = agreement.agreement_number, client = agreement.client?.company_name || [agreement.client?.first_name, agreement.client?.last_name].filter(Boolean).join(" ") || "Deleted Client";
    if (agreement.status === "Sent" && !agreement.client_signed_at) { const validToken = agreement.client_access_token && (!agreement.client_access_token_expires_at || Date.parse(agreement.client_access_token_expires_at) > Date.now()); const reviewUrl = validToken ? `${getPublicSiteUrl()}/agreement/${agreement.client_access_token}` : null; items.push(item(`agreement:${agreement.id}:signature`, "Agreement Awaiting Signature", daysSince(agreement.sent_at) >= 5 ? "Attention" : "Info", "Agreements", "Agreement awaiting signature", `${label} · ${client}${agreement.sent_at ? ` · Sent ${daysSince(agreement.sent_at)} days ago` : ""}${lastFollowup(communications, "agreement_id", agreement.id)}${!validToken ? " · Secure link must be refreshed from Agreement Resend" : ""}`, "Service Agreement", agreement.id, agreement.client_id, label, null, null, agreement.created_at, `/agreements?agreementId=${agreement.id}`, "Open Agreement", validToken ? composer({ clientId: agreement.client_id, propertyId: agreement.property_id, agreementId: agreement.id, communicationType: "Service Agreement", client: agreement.client, fallbackName: client, email: agreement.sent_to ?? agreement.client?.email, phone: agreement.client?.phone, subject: `Reminder: StudioScrubz Service Agreement ${label}`, message: `Hello ${greeting(agreement.client, client)},\n\nThis is a friendly reminder that your StudioScrubz Service Agreement is awaiting your review and signature.\n\nPlease use your secure agreement link to review and sign the agreement.\n\nThank you,\nStudioScrubz`, handoffSuffix: reviewUrl ? `\n\nReview & Sign Agreement:\n${reviewUrl}` : null, sourceType: "Service Agreement", sourceId: agreement.id, metadata: { agreement_number: label, follow_up: true, secure_link_included: true } }) : null)); }
    if (agreement.status === "Accepted") items.push(item(`agreement:${agreement.id}:activate`, "Agreement Accepted Not Active", "Attention", "Agreements", "Accepted agreement needs activation", `${label} · ${client}`, "Service Agreement", agreement.id, agreement.client_id, label, null, null, agreement.created_at, `/agreements?agreementId=${agreement.id}`, "Activate Agreement"));
    if (agreement.status === "Active" && !agreement.auto_renew && agreement.end_date && agreement.end_date >= today && agreement.end_date <= inThirty) items.push(item(`agreement:${agreement.id}:expiring`, "Agreement Expiring", "Attention", "Agreements", "Service Agreement expires soon", `${label} · ${client}`, "Service Agreement", agreement.id, agreement.client_id, label, agreement.end_date, null, agreement.created_at, `/agreements?agreementId=${agreement.id}`, "Open Agreement"));
  }
  for (const invoice of invoices.filter((row) => !row.archived_at && row.balance_due > 0 && !["Paid", "Cancelled", "Archived"].includes(row.status))) {
    const reminderContext = invoice.due_date ? composer({ clientId: invoice.client_id, propertyId: invoice.property_id, invoiceId: invoice.id, communicationType: "Payment Reminder", client: invoice.client, fallbackName: invoice.client_name, email: invoice.customer_email ?? invoice.client?.email, phone: invoice.customer_phone ?? invoice.client?.phone, subject: `Friendly Reminder ? StudioScrubz Invoice`, message: `Hello ${greeting(invoice.client, invoice.client_name)},\n\nThis is a friendly reminder regarding your StudioScrubz invoice.\n\nIf payment has already been submitted, please disregard this message.\n\nIf you still need to complete payment, please use the secure invoice link previously provided.\n\nIf you have any questions about the invoice or payment details, feel free to contact us.\n\nThank you for choosing StudioScrubz.\n\nNo mess. No stress.\n\nStudioScrubz`, sourceType: "Invoice", sourceId: invoice.id, metadata: { invoice_number: invoice.invoice_number, follow_up: true } }) : null;
    if (invoice.due_date && invoice.due_date < today) items.push(item(`invoice:${invoice.id}:overdue`, "Overdue Invoice", "Urgent", "Invoices", "Invoice overdue", `${invoice.invoice_number} · ${money(invoice.balance_due)} outstanding · ${invoice.client_name || "Deleted Client"}${lastFollowup(communications, "invoice_id", invoice.id)}`, "Invoice", invoice.id, invoice.client_id, invoice.invoice_number, invoice.due_date, null, invoice.created_at, `/invoices?invoiceId=${invoice.id}`, "Open Invoice", reminderContext));
    else if (invoice.due_date && invoice.due_date <= inSeven) items.push(item(`invoice:${invoice.id}:due`, "Invoice Due Soon", "Info", "Invoices", "Invoice due soon", `${invoice.invoice_number} · ${money(invoice.balance_due)} outstanding · ${invoice.client_name || "Deleted Client"}${lastFollowup(communications, "invoice_id", invoice.id)}`, "Invoice", invoice.id, invoice.client_id, invoice.invoice_number, invoice.due_date, null, invoice.created_at, `/invoices?invoiceId=${invoice.id}`, "Open Invoice", reminderContext));
  }
  for (const invoice of invoices.filter((row) => !row.archived_at && row.status === "Paid")) {
    const clientName = displayName(invoice.client, invoice.client_name);
    const firstName = invoice.client?.first_name?.trim() || "there";
    const phone = invoice.client?.phone?.trim() || invoice.customer_phone?.trim() || null;
    const message = `Hi ${firstName}, thank you again for choosing StudioScrubz! We’d really appreciate it if you could take a moment to leave us a Google review: ${GOOGLE_REVIEW_URL}`;
    const review = item(`invoice:${invoice.id}:review-request`, "Review Request Ready", "Info", "Invoices", "Review Request Ready", `${clientName} — Invoice #${invoice.invoice_number} paid`, "Invoice", invoice.id, invoice.client_id, invoice.invoice_number, null, null, invoice.paid_at ?? invoice.updated_at, `/invoices?invoiceId=${invoice.id}`, "Open Invoice");
    review.snoozable = false;
    review.dismissible = false;
    review.resolution_label = "MARK SENT";
    review.sms_action = { href: phone ? `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(message)}` : null, unavailable_reason: phone ? null : "No client phone number on file." };
    items.push(review);
  }
  for (const communication of communications.filter((row) => row.status === "Failed" && !row.archived_at && !communications.some((retry) => retry.status === "Sent" && retry.metadata.retry_of_communication_id === row.id))) items.push(item(`communication:${communication.id}:failed`, "Failed Client Communication", "Urgent", "Communications", "Client communication failed", `${communication.communication_number} · ${communication.subject || communication.communication_type}`, "Communication", communication.id, communication.client_id, communication.communication_number, null, null, communication.created_at, communication.client_id ? `/clients?clientId=${communication.client_id}` : "/clients", "View Client", { clientId: communication.client_id, propertyId: communication.property_id, estimateId: communication.estimate_id, proposalId: communication.proposal_id, agreementId: communication.agreement_id, invoiceId: communication.invoice_id, communicationType: communication.communication_type, channel: communication.channel, clientName: "Client", recipientEmail: communication.recipient_email, recipientPhone: communication.recipient_phone, subject: communication.subject ?? "", messageBody: communication.message_body ?? "", sourceType: "Communication Retry", sourceId: communication.id, metadata: { retry_of_communication_id: communication.id } }));
  for (const entry of timeEntries.filter((row) => Boolean(row.job_id) && row.status === "Open" && !row.clock_out && !row.archived_at)) items.push(item(`time:${entry.id}:open`, "Open Time Entry", "Attention", "Time", "Job time entry is still open", `${entry.time_entry_number} · ${entry.employee ? [entry.employee.first_name, entry.employee.last_name].filter(Boolean).join(" ") : "Deleted Employee"}`, "Time Entry", entry.id, null, entry.time_entry_number, null, entry.work_date, entry.created_at, "/time-clock", "Open Job"));
  const actionableKeys = new Set(items.map((entry) => entry.id));
  const activeStates = states.filter((state) => actionableKeys.has(state.attention_key));
  const stateMap = new Map(activeStates.map((state) => [state.attention_key, state]));
  const visible = items.map((entry) => ({ ...entry, attention_state: effectiveState(stateMap.get(entry.id), clock.now) }))
    .filter((entry) => view === "All" || (view === "Active" ? !entry.attention_state : entry.attention_state?.state === view))
    .sort((a, b) => rank(a.severity) - rank(b.severity) || (a.due_date ?? a.scheduled_date ?? "9999").localeCompare(b.due_date ?? b.scheduled_date ?? "9999") || b.created_at.localeCompare(a.created_at));
  return { items: visible, allKeys: [...actionableKeys] };
}

export async function getAttentionSummary(): Promise<AttentionSummary> { const all = await getAttentionItems("All"), active = all.filter((item) => !item.attention_state); return { ...summarizeAttention(active), snoozed: all.filter((item) => item.attention_state?.state === "Snoozed").length }; }
export function summarizeAttention(items: AttentionItem[]): AttentionSummary { return { urgent: items.filter((x) => x.severity === "Urgent").length, attention: items.filter((x) => x.severity === "Attention").length, info: items.filter((x) => x.severity === "Info").length, total: items.length, snoozed: items.filter((x) => x.attention_state?.state === "Snoozed").length }; }
export async function getAttentionItemStates(): Promise<AttentionStateRecord[]> { const { data, error } = await getSupabaseClient().from("attention_item_states").select("*").order("updated_at", { ascending: false }); if (error) throw new Error(`Attention state could not be loaded: ${error.message}`); return data as AttentionStateRecord[]; }
export async function snoozeAttentionItem(attentionKey: string, until: string): Promise<void> { if (Date.parse(until) <= Date.now()) throw new Error("Choose a future snooze time."); await saveState(attentionKey, "Snoozed", until); }
export async function dismissAttentionItem(attentionKey: string): Promise<void> { await saveState(attentionKey, "Dismissed", null); }
export async function restoreAttentionItem(attentionKey: string): Promise<void> { return withImmediateAttentionPush(async()=>{const profile = await getCurrentProfile(); if (!profile) throw new Error("Authentication is required."); const { error } = await getSupabaseClient().from("attention_item_states").delete().eq("user_id", profile.id).eq("attention_key", attentionKey); if (error) throw new Error(`Attention item could not be restored: ${error.message}`);}); }
async function saveState(attentionKey: string, state: "Snoozed" | "Dismissed", until: string | null) { const profile = await getCurrentProfile(); if (!profile) throw new Error("Authentication is required."); const { error } = await getSupabaseClient().from("attention_item_states").upsert({ user_id: profile.id, attention_key: attentionKey, state, snoozed_until: state === "Snoozed" ? until : null, dismissed_at: state === "Dismissed" ? new Date().toISOString() : null }, { onConflict: "user_id,attention_key" }); if (error) throw new Error(`Attention state could not be saved: ${error.message}`); }
async function removeResolvedAttentionStates(userId: string, states: AttentionStateRecord[]) { if (!states.length) return; const { error } = await getSupabaseClient().from("attention_item_states").delete().eq("user_id", userId).in("attention_key", states.map((state) => state.attention_key)); if (error) throw new Error(`Resolved attention state could not be cleared: ${error.message}`); }
function item(id: string, type: AttentionItem["type"], severity: AttentionItem["severity"], category: AttentionItem["category"], title: string, description: string, record_type: string, record_id: string, client_id: string | null, entity_label: string | null, due_date: string | null, scheduled_date: string | null, created_at: string, action_url: string, action_label: string, communication_context: CommunicationComposerContext | null = null): AttentionItem { return { id, type, severity, category, title, description, record_type, record_id, client_id, entity_label, due_date, scheduled_date, created_at, action_url, action_label, metadata: {}, snoozable: true, dismissible: true, attention_state: null, communication_context, sms_action: null, resolution_label: null }; }
function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function addDays(value: string, days: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return localDate(date); }
function daysSince(value: string | null) { return value ? Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86400000)) : 0; }
function rank(value: AttentionItem["severity"]) { return value === "Urgent" ? 0 : value === "Attention" ? 1 : 2; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function effectiveState(state: AttentionStateRecord | undefined, now: Date) { if (!state) return null; if (state.state === "Snoozed" && (!state.snoozed_until || Date.parse(state.snoozed_until) <= now.getTime())) return null; return state; }
function withinReminderWindow(date: string, time: string | null, now: Date) { const scheduled = new Date(`${date}T${time?.slice(0, 5) || "09:00"}:00`); const delta = scheduled.getTime() - now.getTime(); return delta >= 0 && delta <= 48 * 60 * 60 * 1000; }
function reminderWasSent(rows: Awaited<ReturnType<typeof getAllClientCommunications>>, source: string, sourceId: string, scheduledDate: string) { return rows.some((row) => row.communication_type === "Service Reminder" && row.status === "Sent" && row.metadata.source === source && row.metadata.source_id === sourceId && row.metadata.scheduled_date === scheduledDate); }
function businessClock(timeZone: string | null, reference = new Date()) { const now = reference; if (!timeZone) return { now, date: localDate(now) }; try { const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now); const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00"; const date = `${get("year")}-${get("month")}-${get("day")}`; return { date, now: new Date(`${date}T${get("hour")}:${get("minute")}:00`) }; } catch { return { now, date: localDate(now) }; } }
function composer(input: { clientId: string | null; propertyId?: string | null; proposalId?: string; agreementId?: string; invoiceId?: string; jobId?: string; communicationType: CommunicationComposerContext["communicationType"]; client: { first_name: string | null; last_name: string | null; company_name: string | null; email: string | null; phone: string | null } | null; fallbackName: string | null; email?: string | null; phone?: string | null; subject: string; message: string; handoffSuffix?: string | null; sourceType: string; sourceId: string; metadata: CommunicationComposerContext["metadata"] }): CommunicationComposerContext { return { clientId: input.clientId, propertyId: input.propertyId, proposalId: input.proposalId, agreementId: input.agreementId, invoiceId: input.invoiceId, jobId: input.jobId, communicationType: input.communicationType, channel: "Email", clientName: displayName(input.client, input.fallbackName), recipientEmail: input.email ?? null, recipientPhone: input.phone ?? null, subject: input.subject, messageBody: input.message, handoffSuffix: input.handoffSuffix, sourceType: input.sourceType, sourceId: input.sourceId, metadata: input.metadata }; }
function displayName(client: { first_name: string | null; last_name: string | null; company_name: string | null } | null, fallback: string | null) { return client?.company_name || [client?.first_name, client?.last_name].filter(Boolean).join(" ") || fallback || "Client"; }
function greeting(client: { first_name: string | null; company_name: string | null } | null, fallback: string | null) { return client?.first_name?.trim() || client?.company_name?.trim() || fallback || "Client"; }
function friendlyDate(value: string) { return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function friendlyTime(value: string) { const [h, m] = value.slice(0, 5).split(":").map(Number); return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m)); }
function lastFollowup(rows: Awaited<ReturnType<typeof getAllClientCommunications>>, field: "proposal_id" | "agreement_id" | "invoice_id", id: string) { const found = rows.find((row) => row[field] === id && row.status === "Sent"); return found ? ` · Last follow-up ${friendlyDate((found.sent_at ?? found.created_at).slice(0, 10))}` : ""; }
