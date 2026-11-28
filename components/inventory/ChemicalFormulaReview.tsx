"use client";
import type { ChemicalFormula } from "@/lib/services/inventory";
const fields = [
  ["manufacturer", "Actual manufacturer"], ["product_name", "Exact product name"], ["sku", "Exact SKU"],
  ["label_url", "Original product label HTTPS reference"], ["sds_url", "Safety Data Sheet HTTPS reference"],
  ["manufacturer_instructions", "Verified manufacturer dilution instructions"], ["preparation", "Preparation instruction for this version"],
  ["ppe", "Required PPE"], ["surface_compatibility", "Surface compatibility"], ["dwell_time", "Contact / dwell time"],
  ["storage_requirements", "Storage requirements"], ["hazard_labeling", "Applicable hazard labeling"], ["conflict_notes", "Unresolved conflict (blocks release)"],
] as const;
export function ChemicalFormulaReview({ formula, busy, act }: { formula: ChemicalFormula; busy: boolean; act: (name: string, args: Record<string, unknown>) => Promise<void> }) {
  return <details className="mt-3"><summary className="cursor-pointer font-semibold">Review documents and create a revised version</summary>
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); const details = Object.fromEntries(fields.map(([key]) => [key, form.get(key)])); void act("inventory_revise_formula", { p_id: formula.id, p_details: { ...details, status: form.get("status") } }); }}>
      <p className="text-sm sm:col-span-2">Review the actual product documents. Any conflict must be corrected before release. Saving creates a new version; prior preparation text remains in history.</p>
      {fields.map(([key, label]) => <label key={key} className="text-sm">{label}<textarea className="mt-1 w-full rounded-lg border p-2" name={key} required={key !== "conflict_notes"} defaultValue={formula[key] ?? ""} /></label>)}
      <label className="text-sm">Verification decision<select className="mt-1 w-full rounded-lg border p-2" name="status"><option value="unverified">Unverified — management review only</option><option value="conflict">Conflict — management review only</option><option value="released">Verified — release to employees</option></select></label>
      <label className="text-sm"><input type="checkbox" required className="mr-2" />I reviewed the supplied evidence and am recording the actual verification decision.</label>
      <button disabled={busy} className="rounded-lg bg-[#143d1a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Save reviewed version</button>
    </form>
  </details>;
}
