"use client";

import type { EstimateResult, PostConstructionCalculatorInput } from "@/types/estimate";
import { useAuth } from "@/components/auth/AuthProvider";

export function PostConstructionBidSummary({result,manualPrice,setManualPrice,profitabilityMinimum,saving,save,editing}:{result:EstimateResult;manualPrice:number|null;setManualPrice:(value:number|null)=>void;profitabilityMinimum?:number|null;saving:boolean;save:()=>Promise<void>;editing:boolean}){
  const { profile } = useAuth();
  if(profile?.role==="Sales")return <aside className="sticky top-6 rounded-2xl bg-[#143d1a] p-6 text-white"><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#d4af37]">Customer pricing</p><h2 className="mt-2 text-xl font-extrabold">Post-Construction Estimate</h2><label className="mt-5 block text-xs font-bold text-white/70">Manual / Custom Estimate Amount<input aria-label="Manual or custom estimate amount" type="number" min="0" step="0.01" value={manualPrice??""} placeholder={String(result.calculatedFinalPrice??result.finalPrice)} onChange={event=>setManualPrice(event.target.value===""?null:Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg bg-white px-3 text-sm font-bold text-[#143d1a]"/></label><p className="mt-5 text-xs font-bold uppercase tracking-[.12em] text-white/55">Final Price</p><p className="mt-1 text-4xl font-extrabold text-[#d4af37]">{currency(result.finalPrice)}</p><button type="button" disabled={saving} onClick={()=>void save()} className="mt-5 w-full rounded-lg bg-[#d4af37] px-5 py-3 text-sm font-extrabold text-[#143d1a] disabled:opacity-60">{saving?"Saving…":editing?"Update Estimate":"Save Estimate"}</button></aside>;
  const breakdown=result.postConstructionBreakdown;
  const input=result.calculatorInput as PostConstructionCalculatorInput;
  if(!breakdown)return null;
  const recommendedBid=result.calculatedFinalPrice??result.finalPrice;
  const finalAmount=result.finalPrice;
  const expenses=input.projectExpenses;
  // Match the authoritative unified project quote: these expenses are already
  // included in its cost basis, not additional billable line items.
  const additionalProjectCosts=(expenses?.equipmentRentalCost??0)+(expenses?.travelLogisticsCost??0)
    +(expenses?.supervisionAdminCost??0)+(expenses?.contingencyCost??0);
  const jobCost=result.laborCost+result.supplyCost+additionalProjectCosts;
  const projectedProfit=finalAmount-jobCost;
  const projectedMargin=finalAmount>0?projectedProfit/finalAmount*100:0;
  const addons=result.adjustments.filter(item=>item.catalogAddonId);
  return <aside className="sticky top-6 overflow-hidden rounded-2xl border border-[#143d1a]/10 bg-[#143d1a] text-white shadow-[0_18px_45px_rgba(20,61,26,.2)]">
    <div className="border-b border-white/10 p-6"><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#d4af37]">Recommended Bid</p><p className="mt-1 text-4xl font-extrabold text-[#d4af37]">{currency(recommendedBid)}</p>{manualPrice!==null&&<><p className="mt-4 text-[10px] font-extrabold uppercase tracking-[.18em] text-white/55">Final Estimate Amount</p><p className="mt-1 text-3xl font-extrabold">{currency(finalAmount)}</p></>}</div>
    <div className="grid grid-cols-2 gap-4 border-b border-white/10 p-6 text-sm"><Metric label="Estimated Job Cost" value={currency(jobCost)}/><Metric label="Projected Profit" value={currency(projectedProfit)}/><Metric label="Projected Margin" value={`${round(projectedMargin)}%`}/><Metric label="Workday" value={`${input.workdayHours} hrs`}/></div>
    <Section title="Production Plan"><Row label="Total Estimated Labor Hours" value={`${breakdown.totalLaborHours} hrs`}/><Row label="Recommended Crew Size" value={`${breakdown.recommendedCrewSize} people`}/><Row label="Estimated Project Days" value={`${breakdown.estimatedProjectDays} days`}/></Section>
    <Section title="Cost Breakdown"><Row label="Labor Cost" value={currency(result.laborCost)}/><Row label="Supply Cost" value={currency(result.supplyCost)}/>{additionalProjectCosts>0&&<Row label="Additional Project Costs" value={currency(additionalProjectCosts)}/>}<Row label="Estimated Job Cost" value={currency(jobCost)}/></Section>
    {addons.length>0&&<Section title="Add-Ons">{addons.map(item=><Row key={item.catalogAddonId} label={item.label} value={`+${currency(item.amount)}`}/>)}</Section>}
    <Section title="Labor Breakdown"><Row label="Base square-footage production" value={`${breakdown.baseProductionHours} hrs`}/>{breakdown.adjustments.filter(item=>item.laborHours!==0).map(item=><Row key={item.label} label={item.label} value={`+${item.laborHours} hrs`}/>)}</Section>
    <div className="border-t border-white/10 px-6 py-4">
      <div className="mb-4 rounded-lg border border-white/15 bg-white/5 p-3">
        <p className="text-xs font-bold uppercase tracking-wider text-white/65">Recommended minimum (includes commission, fees and overhead)</p>
        <p className="mt-1 text-xl font-extrabold text-[#d4af37]">{profitabilityMinimum == null ? "Unavailable — verify job and travel costs" : currency(profitabilityMinimum)}</p>
        <button type="button" disabled={profitabilityMinimum == null || !Number.isFinite(profitabilityMinimum) || profitabilityMinimum <= 0 || saving}
          onClick={()=>{ if(profitabilityMinimum != null && Number.isFinite(profitabilityMinimum) && profitabilityMinimum > 0) setManualPrice(profitabilityMinimum); }}
          className="mt-3 w-full rounded-lg border border-[#d4af37] px-4 py-2 text-sm font-extrabold text-[#d4af37] disabled:cursor-not-allowed disabled:opacity-45"
        >Use Profitability Minimum as Estimate Amount</button>
        <p className="mt-2 text-xs text-white/65">This applies the internal profitability recommendation as an editable customer price. You can still edit it manually or restore the original calculated bid. It does not save until you select Save Estimate.</p>
      </div>
      <label className="text-xs font-bold text-white/70">Manual / Custom Estimate Amount<input aria-label="Manual or custom estimate amount" type="number" min="0" step="0.01" value={manualPrice??""} placeholder={String(recommendedBid)} onChange={event=>setManualPrice(event.target.value===""?null:Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-white/20 bg-white px-3 text-sm font-bold text-[#143d1a]"/></label><button type="button" disabled={manualPrice===null} onClick={()=>setManualPrice(null)} className="mt-2 text-xs font-bold text-[#d4af37] disabled:opacity-40">Use Recommended Bid</button></div>
    <div className="bg-[#0d2b12] p-6"><p className="text-xs font-bold uppercase tracking-[.12em] text-white/55">Final Estimate Amount</p><p className="mt-1 text-4xl font-extrabold text-[#d4af37]">{currency(finalAmount)}</p><button type="button" disabled={saving} onClick={()=>void save()} className="mt-5 w-full rounded-lg bg-[#d4af37] px-5 py-3 text-sm font-extrabold text-[#143d1a] hover:bg-[#e1c056] disabled:opacity-60">{saving?"Saving…":editing?"Update Estimate":"Save Estimate"}</button></div>
  </aside>;
}

function Section({title,children}:{title:string;children:React.ReactNode}){return <div className="border-b border-white/10 px-6 py-5"><h3 className="text-xs font-extrabold uppercase tracking-[.14em] text-[#d4af37]">{title}</h3><dl className="mt-3 space-y-2 text-sm">{children}</dl></div>}
function Row({label,value}:{label:string;value:string}){return <div className="flex justify-between gap-4"><dt className="text-white/65">{label}</dt><dd className="text-right font-bold">{value}</dd></div>}
function Metric({label,value}:{label:string;value:string}){return <div><p className="text-xs text-white/55">{label}</p><p className="mt-1 font-extrabold">{value}</p></div>}
function currency(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value)}
function round(value:number){return Math.round(value*10)/10}
