"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { EstimateDocument } from "@/components/estimates/EstimateDocument";
import { getPublicEstimate, requestPublicEstimateWalkthrough } from "@/lib/services/publicEstimates";
import type { PublicEstimate, WalkthroughContactMethod } from "@/types/publicEstimate";

export function PublicEstimatePage({ token }: { token: string }) {
  const [estimate, setEstimate] = useState<PublicEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  useEffect(() => { void getPublicEstimate(token).then(setEstimate).catch((cause) => setError(message(cause))).finally(() => setLoading(false)); }, [token]);
  if (loading) return <Shell><p className="p-8">Loading your Estimate…</p></Shell>;
  if (error || !estimate) return <Shell><div className="p-8"><h1 className="text-2xl font-bold text-[#143d1a]">Estimate unavailable</h1><p className="mt-3 text-neutral-600">{error}</p></div></Shell>;

  return <Shell>
    <EstimateDocument document={estimate}/>
    <section className="mx-6 mb-6 rounded-2xl border border-[#d6b923] bg-[#fffdf0] p-6 print:hidden sm:mx-auto sm:max-w-[720px]">
      {estimate.walkthrough_requested ? <Requested/> : <>
        <h2 className="text-xl font-extrabold text-[#143d1a]">Ready for the next step?</h2>
        <p className="mt-2 leading-6 text-neutral-700">If you&apos;d like to move forward with this estimate, request a walkthrough with our team. A StudioScrubz representative will contact you to coordinate a date and time.</p>
        <button type="button" onClick={() => setRequestOpen(true)} className="mt-5 rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white">Request a Walkthrough</button>
      </>}
    </section>
    <div className="mx-auto mb-6 max-w-3xl px-6 print:hidden"><button type="button" className="rounded-lg border px-4 py-2 font-bold text-[#143d1a]" onClick={() => window.print()}>Print / Save as PDF</button></div>
    {requestOpen && <WalkthroughRequestModal token={token} estimate={estimate} close={() => setRequestOpen(false)} completed={(result) => { setEstimate({ ...estimate, ...result }); setRequestOpen(false); }}/>} 
  </Shell>;
}

function WalkthroughRequestModal({ token, estimate, close, completed }: { token:string; estimate:PublicEstimate; close:()=>void; completed:(result:Pick<PublicEstimate,"walkthrough_requested"|"walkthrough_requested_at"|"walkthrough_preferred_contact_method">)=>void }) {
  const [name, setName] = useState(estimate.client_name || "");
  const [email, setEmail] = useState(estimate.client_email || "");
  const [phone, setPhone] = useState(estimate.client_phone || "");
  const [preferred, setPreferred] = useState<WalkthroughContactMethod>(estimate.client_phone ? "Phone" : "Email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event:FormEvent) {
    event.preventDefault(); setError(null);
    const cleanEmail=email.trim(), cleanPhone=phone.trim();
    if(name.trim().length<2)return setError("Please enter your name.");
    if(cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail))return setError("Please enter a valid email address.");
    if(cleanPhone && cleanPhone.replace(/\D/g,"").length<7)return setError("Please enter a valid phone number.");
    if(preferred==="Email"&&!cleanEmail)return setError("An email address is required when Email is preferred.");
    if((preferred==="Phone"||preferred==="Text")&&!cleanPhone)return setError("A phone number is required for your preferred contact method.");
    setBusy(true);
    try { completed(await requestPublicEstimateWalkthrough(token,{clientName:name.trim(),email:cleanEmail||null,phone:cleanPhone||null,preferredContactMethod:preferred})); }
    catch(cause){setError(message(cause));setBusy(false)}
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:hidden" role="dialog" aria-modal="true" aria-labelledby="walkthrough-request-title">
    <form onSubmit={submit} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <h2 id="walkthrough-request-title" className="text-2xl font-extrabold text-[#143d1a]">Request a Walkthrough</h2>
      <p className="mt-2 text-sm leading-6 text-neutral-600">Confirm how our team should contact you to coordinate a date and time.</p>
      <div className="mt-5 space-y-4">
        <Field label="Client name"><input required value={name} onChange={(e)=>setName(e.target.value)} className={inputClass}/></Field>
        <Field label="Email"><input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} className={inputClass}/></Field>
        <Field label="Phone"><input type="tel" value={phone} onChange={(e)=>setPhone(e.target.value)} className={inputClass}/></Field>
        <Field label="Preferred contact method"><select value={preferred} onChange={(e)=>setPreferred(e.target.value as WalkthroughContactMethod)} className={inputClass}><option>Phone</option><option>Text</option><option>Email</option></select></Field>
      </div>
      <p className="mt-5 rounded-lg bg-[#fffdf0] p-3 text-sm font-semibold text-neutral-700">Requesting a walkthrough does not constitute acceptance of this Estimate or its quoted pricing.</p>
      {error&&<p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="mt-6 flex flex-wrap gap-3"><button disabled={busy} className="rounded-lg bg-[#143d1a] px-5 py-2.5 font-bold text-white disabled:opacity-50">{busy?"Submitting…":"Submit Request"}</button><button type="button" onClick={close} className="rounded-lg border px-5 py-2.5 font-bold text-neutral-700">Cancel</button></div>
    </form>
  </div>;
}
function Requested(){return <div><h2 className="text-xl font-extrabold text-[#143d1a]">Walkthrough Requested</h2><p className="mt-2 leading-6 text-neutral-700">Your walkthrough request has been received. A StudioScrubz representative will contact you to schedule.</p></div>}
function Field({label,children}:{label:string;children:ReactNode}){return <label className="block text-sm font-bold text-neutral-800">{label}<span className="mt-2 block">{children}</span></label>}
function Shell({children}:{children:ReactNode}){return <main className="min-h-screen bg-[#f5f6f4] px-4 py-10 print:bg-white print:p-0"><div className="mx-auto max-w-4xl rounded-2xl border bg-white shadow-sm print:border-0 print:shadow-none">{children}</div></main>}
function message(cause:unknown){console.error(cause);return cause instanceof Error?cause.message:"Your walkthrough request could not be submitted."}
const inputClass="w-full rounded-lg border border-neutral-300 px-3 py-2.5 font-normal outline-none focus:border-[#143d1a]";
