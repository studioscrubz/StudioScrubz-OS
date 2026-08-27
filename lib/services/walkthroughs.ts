import { getSupabaseClient } from "@/lib/supabase/client";
import type { Client } from "@/types/client";
import type { AvailableEstimate, Walkthrough, WalkthroughInput, WalkthroughStatus, WalkthroughUpdate, WalkthroughWithRelations } from "@/types/walkthrough";
import type { Property } from "@/types/property";
import { assertWalkthroughSchedule } from "@/lib/walkthroughWorkflow";

const walkthroughSelect = "*, client:clients!walkthroughs_client_id_fkey(*), property:properties!walkthroughs_property_id_fkey(*), estimate:estimates!walkthroughs_estimate_id_fkey(*)";
const estimateSelect = "*, client:clients!estimates_client_id_fkey(*), property:properties!estimates_property_id_fkey(*)";

export async function getWalkthroughs(): Promise<WalkthroughWithRelations[]> { const { data, error } = await getSupabaseClient().from("walkthroughs").select(walkthroughSelect).order("created_at", { ascending: false }); if (error) throw error; return data as WalkthroughWithRelations[]; }
export async function getScheduledWalkthroughs(): Promise<WalkthroughWithRelations[]> { const { data, error } = await getSupabaseClient().from("walkthroughs").select(walkthroughSelect).is("archived_at", null).not("walkthrough_date", "is", null).in("status", ["New", "Scheduled"]).order("walkthrough_date").order("walkthrough_time"); if (error) throw error; return data as WalkthroughWithRelations[]; }
export async function getWalkthroughById(id: string): Promise<WalkthroughWithRelations> { const { data, error } = await getSupabaseClient().from("walkthroughs").select(walkthroughSelect).eq("id", id).single(); if (error) throw error; return data as WalkthroughWithRelations; }
export async function createWalkthrough(input: WalkthroughInput): Promise<Walkthrough> { if (input.estimate_id) { const existing = await getWalkthroughForEstimate(input.estimate_id); if (existing) throw new WalkthroughDuplicateError(existing); } const payload = withScheduledStatus(input, input.status); assertWalkthroughSchedule(payload); const { data, error } = await getSupabaseClient().from("walkthroughs").insert(payload).select().single(); if (error) { if (error.code === "23505") { const existing = input.estimate_id ? await getWalkthroughForEstimate(input.estimate_id) : null; if (existing) throw new WalkthroughDuplicateError(existing); } throw error; } return data; }
export async function updateWalkthrough(id: string, input: WalkthroughUpdate): Promise<Walkthrough> { const current = await getWalkthroughById(id); const merged = withScheduledStatus({ ...current, ...input }, input.status ?? current.status); assertWalkthroughSchedule(merged); const payload: WalkthroughUpdate = { ...input, status: merged.status }; const { data, error } = await getSupabaseClient().from("walkthroughs").update(payload).eq("id", id).select().single(); if (error) throw error; return data; }
export async function archiveWalkthrough(id: string): Promise<Walkthrough> { return updateWalkthrough(id, { status: "Archived", archived_at: new Date().toISOString() }); }
export async function updateWalkthroughStatus(id: string, status: WalkthroughStatus): Promise<Walkthrough> { return updateWalkthrough(id, { status, archived_at: status === "Archived" ? new Date().toISOString() : null }); }
export async function getAvailableEstimates(): Promise<AvailableEstimate[]> { const [{ data, error }, links] = await Promise.all([getSupabaseClient().from("estimates").select(estimateSelect).is("archived_at", null).eq("status", "Open").order("created_at", { ascending: false }), getWalkthroughsForEstimates()]); if (error) throw error; const linkedIds=new Set(links.map((row)=>row.estimate_id).filter((id):id is string=>Boolean(id))); return (data as AvailableEstimate[]).filter((estimate)=>!linkedIds.has(estimate.id)); }
export async function getWalkthroughForEstimate(estimateId: string): Promise<WalkthroughWithRelations | null> { const { data, error } = await getSupabaseClient().from("walkthroughs").select(walkthroughSelect).eq("estimate_id", estimateId).is("archived_at",null).maybeSingle(); if (error) throw error; return data as WalkthroughWithRelations | null; }
export async function getWalkthroughsForEstimates(): Promise<WalkthroughWithRelations[]> { const { data, error } = await getSupabaseClient().from("walkthroughs").select(walkthroughSelect).not("estimate_id", "is", null).is("archived_at",null); if (error) throw error; return data as WalkthroughWithRelations[]; }
export async function getWalkthroughClients(): Promise<Client[]> { const { data, error } = await getSupabaseClient().from("clients").select("*").order("last_name"); if (error) throw error; return data; }
export async function getWalkthroughProperties(): Promise<Property[]> { const { data, error } = await getSupabaseClient().from("properties").select("*").order("address"); if (error) throw error; return data; }

export class WalkthroughDuplicateError extends Error { constructor(public walkthrough: WalkthroughWithRelations) { super("A walkthrough is already linked to this estimate."); this.name = "WalkthroughDuplicateError"; } }

function withScheduledStatus<T extends { walkthrough_date?: string | null; walkthrough_time?: string | null; status?: WalkthroughStatus }>(input: T, currentStatus: WalkthroughStatus): T {
  if (input.walkthrough_date && input.walkthrough_time && !["Completed", "Proposal Ready", "Archived"].includes(currentStatus)) return { ...input, status: "Scheduled" };
  return input;
}
