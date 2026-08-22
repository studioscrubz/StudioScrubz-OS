import { getSupabaseClient } from "@/lib/supabase/client";
import type { PublicInvoice } from "@/types/publicInvoice";

export async function getPublicInvoice(token: string): Promise<PublicInvoice> {
  if (!token) throw new Error("This Invoice link is invalid.");
  const { data, error } = await getSupabaseClient().rpc("get_invoice_by_token", { p_token: token });
  if (error) throw new Error(error.message || "This Invoice could not be loaded.");
  if (!data) throw new Error("This Invoice link is invalid, expired, or no longer available.");
  return data as PublicInvoice;
}
