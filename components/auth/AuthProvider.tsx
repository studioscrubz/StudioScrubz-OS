"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getCurrentProfile, signOut as signOutService } from "@/lib/services/auth";
import type { AuthState, UserProfile } from "@/types/auth";
import type { Session } from "@supabase/supabase-js";
import { hasPermission, permissionForPath } from "@/lib/auth/permissions";
import { AccessDenied } from "@/components/auth/AccessDenied";

type AuthContextValue = AuthState & { refreshProfile: () => Promise<void>; signOut: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  async function resolve(nextSession: Session | null) {
    setSession(nextSession); setProfile(null); setError(null);
    if (!nextSession?.user) { setLoading(false); return; }
    try {
      const nextProfile = await getCurrentProfile(nextSession.user.id);
      if (!nextProfile) setError("Your StudioScrubz OS account is not configured. Contact the Master Admin.");
      else if (!nextProfile.is_active) setError("Your StudioScrubz OS account is inactive.");
      else setProfile(nextProfile);
    } catch (cause) { console.error("Profile resolution failed", cause); setError(cause instanceof Error ? cause.message : "Your account could not be verified."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const client = getSupabaseClient();
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) { setError("Your session could not be verified."); setLoading(false); return; }
      void resolve(data.session);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => { setLoading(true); window.setTimeout(() => void resolve(nextSession), 0); });
    return () => data.subscription.unsubscribe();
  }, []);
  async function refreshProfile() { if (session?.user) setProfile(await getCurrentProfile(session.user.id)); }
  async function logout() { await signOutService(); setSession(null); setProfile(null); }
  const value: AuthContextValue = { session, user: session?.user ?? null, profile, loading, error, refreshProfile, signOut: logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("useAuth must be used inside AuthProvider."); return value; }

export function ProtectedWorkspace({ children }: { children: ReactNode }) {
  const auth = useAuth(); const router = useRouter(); const pathname = usePathname();
  useEffect(() => { if (!auth.loading && !auth.user) router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`); }, [auth.loading, auth.user, pathname, router]);
  if (auth.loading || !auth.user) return <AuthLoading />;
  if (auth.error || !auth.profile) return <AccessBlocked message={auth.error ?? "Your account is not authorized for this version of StudioScrubz OS."} signOut={auth.signOut} />;
  if (pathname !== "/access-denied" && !hasPermission(auth.profile, permissionForPath(pathname))) return <AccessDenied />;
  return <>{children}</>;
}
function AuthLoading() { return <main className="grid min-h-screen place-items-center bg-[#f5f6f4]"><div className="text-center"><div className="mx-auto size-12 animate-pulse rounded-xl bg-[#d4af37]"/><p className="mt-4 text-sm font-bold text-[#143d1a]">Verifying StudioScrubz OS access…</p></div></main>; }
function AccessBlocked({ message, signOut }: { message: string; signOut: () => Promise<void> }) { const router = useRouter(); return <main className="grid min-h-screen place-items-center bg-[#f5f6f4] p-5"><section className="w-full max-w-lg rounded-2xl border bg-white p-8 text-center shadow-xl"><h1 className="text-2xl font-extrabold text-[#143d1a]">Access unavailable</h1><p className="mt-4 text-neutral-600">{message}</p><button className="mt-6 rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white" onClick={() => void signOut().finally(() => router.replace("/login"))}>Return to Login</button></section></main>; }
