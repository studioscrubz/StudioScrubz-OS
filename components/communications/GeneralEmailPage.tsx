"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { getClients } from "@/lib/services/clients";
import { sendCommunicationsEmail } from "@/lib/services/communicationsEmail";
import { EmailAttachmentPicker, encodeEmailFiles } from "@/components/communications/EmailAttachmentPicker";
import type { Client } from "@/types/client";

export function GeneralEmailPage() {
  const { profile } = useAuth();
  const permitted = hasPermission(profile, "communications.create");
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [recipientMode, setRecipientMode] = useState<"client" | "new">("client");
  const [clientId, setClientId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!permitted) return;
    let active = true;
    void getClients().then((data) => {
      if (active) setClients(data.filter((client) => !client.archived_at && Boolean(client.email?.trim())));
    }).catch(() => { if (active) setLoadError("Client list could not be loaded. You can still send to a new email address."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [permitted]);

  const sortedClients = useMemo(() => [...clients].sort((a, b) => clientName(a).localeCompare(clientName(b))), [clients]);
  const selectedClient = clients.find((client) => client.id === clientId);
  const recipientEmail = recipientMode === "client" ? selectedClient?.email?.trim() ?? "" : newEmail.trim();

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setSuccess("");
    if (!recipientEmail || !subject.trim() || !message.trim()) { setError("Recipient, subject, and message are required."); return; }
    setSending(true);
    try {
      const encodedAttachments = await encodeEmailFiles(attachments);
      await sendCommunicationsEmail({
        requestId, recipientEmail, subject: subject.trim(), messageBody: message.trim(),
        communicationType: "General", clientId: recipientMode === "client" ? clientId : null, attachments: encodedAttachments,
      });
      setSuccess(`Email sent to ${recipientEmail} through StudioScrubz.`);
      setSubject(""); setMessage(""); setAttachments([]); setRequestId(crypto.randomUUID());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Email could not be sent.");
    } finally { setSending(false); }
  }

  if (!permitted) return <section className="rounded-2xl bg-white p-6"><h1 className="text-xl font-bold text-[#143d1a]">General Email</h1><p className="mt-2 text-sm text-neutral-600">You do not have permission to send Communications email.</p></section>;
  return <main className="mx-auto w-full max-w-3xl space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-widest text-[#9a7a17]">Communications</p><h1 className="mt-1 text-2xl font-extrabold text-[#143d1a]">General Email</h1><p className="mt-2 text-sm text-neutral-600">Send a message to an existing client or a new email address. Sales messages are sent from your assigned StudioScrubz email.</p></header>
    <form onSubmit={(event) => void send(event)} className="space-y-5 rounded-2xl border border-[#143d1a]/10 bg-white p-6 shadow-sm">
      <fieldset className="space-y-3"><legend className="text-sm font-bold text-[#143d1a]">Recipient</legend>
        <div className="flex flex-wrap gap-5 text-sm"><label className="flex items-center gap-2"><input type="radio" name="recipient-mode" checked={recipientMode === "client"} onChange={() => { setRecipientMode("client"); setError(""); setSuccess(""); }} /> Existing client</label><label className="flex items-center gap-2"><input type="radio" name="recipient-mode" checked={recipientMode === "new"} onChange={() => { setRecipientMode("new"); setError(""); setSuccess(""); }} /> New email address</label></div>
      </fieldset>
      {recipientMode === "client" ? <label className="block space-y-2 text-sm font-semibold text-neutral-700">Select client
        <select required value={clientId} onChange={(event) => { setClientId(event.target.value); setError(""); setSuccess(""); }} disabled={sending || loading} className="w-full rounded-lg border border-neutral-300 bg-white p-3 text-sm">
          <option value="">{loading ? "Loading clients…" : "Choose a client"}</option>
          {sortedClients.map((client) => <option key={client.id} value={client.id}>{clientName(client)} — {client.email}</option>)}
        </select>
      </label> : <label className="block space-y-2 text-sm font-semibold text-neutral-700">Recipient email
        <input type="email" required value={newEmail} onChange={(event) => { setNewEmail(event.target.value); setError(""); setSuccess(""); }} disabled={sending} placeholder="recipient@example.com" className="w-full rounded-lg border border-neutral-300 p-3 text-sm" />
      </label>}
      {loadError && recipientMode === "client" && <p role="alert" className="text-sm text-amber-700">{loadError}</p>}
      <label className="block space-y-2 text-sm font-semibold text-neutral-700">Subject<input required maxLength={300} value={subject} onChange={(event) => setSubject(event.target.value)} disabled={sending} className="w-full rounded-lg border border-neutral-300 p-3 text-sm" /></label>
      <label className="block space-y-2 text-sm font-semibold text-neutral-700">Message<textarea required rows={9} value={message} onChange={(event) => setMessage(event.target.value)} disabled={sending} className="w-full resize-y rounded-lg border border-neutral-300 p-3 text-sm" /></label>
      <EmailAttachmentPicker files={attachments} onChange={setAttachments} disabled={sending} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{success}</p>}
      <div className="flex justify-end"><button type="submit" disabled={sending || !recipientEmail || !subject.trim() || !message.trim()} className="rounded-lg bg-[#143d1a] px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{sending ? "Sending…" : "Send General Email"}</button></div>
    </form>
  </main>;
}

function clientName(client: Client) {
  return [client.first_name, client.last_name].filter(Boolean).join(" ").trim() || client.company_name?.trim() || client.email || "Unnamed client";
}
