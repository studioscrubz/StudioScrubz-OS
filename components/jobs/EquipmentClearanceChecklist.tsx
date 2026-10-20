"use client";
import { useState } from "react";
import { submitEquipmentClearance, type EquipmentCheckpoint, type EquipmentItem } from "@/lib/services/equipmentClearance";

const BASE_ITEMS: { name: string; kind: EquipmentItem["kind"] }[] = [
  { name: "Cleaning caddy", kind: "Equipment" },
  { name: "Vacuum and attachments", kind: "Equipment" },
  { name: "Mop, bucket, and handles", kind: "Equipment" },
  { name: "Extension cords and chargers", kind: "Equipment" },
  { name: "Reusable towels and microfiber", kind: "Supply" },
  { name: "Cleaning chemicals and containers", kind: "Supply" },
  { name: "PPE and safety equipment", kind: "Equipment" },
];
export function EquipmentClearanceChecklist({ jobId, checkpoint, onSubmitted }: {
  jobId: string; checkpoint: EquipmentCheckpoint; onSubmitted?: () => void;
}) {
  const [items,setItems] = useState<EquipmentItem[]>(BASE_ITEMS.map(item => ({...item,status:"Checked"})));
  const [busy,setBusy] = useState(false);
  const [result,setResult] = useState<string | null>(null);
  const [error,setError] = useState<string | null>(null);
  const change = (index: number, patch: Partial<EquipmentItem>) => setItems(current => current.map((item,i) => i===index ? {...item,...patch} : item));
  return <section className="rounded-xl border border-[#143d1a]/20 bg-white p-3">
    <h3 className="text-sm font-extrabold text-[#143d1a]">{checkpoint} · Equipment Clearance</h3>
    <p className="mt-1 text-xs text-neutral-600">Physically verify each item. Choose Not Needed only when unused; report anything missing separately.</p>
    <div className="mt-3 grid gap-3">{items.map((item,i) => <div key={item.name} className="rounded-lg border p-2">
      <p className="text-sm font-semibold">{item.name} <span className="text-xs font-normal text-neutral-500">({item.kind})</span></p>
      <div className="mt-2 flex flex-wrap gap-3">{(["Checked","Not Needed","Missing"] as const).map(status => <label key={status} className="flex items-center gap-1 text-xs">
        <input type="radio" name={checkpoint+jobId+i} checked={item.status===status} disabled={busy || !!result} onChange={() => change(i,{status})} />{status}
      </label>)}</div>
      {item.status==="Missing" && <textarea aria-label={item.name+" missing details"} className="mt-2 w-full rounded-lg border p-2 text-sm" value={item.description??""} disabled={busy || !!result} onChange={e => change(i,{description:e.target.value})} placeholder="What is missing? Last known location, who was notified…" />}
    </div>)}</div>
    {!result && <button type="button" disabled={busy || items.some(i => i.status==="Missing" && !i.description?.trim())} className="mt-3 rounded-lg bg-[#143d1a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
      onClick={async () => {setBusy(true);setError(null);try {const id=await submitEquipmentClearance(jobId,checkpoint,items);setResult(id);onSubmitted?.();} catch(e){setError(e instanceof Error?e.message:"Equipment clearance failed.");}finally{setBusy(false);}}}>{busy?"Submitting…":"Submit Equipment Clearance"}</button>}
    {result && <p role="status" className="mt-2 text-sm font-bold text-[#143d1a]">Checklist submitted. {items.some(i=>i.status==="Missing")?"Supervisor resolution is required before clearance.":"Equipment clearance complete."}</p>}
    {error && <p role="alert" className="mt-2 text-sm font-bold text-red-700">{error}</p>}
  </section>;
}
