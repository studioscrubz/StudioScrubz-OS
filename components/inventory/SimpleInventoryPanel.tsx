"use client";

import { useState } from "react";
import { inventoryAction, type InventoryData, type InventoryItem } from "@/lib/services/inventory";

type Choice = "good" | "restock" | "repair" | "missing";
export type SimpleInventoryTab = "Catalog" | "Restock Checklist" | "Equipment";
const equipmentKeys = new Set(["bucket","organizer","cart","vacuum","steamer","scraper","brushes","measure_cup","measure_spoons","funnel","goggles","spill_tray"]);
const categories = ["Everyday Essentials","Standard Cleaning Kit","Deep Cleaning Supplies","Specialty Cleaning Supplies","Bulk Refill Products","Refill Tools & Safety"];
function category(item: InventoryItem) {
  if (item.item_key.startsWith("bulk_")) return categories[4];
  if (["measure_cup","measure_spoons","funnel","goggles","spill_tray","chemical_gloves","labels","marker"].includes(item.item_key)) return categories[5];
  return item.kit === "essentials" ? categories[0] : item.kit === "standard" ? categories[1] : item.kit === "deep" ? categories[2] : categories[3];
}
function standard(item: InventoryItem) {
  if (item.item_key === "bulk_alcohol") return "Any container size · restock at 25%";
  return `Standard: ${item.target} ${item.unit}${item.restock_at == null ? "" : ` · restock at ${item.restock_at}`}`;
}
const primary = "rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
export function SimpleInventoryPanel({ data, tab, manager, refresh }: { data: InventoryData; tab: SimpleInventoryTab; manager: boolean; refresh: () => Promise<void> }) {
  const [choices,setChoices] = useState<Record<string,Choice>>({});
  const [id,setId] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const catalog = data.items.filter(i => i.stock_state !== "dirty");
  const isEquipment = tab === "Equipment";
  const list = tab === "Catalog" ? catalog : catalog.filter(i => i.stock_state !== "aggregate" && equipmentKeys.has(i.item_key) === isEquipment);
  const selected = Object.fromEntries(Object.entries(choices).filter(([key]) => list.some(i => i.item_key === key)));
  const requested = Object.entries(selected).filter(([,value]) => value !== "good");
  const name = (key:string) => data.items.find(i => i.item_key === key)?.item_name ?? key;
  const locationName = (key:string) => { const loc=data.locations.find(l => l.id === key)?.name ?? "Assigned supplies"; const kits=data.assignments.filter(k=>k.location_id===key && !k.returned_at).map(k=>k.kit_number); return kits.length===1 ? `${kits[0]} | ${loc}` : loc; };
  const requests = data.requests.filter(r => !["completed","declined","cancelled"].includes(r.status) && equipmentKeys.has(r.item_key) === isEquipment);
  const closed = data.requests.filter(r => r.checklist_only && ["completed","declined","cancelled"].includes(r.status) && equipmentKeys.has(r.item_key) === isEquipment);
  function choose(key:string,value:Choice) {
    setChoices(old => { const next = {...old}; if (next[key] === value) delete next[key]; else next[key]=value; return next; });
    setId(crypto.randomUUID()); setNotice(""); setError("");
  }
  async function send() {
    if (!Object.keys(selected).length || busy) return;
    const submission = id || crypto.randomUUID(); setId(submission); setBusy(true); setError(""); setNotice("");
    try {
      await inventoryAction("inventory_submit_supply_checklist",{p_id:submission,p_selections:selected});
      setChoices(old => Object.fromEntries(Object.entries(old).filter(([key]) => !(key in selected))));
      setId(""); setNotice("Checklist saved. Items needing attention are on the request list.");
      await refresh();
    } catch(e) { setError(e instanceof Error ? e.message : "Could not save checklist."); } finally { setBusy(false); }
  }
  async function finish(requestId:string,decision:"completed"|"declined") {
    setBusy(true);setError("");setNotice("");
    try { await inventoryAction("inventory_finish_checklist_request",{p_id:requestId,p_decision:decision}); await refresh();setNotice("Request updated."); }
    catch(e) {setError(e instanceof Error?e.message:"Could not update request.");} finally {setBusy(false);}
  }
  return <section className="space-y-4">
    <p className="text-sm text-neutral-600">{tab==="Catalog"?"Your approved StudioScrubz products and kit standards.":isEquipment?"Check equipment condition. Report missing or unsafe tools; do not use unsafe equipment.":"Select Good or Restock for the items you check. Leave anything not checked unselected."}</p>
    {tab!=="Catalog" && !manager && data.assignments.filter(k=>!k.returned_at).map(k=><p key={k.id} className="rounded-lg border p-3 font-bold">{k.kit_number} | General Essential Kit</p>)}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3">{notice}</p>}
    {tab!=="Catalog" && requests.length>0 && <section className="space-y-2 rounded-xl border bg-white p-3">
      <h2 className="font-bold">{manager?"Pending requests":"Your pending requests"} ({requests.length})</h2>
      {requests.map(r=><article key={r.id} className="border-t py-3"><strong>{name(r.item_key)}</strong><p className="text-xs text-neutral-600">{locationName(r.location_id)} · {new Date(r.created_at).toLocaleDateString()} · {r.status.replaceAll("_"," ")}</p><p className="text-sm">{r.reason}</p>
        {manager && r.checklist_only && <div className="mt-2 flex gap-2"><button type="button" disabled={busy} className={primary} onClick={()=>void finish(r.id,"completed")}>{isEquipment?"Mark resolved":"Mark replenished"}</button><button type="button" disabled={busy} className="rounded-lg border px-3 py-2 text-sm" onClick={()=>void finish(r.id,"declined")}>Decline</button></div>}
        {!r.checklist_only && <p className="text-xs">Quantity-based request. Manage in Advanced settings.</p>}
      </article>)}
    </section>}
    {categories.map(group=>{
      const rows=list.filter(i=>category(i)===group && (tab!=="Catalog" || i.stock_state!=="clean" || i.parent_key==="microfiber"));
      return rows.length>0 && <section key={group} className="rounded-xl border bg-white p-3"><h2 className="mb-2 font-bold">{group}</h2>{rows.map(item=><div className="border-t py-3" key={item.item_key}><strong className="text-sm">{item.item_name}</strong><p className="text-xs text-neutral-600">{standard(item)}</p>
      {tab!=="Catalog" && <div className="mt-2 flex flex-wrap gap-2">{(isEquipment?([["Good","good"],["Needs repair","repair"],["Missing","missing"]] as const):([["Good","good"],["Restock","restock"]] as const)).map(([label,value])=><button key={value} type="button" aria-pressed={choices[item.item_key]===value} disabled={busy} onClick={()=>choose(item.item_key,value)} className={choices[item.item_key]===value ? primary:"rounded-lg border px-4 py-2 text-sm font-semibold"}>{label}</button>)}</div>}
      </div>)}</section>;
    })}
    {tab!=="Catalog" && <section className="sticky bottom-0 space-y-2 rounded-xl border bg-white p-3 shadow"><h2 className="font-bold">{requested.length} {isEquipment?"equipment issues":"items to restock"}</h2>{requested.map(([key,value])=><p key={key} className="text-sm">{name(key)} — {value}</p>)}<button className={primary+" w-full"} type="button" disabled={busy || !Object.keys(selected).length} onClick={()=>void send()}>{busy?"Saving…":"Submit checklist"}</button></section>}
    {tab!=="Catalog" && closed.length>0 && <details className="rounded-lg border p-3"><summary className="font-semibold">Request history</summary>{closed.slice().reverse().map(r=><p key={r.id} className="border-t py-2 text-sm">{name(r.item_key)} · {locationName(r.location_id)} · {r.status}</p>)}</details>}
    {isEquipment && <p className="text-xs">This report does not replace Check Equipment before starting a job. Registered asset maintenance remains available under Advanced settings.</p>}
  </section>;
}
