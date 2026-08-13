"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { getProposals } from "@/lib/services/proposals";
import type { ProposalWithRelations } from "@/types/proposal";
export function ProposalLinkSummary({source}:{source:"estimate"|"walkthrough"}){const[rows,setRows]=useState<ProposalWithRelations[]>([]);useEffect(()=>{let active=true;void getProposals().then(data=>{if(active)setRows(data.filter(p=>source==="estimate"?Boolean(p.estimate_id):Boolean(p.walkthrough_id)))}).catch(error=>console.error("Proposal links failed to load",error));return()=>{active=false}},[source]);if(!rows.length)return null;return <section className="mt-6 rounded-2xl border border-[#143d1a]/10 bg-white p-4"><h2 className="text-sm font-extrabold text-[#143d1a]">Proposal Linked</h2><div className="mt-3 flex flex-wrap gap-2">{rows.map(p=><Link key={p.id} href="/open-proposals" className="rounded-full bg-[#edf4ec] px-3 py-1.5 text-xs font-bold text-[#143d1a]">{p.proposal_number} · View Proposal</Link>)}</div></section>}
