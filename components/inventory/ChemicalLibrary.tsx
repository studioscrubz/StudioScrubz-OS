"use client";
import { ChemicalFormulaReview } from "@/components/inventory/ChemicalFormulaReview";
import type { ChemicalFormula, InventoryData } from "@/lib/services/inventory";

export const formulaProductKeys: Record<string,string> = {
  "Zep Lemon Disinfectant":"bulk_disinfectant",
  "Dawn Glass Cleaner":"bulk_dawn",
  "Alcohol Cleaner":"bulk_alcohol",
  "Citrus Degreaser Light":"bulk_citrus",
  "Citrus Degreaser Moderate":"bulk_citrus",
  "Citrus Degreaser Heavy":"bulk_citrus",
  "Neutral Floor Cleaner Light":"bulk_floor",
  "Neutral Floor Cleaner Normal":"bulk_floor",
  "Neutral Floor Cleaner Heavy":"bulk_floor",
};
export function ChemicalLibrary({data,manager,master,busy,act}:{data:InventoryData;manager:boolean;master:boolean;busy:boolean;act:(name:string,args:Record<string,unknown>)=>Promise<void>}) {
  const latest=data.formulas.filter(f=>!data.formulas.some(n=>n.name===f.name && n.version>f.version));
  const visible=latest.filter(f=>manager || f.status==="released");
  function product(f:ChemicalFormula) {
    return f.product_name?.trim() || data.items.find(i=>i.item_key===formulaProductKeys[f.name])?.item_name || "Exact product not yet recorded";
  }
  return <section className="space-y-3">
    <p className="text-sm text-neutral-600">Use only approved preparation instructions. Independent chemical preparation requires completed safety training and authorization.</p>
    {visible.map(f=><article key={f.id} className="rounded-xl border bg-white p-4 space-y-3">
      <h2 className="font-bold">{f.name}</h2>
      <p className={f.status==="released"?"text-sm font-semibold text-green-800":"text-sm font-semibold text-amber-800"}>{f.status==="released"?"Approved for Use":f.status==="conflict"?"Safety Conflict - Do Not Use":"Pending Safety Verification - Do Not Use"}</p>
      <div><h3 className="text-xs font-semibold text-neutral-600">Exact Product Name</h3><p className="text-sm">{product(f)}</p></div>
      <div><h3 className="text-xs font-semibold text-neutral-600">Preparation Instructions</h3>{f.status==="released"?<p className="text-sm whitespace-pre-wrap">{f.preparation}</p>:<p className="text-sm">Pending safety verification.</p>}</div>
      <div><h3 className="text-xs font-semibold text-neutral-600">Surface Compatibility</h3><p className="text-sm whitespace-pre-wrap">{f.status==="released"?(f.surface_compatibility || "Not recorded - confirm before use"):"Pending safety verification."}</p></div>
      {f.status==="released" && <div className="text-xs">{f.label_url && <a className="mr-3 underline" href={f.label_url} target="_blank" rel="noreferrer">Product label</a>}{f.sds_url && <a className="underline" href={f.sds_url} target="_blank" rel="noreferrer">Safety Data Sheet</a>}</div>}
    </article>)}
    {!visible.length && <p>No approved preparation instructions are available.</p>}
    {master && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Management Settings - Safety Verification</summary><div className="mt-3 space-y-3">{latest.map(f=><article key={f.id} className="rounded-lg border p-3"><h3 className="font-semibold">{f.name}</h3><p className="text-xs text-neutral-600">Current record version: {f.version}</p><ChemicalFormulaReview formula={{...f,product_name:f.product_name || (product(f)==="Exact product not yet recorded"?null:product(f))}} busy={busy} act={act}/></article>)}</div></details>}
  </section>;
}
