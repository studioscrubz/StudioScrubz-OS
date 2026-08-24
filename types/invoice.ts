import type { Client } from "@/types/client";
import type { JobWithRelations } from "@/types/job";
import type { Property } from "@/types/property";
import type { Proposal } from "@/types/proposal";
import type { AgreementBillingType, ServiceAgreement } from "@/types/agreement";

export type ContractBillingType = Extract<AgreementBillingType, "Weekly" | "Biweekly" | "Monthly" | "Flat Contract">;

export const INVOICE_STATUSES = ["Draft", "Open", "Sent", "Partially Paid", "Paid", "Past Due", "Cancelled", "Archived"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceLineItem = { id: string; description: string; quantity: number; rate: number; amount: number };
export type Invoice = {
  id:string; invoice_number:string; job_id:string|null; service_agreement_id:string|null; contract_billing_type:ContractBillingType|null; billing_period_start:string|null; proposal_id:string|null; client_id:string|null; property_id:string|null;
  client_name:string|null; property_name:string|null; customer_phone:string|null; customer_email:string|null; service_name:string|null;
  status:InvoiceStatus; issue_date:string; due_date:string|null; line_items:InvoiceLineItem[]; subtotal:number; discount:number; tax:number;
  total:number; amount_paid:number; balance_due:number; notes:string|null; customer_notes:string|null; terms:string|null; sent_at:string|null; paid_at:string|null;
  client_access_token:string|null; client_access_token_expires_at:string|null;
  created_at:string; updated_at:string; archived_at:string|null;
};
export type InvoiceUpdate = Partial<Pick<Invoice,"issue_date"|"due_date"|"line_items"|"discount"|"tax"|"subtotal"|"total"|"amount_paid"|"balance_due"|"notes"|"customer_notes"|"terms"|"status"|"sent_at"|"paid_at"|"archived_at"|"client_access_token"|"client_access_token_expires_at">>;
export type StandaloneInvoiceInput = {
  client_id:string; property_id:string; client_name:string; property_name:string;
  customer_phone:string|null; customer_email:string|null; service_name:string;
  issue_date:string; due_date:string|null; line_items:InvoiceLineItem[];
  discount:number; tax:number; notes:string|null; customer_notes:string|null; terms:string|null;
};
export type InvoiceWithRelations = Invoice & { job:JobWithRelations|null; agreement:ServiceAgreement|ServiceAgreement[]|null; proposal:Proposal|null; client:Client|null; property:Property|null };
