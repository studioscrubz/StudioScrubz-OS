"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { calculateCommercialEstimate, calculateResidentialEstimate } from "@/lib/pricing/estimates";
import { mapWalkthroughToCalculatorInput } from "@/lib/pricing/walkthroughPricing";
import { findCatalogService, getAvailableServiceAddons } from "@/lib/services/serviceCatalog";
import type { CalculatorInput, CommercialCalculatorInput, Condition, Frequency, ResidentialCalculatorInput } from "@/types/estimate";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";
import { PhotoGallery } from "@/components/photos/PhotoGallery";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { createPhotoSignedUrls } from "@/lib/services/photoStorage";
import { getWalkthroughById } from "@/lib/services/walkthroughs";
import type { OperationalPhotoWithUrl } from "@/types/photo";
import type { WalkthroughWithRelations } from "@/types/walkthrough";
import { CatalogAddonPicker } from "@/components/serviceCatalog/CatalogAddonPicker";
import { serviceFrequencyLabel } from "@/lib/scheduling/frequency";

export function WalkthroughPricingReviewModal({ walkthrough, catalog, close, approved }: { walkthrough: WalkthroughWithRelations; catalog: ServiceCatalogBundle; close: () => void; approved: () => void }) {
  const [input, setInput] = useState<CalculatorInput>(() => mapWalkthroughToCalculatorInput(walkthrough, catalog));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPrice, setManualPrice] = useState<number | null>(walkthrough.pricing_review?.estimateResult.manualPrice ?? null);
  const result = useMemo(() => { try { return input.division === "Residential" ? calculateResidentialEstimate(input, catalog) : calculateCommercialEstimate(input, catalog); } catch { return null; } }, [catalog, input]);
  async function approve() { setBusy(true); setError(null); try { const response = await fetch("/api/walkthroughs/pricing-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ walkthroughId: walkthrough.id, calculatorInput: input, manualPrice }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || "Pricing could not be approved."); approved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Pricing could not be approved."); } finally { setBusy(false); } }
  const preliminary = walkthrough.estimate?.result.finalPrice;
  return <div className="fixed inset-0 z-[90] overflow-y-auto bg-[#07190a]/70 p-3 sm:p-6"><section role="dialog" aria-modal="true" aria-labelledby="pricing-review-title" className="mx-auto max-w-5xl rounded-2xl bg-[#f5f6f4] shadow-2xl"><header className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b bg-white px-5 py-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#9a7a17]">Internal financial review</p><h2 id="pricing-review-title" className="mt-1 text-xl font-extrabold text-[#143d1a]">Review Walkthrough Pricing</h2></div><button type="button" onClick={close} aria-label="Close pricing review" className="grid size-9 place-items-center rounded-lg border text-xl">×</button></header><div className="space-y-5 p-4 sm:p-7">
    {preliminary !== undefined && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-bold uppercase text-amber-800">Preliminary Estimate Reference</p><p className="mt-1 text-xl font-extrabold text-amber-900">{money(preliminary)}</p><p className="mt-1 text-xs text-amber-700">This historical Estimate will not be changed.</p></section>}
    <WalkthroughPricingPhotos walkthroughId={walkthrough.id} />
    <section className="rounded-2xl border bg-white p-5"><h3 className="font-extrabold text-[#143d1a]">Confirmed Calculator Inputs</h3><p className="mt-1 text-xs text-neutral-500">Walkthrough values take precedence; missing values fall back to the preliminary Estimate or active catalog defaults.</p><div className="mt-4">{input.division === "Residential" ? <ResidentialFields value={input} set={setInput} catalog={catalog} /> : <CommercialFields value={input} set={setInput} catalog={catalog} />}</div></section>
    <section className="rounded-2xl bg-[#143d1a] p-5 text-white"><p className="text-xs font-bold uppercase tracking-wider text-[#d4af37]">Reviewed Price</p>{result&&<><p className="mt-2 text-sm text-white/65">Calculated reference: {money(result.finalPrice)}</p><label className="mt-4 block text-xs font-bold text-white/75">Approved Walkthrough Price<input aria-label="Approved walkthrough price" type="number" min="0" step="0.01" value={manualPrice ?? ""} placeholder={String(result.finalPrice)} onChange={event=>setManualPrice(event.target.value===""?null:Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-white/20 bg-white px-3 text-sm font-bold text-[#143d1a]" /></label><button type="button" disabled={manualPrice===null} onClick={()=>setManualPrice(null)} className="mt-2 text-xs font-bold text-[#d4af37] disabled:opacity-40">Use Calculated Price</button></>}<p className="mt-3 text-3xl font-extrabold">{result ? money(manualPrice ?? result.finalPrice) : "Complete required pricing inputs"}</p><p className="mt-2 text-xs text-white/70">The server reloads the active catalog, recalculates the reference, and preserves this explicit approved amount. The original Estimate is not changed.</p>{error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}<div className="mt-5 flex justify-end gap-3"><button type="button" onClick={close} className="rounded-lg border border-white/30 px-4 py-2.5 font-bold">Cancel</button><button type="button" disabled={busy || !result} onClick={() => void approve()} className="rounded-lg bg-[#d4af37] px-5 py-2.5 font-extrabold text-[#143d1a] disabled:opacity-50">{busy ? "Approving…" : "Approve Pricing"}</button></div></section>
  </div></section></div>;
}

const WALKTHROUGH_REALTIME_TABLES = ["walkthroughs"] as const;

function WalkthroughPricingPhotos({ walkthroughId }: { walkthroughId: string }) {
  const [photos, setPhotos] = useState<OperationalPhotoWithUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const current = await getWalkthroughById(walkthroughId);
    const signed = await createPhotoSignedUrls(current.photos);
    setPhotos(signed);
    setError(null);
  }, [walkthroughId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void refresh()
        .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Walkthrough photos could not be loaded."); })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);
  useOperationalRealtime(WALKTHROUGH_REALTIME_TABLES, refresh);

  return <section className="rounded-2xl border border-[#143d1a]/10 bg-white p-5">
    <h3 className="font-extrabold text-[#143d1a]">Walkthrough / Pricing Photos</h3>
    <p className="mt-1 text-sm text-neutral-500">Current persisted Walkthrough photos are shown as read-only pricing references.</p>
    {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : loading ? <p className="mt-4 text-sm text-neutral-500">Loading Walkthrough photos…</p> : <div className="mt-5"><PhotoGallery photos={photos} readonly canDelete={false} /></div>}
  </section>;
}

function ResidentialFields({ value, set, catalog }: { value: ResidentialCalculatorInput; set: (v: CalculatorInput) => void; catalog: ServiceCatalogBundle }) { const service=findCatalogService(catalog.services,"Residential",value.serviceType);const addons=service?getAvailableServiceAddons(catalog,service.id,"Residential"):[];return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Text label="Service" value={value.serviceType} set={serviceType=>set({...value,serviceType,addOns:[]})}/><Choice label="Frequency" value={value.frequency} options={frequencies} set={frequency=>set({...value,frequency:frequency as Frequency})}/><Choice label="Condition" value={value.condition} options={conditions} set={condition=>set({...value,condition:condition as Condition})}/><Num label="Square Feet" value={value.squareFeet} set={squareFeet=>set({...value,squareFeet})}/><Num label="Bedrooms" value={value.bedrooms} set={bedrooms=>set({...value,bedrooms})}/><Num label="Bathrooms" value={value.bathrooms} set={bathrooms=>set({...value,bathrooms})}/><Choice label="Occupancy" value={value.occupied?"Occupied":"Vacant"} options={["Occupied","Vacant"]} set={v=>set({...value,occupied:v==="Occupied"})}/><Choice label="Pets" value={value.pets?"Yes":"No"} options={["Yes","No"]} set={v=>set({...value,pets:v==="Yes"})}/><Num label="Reviewed Discount %" value={value.additionalDiscountPercent} set={additionalDiscountPercent=>set({...value,additionalDiscountPercent})}/><div className="sm:col-span-2 xl:col-span-3"><CatalogAddonPicker addons={addons} selected={value.addOns} setSelected={addOns=>set({...value,addOns})}/></div></div> }
function CommercialFields({ value, set, catalog }: { value: CommercialCalculatorInput; set: (v: CalculatorInput) => void; catalog: ServiceCatalogBundle }) { const service=findCatalogService(catalog.services,"Commercial",value.commercialType);const addons=service?getAvailableServiceAddons(catalog,service.id,"Commercial"):[];return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><Text label="Service / Type" value={value.commercialType} set={commercialType=>set({...value,commercialType,additionalServices:[]})}/><Choice label="Frequency" value={value.frequency} options={frequencies} set={frequency=>set({...value,frequency:frequency as Frequency})}/><Choice label="Condition" value={value.condition} options={conditions} set={condition=>set({...value,condition:condition as Condition})}/>{(["squareFeet","floors","restrooms","kitchens","stations","units","targetCompletionHours","workerHourlyPay","targetProfitMarginPercent","additionalDiscountPercent"] as const).map(key=><Num key={key} label={labels[key]} value={value[key]} set={next=>set({...value,[key]:next})}/>) }<Num label="Target Project Days" value={value.targetProjectDays??3} set={targetProjectDays=>set({...value,targetProjectDays})}/><Choice label="Workday Length" value={String(value.workdayHours??8)} options={["8","10"]} set={next=>set({...value,workdayHours:Number(next) as 8|10})}/><div className="sm:col-span-2 xl:col-span-3"><CatalogAddonPicker addons={addons} selected={value.additionalServices} setSelected={additionalServices=>set({...value,additionalServices})}/></div></div> }
function Text({label,value,set}:{label:string;value:string;set:(v:string)=>void}){return <label><span className={labelClass}>{label}</span><input className={inputClass} value={value} onChange={e=>set(e.target.value)}/></label>}
function Num({label,value,set}:{label:string;value:number;set:(v:number)=>void}){return <label><span className={labelClass}>{label}</span><input className={inputClass} type="number" min="0" step="0.01" value={value} onChange={e=>set(Number(e.target.value))}/></label>}
function Choice({label,value,options,set}:{label:string;value:string;options:readonly string[];set:(v:string)=>void}){return <label><span className={labelClass}>{label}</span><select className={inputClass} value={value} onChange={e=>set(e.target.value)}>{options.map(option=><option key={option}>{label==="Frequency"?serviceFrequencyLabel(option):option}</option>)}</select></label>}
const frequencies=["One-Time","Daily","Weekly","Biweekly","Twice Monthly","Monthly"] as const;const conditions=["Light","Average","Heavy","Extreme"] as const;const labels={squareFeet:"Square Feet",floors:"Floors",restrooms:"Restrooms",kitchens:"Kitchens / Breakrooms",stations:"Stations / Booths",units:"Units",targetCompletionHours:"Target Completion Hours",workerHourlyPay:"Worker Hourly Pay",targetProfitMarginPercent:"Target Profit Margin %",additionalDiscountPercent:"Reviewed Discount %"};
const inputClass="w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm";const labelClass="mb-2 block text-xs font-bold text-neutral-700";function money(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value)}
