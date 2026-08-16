import type { Client } from "@/types/client";
import type { EstimateDivision, Frequency } from "@/types/estimate";
import type { Property } from "@/types/property";
import type { Proposal, ProposalScopeItem } from "@/types/proposal";
import type { AgreementFrequency } from "@/types/agreement";
import type { OperationalPhoto } from "@/types/photo";

export const JOB_STATUSES = [
  "Ready to Schedule",
  "Scheduled",
  "Crew Assigned",
  "In Progress",
  "Completed",
  "Cancelled",
  "Archived",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobAssignedTeam = string[];
export type JobChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
};
export type JobPhoto = OperationalPhoto;

export type Job = {
  id: string;
  job_number: string;
  proposal_id: string | null;
  service_occurrence_id: string | null;
  estimate_id: string | null;
  walkthrough_id: string | null;
  client_id: string | null;
  property_id: string | null;
  division: EstimateDivision;
  client_name: string | null;
  property_name: string | null;
  service_name: string | null;
  frequency: Frequency | AgreementFrequency;
  status: JobStatus;
  scheduled_date: string | null;
  start_time: string | null;
  estimated_duration: number | null;
  assigned_crew_id: string | null;
  assigned_crew_name: string | null;
  crew_lead_name: string | null;
  assigned_team: JobAssignedTeam;
  price: number;
  deposit: number;
  balance: number;
  labor_hours: number;
  recommended_crew_size: number;
  scope: ProposalScopeItem[];
  checklist: JobChecklistItem[];
  photos: JobPhoto[];
  access_instructions: string | null;
  internal_notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
export type JobInsert = Omit<
  Job,
  | "id"
  | "job_number"
  | "created_at"
  | "updated_at"
  | "archived_at"
  | "service_occurrence_id"
> & {
  job_number?: string;
  archived_at?: string | null;
  service_occurrence_id?: string | null;
};
export type JobUpdate = Partial<
  Omit<Job, "id" | "job_number" | "proposal_id" | "created_at" | "updated_at">
>;
export type JobWithRelations = Job & {
  proposal: Proposal | null;
  client: Client | null;
  property: Property | null;
};
export type CrewConflict = Pick<
  JobWithRelations,
  | "id"
  | "job_number"
  | "client_name"
  | "property_name"
  | "scheduled_date"
  | "start_time"
  | "estimated_duration"
>;
