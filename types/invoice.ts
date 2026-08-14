import type { Client } from "@/types/client";
import type { JobWithRelations } from "@/types/job";
import type { Property } from "@/types/property";
import type { Proposal } from "@/types/proposal";

export const INVOICE_STATUSES = ["Draft", "Open", "Sent", "Partially Paid", "Paid", "Past Due", "Cancelled", "Archived"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceLineItem = { id: string; description: string; quantity: number; rate: number; amount: number };
export type Invoice = {
  id:string; invoice_number:string; job_id:string|null; proposal_id:string|null; client_id:string|null; property_id:string|null;
  client_name:string|null; property_name:string|null; customer_phone:string|null; customer_email:string|null; service_name:string|null;
  status:InvoiceStatus; issue_date:string; due_date:string|null; line_items:InvoiceLineItem[]; subtotal:number; discount:number; tax:number;
  total:number; amount_paid:number; balance_due:number; notes:string|null; terms:string|null; sent_at:string|null; paid_at:string|null;
  created_at:string; updated_at:string; archived_at:string|null;
};
export type InvoiceUpdate = Partial<Pick<Invoice,"issue_date"|"due_date"|"line_items"|"discount"|"tax"|"subtotal"|"total"|"amount_paid"|"balance_due"|"notes"|"terms"|"status"|"sent_at"|"paid_at"|"archived_at">>;
export type InvoiceWithRelations = Invoice & { job:JobWithRelations|null; proposal:Proposal|null; client:Client|null; property:Property|null };
