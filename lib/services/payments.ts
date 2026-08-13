import { getSupabaseClient } from "@/lib/supabase/client";
import { getInvoiceById, recalculateInvoicePaymentTotals } from "@/lib/services/invoices";
import type { Payment, PaymentInsert } from "@/types/payment";

export async function getPaymentsForInvoice(invoiceId:string):Promise<Payment[]>{const{data,error}=await getSupabaseClient().from("payments").select("*").eq("invoice_id",invoiceId).order("payment_date",{ascending:false}).order("created_at",{ascending:false});if(error)throw error;return data as Payment[]}
export async function recordPayment(input:Omit<PaymentInsert,"client_id"|"job_id">):Promise<Payment>{if(input.amount<=0)throw new Error("Payment amount must be greater than zero.");const invoice=await getInvoiceById(input.invoice_id);const{data,error}=await getSupabaseClient().from("payments").insert({...input,client_id:invoice.client_id,job_id:invoice.job_id}).select().single();if(error)throw error;try{await recalculateInvoicePaymentTotals(invoice.id)}catch(cause){console.error("Payment saved but invoice recalculation failed",cause);throw new Error("Payment was saved, but invoice totals could not be recalculated. Please retry the recalculation.")}return data as Payment}
