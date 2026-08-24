import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type PublicBusinessContact = {
  businessName: string;
  email: string | null;
  phone: string | null;
};

export const getPublicBusinessContact = cache(async (): Promise<PublicBusinessContact> => {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("business_settings")
      .select("business_name,business_email,business_phone")
      .single();
    if (error || !data) throw error ?? new Error("Business settings are unavailable.");
    return {
      businessName: data.business_name?.trim() || "StudioScrubz",
      email: data.business_email?.trim() || null,
      phone: data.business_phone?.trim() || null,
    };
  } catch (error) {
    console.error("Public business contact could not be loaded", error);
    return { businessName: "StudioScrubz", email: null, phone: null };
  }
});
