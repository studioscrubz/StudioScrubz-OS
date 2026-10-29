import { getSupabaseClient } from "@/lib/supabase/client";
import {
  validateCorporateCapabilityProfile,
  type CorporateCapabilityProfile,
} from "@/types/corporateCapability";

export async function getCorporateCapabilityProfile(): Promise<CorporateCapabilityProfile> {
  const { data, error } = await getSupabaseClient().rpc("get_corporate_capability_profile");
  if (error) throw new Error(`Corporate capability profile could not be loaded: ${error.message}`);
  return validateCorporateCapabilityProfile(data);
}

export async function saveCorporateCapabilityProfile(profile: CorporateCapabilityProfile): Promise<CorporateCapabilityProfile> {
  const normalized = validateCorporateCapabilityProfile(profile);
  const { data, error } = await getSupabaseClient().rpc("save_corporate_capability_profile", { p_profile: normalized });
  if (error) throw new Error(`Corporate capability profile could not be saved: ${error.message}`);
  return validateCorporateCapabilityProfile(data);
}
