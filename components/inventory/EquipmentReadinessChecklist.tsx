"use client";
import { useState } from "react";
import { inventoryAction } from "@/lib/services/inventory";
import { confirmEquipmentResponsibility } from "@/lib/services/equipmentAccountability";
type Requirement = { key: string; name: string; minimum: number; target: number; threshold: number | null; unit: string; version: string };
type Result = { key: string; status: string; quantity: number; notes: string };
export function EquipmentReadinessChecklist({ jobId, disabled = false, onConfirmed }: { jobId: string; disabled?: boolean; onConfirmed?: () => void }) {
  const [requirements, setRequirements] = useState<Requirement[] | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function load() {
    setBusy(true); setError(null);
    try { await inventoryAction("inventory_begin_preparation", { p_job: jobId }); const rows = await inventoryAction<Requirement[]>("inventory_job_requirements", { p_job: jobId }); setRequirements(rows); setResults(rows.map(row => ({ key: row.key, status: "", quantity: 0, notes: "" }))); setKey(crypto.randomUUID()); }
    catch (e) { setError(e instanceof Error ? e.message : "Checklist could not be loaded"); } finally { setBusy(false); }
  }
  function change(index: number, patch: Partial<Result>) { setResults(previous => previous.map((row, i) => i === index ? { ...row, ...patch } : row)); setKey(crypto.randomUUID()); }
  async function submit() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const ready = await inventoryAction<boolean>("inventory_submit_inspection", { p_id: key, p_job: jobId, p_requirements: requirements, p_results: results });
      if (ready) { await confirmEquipmentResponsibility(jobId); setNotice("Inspection saved. Equipment readiness confirmed."); onConfirmed?.(); }
      else { setNotice("Inspection saved with exceptions. Resolve missing supplies or unsafe equipment before readiness can be approved."); setKey(crypto.randomUUID()); }
    } catch (e) { setError(e instanceof Error ? e.message : "Inspection failed"); } finally { setBusy(false); }
  }
  return <section className="mt-3 space-y-3 rounded-lg border bg-white p-3">
    <button type="button" disabled={disabled || busy} onClick={() => void load()} className="rounded-lg bg-[#143d1a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "Loading…" : "Check Equipment — begin paid preparation"}</button>
    {requirements && <button type="button" disabled={disabled || busy} onClick={() => { setBusy(true); void inventoryAction("inventory_end_preparation", { p_job: jobId }).then(() => { setRequirements(null); setNotice("Paid preparation ended. Time is recorded in the existing payroll ledger."); }).catch(e => setError(e instanceof Error ? e.message : "Preparation could not be ended")).finally(() => setBusy(false)); }} className="ml-2 rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50">End preparation without starting job</button>}
    {requirements && <><p className="text-xs">Clock in for paid preparation first. Every listed item is mandatory. Low stock prompts replenishment; sufficient safe supplies may still pass.</p>{requirements.map((r, index) => <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2" key={r.key}>
      <p className="text-sm font-semibold sm:col-span-2">{r.name} <span className="text-xs font-normal">· minimum {r.minimum} {r.unit} · version {r.version}</span></p>
      <label className="text-xs">Inspection result<select className="mt-1 w-full rounded border p-2 text-sm" value={results[index].status} onChange={e => change(index, { status: e.target.value })}><option value="">Select result</option><option value="checked">Present, safe and sufficient</option><option value="missing">Missing</option><option value="insufficient">Insufficient supplies</option><option value="damaged">Damaged</option><option value="defective">Defective / unsafe</option></select></label>
      <label className="text-xs">{r.unit === "confirmation" ? "Enter 1 to confirm" : `Available quantity (${r.unit})`}<input className="mt-1 w-full rounded border p-2 text-sm" type="number" min="0" step="0.001" value={results[index].quantity} onChange={e => change(index, { quantity: Number(e.target.value) })} /></label>
      {r.threshold != null && results[index].quantity <= r.threshold && <p className="text-xs text-amber-800 sm:col-span-2">At restock threshold. Recommended replenishment: {Math.max(0, r.target - results[index].quantity)} {r.unit}. Submit a restocking request from Inventory &amp; Equipment.</p>}
      <label className="text-xs sm:col-span-2">Exception / notes<textarea className="mt-1 w-full rounded border p-2 text-sm" value={results[index].notes} onChange={e => change(index, { notes: e.target.value })} /></label>
    </div>)}<button type="button" disabled={busy || disabled || results.some(r => !r.status || (r.status !== "checked" && !r.notes.trim()))} onClick={() => void submit()} className="rounded-lg bg-[#143d1a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Save inspection and verify readiness</button></>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
