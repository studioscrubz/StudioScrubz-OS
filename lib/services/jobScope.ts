import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/services/auth";
import type { Database } from "@/types/database";

type ScopeSnapshotRow = Database["public"]["Tables"]["scope_snapshots"]["Row"];
type FullScopeItem = Database["public"]["Tables"]["scope_snapshot_items"]["Row"];
type OperationalScopeItem = Database["public"]["Views"]["job_scope_operational_items"]["Row"];
export type JobScopeItem = OperationalScopeItem & Partial<Pick<FullScopeItem, "unit_price" | "line_total" | "metadata">>;

export type JobScopeV1 = {
  snapshot: Pick<ScopeSnapshotRow, "id" | "version" | "snapshot_type" | "accepted_at" | "proposal_notes" | "pricing" | "proposal_result"> | null;
  items: JobScopeItem[];
  financialsAvailable: boolean;
};

export async function getJobScopeV1(jobId: string): Promise<JobScopeV1> {
  const client = getSupabaseClient();
  const profile = await getCurrentProfile();
  const canReadFinancials = profile?.role === "Master Admin";

  if (!canReadFinancials) {
    const { data, error } = await client
      .from("job_scope_operational_items")
      .select("*")
      .eq("job_id", jobId)
      .order("sort_order");
    if (error) throw error;
    return { snapshot: null, items: data ?? [], financialsAvailable: false };
  }

  const [snapshotResult, itemsResult] = await Promise.all([
    client
      .from("scope_snapshots")
      .select("id, version, snapshot_type, accepted_at, proposal_notes, pricing, proposal_result")
      .eq("job_id", jobId)
      .eq("version", 1)
      .maybeSingle(),
    client
      .from("scope_snapshot_items")
      .select("*")
      .eq("job_id", jobId)
      .order("sort_order"),
  ]);

  if (itemsResult.error) throw itemsResult.error;

  if (snapshotResult.error) throw snapshotResult.error;
  return {
    snapshot: snapshotResult.data,
    items: itemsResult.data ?? [],
    financialsAvailable: snapshotResult.data !== null,
  };
}
