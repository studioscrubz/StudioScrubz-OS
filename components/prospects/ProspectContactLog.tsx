"use client";
import {useEffect,useState,type FormEvent} from "react";
import {createProspectContactActivity,getProspectContactActivities,type ProspectContactActivity} from "@/lib/services/prospects";

export function ProspectContactLog({prospectId}:{prospectId:string}){
 const [items,setItems]=useState<ProspectContactActivity[]>([]);
 const [kind,setKind]=useState<ProspectContactActivity["activity_type"]>("Call");
 const [outcome,setOutcome]=useState("");
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{let active=true;getProspectContactActivities(prospectId).then(data=>{if(active)setItems(data);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Unable to load activity.");});return()=>{active=false;};},[prospectId]);
 async function submit(event:FormEvent){event.preventDefault();if(!outcome.trim())return;setSaving(true);setError(null);try{await createProspectContactActivity(prospectId,kind,outcome);setOutcome("");setItems(await getProspectContactActivities(prospectId));}catch(cause){setError(cause instanceof Error?cause.message:"Unable to save activity.");}finally{setSaving(false);}}
 return <section className="space-y-3 rounded-xl border border-[#143d1a]/15 bg-white p-4">
  <h3 className="font-extrabold text-[#143d1a]">Contact activity</h3>
  <form onSubmit={submit} className="space-y-2">
   <label className="block text-xs font-bold text-neutral-600">Contact method<select value={kind} onChange={event=>setKind(event.target.value as ProspectContactActivity["activity_type"])} className="mt-1 w-full rounded-lg border p-2 text-sm">{["Call","Email","Text","Meeting","Other"].map(option=><option key={option}>{option}</option>)}</select></label>
   <label className="block text-xs font-bold text-neutral-600">Outcome / conversation notes<textarea value={outcome} maxLength={2000} onChange={event=>setOutcome(event.target.value)} rows={3} required className="mt-1 w-full rounded-lg border p-2 text-sm" placeholder="What happened? What was agreed?"/></label>
   <button type="submit" disabled={saving||!outcome.trim()} className="rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving?"Saving…":"Log contact"}</button>
  </form>
  {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
  <div className="max-h-72 space-y-2 overflow-y-auto">{items.map(item=><article key={item.id} className="rounded-lg border p-3"><p className="text-xs font-bold text-[#143d1a]">{item.activity_type} · {new Date(item.created_at).toLocaleString()}</p><p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{item.outcome}</p></article>)}{items.length===0&&<p className="text-xs text-neutral-500">No contacts logged yet.</p>}</div>
 </section>;
}
