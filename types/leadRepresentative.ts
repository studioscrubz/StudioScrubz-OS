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

export type LeadRepresentativeCommission = {
  commission_id: string;
  customer_name: string;
  commission_type: "NEW_CUSTOMER_LEAD" | "GENERATE_PERSONALLY_CLOSE" | "RECURRING_CONVERSION_BONUS" | "REVERSAL";
  cleaning_ordinal: 1 | 2;
  job_number: string;
  service_name: string;
  earned_at: string;
  amount: number;
  status: "EARNED_UNPAID";
  is_reversal: boolean;
};
