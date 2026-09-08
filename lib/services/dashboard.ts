import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentProfile } from "@/lib/services/auth";
import { getActiveCrews } from "@/lib/services/crews";
import { getJobs, getJobProposalIds, getJobsForDateRange } from "@/lib/services/jobs";
import { getEstimates } from "@/lib/services/estimates";
import { getWalkthroughs, getWalkthroughsForEstimates } from "@/lib/services/walkthroughs";
import { getProposals, isProposalDueToExpire } from "@/lib/services/proposals";
import { getAgreements } from "@/lib/services/agreements";
import { getInvoices, isPastDueInvoice } from "@/lib/services/invoices";
import { getAttentionItems as getOperationalAttentionItems } from "@/lib/services/attention";
import { compareWalkthroughSchedule, isScheduledWalkthrough, proposalRetiresWalkthrough } from "@/lib/walkthroughWorkflow";
import type { DashboardData, DashboardAttentionItem } from "@/types/dashboard";
import type { JobWithRelations } from "@/types/job";

export async function getDashboardData(): Promise<DashboardData> {
  const profile = await getCurrentProfile();
  if (!profile?.is_active || !hasPermission(profile, "dashboard.view")) throw new Error("Dashboard access denied.");
  const today = localDate(), tomorrow = addDays(today, 1);
  const canJobs = hasPermission(profile, "jobs.view");
  const canEstimates = hasPermission(profile, "estimates.view");
  const canProposals = hasPermission(profile, "proposals.view");
  const [estimates, estimateLinks, walkthroughs, proposals, jobProposalIds, agreements, jobRows, todaysJobs, previewRows, invoices, crews, attention] = await Promise.all([
    canEstimates ? getEstimates() : Promise.resolve([]),
    canEstimates ? getWalkthroughsForEstimates() : Promise.resolve([]),
    hasPermission(profile, "walkthroughs.view") ? getWalkthroughs() : Promise.resolve([]),
    canProposals ? getProposals() : Promise.resolve([]),
    canProposals ? getJobProposalIds() : Promise.resolve([]),
    canProposals && hasPermission(profile, "agreements.view") ? getAgreements() : Promise.resolve([]),
    canJobs ? getJobs() : Promise.resolve([]),
    canJobs ? getTodaysJobs(today) : Promise.resolve([]),
    canJobs ? getJobsForDateRange(today, tomorrow) : Promise.resolve([]),
    hasPermission(profile, "invoices.view") ? getInvoices() : Promise.resolve([]),
    hasPermission(profile, "crews.view") ? getActiveCrews() : Promise.resolve([]),
    hasPermission(profile, "attention.view") ? getOperationalAttentionItems() : Promise.resolve([]),
  ]);

  // Open Estimates retires only links with both a scheduled date and time.
  const scheduledEstimateIds = new Set(estimateLinks.filter(isScheduledWalkthrough).map(row => row.estimate_id));
  const openEstimates = estimates.filter(row => !row.archived_at && row.status === "Open" && !scheduledEstimateIds.has(row.id));
  const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00`).getTime();
  const monthEnd = new Date(monthStart); monthEnd.setMonth(monthEnd.getMonth() + 1);

  // Match the Proposals page's expiration rule without mutating records on Dashboard load.
  const currentProposals = proposals.map(row => isProposalDueToExpire(row) ? { ...row, status: "Expired" as const } : row);
  const routed = new Set([...jobProposalIds, ...agreements.map(row => row.proposal_id)]);
  const openProposals = currentProposals.filter(row => !row.archived_at && row.status !== "Archived" && (row.status !== "Accepted" || !routed.has(row.id)));
  const proposalCount = (...statuses: string[]) => openProposals.filter(row => statuses.includes(row.status)).length;
  const accepted = proposalCount("Accepted"), declined = proposalCount("Declined");

  const proposalByWalkthrough = new Map(proposals.filter(row => row.walkthrough_id && !row.archived_at).map(row => [row.walkthrough_id, row]));
  const upcoming = walkthroughs.filter(row => !row.archived_at && row.estimate?.status !== "Declined"
    && ["New", "Scheduled"].includes(row.status) && isScheduledWalkthrough(row)
    && !proposalRetiresWalkthrough(proposalByWalkthrough.get(row.id)?.status))
    .sort(compareWalkthroughSchedule);
  const activeJobs = jobRows.filter(row => !row.archived_at && !["Cancelled", "Archived"].includes(row.status));
  const jobCount = (status: string) => activeJobs.filter(row => row.status === status).length;
  const preview = operationalScheduleRows(previewRows);
  return {
    metrics: {
      openEstimates: openEstimates.length,
      upcomingWalkthroughs: upcoming.length,
      pendingProposals: proposalCount("Draft", "Ready for Approval", "Approved", "Sent", "Viewed", "Accepted"),
      jobsToday: todaysJobs.length,
      pastDueInvoices: invoices.filter(row => !row.archived_at && isPastDueInvoice(row)).length,
    },
    todaysJobs,
    upcomingWalkthroughs: upcoming.slice(0, 5),
    proposal: { draft: proposalCount("Draft"), ready: proposalCount("Ready for Approval"), approved: proposalCount("Approved"), sentViewed: proposalCount("Sent", "Viewed"), accepted, declined, acceptanceRate: accepted + declined ? accepted / (accepted + declined) * 100 : null },
    estimate: {
      open: openEstimates.length,
      residential: openEstimates.filter(row => row.division === "Residential").length,
      commercial: openEstimates.filter(row => row.division === "Commercial").length,
      createdThisMonth: estimates.filter(row => !row.archived_at && !(row.status === "Open" && scheduledEstimateIds.has(row.id))
        && Date.parse(row.created_at) >= monthStart && Date.parse(row.created_at) < monthEnd.getTime()).length,
    },
    jobs: { ready: jobCount("Ready to Schedule"), scheduled: jobCount("Scheduled"), crewAssigned: jobCount("Crew Assigned"), inProgress: jobCount("In Progress"), completed: jobCount("Completed") },
    crews: crews.map(crew => ({ crew, todayJobs: todaysJobs.filter(job => job.assigned_crew_id === crew.id).length, inProgress: todaysJobs.some(job => job.assigned_crew_id === crew.id && job.status === "In Progress") })),
    attention: attention.slice(0, 12).map(entry => ({ id: entry.id, type: entry.type, record: entry.entity_label ?? entry.record_type, description: entry.title, action: entry.action_label, href: entry.action_url })),
    preview: { today: preview.filter(job => job.scheduled_date === today), tomorrow: preview.filter(job => job.scheduled_date === tomorrow) },
  };
}

export async function getTodaysJobs(today = localDate()) {
  return operationalScheduleRows(await getJobsForDateRange(today, today));
}
function operationalScheduleRows(jobs: JobWithRelations[]) {
  return jobs.filter(job => !job.archived_at && !["Completed", "Cancelled", "Archived"].includes(job.status))
    .sort((a, b) => (a.start_time ?? "\uffff").localeCompare(b.start_time ?? "\uffff"));
}

// Preserve existing exports; every section uses the same authorized aggregation.
export async function getDashboardMetrics() { return (await getDashboardData()).metrics; }
export async function getUpcomingWalkthroughs() { return (await getDashboardData()).upcomingWalkthroughs; }
export async function getProposalPipelineMetrics() { return (await getDashboardData()).proposal; }
export async function getEstimateMetrics() { return (await getDashboardData()).estimate; }
export async function getJobPipelineMetrics() { return (await getDashboardData()).jobs; }
export async function getCrewStatus() { return (await getDashboardData()).crews; }
export async function getAttentionItems(): Promise<DashboardAttentionItem[]> { return (await getDashboardData()).attention; }
export async function getSchedulePreview() { return (await getDashboardData()).preview; }

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return localDate(d);
}
