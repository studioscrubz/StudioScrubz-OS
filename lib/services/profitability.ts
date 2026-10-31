import { getSupabaseClient } from "@/lib/supabase/client";
import { validateProfitabilitySettings } from "@/lib/pricing/profitabilitySettings";
import type { ProfitabilityProjection, ProfitabilitySettings, TravelProjection } from "@/types/profitability";

export async function getProfitabilitySettings(): Promise<ProfitabilitySettings> {
  const client = getSupabaseClient() as unknown as { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  const { data, error } = await client.rpc("get_profitability_settings");
  if (error) throw new Error(`Profitability settings could not be loaded: ${error.message}`);
  return validateProfitabilitySettings(data);
}

export async function saveProfitabilitySettings(settings: ProfitabilitySettings): Promise<ProfitabilitySettings> {
  const normalized = validateProfitabilitySettings(settings);
  const client = getSupabaseClient() as unknown as { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  const { data, error } = await client.rpc("save_profitability_settings", { p_settings: normalized });
  if (error) throw new Error(`Profitability settings could not be saved: ${error.message}`);
  return validateProfitabilitySettings(data);
}

export async function calculateTravelProjection(destination: string): Promise<TravelProjection> {
  const response = await fetch("/api/profitability/travel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ destination }),
  });
  const body = await response.json() as { travel?: TravelProjection; error?: string };
  if (!response.ok || !body.travel) throw new Error(body.error || "Travel could not be calculated.");
  return body.travel;
}

type ProfitabilityProjectionRpc = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
const projectionClient = () => getSupabaseClient() as unknown as ProfitabilityProjectionRpc;

export async function getProfitabilityProjection(input: { estimateId?: string | null; proposalId?: string | null }): Promise<ProfitabilityProjection | null> {
  const { data, error } = await projectionClient().rpc("get_profitability_projection", { p_estimate_id: input.estimateId ?? null, p_proposal_id: input.proposalId ?? null });
  if (error) throw new Error(`Profitability projection could not be loaded: ${error.message}`);
  return data as ProfitabilityProjection | null;
}

export async function saveProfitabilityProjection(input: { estimateId?: string | null; proposalId?: string | null; projection: ProfitabilityProjection }): Promise<ProfitabilityProjection> {
  const { data, error } = await projectionClient().rpc("save_profitability_projection", { p_estimate_id: input.estimateId ?? null, p_proposal_id: input.proposalId ?? null, p_projection: input.projection });
  if (error) throw new Error(`Profitability projection could not be saved: ${error.message}`);
  return data as ProfitabilityProjection;
}
