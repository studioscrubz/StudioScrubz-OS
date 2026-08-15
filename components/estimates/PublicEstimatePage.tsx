"use client";
import { useEffect, useState } from "react";
import { EstimateDocument } from "@/components/estimates/EstimateDocument";
import { getPublicEstimate } from "@/lib/services/publicEstimates";
import type { PublicEstimate } from "@/types/publicEstimate";

export function PublicEstimatePage({token}:{token:string}){const[estimate,setEstimate]=useState<PublicEstimate|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState<string|null>(null);useEffect(()=>{void getPublicEstimate(token).then(setEstimate).catch(cause=>setError(message(cause))).finally(()=>setLoading(false))},[token]);if(loading)return <Shell><p>Loading your Estimate…</p></Shell>;if(error||!estimate)return <Shell><h1 className="text-2xl font-bold text-[#143d1a]">Estimate unavailable</h1><p className="mt-3 text-neutral-600">{error}</p></Shell>;return <Shell><EstimateDocument document={estimate}/><div className="mx-auto mt-5 max-w-3xl print:hidden"><button className="rounded-lg border px-4 py-2 font-bold text-[#143d1a]" onClick={()=>window.print()}>Print / Save as PDF</button></div></Shell>}
function Shell({children}:{children:React.ReactNode}){return <main className="min-h-screen bg-[#f5f6f4] px-4 py-10 print:bg-white print:p-0"><div className="mx-auto max-w-4xl rounded-2xl border bg-white shadow-sm print:border-0 print:shadow-none">{children}</div></main>}function message(cause:unknown){console.error(cause);return cause instanceof Error?cause.message:"This estimate could not be loaded."}
