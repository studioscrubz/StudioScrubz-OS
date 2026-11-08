"use client";

import { useEffect, useState } from "react";

type Account = { id: string; label: string; profileEmail: string | null; override: string | null };
type Settings = { signature: string; senderEmail: string | null; accounts: Account[] };

async function requestSettings(options?: RequestInit) {
  const response = await fetch("/api/settings/personal-email", { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Email settings are unavailable.");
  return result;
}

export default function EmailSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [signature, setSignature] = useState("");
  const [userId, setUserId] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void requestSettings().then(result => {
      if (active) { setSettings(result); setSignature(result.signature); }
    }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);

  async function save(body: Record<string, string>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      await requestSettings({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setSettings(await requestSettings());
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Email settings could not be saved.");
    } finally { setBusy(false); }
  }

  const account = settings?.accounts.find(row => row.id === userId);
  const input = "mt-1 block w-full rounded-lg border border-neutral-300 p-2";
  const button = "rounded-lg bg-[#143d1a] px-4 py-2 font-bold text-white disabled:opacity-50";
  return <main className="max-w-2xl space-y-5">
    <header><h1 className="text-3xl font-extrabold text-[#143d1a]">Email Signature</h1>
      <p className="mt-2 text-neutral-600">Choose the signature appended to emails you send from the OS.</p></header>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status" className="text-green-800">{message}</p>}
    {settings ? <>
      <form className="space-y-4 rounded-xl border bg-white p-5" onSubmit={event => { event.preventDefault(); void save({ action: "signature", signature }, "Signature saved."); }}>
        <p><b>Sending address</b> {settings.senderEmail ?? "Ask a Master Admin to assign your StudioScrubz sender address."}</p>
        <label className="block font-bold">Your signature
          <textarea className={input} rows={6} maxLength={2000} value={signature} onChange={event => setSignature(event.target.value)} />
        </label>
        <button className={button} disabled={busy}>Save signature</button>
      </form>
      {settings.accounts.length > 0 && <form className="space-y-4 rounded-xl border bg-white p-5" onSubmit={event => {
        event.preventDefault(); void save({ action: "sender", userId, senderEmail }, "Sender address saved.");
      }}>
        <h2 className="text-xl font-extrabold">Designated sender addresses</h2>
        <label className="block font-bold">OS user
          <select className={input} required value={userId} onChange={event => {
            const id = event.target.value;
            setUserId(id);
            setSenderEmail(settings.accounts.find(row => row.id === id)?.override ?? "");
          }}>
            <option value="">Select a user</option>
            {settings.accounts.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </label>
        <label className="block font-bold">StudioScrubz sender address
          <input className={input} type="email" value={senderEmail} onChange={event => setSenderEmail(event.target.value)} placeholder={account?.profileEmail ?? "name@studioscrubz.com"} />
        </label>
        <p className="text-sm text-neutral-600">Leave blank to use the user’s StudioScrubz profile email. This setting is separate from their sign-in email.</p>
        <button className={button} disabled={busy || !userId}>Save sender address</button>
      </form>}
    </> : !error && <p role="status">Loading email settings…</p>}
  </main>;
}
