"use client";
import { useEffect, useState } from "react";
import { ProposalDocument } from "@/components/proposals/ProposalDocument";
import { acceptPublicProposal, getPublicProposal } from "@/lib/services/publicProposals";
import type { PublicProposal } from "@/types/publicProposal";

export function PublicProposalPage({token}:{token:string}) {
  const [proposal,setProposal]=useState<PublicProposal|null>(null),[name,setName]=useState(""),[consent,setConsent]=useState(false),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null);
  useEffect(()=>{void getPublicProposal(token).then(setProposal).catch(cause=>setError(message(cause))).finally(()=>setLoading(false))},[token]);
  async function accept(){setSaving(true);setError(null);try{setProposal(await acceptPublicProposal(token,name,consent))}catch(cause){setError(message(cause))}finally{setSaving(false)}}
  if(loading)return <Shell><p>Loading your Proposal…</p></Shell>;
  if(error&&!proposal)return <Shell><h1 className="text-2xl font-bold text-[#143d1a]">Proposal unavailable</h1><p className="mt-3">{error}</p></Shell>;
  if(!proposal)return null;
  const accepted=proposal.status==="Accepted",deposit=proposal.deposit_instructions;
  return <Shell><ProposalDocument document={proposal}/><section className="mx-auto max-w-3xl px-6 pb-6 print:hidden">
    {accepted?<><div className="rounded-xl border border-green-300 bg-green-50 p-5"><h3 className="font-bold text-green-800">Proposal Accepted</h3><p>Accepted by <b>{proposal.accepted_by_name}</b></p><p className="text-sm">{proposal.accepted_at&&new Date(proposal.accepted_at).toLocaleString()}</p></div>
      {deposit&&<div className="mt-4 rounded-xl border border-[#d4af37]/50 bg-[#fffdf4] p-5"><h3 className="font-bold text-[#143d1a]">Deposit Instructions</h3><p className="mt-2"><b>Payment method:</b> {deposit.payment_method}</p><p><b>Recipient:</b> {deposit.recipient_name}</p><p><b>Phone:</b> {formatPhone(deposit.recipient_phone)}</p><p><b>Exact amount:</b> {money(deposit.required_amount,deposit.currency)}</p><p><b>Memo:</b> {deposit.rendered_memo}</p><p className="mt-3 text-sm text-neutral-600">Sending payment does not automatically confirm receipt. StudioScrubz staff will confirm the deposit after it is received.</p></div>}</>
      :proposal.status==="Sent"||proposal.status==="Viewed"?<div className="rounded-xl border bg-neutral-50 p-5"><h3 className="font-bold text-[#143d1a]">Accept Proposal</h3><label className="mt-4 block font-semibold">Full Name<input className="mt-1 h-11 w-full rounded-lg border bg-white px-3" value={name} onChange={event=>setName(event.target.value)}/></label><label className="mt-4 flex gap-3"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>I have reviewed and accept this Proposal.</span></label>{error&&<p className="mt-3 rounded bg-red-50 p-3 text-red-700">{error}</p>}<button disabled={saving||!consent||name.trim().length<2} onClick={()=>void accept()} className="mt-5 rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white disabled:opacity-50">{saving?"Accepting…":"Accept Proposal"}</button></div>
      :<p className="rounded-xl bg-neutral-50 p-5">This Proposal is read-only.</p>}
    <button className="mt-5 rounded-lg border px-4 py-2 font-bold text-[#143d1a]" onClick={()=>window.print()}>Print / Save as PDF</button>
  </section></Shell>;
}
function Shell({children}:{children:React.ReactNode}){return <main className="min-h-screen bg-[#f5f6f4] px-4 py-10 print:bg-white print:p-0"><div className="mx-auto max-w-4xl rounded-2xl border bg-white shadow-sm print:border-0 print:shadow-none">{children}</div></main>}
function message(cause:unknown){console.error(cause);return cause instanceof Error?cause.message:"This proposal could not be loaded."}
function formatPhone(value:string){return value.length===10?`(${value.slice(0,3)}) ${value.slice(3,6)}-${value.slice(6)}`:value}
function money(value:number,currency:string){return new Intl.NumberFormat("en-US",{style:"currency",currency}).format(value)}
