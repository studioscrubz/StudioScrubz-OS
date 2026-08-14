"use client";

import { useEffect, useState } from "react";
import { acceptPublicAgreement, getPublicAgreement } from "@/lib/services/publicAgreements";
import type { PublicAgreement } from "@/types/publicAgreement";

export function PublicAgreementPage({ token }: { token: string }) {
  const [agreement, setAgreement] = useState<PublicAgreement | null>(null);
  const [name, setName] = useState(""); const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true); const [signing, setSigning] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void getPublicAgreement(token).then(setAgreement).catch((cause) => setError(safeMessage(cause))).finally(() => setLoading(false)); }, [token]);
  async function sign() { if (!consent) { setError("You must review and agree to the Service Agreement before signing."); return; } setSigning(true); setError(null); try { setAgreement(await acceptPublicAgreement(token, name, consent)); } catch (cause) { setError(safeMessage(cause)); } finally { setSigning(false); } }
  if (loading) return <PublicShell><p className="text-center font-semibold">Loading your Service Agreement…</p></PublicShell>;
  if (error && !agreement) return <PublicShell><h1 className="text-2xl font-bold text-[#143d1a]">Agreement unavailable</h1><p className="mt-3 text-neutral-600">{error}</p></PublicShell>;
  if (!agreement) return null;
  const schedule = agreement.frequency === "Multiple Days Per Week" ? agreement.days_of_week.map((day) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]).join(", ") : agreement.frequency;
  const signed = Boolean(agreement.client_signed_at);
  const canSign = agreement.status === "Sent" && !signed;
  return <PublicShell><article id="public-agreement" className="rounded-2xl border bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
    <header className="border-b-2 border-[#143d1a] pb-5"><h1 className="text-3xl font-extrabold text-[#143d1a]">{agreement.business_name}</h1>{agreement.tagline && <p>{agreement.tagline}</p>}<p className="mt-1 text-sm text-neutral-600">{[agreement.business_email, agreement.business_phone, agreement.website].filter(Boolean).join(" · ")}</p><p className="text-sm text-neutral-600">{[agreement.address, agreement.city, agreement.state, agreement.zip].filter(Boolean).join(", ")}</p></header>
    <h2 className="mt-6 text-2xl font-bold">Service Agreement</h2><p className="font-semibold">{agreement.agreement_number}</p>
    <div className="mt-6 grid gap-4 sm:grid-cols-2"><Detail label="Client" value={agreement.client_name}/><Detail label="Property / Service Location" value={agreement.property_location}/><Detail label="Service" value={agreement.service_name}/><Detail label="Frequency" value={agreement.frequency}/><Detail label="Schedule" value={`${schedule}${agreement.default_start_time ? ` at ${agreement.default_start_time}` : ""}`}/><Detail label="Dates" value={`${agreement.start_date}${agreement.end_date ? ` through ${agreement.end_date}` : ""}`}/><Detail label="Billing" value={`${money(agreement.billing_amount)} · ${agreement.billing_type}`}/></div>
    <Section label="Scope / Service Details" value={agreement.scope}/><Section label="Payment Terms" value={agreement.payment_terms}/><Section label="Agreement Terms" value={agreement.agreement_terms}/><Section label="Cancellation Terms" value={agreement.cancellation_terms}/><Section label="Special Instructions" value={agreement.special_instructions}/>
    {signed ? <section className="mt-8 rounded-xl border border-green-300 bg-green-50 p-5"><h3 className="text-lg font-bold text-green-800">Agreement Accepted</h3><p className="mt-2">Signed by: <b>{agreement.client_signed_name}</b></p><p className="font-serif text-2xl italic">{agreement.client_signature}</p><p className="text-sm">Signed {new Date(agreement.client_signed_at!).toLocaleString()}</p>{agreement.client_consent_text && <p className="mt-2 text-xs text-neutral-600">{agreement.client_consent_text}</p>}</section> : canSign ? <section className="mt-8 rounded-xl border bg-neutral-50 p-5 print:hidden"><h3 className="text-xl font-bold text-[#143d1a]">Electronic Signature</h3><label className="mt-4 block font-semibold">Full Legal Name<input className="mt-1 h-11 w-full rounded-lg border bg-white px-3" value={name} onChange={(event) => setName(event.target.value)}/></label><label className="mt-4 flex items-start gap-3"><input className="mt-1" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/><span>I have reviewed and agree to the terms of this Service Agreement.</span></label>{error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}<button disabled={signing || !consent || name.trim().length < 2} className="mt-5 rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white disabled:opacity-50" onClick={() => void sign()}>{signing ? "Signing…" : "Accept & Sign Agreement"}</button></section> : <section className="mt-8 rounded-xl border bg-neutral-50 p-5"><h3 className="font-bold text-[#143d1a]">Agreement {agreement.status}</h3><p className="mt-1 text-sm text-neutral-600">This agreement is not currently available for electronic signature.</p></section>}
    <div className="mt-6 print:hidden"><button className="rounded-lg border px-4 py-2 font-bold text-[#143d1a]" onClick={() => window.print()}>Print / Save as PDF</button></div>
  </article></PublicShell>;
}
function PublicShell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[#f5f6f4] px-4 py-10 print:bg-white print:p-0"><div className="mx-auto max-w-4xl">{children}</div></main>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><b className="block text-[#143d1a]">{label}</b><span>{value || "—"}</span></div>; }
function Section({ label, value }: { label: string; value: string | null }) { return <section className="mt-5"><h3 className="font-bold text-[#143d1a]">{label}</h3><p className="whitespace-pre-line">{value || "—"}</p></section>; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function safeMessage(cause: unknown) { console.error(cause); return cause instanceof Error ? cause.message : "This agreement could not be loaded."; }
