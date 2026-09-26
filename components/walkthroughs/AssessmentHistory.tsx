"use client";

import { useEffect, useState } from "react";
import { getAssessmentHistory, type AssessmentHistoryEntry } from "@/lib/services/walkthroughs";

export function AssessmentHistory({walkthroughId}:{walkthroughId:string}){
  const[rows,setRows]=useState<AssessmentHistoryEntry[]>([]),[error,setError]=useState<string|null>(null);
  useEffect(()=>{void getAssessmentHistory(walkthroughId).then(setRows).catch(()=>setError("Assessment history could not be loaded."))},[walkthroughId]);
  return <section className="rounded-2xl border border-[#143d1a]/10 bg-white p-5"><h3 className="font-extrabold text-[#143d1a]">History</h3>{error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}<div className="mt-3 divide-y">{rows.map(row=><article key={row.id} className="py-3 text-sm"><div className="flex justify-between gap-3"><b>{row.event_type}</b><time className="text-xs text-neutral-400">{new Date(row.created_at).toLocaleString()}</time></div><p className="mt-1 text-xs text-neutral-500">{row.from_stage&&row.to_stage&&row.from_stage!==row.to_stage?`${row.from_stage} → ${row.to_stage} · `:""}{row.changed_fields.join(", ")}</p></article>)}{!error&&rows.length===0&&<p className="py-3 text-sm text-neutral-500">No recorded changes yet.</p>}</div></section>;
}
