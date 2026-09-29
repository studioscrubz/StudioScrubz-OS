import { getSupabaseClient } from "@/lib/supabase/client";
import type { Prospect, ProspectAssignee, ProspectEvent, ProspectInput } from "@/types/prospect";

export async function getProspects(): Promise<Prospect[]> {
  const { data, error } = await prospectClient().from("prospects").select("*").order("score", { ascending: false });
  if (error) throw new Error(error.message);
  return data as Prospect[];
}

export async function createProspect(input: ProspectInput): Promise<Prospect> {
  const { data, error } = await prospectClient().from("prospects").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as Prospect;
}

export async function updateProspect(id: string, input: Partial<ProspectInput>): Promise<Prospect> {
  const { data, error } = await prospectClient().from("prospects").update(input).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as Prospect;
}

export async function getProspectEvents(prospectId: string): Promise<ProspectEvent[]> {
  const { data, error } = await prospectClient().from("prospect_events").select("*").eq("prospect_id", prospectId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as ProspectEvent[];
}

export async function getProspectAssignees(): Promise<ProspectAssignee[]> {
  const { data, error } = await prospectClient().rpc("get_prospect_assignees");
  if (error) throw new Error(error.message);
  return data as ProspectAssignee[];
}

// These tables are introduced by the pending forward-only migration, so the
// hand-maintained generated schema cannot expose them until that migration runs.
function prospectClient() { return getSupabaseClient() as ReturnType<typeof getSupabaseClient> & { from: (table: string) => any; rpc: (name: string, args?: never) => Promise<any> }; }
