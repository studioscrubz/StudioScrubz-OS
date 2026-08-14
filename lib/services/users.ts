import { getSupabaseClient } from "@/lib/supabase/client";
import type { UserProfile, UserProfileInput } from "@/types/auth";

export async function getUserProfiles(): Promise<UserProfile[]> {
  const { data, error } = await getSupabaseClient().from("user_profiles").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function createUserProfile(input: UserProfileInput): Promise<UserProfile> {
  const { data, error } = await getSupabaseClient().rpc("admin_create_user_profile", {
    p_auth_user_id: input.auth_user_id,
    p_email: input.email.trim(),
    p_display_name: input.display_name.trim(),
    p_role: input.role,
    p_employee_id: input.employee_id,
    p_is_active: input.is_active,
  });
  if (error) throw new Error(profileError(error.message));
  return data;
}

export async function updateUserProfile(id: string, input: Omit<UserProfileInput, "auth_user_id" | "email">): Promise<UserProfile> {
  const { data, error } = await getSupabaseClient().rpc("admin_update_user_profile", {
    p_profile_id: id,
    p_display_name: input.display_name.trim(),
    p_role: input.role,
    p_employee_id: input.employee_id,
    p_is_active: input.is_active,
  });
  if (error) throw new Error(profileError(error.message));
  return data;
}

export async function setUserActive(id: string, isActive: boolean): Promise<UserProfile> {
  const { data, error } = await getSupabaseClient().rpc("admin_set_user_active", { p_profile_id: id, p_is_active: isActive });
  if (error) throw new Error(profileError(error.message));
  return data;
}

function profileError(message: string) {
  if (message.includes("active Master Admin")) return "At least one active Master Admin is required.";
  if (message.includes("duplicate key")) return "A profile already exists for this Auth user or employee.";
  if (message.includes("Auth user")) return message;
  if (message.includes("Master Admin access required")) return "You do not have permission to manage users.";
  return message || "User access could not be updated.";
}
