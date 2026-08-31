"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProposalBuilder } from "@/components/proposals/ProposalBuilder";
import { getProposalById } from "@/lib/services/proposals";
import type { ProposalWithRelations } from "@/types/proposal";

export function ProposalEditPage({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [proposal,setProposal]=useState<ProposalWithRelations|null>(null);
  const [missing,setMissing]=useState(false);
  useEffect(()=>{let active=true;void getProposalById(proposalId).then(value=>{if(!active)return;if(value.status!=="Draft")setMissing(true);else setProposal(value)}).catch(()=>{if(active)setMissing(true)});return()=>{active=false}},[proposalId]);
  if(missing)return <section className="rounded-2xl border bg-white p-8"><h1 className="text-2xl font-extrabold text-[#143d1a]">Proposal not found</h1><p className="mt-2 text-neutral-600">The Proposal does not exist or is outside your permitted scope.</p><Link href="/open-proposals" className="mt-5 inline-flex rounded-lg bg-[#143d1a] px-4 py-2 font-bold text-white">Back to Open Proposals</Link></section>;
  if(!proposal)return <div className="h-72 animate-pulse rounded-2xl bg-neutral-200" />;
  return <><header className="mb-7 border-b border-[#143d1a]/10 pb-7"><p className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Edit Proposal</p><h1 className="mt-2 text-3xl font-extrabold text-[#143d1a]">{proposal.proposal_number}</h1></header><ProposalBuilder proposal={proposal} onSaved={()=>router.push("/open-proposals")}/></>;
}
