import { getSupabaseClient } from "@/lib/supabase/client";
import type { Client, ClientInput } from "@/types/client";

export async function getClients(): Promise<Client[]> {
  const { data, error } = await getSupabaseClient()
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function createClient(input: ClientInput): Promise<Client> {
  const { data, error } = await getSupabaseClient().from("clients").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateClient(id: string, input: ClientInput): Promise<Client> {
  const { data, error } = await getSupabaseClient().from("clients").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function archiveClient(id: string): Promise<Client> {
  const { data, error } = await getSupabaseClient()
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function findPotentialDuplicateClients(input: ClientInput): Promise<Client[]> {
  const { data, error } = await getSupabaseClient().from("clients").select("*");
  if (error) throw error;

  const email = normalizeText(input.email);
  const phone = normalizePhone(input.phone);
  const fullName = normalizeText(`${input.first_name ?? ""} ${input.last_name ?? ""}`);
  const company = normalizeText(input.company_name);

  return data.filter((client) => {
    const sameEmail = email.length > 0 && normalizeText(client.email) === email;
    const samePhone = phone.length > 0 && normalizePhone(client.phone) === phone;
    const sameName = fullName.length > 0 && normalizeText(`${client.first_name ?? ""} ${client.last_name ?? ""}`) === fullName;
    const sameCompany = company.length > 0 && normalizeText(client.company_name) === company;
    return sameEmail || samePhone || sameName || sameCompany;
  });
}

function normalizeText(value: string | null): string {
  return value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") ?? "";
}

function normalizePhone(value: string | null): string {
  return value?.replace(/\D/g, "") ?? "";
}
