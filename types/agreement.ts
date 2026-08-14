import type { Client } from "@/types/client";
import type { Property } from "@/types/property";
import type { Proposal, ProposalScopeItem } from "@/types/proposal";
import type { Crew } from "@/types/crew";

export const AGREEMENT_STATUSES = ["Draft", "Sent", "Accepted", "Active", "Paused", "Completed", "Cancelled", "Expired", "Archived"] as const;
export const AGREEMENT_BILLING_TYPES = ["Per Visit", "Weekly", "Biweekly", "Monthly", "Flat Contract"] as const;
export const AGREEMENT_FREQUENCIES = ["One-Time", "Weekly", "Biweekly", "Monthly", "Every 4 Weeks", "Multiple Days Per Week", "Custom"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];
export type AgreementBillingType = (typeof AGREEMENT_BILLING_TYPES)[number];
export type AgreementFrequency = (typeof AGREEMENT_FREQUENCIES)[number];
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RecurrenceRule = { daysOfWeek: Weekday[]; intervalWeeks: number; dayOfMonth: number | null; customIntervalDays: number | null };
export type ServiceAgreement = {
  id: string; agreement_number: string; client_id: string | null; property_id: string | null; proposal_id: string | null;
  division: "Residential" | "Commercial"; agreement_name: string; service_name: string; frequency: AgreementFrequency;
  days_of_week: Weekday[]; interval_weeks: number; day_of_month: number | null; custom_interval_days: number | null;
  start_date: string; end_date: string | null; auto_renew: boolean; billing_type: AgreementBillingType; billing_amount: number;
  payment_terms: string | null; agreement_terms: string | null; cancellation_terms: string | null; scope: ProposalScopeItem[];
  special_instructions: string | null; assigned_crew_id: string | null; default_start_time: string | null; estimated_duration: number | null;
  status: AgreementStatus; sent_at: string | null; sent_to: string | null; sent_by: string | null; accepted_at: string | null;
  client_access_token: string | null; client_access_token_expires_at: string | null; client_signed_at: string | null; client_signed_name: string | null; client_signature: string | null;
  client_signed_snapshot: Record<string, unknown> | null; client_consent_text: string | null; client_consent_at: string | null;
  notes: string | null; created_at: string; updated_at: string; archived_at: string | null;
};
export type AgreementInput = Omit<ServiceAgreement, "id" | "agreement_number" | "sent_at" | "sent_to" | "sent_by" | "accepted_at" | "client_access_token" | "client_access_token_expires_at" | "client_signed_at" | "client_signed_name" | "client_signature" | "client_signed_snapshot" | "client_consent_text" | "client_consent_at" | "created_at" | "updated_at" | "archived_at">;
export type AgreementUpdate = Partial<AgreementInput> & { sent_at?: string | null; sent_to?: string | null; sent_by?: string | null; accepted_at?: string | null; client_access_token?: string | null; client_access_token_expires_at?: string | null; archived_at?: string | null };
export type AgreementWithRelations = ServiceAgreement & { client: Client | null; property: Property | null; proposal: Proposal | null; crew: Crew | null };
export type AgreementFinancialSummary = { jobsGenerated: number; completedJobs: number; invoiced: number; collected: number; outstanding: number };
