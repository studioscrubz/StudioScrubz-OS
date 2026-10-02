import { getSupabaseClient } from "@/lib/supabase/client";
import type { LeadPayoutManagement, MyLeadPayouts, LeadRepresentativeCommission, LeadRepresentativeLead } from "@/types/leadRepresentative";

type LeadRepresentativeRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function getMyLeadRepresentativeLeads(): Promise<LeadRepresentativeLead[]> {
  const client = getSupabaseClient() as unknown as LeadRepresentativeRpcClient;
  const { data, error } = await client.rpc("get_my_lead_representative_leads", {});
  if (error) throw new Error(error.message || "Your leads could not be loaded.");
  return (data ?? []) as LeadRepresentativeLead[];
}

async function unwrapPayoutRpc<T>(request: Promise<{ data: unknown; error: { message?: string } | null }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw new Error(error.message || "Commission payout request failed.");
  return data as T;
}

const payoutClient = () => getSupabaseClient() as unknown as LeadRepresentativeRpcClient;
export const getMyLeadRepresentativePayouts = () => unwrapPayoutRpc<MyLeadPayouts>(payoutClient().rpc("get_my_lead_representative_payouts", {}));
export const getLeadCommissionPayoutManagement = () => unwrapPayoutRpc<LeadPayoutManagement>(payoutClient().rpc("get_lead_commission_payout_management", {}));
export const generateWeeklyLeadCommissionPayouts = (periodEnd: string) => unwrapPayoutRpc<string[]>(payoutClient().rpc("generate_weekly_lead_commission_payouts", { p_period_end: periodEnd }));
export const approveLeadCommissionPayoutBatch = (batchId: string) => unwrapPayoutRpc<string>(payoutClient().rpc("approve_lead_commission_payout_batch", { p_batch_id: batchId }));
export const discardLeadCommissionPayoutBatch = (batchId: string, reason: string) => unwrapPayoutRpc<void>(payoutClient().rpc("discard_lead_commission_payout_batch", { p_batch_id: batchId, p_reason: reason }));
export const holdLeadCommissionEntry = (commissionId: string, reason: string) => unwrapPayoutRpc<string>(payoutClient().rpc("hold_lead_commission_entry", { p_ledger_entry_id: commissionId, p_reason: reason }));
export const releaseLeadCommissionEntryHold = (commissionId: string, reason: string) => unwrapPayoutRpc<string>(payoutClient().rpc("release_lead_commission_entry_hold", { p_ledger_entry_id: commissionId, p_reason: reason }));
export const createLeadCommissionPayoutAdjustment = (representativeId: string, amount: number, reason: string) => unwrapPayoutRpc<string>(payoutClient().rpc("create_lead_commission_payout_adjustment", { p_lead_representative_id: representativeId, p_amount: amount, p_reason: reason }));
export const markLeadCommissionPayoutPaid = (batchId: string, paymentDate: string, paymentMethod: string, otherMethodDescription?: string, confirmationReference?: string, note?: string) => unwrapPayoutRpc<string>(payoutClient().rpc("mark_lead_commission_payout_paid", { p_batch_id: batchId, p_actual_payment_date: paymentDate, p_payment_method: paymentMethod, p_other_method_description: otherMethodDescription || null, p_confirmation_reference: confirmationReference || null, p_note: note || null }));

export async function getMyLeadRepresentativeCommissions(): Promise<LeadRepresentativeCommission[]> {
  const client = getSupabaseClient() as unknown as LeadRepresentativeRpcClient;
  const { data, error } = await client.rpc("get_my_lead_representative_commissions", {});
  if (error) throw new Error(error.message || "Your commissions could not be loaded.");
  return (data ?? []) as LeadRepresentativeCommission[];
}
