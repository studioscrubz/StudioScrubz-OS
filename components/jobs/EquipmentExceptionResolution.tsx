"use client";
import { useEffect,useState } from "react";
import { getEquipmentExceptions,resolveEquipmentException,type EquipmentException } from "@/lib/services/equipmentAccountability";
export function EquipmentExceptionResolution({jobId}:{jobId:string}) {
 const [items,setItems]=useState<EquipmentException[]>([]);
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [error,setError]=useState<string|null>(null);
 const [busy,setBusy]=useState<string|null>(null);
 const refresh=()=>getEquipmentExceptions(jobId).then(setItems).catch(e=>setError(e instanceof Error?e.message:"Unable to load exceptions."));
 useEffect(()=>{let active=true;getEquipmentExceptions(jobId).then(rows=>{if(active)setItems(rows)}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Unable to load exceptions.")});return()=>{active=false}},[jobId]);
 return <section className="rounded-xl border border-amber-300 bg-amber-50 p-3">
  <h3 className="font-bold text-amber-950">Equipment exceptions · Supervisor</h3>
  {items.length===0 && <p className="mt-2 text-xs text-neutral-600">No open equipment exceptions for this job.</p>}
  {items.map(item=><div key={item.exception_id} className="mt-2 rounded-lg bg-white p-3">
   <p className="text-sm font-bold">{item.item_name}</p>
   <p className="text-sm">{item.description}</p>
   <p className="text-xs text-neutral-500">Reported {new Date(item.reported_at).toLocaleString()}</p>
   <textarea aria-label={"Resolution for "+item.item_name} className="mt-2 w-full rounded-lg border p-2 text-sm" value={notes[item.exception_id]??""} onChange={e=>setNotes(v=>({...v,[item.exception_id]:e.target.value}))} placeholder="Document recovery, replacement, loss investigation, or supervisor-approved disposition." />
   <button type="button" disabled={busy===item.exception_id || !(notes[item.exception_id]??"").trim()} className="mt-2 rounded-lg bg-[#143d1a] px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={async()=>{setBusy(item.exception_id);setError(null);try{await resolveEquipmentException(item.exception_id,notes[item.exception_id]);await refresh()}catch(e){setError(e instanceof Error?e.message:"Resolution failed")}finally{setBusy(null)}}}>Resolve Exception</button>
  </div>)}
  {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
 </section>;
}
