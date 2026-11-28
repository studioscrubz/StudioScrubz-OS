"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { EquipmentMaintenancePanel } from "@/components/inventory/EquipmentMaintenancePanel";
import { ChemicalLibrary, ChemicalSafetyVerification } from "@/components/inventory/ChemicalLibrary";
import { InventoryTrainingPanel } from "@/components/inventory/InventoryTrainingPanel";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { SimpleInventoryPanel, type SimpleInventoryTab } from "@/components/inventory/SimpleInventoryPanel";
import { KitStandardEditor } from "@/components/inventory/KitStandardEditor";
import { inventoryAction, loadInventory, stockThreshold, type InventoryData } from "@/lib/services/inventory";

const sections = ["Chemical Safety Verification", "Inventory Dashboard", "Master Inventory", "Kit Standards", "Assigned Kits", "Equipment Inspections", "Restocking Requests", "Chemical Formula Library", "Equipment Maintenance", "Inventory Transactions"] as const;
const primarySections = [
  ["Supplies", "Master Inventory"],
  ["Cleaning Kits", "Assigned Kits"],
  ["Requests", "Restocking Requests"],
  ["Equipment", "Equipment Maintenance"],
] as const;
const advancedSections = ["Chemical Safety Verification", "Kit Standards", "Equipment Inspections", "Chemical Formula Library", "Inventory Transactions"] as const;
const control = "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900";
const button = "rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm font-semibold">{label}{children}</label>; }

export function InventoryPage() {
  const { profile } = useAuth();
  const allowed = Boolean(profile?.is_active && ["Master Admin", "Manager", "Crew Lead", "Scrub Technician"].includes(profile.role));
  const manager = Boolean(profile && ["Master Admin", "Manager"].includes(profile.role));
  const [assignees,setAssignees] = useState<{id:string;name:string}[]>([]);
  const [assigning,setAssigning] = useState<string|null>(null);
  const [section, setSection] = useState<typeof sections[number]>("Inventory Dashboard");
  const [simpleTab,setSimpleTab] = useState<SimpleInventoryTab>("Catalog");
  const [advanced,setAdvanced] = useState(false);
  const [movementKey, setMovementKey] = useState(() => crypto.randomUUID());
  const [movementType, setMovementType] = useState("purchase");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [data, setData] = useState<InventoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (profile?.role === "Master Admin" && profile.is_active) void inventoryAction<{id:string;name:string}[]>("inventory_kit_assignees", {}).then(setAssignees).catch(e=>setError(e instanceof Error?e.message:"Unable to load technicians")); }, [profile?.role,profile?.is_active]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState("");
  const [itemKey, setItemKey] = useState("");
  const [observations, setObservations] = useState<Record<string, number>>({});
  const refresh = useCallback(async () => { setData(await loadInventory()); }, []);
  useOperationalRealtime(allowed ? ["technician_restock_requests", "technician_equipment_maintenance", "technician_inventory_stock", "technician_equipment_assets", "technician_kit_assignments", "job_inventory_inspections"] : [], refresh);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void loadInventory().then(result => { if (active) setData(result); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Inventory could not be loaded."); });
    return () => { active = false; };
  }, [allowed]);
  async function act(name: string, args: Record<string, unknown>) {
    setBusy(true); setError(null); setNotice(null);
    try { await inventoryAction(name, args); if (name === "inventory_move") setMovementKey(crypto.randomUUID()); await refresh(); setNotice("Saved."); } catch (e) { setError(e instanceof Error ? e.message : "Action failed."); } finally { setBusy(false); }
  }
  if (!allowed) return <p role="alert">You do not have inventory access.</p>;
  if (!data) return <p role={error ? "alert" : "status"}>{error || "Loading inventory..."}</p>;
  const item = data.items.find(row => row.item_key === itemKey);
  const selectedStock = data.stock.find(row => row.location_id === location && row.item_key === itemKey);
  const threshold = item ? stockThreshold(item, selectedStock) : null;
  const current = selectedStock?.quantity ?? 0;
  const observed = observations[`${location}:${itemKey}`] ?? current;
  const leafItems = data.items.filter(row => row.stock_state !== "aggregate");
  const openRequests = data.requests.filter(row => !row.checklist_only && !["completed", "declined", "cancelled"].includes(row.status));
  const lowStock = data.locations.flatMap(loc => leafItems.filter(i => {
    const stock = data.stock.find(s => s.location_id === loc.id && s.item_key === i.item_key);
    const limits = stockThreshold(i, stock);
    // Never imply that every optional specialty item is assigned to every location.
    return stock && limits?.threshold != null && stock.quantity <= limits.threshold;
  }).map(i => ({ loc, item: i, stock: data.stock.find(s => s.location_id === loc.id && s.item_key === i.item_key)! })));
  const itemName = (key: string) => data.items.find(i => i.item_key === key)?.item_name ?? key;
  const locationName = (id: string) => data.locations.find(l => l.id === id)?.name ?? id;
  const selectLocation = <select required className={control} value={location} onChange={e => setLocation(e.target.value)}><option value="">Select location</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>;
  const selectItem = <select required className={control} value={itemKey} onChange={e => setItemKey(e.target.value)}><option value="">Select item</option>{leafItems.map(i => <option key={i.item_key} value={i.item_key}>{i.item_name} ({i.unit})</option>)}</select>;
  function submit(event: FormEvent<HTMLFormElement>, name: string, build: (form: FormData) => Record<string, unknown>) { event.preventDefault(); void act(name, build(new FormData(event.currentTarget))); }
  return <main className="space-y-5 text-[#143d1a]">
    <header><h1 className="text-2xl font-extrabold">Inventory &amp; Equipment</h1><p className="mt-1 text-sm text-neutral-600">Manage your standard products, cleaning kits, supply requests and equipment. Complete inspections and preparation during paid working time.</p></header>
    <nav aria-label="Daily operations" className="flex flex-wrap gap-2">
      {(["Catalog","Restock Checklist","Equipment"] as const).map(tab=><button key={tab} type="button" onClick={()=>{setAdvanced(false);setSimpleTab(tab);}} aria-current={!advanced && simpleTab===tab?"page":undefined} className={!advanced && simpleTab===tab?button:"rounded-lg border px-3 py-2 text-sm font-semibold"}>{tab}</button>)}
      <button type="button" aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)} className="rounded-lg border px-3 py-2 text-sm font-semibold">Advanced settings</button>
    </nav>
    {!advanced && <SimpleInventoryPanel key={simpleTab} data={data} tab={simpleTab} manager={manager} refresh={refresh}/>}
    {advanced && <>
    <nav aria-label="Inventory sections" className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setSection("Inventory Dashboard")} aria-current={section === "Inventory Dashboard" ? "page" : undefined} className={section === "Inventory Dashboard" ? button : "rounded-lg border px-3 py-2 text-sm font-semibold"}>Overview</button>
      {primarySections.map(([label, target]) => <button type="button" key={target} onClick={() => setSection(target)} aria-current={section === target ? "page" : undefined} className={section === target ? button : "rounded-lg border px-3 py-2 text-sm font-semibold"}>{label}</button>)}
      <button type="button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(v => !v)} className="rounded-lg border px-3 py-2 text-sm font-semibold">More</button>
      {showAdvanced && <div className="flex w-full flex-wrap gap-2">{advancedSections.filter(label => label === "Chemical Safety Verification" ? profile?.role === "Master Admin" : manager || label === "Chemical Formula Library" || label === "Equipment Inspections").map(label => <button type="button" key={label} onClick={() => setSection(label)} aria-current={section === label ? "page" : undefined} className={section === label ? button : "rounded-lg border px-3 py-2 text-sm font-semibold"}>{label}</button>)}</div>}
    </nav>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}{notice && <p role="status">{notice}</p>}
    {section === "Inventory Dashboard" && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{([
        ["Supplies to restock", lowStock.length, "Master Inventory"],
        ["Assigned kits", data.assignments.filter(k => !k.returned_at).length, "Assigned Kits"],
        ["Pending requests", openRequests.length, "Restocking Requests"],
        ["Equipment issues", data.assets.filter(a => ["out_of_service", "missing", "needs_maintenance"].includes(a.condition)).length, "Equipment Maintenance"],
      ] as [string, number, typeof sections[number]][]).map(([label, count, target]) => <button type="button" className="rounded-xl border bg-white p-4 text-left" key={label} onClick={() => setSection(target)}><span className="block text-xs">{label}</span><strong className="text-2xl">{count}</strong></button>)}</div>
      <h2 className="font-bold">Recorded low stock</h2>{lowStock.length ? lowStock.map(({ loc, item, stock }) => <p key={`${loc.id}:${item.item_key}`} className="rounded-lg border border-amber-300 p-3">{loc.name}: {item.item_name} - {stock.quantity} {item.unit}</p>) : <p>No recorded stock is at its restocking threshold.</p>}
    </>}
    {section === "Master Inventory" && <>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Location">{selectLocation}</Field><Field label="Inventory item">{selectItem}</Field></div>
      {item && <p>Available: {current} {item.unit}. {threshold ? `Target: ${threshold.target}. Restock at: ${threshold.threshold ?? "not set"}.` : "Record actual container capacity to calculate replenishment."}</p>}
      {manager && <form className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2" onSubmit={e => submit(e, "inventory_move", f => ({ p_key: f.get("key"), p_item: itemKey, p_quantity: Number(f.get("quantity")), p_type: f.get("type"), p_reason: f.get("reason"), p_source: f.get("source") || null, p_destination: f.get("destination") || null, p_request: f.get("request") || null }))}>
        <h2 className="font-bold sm:col-span-2">Record stock movement</h2>
        <input type="hidden" name="key" value={movementKey} />
        <Field label="What are you doing?"><select name="type" value={movementType} onChange={e => setMovementType(e.target.value)} className={control}>{["purchase", "issue", "consumption", "return", "transfer", "adjustment", "laundry_return", "damage", "loss", ...(profile?.role === "Master Admin" ? ["disposal"] : [])].map(t => <option key={t}>{t}</option>)}</select></Field>
        {(movementType === "purchase" ? ["destination"] : ["consumption", "loss", "damage", "disposal"].includes(movementType) ? ["source"] : ["source", "destination"]).map(name => <Field key={name} label={name === "source" ? "Source (leave empty for purchase)" : "Destination (leave empty for consumption/loss)"}><select name={name} className={control}><option value="">None</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>)}
        <Field label={`Quantity (${item?.unit ?? "select an item above"})`}><input className={control} name="quantity" type="number" required min="0.001" step="0.001" /></Field>
        <Field label="Approved request (optional)"><select name="request" className={control}><option value="">None</option>{openRequests.filter(r => ["approved", "ready", "issued"].includes(r.status)).map(r => <option key={r.id} value={r.id}>{locationName(r.location_id)} - {itemName(r.item_key)} ({(r.requested_quantity ?? 0) - r.issued_quantity} remaining)</option>)}</select></Field>
        <Field label="Reason"><input className={control} name="reason" required /></Field><button disabled={busy || !item} className={button}>Record movement</button>
      </form>}
      {manager && item && <form className="flex flex-wrap items-end gap-3" onSubmit={e => submit(e, "inventory_set_capacity", f => ({ p_location: location, p_item: itemKey, p_capacity: Number(f.get("capacity")) }))}><Field label="Actual container capacity"><input className={control} name="capacity" required type="number" min="0.001" step="0.001" /></Field><button className={button} disabled={busy || !location}>Save capacity</button></form>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Item</th><th>Unit</th><th>Target</th><th>Restock at</th></tr></thead><tbody>{data.items.filter(i => !i.parent_key).map(i => <tr className="border-t" key={i.item_key}><td className="p-2">{i.item_name}</td><td>{i.unit}</td><td>{i.item_key === "bulk_alcohol" ? "Actual capacity" : i.target}</td><td>{i.item_key === "bulk_alcohol" ? "25% remaining" : i.restock_at ?? "-"}</td></tr>)}</tbody></table></div>
    </>}
    {section === "Kit Standards" && <div className="space-y-3"><p>General Essential Kit: everyday essentials and standard supplies. Deep cleaning, move-in/out and specialty supplies are separate add-ons for job scope, not separate physical kits.</p>{data.items.filter(i => i.stock_state !== "dirty").map(i => <div className="rounded-lg border bg-white p-3" key={i.item_key}><strong>{i.item_name}</strong><p className="text-sm">{i.kit} | {i.target} {i.unit} | threshold {i.restock_at ?? "not set"} | version {i.standard_version}</p>{profile?.role === "Master Admin" && i.stock_state !== "aggregate" && <form className="mt-2 grid gap-2 sm:grid-cols-4" onSubmit={e => submit(e, "inventory_set_standard", f => ({ p_item: i.item_key, p_target: Number(f.get("target")), p_threshold: f.get("threshold") === "" ? null : Number(f.get("threshold")), p_version: f.get("version") }))}><Field label="Target"><input name="target" className={control} type="number" min="0.001" step="0.001" required defaultValue={i.target} /></Field><Field label="Threshold"><input name="threshold" className={control} type="number" min="0" step="0.001" defaultValue={i.restock_at ?? ""} /></Field><Field label="New version"><input name="version" className={control} required placeholder="e.g. 1.1" /></Field><button disabled={busy} className={button}>Save standard</button></form>}</div>)}</div>}
    {section === "Assigned Kits" && <>
      {profile?.role === "Master Admin" && <form className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2" onSubmit={e => submit(e, "inventory_assign_kit", f => ({ p_number: f.get("number"), p_kit: "standard", p_location: location }))}><Field label="Kit identification"><input className={control} name="number" required defaultValue={`KIT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`} /></Field><p className="text-sm font-semibold">General Essential Kit</p><Field label="Storage location"><select className={control} value={location} onChange={e=>setLocation(e.target.value)} required><option value="">Select storage location</option>{data.locations.filter(l=>l.location_type==="central").map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field><button disabled={busy || !data.locations.some(l=>l.id===location && l.location_type==="central")} className={button}>Create kit</button></form>}
      {Array.from(new Set(data.assignments.map(k=>k.home_location_id || null))).map(home=>({home,kits:data.assignments.filter(k=>(k.home_location_id || null)===home).sort((a,b)=>a.kit_number.localeCompare(b.kit_number))})).map(group=><details key={group.home || "unrecorded"} className="rounded-xl border p-3"><summary className="cursor-pointer text-lg font-extrabold">{group.home ? (data.locations.find(l=>l.id===group.home)?.name || "Home inventory") : "Home location not recorded"} | {group.kits.length} kits</summary><div className="mt-3 space-y-3">
      {group.kits.map(k => { const loc=data.locations.find(l=>l.id===k.location_id); const available=!!k.returned_at || loc?.location_type==="central"; const own=!!profile?.employee_id && loc?.employee_id===profile.employee_id; return <article className="rounded-xl border p-4 space-y-2" key={k.id}><h2 className="text-xl font-extrabold">{k.kit_number}</h2><p className="text-sm">General Essential Kit</p><p className="text-sm">{available?"Available for assignment":`Assigned to: ${locationName(k.location_id)}`}</p><p>{available?"Available":k.return_required?"Return Required":k.acknowledged_at?"Assigned":"Awaiting Acknowledgment"}</p>{available && profile?.role==="Master Admin" && <><button type="button" className={button} onClick={()=>setAssigning(v=>v===k.id?null:k.id)}>Assign Kit</button>{assigning===k.id && <form className="space-y-2" onSubmit={e=>submit(e,"inventory_issue_kit",f=>({p_id:k.id,p_employee:f.get("employee")}))}><Field label="Assign to technician"><select className={control} name="employee" required><option value="">Select technician</option>{assignees.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><button disabled={busy || !assignees.length} className={button}>Confirm assignment</button>{!assignees.length && <p className="text-sm">No eligible active technicians with system access.</p>}</form>}</>}{!available && !k.acknowledged_at && !k.return_required && own && <><p className="text-sm">I acknowledge receipt and responsibility for this kit and its contents.</p><button type="button" disabled={busy} className={button} onClick={()=>void act("inventory_acknowledge_kit",{p_id:k.id})}>Acknowledge kit received</button></>}{!available && k.return_required && profile?.role==="Master Admin" && <form className="mt-2 space-y-2" onSubmit={e=>submit(e,"inventory_return_kit",f=>({p_id:k.id,p_notes:f.get("notes")}))}><Field label="Physical return / recovery notes"><input className={control} name="notes" required /></Field><button disabled={busy} className={button}>Record kit returned</button></form>}</article>; })}
      </div></details>)}
      {profile?.role === "Master Admin" && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Add central inventory location</summary><form className="mt-3 space-y-3" onSubmit={e => submit(e, "inventory_create_location", f => ({ p_name: f.get("name"), p_type: "central", p_employee: null, p_crew: null }))}><Field label="Location name"><input className={control} name="name" required /></Field><button disabled={busy} className={button}>Create location</button></form></details>}

      <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Training and acknowledgments</summary><InventoryTrainingPanel data={data} manager={manager} busy={busy} act={act} /></details>
    </>}
    {section === "Equipment Inspections" && <>
      <p>Complete Check Equipment from Jobs / Manage Job. These records retain the exact requirements and item versions used for each inspection.</p>
      {manager && <form className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2" onSubmit={e => submit(e, "inventory_set_job_scope", f => ({ p_job: f.get("job"), p_kit: f.get("kit") || null, p_specialties: f.getAll("specialty") }))}><Field label="Job ID"><input className={control} name="job" required /></Field><Field label="Job inspection profile"><select name="kit" className={control}><option value="">Preserve existing service-specific catalog</option>{data.kits.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field><fieldset className="sm:col-span-2"><legend className="font-semibold">Applicable specialty requirements</legend>{data.items.filter(i => ["shower","mold","grout","brushes","steel"].includes(i.item_key)).map(i => <label key={i.item_key} className="mr-4 inline-block text-sm"><input name="specialty" type="checkbox" value={i.item_key} className="mr-1" />{i.item_name}</label>)}</fieldset><button disabled={busy} className={button}>Save job-specific scope</button></form>}
      {data.inspections.slice().reverse().map(i => <details key={i.id} className="rounded-xl border p-4"><summary className="cursor-pointer font-bold">{new Date(i.created_at).toLocaleString()} | {i.ready ? "Ready" : "Exceptions - not ready"} | Job {i.job_id}</summary><p className="my-2 text-sm">Employee: {i.employee_id}</p><a className="underline" href={`/jobs?jobId=${i.job_id}`}>Open job</a>{i.results.map(r => <p key={r.key} className="mt-2 text-sm">{i.requirements.find(req => req.key === r.key)?.name ?? r.key}: {r.status} | {r.quantity} | {r.notes}</p>)}</details>)}
      {!data.inspections.length && <p>No inspections have been recorded.</p>}
    </>}
    {section === "Restocking Requests" && <>
      <form className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2" onSubmit={e => submit(e, "inventory_request_restock", f => ({ p_location: location, p_item: itemKey, p_current: Number(f.get("current")), p_quantity: Number(f.get("quantity")), p_reason: f.get("reason"), p_priority: f.get("priority"), p_notes: f.get("notes") || null }))}>
        <Field label="Assigned location">{selectLocation}</Field><Field label="Item">{selectItem}</Field>
        <Field label="Observed available quantity"><input className={control} name="current" type="number" min="0" step="0.001" required value={observed} onChange={e => setObservations(previous => ({ ...previous, [`${location}:${itemKey}`]: Number(e.target.value) }))} /></Field>
        <Field label="Requested quantity"><input key={`${location}:${itemKey}:${observed}:quantity`} className={control} name="quantity" type="number" min="0.001" step="0.001" required defaultValue={threshold ? Math.max(0, threshold.target - observed) : ""} /></Field>
        <Field label="Priority"><select name="priority" className={control}><option value="routine">Routine</option><option value="high">High - before next assignment</option><option value="urgent">Urgent - current assignment affected</option></select></Field>
        <Field label="Reason"><input name="reason" className={control} required /></Field><Field label="Notes"><textarea name="notes" className={control} /></Field><button className={button} disabled={busy}>Submit request</button>
      </form>
      {data.requests.filter(r => !r.checklist_only).slice().reverse().map(r => <article key={r.id} className="space-y-2 rounded-xl border bg-white p-4"><h2 className="font-bold">{itemName(r.item_key)} - {locationName(r.location_id)}</h2><p className="text-sm">{r.priority} | {r.status} | requested {r.requested_quantity}, issued {r.issued_quantity}, received {r.received_quantity}</p><p>{r.reason}</p>
        {manager && <div className="flex flex-wrap gap-2">{(r.status === "submitted" ? ["approved", "declined", "cancelled"] : r.status === "approved" ? ["awaiting_purchase", "ready"] : r.status === "awaiting_purchase" ? ["ready"] : r.status === "received" && r.received_quantity === r.requested_quantity ? ["completed"] : []).map(status => <button key={status} type="button" className={button} disabled={busy} onClick={() => void act("inventory_update_request", { p_id: r.id, p_status: status })}>{status.replaceAll("_", " ")}</button>)}</div>}
        {["issued", "received"].includes(r.status) && r.received_quantity < r.issued_quantity && <form className="flex flex-wrap items-end gap-2" onSubmit={e => submit(e, "inventory_update_request", f => ({ p_id: r.id, p_status: "received", p_received: Number(f.get("received")) }))}><Field label="Total quantity received so far"><input className={control} type="number" name="received" required min={r.received_quantity} max={r.issued_quantity} step="0.001" defaultValue={r.issued_quantity} /></Field><button className={button} disabled={busy}>Acknowledge receipt</button></form>}
      </article>)}
    </>}
    {section === "Chemical Formula Library" && <ChemicalLibrary data={data} manager={manager} master={profile?.role === "Master Admin"} busy={busy} act={act} />}
    {section === "Chemical Safety Verification" && <ChemicalSafetyVerification data={data} manager={manager} master={profile?.role === "Master Admin"} busy={busy} act={act} />}
    {section === "Inventory Transactions" && <div className="space-y-2">{data.transactions.slice().reverse().map(t => <article key={t.id} className="rounded-xl border p-3"><strong>{t.transaction_type} | {itemName(t.item_key)} | {t.quantity_delta > 0 ? "+" : ""}{t.quantity_delta}</strong><p className="text-sm">{locationName(t.location_id)} | {new Date(t.created_at).toLocaleString()}</p><p className="text-sm">{t.reason}</p><p className="break-all text-xs text-neutral-500">Movement: {t.movement_id}</p></article>)}{!data.transactions.length && <p>No stock movements have been recorded.</p>}</div>}
    {section === "Kit Standards" && profile?.role === "Master Admin" && <KitStandardEditor data={data} busy={busy} act={act} />}
    {section === "Equipment Maintenance" && <EquipmentMaintenancePanel data={data} manager={manager} master={profile?.role === "Master Admin"} busy={busy} act={act} />}
    </>}
  </main>;
}
