"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { contractorPage } from "@/lib/contractors/host";
import { getSupabaseClient } from "@/lib/supabase/client";

export function ContractorResetPassword() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const { data: { subscription } } = getSupabaseClient().auth.onAuthStateChange(event => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
      if (event === "SIGNED_OUT") setReady(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f6f4] p-5">
      <form className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6" onSubmit={async event => {
        event.preventDefault();
        if (!ready) return;
        setBusy(true);
        setError("");
        try {
          const client = getSupabaseClient();
          const { error } = await client.auth.updateUser({ password });
          if (error) throw error;
          await client.auth.signOut({ scope: "local" });
          router.replace(contractorPage("/login"));
        } catch (error) {
          setError(error instanceof Error ? error.message : "Password update failed.");
        } finally {
          setBusy(false);
        }
      }}>
        <h1 className="text-xl font-bold text-[#143d1a]">Set a new contractor password</h1>
        {ready ? <>
          <label className="block text-sm font-bold">New password
            <input type="password" minLength={12} required autoComplete="new-password" value={password}
              onChange={event => setPassword(event.target.value)} className="mt-1 w-full rounded border p-3" />
          </label>
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <button className="w-full rounded-lg bg-[#143d1a] p-3 text-white" disabled={busy}>Update password</button>
        </> : <>
          <p className="text-sm">Open the recovery email in the browser where you requested it. If the link has expired, request a new one from the sign-in page.</p>
          <button type="button" className="text-sm text-[#143d1a] underline" onClick={() => router.replace(contractorPage("/login"))}>Back to sign in</button>
        </>}
      </form>
    </main>
  );
}
