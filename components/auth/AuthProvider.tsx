"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  const userIdRef = useRef<string | null>(null);
  const profileRef = useRef<UserProfile | null>(null);
  const resolutionRef = useRef(0);
  const commitProfile = useCallback((nextProfile: UserProfile | null) => {
    profileRef.current = nextProfile;
    setProfile(nextProfile);
  }, []);
  const resolveProfile = useCallback(async (nextSession: Session, showLoading: boolean) => {
    const resolution = ++resolutionRef.current;
    userIdRef.current = nextSession.user.id;
    setSession(nextSession);
    setError(null);
    if (showLoading) { setLoading(true); commitProfile(null); }
    try {
      const nextProfile = await getCurrentProfile(nextSession.user.id);
      if (resolution !== resolutionRef.current) return;
      if (!nextProfile) { commitProfile(null); setError("Your StudioScrubz OS account is not configured. Contact the Master Admin."); }
      else if (!nextProfile.is_active) { commitProfile(null); setError("Your StudioScrubz OS account is inactive."); }
      else commitProfile(nextProfile);
    } catch (cause) {
      if (resolution !== resolutionRef.current) return;
      console.error("Profile resolution failed", cause);
      if (showLoading) {
        commitProfile(null);
        setError(cause instanceof Error ? cause.message : "Your account could not be verified.");
      }
    } finally { if (resolution === resolutionRef.current && showLoading) setLoading(false); }
  }, [commitProfile]);
  useEffect(() => {
    const client = getSupabaseClient();
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) { setError("Your session could not be verified."); setLoading(false); return; }
      if (!data.session?.user) {
        userIdRef.current = null; setSession(null); commitProfile(null); setError(null); setLoading(false); return;
      }
      void resolveProfile(data.session, true);
    });
    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      window.setTimeout(() => {
        if (event === "INITIAL_SESSION") return;
        if (event === "SIGNED_OUT" || !nextSession?.user) {
          resolutionRef.current += 1; userIdRef.current = null; setSession(null); commitProfile(null); setError(null); setLoading(false); return;
        }
        const sameUser = userIdRef.current === nextSession.user.id;
        if (event === "TOKEN_REFRESHED" || event === "PASSWORD_RECOVERY") {
          userIdRef.current = nextSession.user.id; setSession(nextSession); return;
        }
        if (event === "USER_UPDATED") {
          if (sameUser && profileRef.current) { setSession(nextSession); void resolveProfile(nextSession, false); }
          else void resolveProfile(nextSession, true);
          return;
        }
        if (event === "SIGNED_IN" || event === "MFA_CHALLENGE_VERIFIED") {
          if (sameUser && profileRef.current) { setSession(nextSession); return; }
          void resolveProfile(nextSession, true);
        }
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [commitProfile, resolveProfile]);
  async function refreshProfile() { if (session?.user) await resolveProfile(session, false); }
  async function logout() { await signOutService(); resolutionRef.current += 1; userIdRef.current = null; setSession(null); commitProfile(null); setError(null); setLoading(false); }
  const value: AuthContextValue = { session, user: session?.user ?? null, profile, loading, error, refreshProfile, signOut: logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("useAuth must be used inside AuthProvider."); return value; }

export function ProtectedWorkspace({ children }: { children: ReactNode }) {
  const auth = useAuth(); const router = useRouter(); const pathname = usePathname();
  useEffect(() => { if (!auth.loading && !auth.user) router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`); }, [auth.loading, auth.user, pathname, router]);
  if (auth.loading) return <AuthLoading />;
  if (!auth.user) return null;
  if (auth.error || !auth.profile) return <AccessBlocked message={auth.error ?? "Your account is not authorized for this version of StudioScrubz OS."} signOut={auth.signOut} />;
  if (pathname !== "/access-denied" && !hasPermission(auth.profile, permissionForPath(pathname))) return <AccessDenied />;
  return <>{children}</>;
}
function AuthLoading() { return <main className="grid min-h-screen place-items-center bg-[#f5f6f4]"><div className="text-center"><div className="mx-auto size-12 animate-pulse rounded-xl bg-[#d4af37]"/><p className="mt-4 text-sm font-bold text-[#143d1a]">Verifying StudioScrubz OS access…</p></div></main>; }
function AccessBlocked({ message, signOut }: { message: string; signOut: () => Promise<void> }) { const router = useRouter(); return <main className="grid min-h-screen place-items-center bg-[#f5f6f4] p-5"><section className="w-full max-w-lg rounded-2xl border bg-white p-8 text-center shadow-xl"><h1 className="text-2xl font-extrabold text-[#143d1a]">Access unavailable</h1><p className="mt-4 text-neutral-600">{message}</p><button className="mt-6 rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white" onClick={() => void signOut().finally(() => router.replace("/login"))}>Return to Login</button></section></main>; }
