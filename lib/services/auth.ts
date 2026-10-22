import { getSupabaseClient } from "@/lib/supabase/client";
import { USER_ROLES, type UserProfile } from "@/types/auth";
import type { User } from "@supabase/supabase-js";

type LeadRepresentativeIdentityClient = {
  rpc: (name: "is_current_lead_representative_eligible") => Promise<{
    data: boolean | null;
    error: { message?: string } | null;
  }>;
};

const USER_CACHE_MS = 15_000;
const PROFILE_CACHE_MS = 30_000;
let cachedUser: { value: User | null; expiresAt: number } | null = null;
let userRequest: Promise<User | null> | null = null;
let cachedProfile: { value: UserProfile | null; userId: string; expiresAt: number } | null = null;
let profileRequest: { userId: string; promise: Promise<UserProfile | null> } | null = null;

export function invalidateAuthIdentityCache() {
  cachedUser = null;
  cachedProfile = null;
  userRequest = null;
  profileRequest = null;
}

export function seedCurrentProfile(profile: UserProfile | null) {
  if (!profile) { cachedProfile = null; return; }
  cachedProfile = { value: profile, userId: profile.id, expiresAt: Date.now() + PROFILE_CACHE_MS };
}

export async function signIn(email: string, password: string) {
  invalidateAuthIdentityCache();
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
  invalidateAuthIdentityCache();
}
export async function getCurrentSession() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw new Error("Your session could not be verified.");
  return data.session;
}
export async function getCurrentUser() {
  if (cachedUser && cachedUser.expiresAt > Date.now()) return cachedUser.value;
  if (userRequest) return userRequest;
  userRequest = (async () => {
    const { data, error } = await getSupabaseClient().auth.getUser();
    if (error) {
      console.error("Supabase user verification failed", { message: error.message, status: error.status });
      return null;
    }
    cachedUser = { value: data.user, expiresAt: Date.now() + USER_CACHE_MS };
    return data.user;
  })().finally(() => { userRequest = null; });
  return userRequest;
}
export async function getCurrentProfile(userId?: string): Promise<UserProfile | null> {
  const id = userId ?? (await getCurrentUser())?.id;
  if (!id) return null;
  if (cachedProfile?.userId === id && cachedProfile.expiresAt > Date.now()) return cachedProfile.value;
  if (profileRequest?.userId === id) return profileRequest.promise;
  const promise = (async () => {
    const { data, error } = await getSupabaseClient().from("user_profiles").select("*").eq("id", id).maybeSingle();
    if (error) {
      console.error("Supabase profile query failed", { message: error.message, code: error.code });
      throw new Error("Your StudioScrubz OS profile could not be loaded.");
    }
    const profile = data as UserProfile | null;
    if (profile?.role === "Lead Representative") {
      const { data: eligible, error: eligibilityError } = await (getSupabaseClient() as unknown as LeadRepresentativeIdentityClient)
        .rpc("is_current_lead_representative_eligible");
      if (eligibilityError || eligible !== true) {
        throw new Error("Your Lead Representative account is not linked to an active Lead Representative employee.");
      }
    }
    cachedProfile = { value: profile, userId: id, expiresAt: Date.now() + PROFILE_CACHE_MS };
    return profile;
  })().finally(() => { if (profileRequest?.promise === promise) profileRequest = null; });
  profileRequest = { userId: id, promise };
  return promise;
}
