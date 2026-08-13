import { getSupabaseClient } from "@/lib/supabase/client";
import { USER_ROLES, type UserProfile } from "@/types/auth";

export async function signIn(email: string, password: string) {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    console.error("Supabase sign-in failed", { message: error.message, status: error.status });
    throw new Error(error.message || "Unable to sign in.");
  }
  if (!data.user || !data.session) throw new Error("Unable to establish session.");

  const profile = await getCurrentProfile(data.user.id);
  if (!profile) {
    await signOut();
    throw new Error("Profile not found. Contact the Master Admin.");
  }
  if (!profile.is_active) {
    await signOut();
    throw new Error("Your StudioScrubz OS account is inactive.");
  }
  if (!USER_ROLES.includes(profile.role)) {
    await signOut();
    throw new Error("Your account has an invalid role. Contact the Master Admin.");
  }
  return { ...data, profile };
}
export async function signOut() {
  const { error } = await getSupabaseClient().auth.signOut({ scope: "local" });
  if (error) throw new Error("Sign out failed. Please try again.");
}
export async function getCurrentSession() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw new Error("Your session could not be verified.");
  return data.session;
}
export async function getCurrentUser() {
  const { data, error } = await getSupabaseClient().auth.getUser();
  if (error) {
    console.error("Supabase user verification failed", { message: error.message, status: error.status });
    return null;
  }
  return data.user;
}
export async function getCurrentProfile(userId?: string): Promise<UserProfile | null> {
  const id = userId ?? (await getCurrentUser())?.id;
  if (!id) return null;
  const { data, error } = await getSupabaseClient().from("user_profiles").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("Supabase profile query failed", { message: error.message, code: error.code });
    throw new Error("Your StudioScrubz OS profile could not be loaded.");
  }
  return data as UserProfile | null;
}
