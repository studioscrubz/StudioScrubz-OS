import { getSupabaseClient } from "@/lib/supabase/client";
import { getActiveCrews } from "@/lib/services/crews";
import { getJobProposalIds } from "@/lib/services/jobs";
import { getInvoicedJobIds } from "@/lib/services/invoices";
import type {
  DashboardAttentionItem,
  DashboardData,
  DashboardEstimateMetrics,
  DashboardJobMetrics,
  DashboardMetrics,
  DashboardProposalMetrics,
} from "@/types/dashboard";
import type { JobWithRelations } from "@/types/job";
import type { WalkthroughWithRelations } from "@/types/walkthrough";
import { isRecurringFrequency } from "@/lib/scheduling/frequency";
import { getAttentionItems as getOperationalAttentionItems } from "@/lib/services/attention";
const jobSelect =
  "*, proposal:proposals!jobs_proposal_id_fkey(*), client:clients!jobs_client_id_fkey(*), property:properties!jobs_property_id_fkey(*)";
const walkthroughSelect =
  "*, client:clients!walkthroughs_client_id_fkey(*), property:properties!walkthroughs_property_id_fkey(*), estimate:estimates!walkthroughs_estimate_id_fkey(*)";
export async function getDashboardData(): Promise<DashboardData> {
  const [
    metrics,
    todaysJobs,
    upcomingWalkthroughs,
    proposal,
    estimate,
    jobs,
    crews,
    attention,
    preview,
  ] = await Promise.all([
    getDashboardMetrics(),
    getTodaysJobs(),
    getUpcomingWalkthroughs(),
    getProposalPipelineMetrics(),
    getEstimateMetrics(),
    getJobPipelineMetrics(),
    getCrewStatus(),
    getOperationalAttentionItems(),
    getSchedulePreview(),
  ]);
  return {
    metrics,
    todaysJobs,
    upcomingWalkthroughs,
    proposal,
    estimate,
    jobs,
    crews,
    attention: attention.slice(0, 12).map((entry) => ({
      id: entry.id,
      type: entry.type,
      record: entry.entity_label ?? entry.record_type,
      description: entry.title,
      action: entry.action_label,
      href: entry.action_url,
    })),
    preview,
  };
}
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const db = getSupabaseClient();
  const today = localDate();
  const [estimatesResult, linkedWalkthroughsResult, walkthroughsResult, proposalsResult, routedJobsResult, routedAgreementsResult, jobsResult, invoicesResult, timeEntriesResult] = await Promise.all([
    db
      .from("estimates")
      .select("id")
      .eq("status", "Open")
      .is("archived_at", null),
    db.from("walkthroughs").select("estimate_id").not("estimate_id", "is", null),
    db
      .from("walkthroughs")
      .select("id", { count: "exact", head: true })
      .gte("walkthrough_date", today)
      .eq("status", "Scheduled")
      .is("archived_at", null),
    db
      .from("proposals")
      .select("id,status,accepted")
      .is("archived_at", null),
    db.from("jobs").select("proposal_id").not("proposal_id", "is", null).is("archived_at", null),
    db.from("service_agreements").select("proposal_id").not("proposal_id", "is", null).is("archived_at", null),
    db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("scheduled_date", today)
      .not("status", "in", "(Cancelled,Archived)")
      .is("archived_at", null),
    db
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .lt("due_date", today)
      .gt("balance_due", 0)
      .not("status", "in", "(Paid,Cancelled,Archived)")
      .is("archived_at", null),
    db
      .from("time_entries")
      .select("employee_id")
      .eq("status", "Open")
      .is("clock_out", null)
      .is("archived_at", null),
  ]);
  const results = [estimatesResult, linkedWalkthroughsResult, walkthroughsResult, proposalsResult, routedJobsResult, routedAgreementsResult, jobsResult, invoicesResult, timeEntriesResult];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  const routedProposalIds = new Set([
    ...(routedJobsResult.data ?? []).map((row) => row.proposal_id),
    ...(routedAgreementsResult.data ?? []).map((row) => row.proposal_id),
  ].filter((id): id is string => Boolean(id)));
  const pendingStatuses = new Set(["Draft", "Ready for Approval", "Approved", "Sent", "Viewed"]);
  const pendingProposals = (proposalsResult.data ?? []).filter((proposal) =>
    pendingStatuses.has(proposal.status) ||
    (proposal.status === "Accepted" && proposal.accepted && !routedProposalIds.has(proposal.id)),
  ).length;
  const clockedInEmployees = new Set((timeEntriesResult.data ?? []).map((entry) => entry.employee_id).filter((id): id is string => Boolean(id)));
  return {
    openEstimates: activeEstimateCount(estimatesResult.data, linkedWalkthroughsResult.data),
    upcomingWalkthroughs: walkthroughsResult.count ?? 0,
    pendingProposals,
    jobsToday: jobsResult.count ?? 0,
    pastDueInvoices: invoicesResult.count ?? 0,
    employeesClockedIn: clockedInEmployees.size,
  };
}
export async function getTodaysJobs() {
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .select(jobSelect)
    .eq("scheduled_date", localDate())
    .not("status", "in", "(Completed,Cancelled,Archived)")
    .order("start_time");
  if (error) throw error;
  return data as JobWithRelations[];
}
export async function getUpcomingWalkthroughs() {
  const { data, error } = await getSupabaseClient()
    .from("walkthroughs")
    .select(walkthroughSelect)
    .gte("walkthrough_date", localDate())
    .eq("status", "Scheduled")
    .is("archived_at", null)
    .order("walkthrough_date")
    .order("walkthrough_time")
    .limit(5);
  if (error) throw error;
  return data as WalkthroughWithRelations[];
}
export async function getProposalPipelineMetrics(): Promise<DashboardProposalMetrics> {
  const { data, error } = await getSupabaseClient()
    .from("proposals")
    .select("status")
    .is("archived_at", null);
  if (error) throw error;
  const n = (...s: string[]) => data.filter((x) => s.includes(x.status)).length;
  const accepted = n("Accepted"),
    declined = n("Declined");
  return {
    draft: n("Draft"),
    ready: n("Ready for Approval"),
    approved: n("Approved"),
    sentViewed: n("Sent", "Viewed"),
    accepted,
    declined,
    acceptanceRate:
      accepted + declined ? (accepted / (accepted + declined)) * 100 : null,
  };
}
export async function getEstimateMetrics(): Promise<DashboardEstimateMetrics> {
  const db = getSupabaseClient();
  const month = localDate().slice(0, 8) + "01";
  const qs = [
    db
      .from("estimates")
      .select("id")
      .eq("status", "Open")
      .is("archived_at", null),
    db.from("walkthroughs").select("estimate_id").not("estimate_id", "is", null),
    db
      .from("estimates")
      .select("id", { count: "exact", head: true })
      .eq("division", "Residential")
      .is("archived_at", null),
    db
      .from("estimates")
      .select("id", { count: "exact", head: true })
      .eq("division", "Commercial")
      .is("archived_at", null),
    db
      .from("estimates")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${month}T00:00:00`)
      .is("archived_at", null),
  ];
  const r = await Promise.all(qs);
  const fail = r.find((x) => x.error);
  if (fail?.error) throw fail.error;
  return {
    open: activeEstimateCount(r[0].data as { id: string }[] | null, r[1].data as { estimate_id: string | null }[] | null),
    residential: r[2].count ?? 0,
    commercial: r[3].count ?? 0,
    createdThisMonth: r[4].count ?? 0,
  };
}
export async function getJobPipelineMetrics(): Promise<DashboardJobMetrics> {
  const [{ data, error }, invoicedIds] = await Promise.all([getSupabaseClient()
    .from("jobs").select("id,status").is("archived_at", null), getInvoicedJobIds()]);
  if (error) throw error;
  const invoiced = new Set(invoicedIds);
  const active = data.filter((x) => !invoiced.has(x.id) && !["Cancelled", "Archived"].includes(x.status));
  const n = (s: string) => active.filter((x) => x.status === s).length;
  return {
    ready: n("Ready to Schedule"),
    scheduled: n("Scheduled"),
    crewAssigned: n("Crew Assigned"),
    inProgress: n("In Progress"),
    completed: n("Completed"),
  };
}
export async function getCrewStatus() {
  const [crews, jobs] = await Promise.all([getActiveCrews(), getTodaysJobs()]);
  return crews.map((crew) => ({
    crew,
    todayJobs: jobs.filter((j) => j.assigned_crew_id === crew.id).length,
    inProgress: jobs.some(
      (j) => j.assigned_crew_id === crew.id && j.status === "In Progress",
    ),
  }));
}
export async function getAttentionItems(): Promise<DashboardAttentionItem[]> {
  const db = getSupabaseClient();
  const today = localDate();
  const [
    jobIds,
    { data: proposals, error: pe },
    { data: jobs, error: je },
    { data: walkthroughs, error: we },
    { data: agreements, error: ae },
  ] = await Promise.all([
    getJobProposalIds(),
    db
      .from("proposals")
      .select("id,proposal_number,status,client_name,frequency")
      .in("status", ["Ready for Approval", "Accepted", "Expired"])
      .is("archived_at", null),
    db
      .from("jobs")
      .select(jobSelect)
      .in("status", [
        "Ready to Schedule",
        "Scheduled",
        "Crew Assigned",
        "In Progress",
      ])
      .is("archived_at", null),
    db
      .from("walkthroughs")
      .select(walkthroughSelect)
      .eq("walkthrough_date", today)
      .neq("status", "Archived")
      .is("archived_at", null),
    db.from("service_agreements").select("proposal_id").not("proposal_id", "is", null),
  ]);
  if (pe) throw pe;
  if (je) throw je;
  if (we) throw we;
  if (ae) throw ae;
  const rows = jobs as JobWithRelations[];
  const jobProposalIds = new Set(jobIds);
  const agreementProposalIds = new Set((agreements ?? []).map((row) => row.proposal_id));
  const items: DashboardAttentionItem[] = [];
  for (const p of proposals) {
    if (p.status === "Ready for Approval")
      items.push(
        item(
          `approval-${p.id}`,
          "Proposal",
          p.proposal_number,
          "Proposal awaiting approval.",
          "Review Proposal",
          "/open-proposals",
        ),
      );
    if (p.status === "Accepted" && !jobProposalIds.has(p.id) && !agreementProposalIds.has(p.id))
      items.push(
        item(
          `job-${p.id}`,
          "Proposal",
          p.proposal_number,
          isRecurringFrequency(p.frequency) ? "Accepted proposal does not have a Service Agreement." : "Accepted proposal does not have a Job.",
          isRecurringFrequency(p.frequency) ? "Create Agreement" : "Create Job",
          "/open-proposals",
        ),
      );
    if (p.status === "Expired")
      items.push(
        item(
          `expired-${p.id}`,
          "Proposal",
          p.proposal_number,
          "Proposal has expired.",
          "Review Proposal",
          "/open-proposals",
        ),
      );
  }
  for (const j of rows) {
    if (j.status === "Ready to Schedule")
      items.push(
        item(
          `schedule-${j.id}`,
          "Job",
          j.job_number,
          "Job is ready to schedule.",
          "Schedule Job",
          `/schedule`,
        ),
      );
    if (j.scheduled_date && !j.assigned_crew_id)
      items.push(
        item(
          `crew-${j.id}`,
          "Job",
          j.job_number,
          "Scheduled Job does not have a crew.",
          "Assign Crew",
          `/jobs?jobId=${j.id}`,
        ),
      );
    if (j.status === "In Progress")
      items.push(
        item(
          `progress-${j.id}`,
          "Job",
          j.job_number,
          "Job is currently in progress.",
          "View Job",
          `/jobs?jobId=${j.id}`,
        ),
      );
  }
  const seen = new Set<string>();
  for (let a = 0; a < rows.length; a++)
    for (let b = a + 1; b < rows.length; b++) {
      const first = rows[a],
        second = rows[b];
      if (
        first.assigned_crew_id &&
        first.assigned_crew_id === second.assigned_crew_id &&
        first.scheduled_date &&
        first.scheduled_date === second.scheduled_date &&
        overlap(first, second)
      ) {
        const key = [first.id, second.id].sort().join("-");
        if (!seen.has(key)) {
          seen.add(key);
          items.push(
            item(
              `conflict-${key}`,
              "Schedule",
              `${first.job_number} / ${second.job_number}`,
              "Crew assignments overlap during the scheduled time.",
              "Review Schedule",
              "/schedule",
            ),
          );
        }
      }
    }
  for (const w of walkthroughs as WalkthroughWithRelations[])
    items.push(
      item(
        `walkthrough-${w.id}`,
        "Walkthrough",
        w.client ? clientName(w.client) : "Walkthrough",
        "Walkthrough is scheduled today.",
        "View Walkthrough",
        "/walkthroughs",
      ),
    );
  return items.slice(0, 12);
}
export async function getSchedulePreview() {
  const db = getSupabaseClient();
  const today = localDate(),
    tomorrow = addDays(today, 1);
  const { data, error } = await db
    .from("jobs")
    .select(jobSelect)
    .in("scheduled_date", [today, tomorrow])
    .not("status", "in", "(Completed,Cancelled,Archived)")
    .order("start_time");
  if (error) throw error;
  const rows = data as JobWithRelations[];
  return {
    today: rows.filter((j) => j.scheduled_date === today),
    tomorrow: rows.filter((j) => j.scheduled_date === tomorrow),
  };
}
function item(
  id: string,
  type: string,
  record: string,
  description: string,
  action: string,
  href: string,
) {
  return { id, type, record, description, action, href };
}
function overlap(a: JobWithRelations, b: JobWithRelations) {
  if (!a.start_time || !b.start_time) return false;
  const as = min(a.start_time),
    ae = as + (a.estimated_duration ?? 0) * 60,
    bs = min(b.start_time),
    be = bs + (b.estimated_duration ?? 0) * 60;
  return as < be && bs < ae;
}
function min(v: string) {
  const [h, m] = v.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}
function clientName(c: {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
}) {
  return (
    [c.first_name, c.last_name].filter(Boolean).join(" ") ||
    c.company_name ||
    "Client"
  );
}
function localDate(d = new Date()) {
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, "0"),
    day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
}
function activeEstimateCount(estimates: { id: string }[] | null, walkthroughs: { estimate_id: string | null }[] | null) {
  const linked = new Set((walkthroughs ?? []).map((row) => row.estimate_id).filter(Boolean));
  return (estimates ?? []).filter((row) => !linked.has(row.id)).length;
}
