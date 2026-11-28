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
type Props={data:InventoryData;manager:boolean;master:boolean;busy:boolean;act:(name:string,args:Record<string,unknown>)=>Promise<void>};
function latestFormulas(data:InventoryData) {
  return data.formulas.filter(f=>!data.formulas.some(n=>n.name===f.name && n.version>f.version));
}
function product(data:InventoryData,f:ChemicalFormula) {
  return f.product_name?.trim() || data.items.find(i=>i.item_key===formulaProductKeys[f.name])?.item_name || "";
}
export function ChemicalLibrary({data,manager,master,busy,act}:Props) {
  const visible=latestFormulas(data).filter(f=>manager || f.status==="released");
  return <section className="space-y-3">
    {visible.map(f=><article key={f.id} className="rounded-xl border bg-white p-4 space-y-3">
      <h2 className="font-bold">{f.name}</h2>
      <p className={f.status==="released"?"text-sm font-semibold text-green-800":"text-sm font-semibold text-amber-800"}>{f.status==="released"?"Approved for Use":f.status==="conflict"?"Safety Conflict - Do Not Use":"Pending Safety Verification - Do Not Use"}</p>
      {master && f.status==="unverified" ? <form className="space-y-3" onSubmit={e=>{
        e.preventDefault();
        const fields=new FormData(e.currentTarget);
        void act("inventory_revise_formula",{p_id:f.id,p_details:{
          manufacturer:f.manufacturer,sku:f.sku,label_url:f.label_url,sds_url:f.sds_url,
          manufacturer_instructions:f.manufacturer_instructions,ppe:f.ppe,dwell_time:f.dwell_time,
          storage_requirements:f.storage_requirements,hazard_labeling:f.hazard_labeling,conflict_notes:f.conflict_notes,
          product_name:String(fields.get("product_name")??"").trim(),
          preparation:String(fields.get("preparation")??"").trim(),
          surface_compatibility:String(fields.get("surface_compatibility")??"").trim(),status:"unverified"
        }});
      }}>
        <label className="block text-sm font-semibold">Exact Product Name<input className="mt-1 w-full rounded-lg border p-2" name="product_name" defaultValue={product(data,f)} required /></label>
        <label className="block text-sm font-semibold">Preparation Instructions<textarea className="mt-1 w-full rounded-lg border p-2" name="preparation" defaultValue={f.preparation} required /></label>
        <label className="block text-sm font-semibold">Surface Compatibility<textarea className="mt-1 w-full rounded-lg border p-2" name="surface_compatibility" defaultValue={f.surface_compatibility??""} /></label>
        <button disabled={busy} className="rounded-lg bg-[#143d1a] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Save Draft</button>
      </form>:<>
        <div><h3 className="text-xs font-semibold text-neutral-600">Exact Product Name</h3><p className="text-sm">{product(data,f)||"Not recorded"}</p></div>
        <div><h3 className="text-xs font-semibold text-neutral-600">Preparation Instructions</h3><p className="text-sm whitespace-pre-wrap">{f.status==="released"?f.preparation:"Pending safety verification."}</p></div>
        <div><h3 className="text-xs font-semibold text-neutral-600">Surface Compatibility</h3><p className="text-sm whitespace-pre-wrap">{f.status==="released"?(f.surface_compatibility || "Not recorded - confirm before use"):"Pending safety verification."}</p></div>
      </>}
    </article>)}
    {!visible.length && <p>No approved preparation instructions are available.</p>}
  </section>;
}
export function ChemicalSafetyVerification({data,master,busy,act}:Props) {
  if(!master) return <p>Master Admin access required.</p>;
  return <section className="space-y-3"><p className="text-sm">Verify the actual product label and SDS before releasing formulas to employees.</p>{latestFormulas(data).map(f=><article key={f.id} className="rounded-lg border p-3"><h3 className="font-semibold">{f.name}</h3><p className="text-xs text-neutral-600">Current record version: {f.version}</p><ChemicalFormulaReview formula={{...f,product_name:product(data,f)||null}} busy={busy} act={act}/></article>)}</section>;
}
