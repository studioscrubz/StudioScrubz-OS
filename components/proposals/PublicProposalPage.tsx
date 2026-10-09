"use client";

import { useEffect, useState } from "react";
import { ProposalDocument } from "@/components/proposals/ProposalDocument";
import { acceptPublicProposal, declinePublicProposal, getPublicProposal, recordPublicProposalView } from "@/lib/services/publicProposals";
import type { PublicProposal } from "@/types/publicProposal";

export function PublicProposalPage({ token }: { token: string }) {
  const [proposal, setProposal] = useState<PublicProposal | null>(null);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getPublicProposal(token)
      .then(async (loaded) => {
        if (active) setProposal(loaded);
        try {
          const viewed = await recordPublicProposalView(token);
          if (active) setProposal(viewed);
        } catch (cause) {
          console.error("Proposal view tracking failed", cause);
        }
      })
      .catch((cause) => { if (active) setError(message(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function accept() {
    setSaving(true); setError(null);
    try { setProposal(await acceptPublicProposal(token, name, consent)); }
    catch (cause) { setError(message(cause)); }
    finally { setSaving(false); }
  }

  async function decline() {
    setSaving(true); setError(null);
    try { setProposal(await declinePublicProposal(token, declineReason)); setDeclining(false); }
    catch (cause) { setError(message(cause)); }
    finally { setSaving(false); }
  }

  if (loading) return <Shell><p>Loading your Proposal…</p></Shell>;
  if (error && !proposal) return <Shell><h1 className="text-2xl font-bold text-[#143d1a]">Proposal unavailable</h1><p className="mt-3">{error}</p></Shell>;
  if (!proposal) return null;

  const accepted = proposal.status === "Accepted";
  const declined = proposal.status === "Declined";
  const deposit = proposal.deposit_instructions;

  return <Shell>
    <div className="px-6 pt-6 text-sm font-bold text-[#143d1a]">Proposal revision V{proposal.revision_number}</div>
    <ProposalDocument document={proposal} />
    <section className="mx-auto max-w-3xl px-6 pb-6 print:hidden">
      {proposal.superseded && <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900"><h3 className="font-bold">This proposal has been superseded</h3><p className="mt-1 text-sm">This historical revision remains available for reference but can no longer be accepted. Please use the newest proposal link from StudioScrubz.</p></div>}
      {accepted ? <>
        <div className="rounded-xl border border-green-300 bg-green-50 p-5"><h3 className="font-bold text-green-800">Proposal Accepted</h3><p>Accepted by <b>{proposal.accepted_by_name}</b></p><p className="text-sm">{proposal.accepted_at && new Date(proposal.accepted_at).toLocaleString()}</p></div>
        {deposit && <div className="mt-4 rounded-xl border border-[#d4af37]/50 bg-[#fffdf4] p-5"><h3 className="font-bold text-[#143d1a]">Deposit Instructions</h3><p className="mt-2"><b>Payment method:</b> {deposit.payment_method}</p><p><b>Recipient:</b> {deposit.recipient_name}</p><p><b>Phone:</b> {formatPhone(deposit.recipient_phone)}</p><p><b>Exact amount:</b> {money(deposit.required_amount, deposit.currency)}</p><p><b>Memo:</b> {deposit.rendered_memo}</p><p className="mt-3 text-sm text-neutral-600">Sending payment does not automatically confirm receipt. StudioScrubz staff will confirm the deposit after it is received.</p></div>}
      </> : declined ?
        <div className="rounded-xl border border-neutral-300 bg-neutral-50 p-5"><h3 className="font-bold text-[#143d1a]">Proposal Declined</h3><p className="mt-1 text-sm text-neutral-600">StudioScrubz has been notified. This proposal remains available for your records.</p></div>
      : !proposal.superseded && (proposal.status === "Sent" || proposal.status === "Viewed") ?
        <div className="rounded-xl border bg-neutral-50 p-5">
          <h3 className="font-bold text-[#143d1a]">Accept Proposal</h3>
          <label className="mt-4 block font-semibold">Full Name<input className="mt-1 h-11 w-full rounded-lg border bg-white px-3" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="mt-4 flex gap-3"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I have reviewed and accept this Proposal.</span></label>
          {error && <p className="mt-3 rounded bg-red-50 p-3 text-red-700">{error}</p>}
          <div className="mt-5 flex flex-wrap gap-3">
            <button disabled={saving || !consent || name.trim().length < 2} onClick={() => void accept()} className="rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? "Accepting…" : "Accept Proposal"}</button>
            <button disabled={saving} onClick={() => setDeclining((value) => !value)} className="rounded-lg border border-neutral-300 px-5 py-3 font-bold text-neutral-700 disabled:opacity-50">Decline Proposal</button>
          </div>
          {declining && <div className="mt-4 rounded-lg border bg-white p-4"><label className="block text-sm font-semibold">Reason or feedback (optional)<textarea maxLength={1000} className="mt-2 min-h-24 w-full rounded-lg border p-3 font-normal" value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} /></label><p className="mt-2 text-xs text-neutral-500">Declining is final for this proposal revision.</p><button disabled={saving} onClick={() => void decline()} className="mt-3 rounded-lg bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50">{saving ? "Declining…" : "Confirm Decline"}</button></div>}
        </div>
      : <p className="rounded-xl bg-neutral-50 p-5">This Proposal is read-only.</p>}
      <button className="mt-5 rounded-lg border px-4 py-2 font-bold text-[#143d1a]" onClick={() => window.print()}>Print / Save as PDF</button>
    </section>
  </Shell>;
}

function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[#f5f6f4] px-4 py-10 print:bg-white print:p-0"><div className="mx-auto max-w-4xl rounded-2xl border bg-white shadow-sm print:border-0 print:shadow-none">{children}</div></main>; }
function message(cause: unknown) { console.error(cause); return cause instanceof Error ? cause.message : "This proposal could not be loaded."; }
function formatPhone(value: string) { return value.length === 10 ? `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6)}` : value; }
function money(value: number, currency: string) { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value); }
