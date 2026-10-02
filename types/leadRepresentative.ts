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

export type LeadPayoutOpenEntry = {
  commissionId: string;
  customerName: string;
  commissionType: LeadRepresentativeCommission["commission_type"];
  jobNumber: string;
  serviceName: string;
  earnedAt: string;
  amount: number;
  status: "Pending Weekly Payout" | "Held";
};

export type LeadPayoutBatchStatus = "Awaiting Approval" | "Approved / Awaiting Payment" | "Approved / No Payment Due" | "Paid" | "Discarded";

export type LeadPayoutBatch = {
  batchId: string;
  batchNumber: string;
  leadRepresentativeId?: string;
  representativeName?: string;
  periodStart: string;
  periodEnd: string;
  status: LeadPayoutBatchStatus;
  grossPositiveAmount: number;
  negativeActivityAmount: number;
  carryForwardIn: number;
  accountingTotal: number;
  payoutAmount: number;
  carryForwardOut: number;
  generatedAt: string;
  approvedAt: string | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  paymentMethodDescription: string | null;
  confirmationReference: string | null;
  items?: Array<{ itemId: string; sourceType: string; amount: number; effectiveAt: string; description: string }>;
};

export type MyLeadPayouts = {
  businessTimezone: string;
  openPeriodStart: string;
  openEntries: LeadPayoutOpenEntry[];
  batches: LeadPayoutBatch[];
};

export type LeadPayoutManagement = {
  businessTimezone: string;
  ledgerEntries: Array<{ commissionId: string; leadRepresentativeId: string; representativeName: string; customerName: string; eventType: string; earnedAt: string; amount: number; held: boolean; consumed: boolean }>;
  representatives: Array<{ employeeId: string; displayName: string }>;
  batches: LeadPayoutBatch[];
};
