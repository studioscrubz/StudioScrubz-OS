import { getSupabaseClient } from "@/lib/supabase/client";
import type { LeadRepresentativeLead } from "@/types/leadRepresentative";

type LeadRepresentativeRpcClient = {
  rpc: (
    name: "get_my_lead_representative_leads",
    args?: Record<string, never>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function getMyLeadRepresentativeLeads(): Promise<LeadRepresentativeLead[]> {
  const client = getSupabaseClient() as unknown as LeadRepresentativeRpcClient;
  const { data, error } = await client.rpc("get_my_lead_representative_leads", {});
  if (error) throw new Error(error.message || "Your leads could not be loaded.");
  return (data ?? []) as LeadRepresentativeLead[];
}
