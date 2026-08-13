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
  DashboardRecentActivity,
} from "@/types/dashboard";
import type { JobWithRelations } from "@/types/job";
import type { WalkthroughWithRelations } from "@/types/walkthrough";
export async function getFinancialOperationalMetrics() {
  const { data, error } = await getSupabaseClient()
    .from("invoices")
    .select("status,balance_due")
    .is("archived_at", null);
  if (error) throw error;
  return {
    outstandingBalance: (data ?? [])
      .filter((x) => !["Paid", "Cancelled", "Archived"].includes(x.status))
      .reduce((sum, x) => sum + Number(x.balance_due), 0),
    pastDueInvoices: (data ?? []).filter((x) => x.status === "Past Due").length,
  };
}
export async function getInvoiceAttentionItems(): Promise<
  DashboardAttentionItem[]
> {
  const db = getSupabaseClient();
  const [
    invoiced,
    { data: jobs, error: jobsError },
    { data: invoices, error: invoiceError },
  ] = await Promise.all([
    getInvoicedJobIds(),
    db
      .from("jobs")
      .select("id,job_number")
      .eq("status", "Completed")
      .is("archived_at", null),
    db
      .from("invoices")
      .select("id,invoice_number")
      .eq("status", "Past Due")
      .is("archived_at", null),
  ]);
  if (jobsError) throw jobsError;
  if (invoiceError) throw invoiceError;
  const linked = new Set(invoiced);
  return [
    ...(jobs ?? [])
      .filter((job) => !linked.has(job.id))
      .map((job) =>
        item(
          `invoice-job-${job.id}`,
          "Invoice",
          job.job_number,
          "Completed Job does not have an Invoice.",
          "Create Invoice",
          `/jobs?jobId=${job.id}`,
        ),
      ),
    ...(invoices ?? []).map((invoice) =>
      item(
        `past-due-${invoice.id}`,
        "Invoice",
        invoice.invoice_number,
        "Invoice is past due.",
        "View Invoice",
        `/invoices?invoiceId=${invoice.id}`,
      ),
    ),
  ];
}
const jobSelect =
  "*, proposal:proposals!jobs_proposal_id_fkey(*), client:clients!jobs_client_id_fkey(*), property:properties!jobs_property_id_fkey(*)";
const walkthroughSelect =
  "*, client:clients!walkthroughs_client_id_fkey(*), property:properties!walkthroughs_property_id_fkey(*), estimate:estimates!walkthroughs_estimate_id_fkey(*)";
export async function getDashboardData(): Promise<DashboardData> {
  const [
    metrics,
    financial,
    todaysJobs,
    upcomingWalkthroughs,
    proposal,
    estimate,
    jobs,
    crews,
    recent,
    attention,
    invoiceAttention,
    preview,
  ] = await Promise.all([
    getDashboardMetrics(),
    getFinancialOperationalMetrics(),
    getTodaysJobs(),
    getUpcomingWalkthroughs(),
    getProposalPipelineMetrics(),
    getEstimateMetrics(),
    getJobPipelineMetrics(),
    getCrewStatus(),
    getRecentActivity(),
    getAttentionItems(),
    getInvoiceAttentionItems(),
    getSchedulePreview(),
  ]);
  return {
    metrics: { ...metrics, ...financial },
    todaysJobs,
    upcomingWalkthroughs,
    proposal,
    estimate,
    jobs,
    crews,
    recent,
    attention: [...attention, ...invoiceAttention].slice(0, 12),
    preview,
  };
}
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const db = getSupabaseClient();
  const today = localDate();
  const queries = [
    db
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("status", "Active")
      .is("archived_at", null),
    db
      .from("estimates")
      .select("id", { count: "exact", head: true })
      .eq("status", "Open")
      .is("archived_at", null),
    db
      .from("walkthroughs")
      .select("id", { count: "exact", head: true })
      .gte("walkthrough_date", today)
      .neq("status", "Archived")
      .is("archived_at", null),
    db
      .from("proposals")
      .select("id", { count: "exact", head: true })
      .in("status", [
        "Draft",
        "Ready for Approval",
        "Approved",
        "Sent",
        "Viewed",
      ])
      .is("archived_at", null),
    db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("status", [
        "Ready to Schedule",
        "Scheduled",
        "Crew Assigned",
        "In Progress",
      ])
      .is("archived_at", null),
    db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("scheduled_date", today)
      .not("status", "in", "(Cancelled,Archived)")
      .is("archived_at", null),
    db
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("status", "Open")
      .is("clock_out", null)
      .is("archived_at", null),
    db
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("status", "Completed")
      .is("archived_at", null),
  ];
  const results = await Promise.all(queries);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  return {
    activeClients: results[0].count ?? 0,
    openEstimates: results[1].count ?? 0,
    upcomingWalkthroughs: results[2].count ?? 0,
    pendingProposals: results[3].count ?? 0,
    activeJobs: results[4].count ?? 0,
    jobsToday: results[5].count ?? 0,
    employeesClockedIn: results[6].count ?? 0,
    timeAwaitingApproval: results[7].count ?? 0,
  };
}
export async function getTodaysJobs() {
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .select(jobSelect)
    .eq("scheduled_date", localDate())
    .not("status", "in", "(Cancelled,Archived)")
    .order("start_time");
  if (error) throw error;
  return data as JobWithRelations[];
}
export async function getUpcomingWalkthroughs() {
  const { data, error } = await getSupabaseClient()
    .from("walkthroughs")
    .select(walkthroughSelect)
    .gte("walkthrough_date", localDate())
    .neq("status", "Archived")
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
      .select("id", { count: "exact", head: true })
      .eq("status", "Open")
      .is("archived_at", null),
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
    open: r[0].count ?? 0,
    residential: r[1].count ?? 0,
    commercial: r[2].count ?? 0,
    createdThisMonth: r[3].count ?? 0,
  };
}
export async function getJobPipelineMetrics(): Promise<DashboardJobMetrics> {
  const { data, error } = await getSupabaseClient()
    .from("jobs")
    .select("status")
    .is("archived_at", null);
  if (error) throw error;
  const n = (s: string) => data.filter((x) => x.status === s).length;
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
  ] = await Promise.all([
    getJobProposalIds(),
    db
      .from("proposals")
      .select("id,proposal_number,status,client_name")
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
  ]);
  if (pe) throw pe;
  if (je) throw je;
  if (we) throw we;
  const rows = jobs as JobWithRelations[];
  const jobProposalIds = new Set(jobIds);
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
    if (p.status === "Accepted" && !jobProposalIds.has(p.id))
      items.push(
        item(
          `job-${p.id}`,
          "Proposal",
          p.proposal_number,
          "Accepted proposal does not have a Job.",
          "Create Job",
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
export async function getRecentActivity(): Promise<DashboardRecentActivity[]> {
  const db = getSupabaseClient();
  const [p, c, e, w, j] = await Promise.all([
    db
      .from("proposal_history")
      .select("id,event_type,description,created_at,proposal_id")
      .order("created_at", { ascending: false })
      .limit(10),
    db
      .from("clients")
      .select("id,first_name,last_name,company_name,created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("estimates")
      .select("id,estimate_number,created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("walkthroughs")
      .select("id,contact_name,walkthrough_date,created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("jobs")
      .select("id,job_number,status,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);
  for (const r of [p, c, e, w, j]) if (r.error) throw r.error;
  const out: DashboardRecentActivity[] = [];
  for (const x of p.data ?? [])
    out.push({
      id: `p-${x.id}`,
      label: x.event_type,
      description: x.description ?? "Proposal activity recorded.",
      timestamp: x.created_at,
      href: "/open-proposals",
    });
  for (const x of c.data ?? [])
    out.push({
      id: `c-${x.id}`,
      label: "Client Added",
      description:
        [x.first_name, x.last_name].filter(Boolean).join(" ") ||
        x.company_name ||
        "Client",
      timestamp: x.created_at,
      href: "/clients",
    });
  for (const x of e.data ?? [])
    out.push({
      id: `e-${x.id}`,
      label: "Estimate Created",
      description: x.estimate_number,
      timestamp: x.created_at,
      href: "/open-estimates",
    });
  for (const x of w.data ?? [])
    out.push({
      id: `w-${x.id}`,
      label: "Walkthrough Scheduled",
      description: x.contact_name ?? x.walkthrough_date ?? "Walkthrough",
      timestamp: x.created_at,
      href: "/walkthroughs",
    });
  for (const x of j.data ?? [])
    out.push({
      id: `j-${x.id}`,
      label: x.status === "Completed" ? "Job Completed" : "Job Updated",
      description: x.job_number,
      timestamp: x.updated_at,
      href: `/jobs?jobId=${x.id}`,
    });
  return out
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 10);
}
export async function getSchedulePreview() {
  const db = getSupabaseClient();
  const today = localDate(),
    tomorrow = addDays(today, 1);
  const { data, error } = await db
    .from("jobs")
    .select(jobSelect)
    .in("scheduled_date", [today, tomorrow])
    .not("status", "in", "(Cancelled,Archived)")
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
