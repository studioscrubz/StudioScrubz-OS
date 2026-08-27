import type { ContractBillingType, InvoiceJobLine, InvoiceLineItem, InvoiceStatus } from "@/types/invoice";

export type PublicInvoicePayment = {
  amount: number;
  payment_date: string;
  payment_method: string;
};

export type PublicInvoicePhoto = { id: string; caption: string | null; originalFilename: string; uploadedAt: string; url: string };

export type PublicInvoice = {
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string | null;
  client_name: string | null;
  property_name: string | null;
  service_name: string | null;
  job_number: string | null;
  agreement_number: string | null;
  contract_billing_type: ContractBillingType | null;
  billing_period_start: string | null;
  is_consolidated: boolean;
  job_lines: Omit<InvoiceJobLine, "invoice_id">[];
  line_items: InvoiceLineItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  terms: string | null;
  customer_notes: string | null;
  payments: PublicInvoicePayment[];
  business_name: string;
  tagline: string | null;
  business_email: string | null;
  business_phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};
