export const PAYMENT_METHODS = ["Cash", "Check", "Credit Card", "Debit Card", "ACH", "Zelle", "Venmo", "Cash App", "Apple Pay", "Other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type Payment = { id:string; invoice_id:string; client_id:string; job_id:string|null; amount:number; payment_date:string; payment_method:PaymentMethod; reference_number:string|null; notes:string|null; created_at:string };
export type PaymentInsert = Omit<Payment,"id"|"created_at">;
