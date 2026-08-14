import { getSupabaseClient } from "@/lib/supabase/client";
import type { Client } from "@/types/client";
import type { Property, PropertyInput, PropertyWithClient } from "@/types/property";

const propertySelect = "*, client:clients!properties_client_id_fkey(*)";

export async function getProperties(): Promise<PropertyWithClient[]> {
  const { data, error } = await getSupabaseClient()
    .from("properties")
    .select(propertySelect)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as PropertyWithClient[];
}

export async function getPropertyClients(): Promise<Client[]> {
  const { data, error } = await getSupabaseClient()
    .from("clients")
    .select("*")
    .order("company_name", { ascending: true, nullsFirst: false })
    .order("last_name", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data;
}

export async function createProperty(input: PropertyInput): Promise<Property> {
  if (!input.client_id) throw new Error("Select a Client before creating a Property.");
  const { data, error } = await getSupabaseClient().from("properties").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateProperty(id: string, input: PropertyInput): Promise<Property> {
  const { data, error } = await getSupabaseClient().from("properties").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function archiveProperty(id: string): Promise<Property> {
  const { data, error } = await getSupabaseClient().from("properties").update({ archived_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function findPotentialDuplicateProperties(input: PropertyInput): Promise<Property[]> {
  if (!input.client_id) return [];
  const { data, error } = await getSupabaseClient().from("properties").select("*").eq("client_id", input.client_id);
  if (error) throw error;

  const candidate = normalizedLocation(input);
  return data.filter((property) => normalizedLocation(property) === candidate);
}

function normalizedLocation(value: Pick<PropertyInput, "address" | "address_line_2" | "city" | "state" | "zip">): string {
  return [value.address, value.address_line_2, value.city, value.state, value.zip]
    .map((part) => part?.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "") ?? "")
    .join("|");
}
