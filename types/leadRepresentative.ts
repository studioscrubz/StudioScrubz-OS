export type LeadRepresentativeLifecycleStage =
  | "Submitted"
  | "Walkthrough / Assessment"
  | "Proposal Sent"
  | "Booked"
  | "Completed / Paid"
  | "Declined"
  | "Cancelled";

export type LeadRepresentativeLead = {
  estimate_id: string;
  estimate_number: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  service_name: string;
  submitted_at: string;
  lifecycle_stage: LeadRepresentativeLifecycleStage;
  walkthrough_status: string | null;
  proposal_status: string | null;
  booked: boolean;
  job_status: string | null;
  paid: boolean;
  terminal_reason: string | null;
};
