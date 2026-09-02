import { getSupabaseClient } from "@/lib/supabase/client";
import type { Payment, PaymentInsert } from "@/types/payment";
import { getInvoiceById } from "@/lib/services/invoices";
import { requestImmediateAttentionPush } from "@/lib/push/client";

export async function getPaymentsForInvoice(invoiceId:string):Promise<Payment[]>{const{data,error}=await getSupabaseClient().from("payments").select("*").eq("invoice_id",invoiceId).order("payment_date",{ascending:false}).order("created_at",{ascending:false});if(error)throw error;return data as Payment[]}
export async function recordPayment(input:Omit<PaymentInsert,"client_id"|"job_id">):Promise<Payment>{if(input.amount<=0)throw new Error("Payment amount must be greater than zero.");const{data,error}=await getSupabaseClient().rpc("record_invoice_payment",{p_invoice_id:input.invoice_id,p_amount:input.amount,p_payment_date:input.payment_date,p_payment_method:input.payment_method,p_reference_number:input.reference_number,p_notes:input.notes});if(error)throw error;const payment=data as Payment;try{const invoice=await getInvoiceById(input.invoice_id);if(invoice.status==="Paid")await requestImmediateAttentionPush()}catch{}return payment}
