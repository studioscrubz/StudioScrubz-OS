import type { CrewWithRelations } from "@/types/crew";
import type { JobWithRelations } from "@/types/job";
import type { WalkthroughWithRelations } from "@/types/walkthrough";
import type { OperationalActiveTimeEntry } from "@/types/timeEntry";
export type DashboardMetrics = {
  openEstimates: number;
  upcomingWalkthroughs: number;
  pendingProposals: number;
  jobsToday: number;
  employeesClockedIn: number;
  pastDueInvoices: number;
};
export type DashboardAttentionItem = {
  id: string;
  type: string;
  record: string;
  description: string;
  action: string;
  href: string;
};
export type DashboardProposalMetrics = {
  draft: number;
  ready: number;
  approved: number;
  sentViewed: number;
  accepted: number;
  declined: number;
  acceptanceRate: number | null;
};
export type DashboardEstimateMetrics = {
  open: number;
  residential: number;
  commercial: number;
  createdThisMonth: number;
};
export type DashboardJobMetrics = {
  ready: number;
  scheduled: number;
  crewAssigned: number;
  inProgress: number;
  completed: number;
};
export type DashboardCrewStatus = {
  crew: CrewWithRelations;
  todayJobs: number;
  inProgress: boolean;
};
export type DashboardData = {
  metrics: DashboardMetrics;
  activeEmployees: OperationalActiveTimeEntry[];
  attention: DashboardAttentionItem[];
  todaysJobs: JobWithRelations[];
  upcomingWalkthroughs: WalkthroughWithRelations[];
  proposal: DashboardProposalMetrics;
  estimate: DashboardEstimateMetrics;
  jobs: DashboardJobMetrics;
  crews: DashboardCrewStatus[];
  preview: { today: JobWithRelations[]; tomorrow: JobWithRelations[] };
};
