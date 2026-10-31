"use client";

import type { HighDustingInputs } from "@/lib/pricing/highDusting";
import { approvedHighDustingAccessMethods, priceHighDusting } from "@/lib/pricing/highDusting";

export function HighDustingQuoteCalculator({value,onChange}:{
 value:HighDustingInputs;onChange:(next:HighDustingInputs)=>void;
}){
 const inputs=value;
 const height=value.workingHeight;
 const access=value.accessMethods;
 const areas=value.scope;
 let preview: ReturnType<typeof priceHighDusting> | null = null;
 let pricingError: string | null = null;
 try { preview = priceHighDusting(value); }
 catch (cause) { pricingError = cause instanceof Error ? cause.message : "Review the High Dusting cost inputs."; }
 const missingAssessment = !height.trim() || !areas.trim() || !access.length;
 const setInputs=(update:(current:HighDustingInputs)=>HighDustingInputs)=>onChange(update(value));
 function field(key:keyof Pick<HighDustingInputs,"cleaners"|"hoursPerCleaner"|"hourlyLaborCost"|"equipment"|"supplies"|"travelAndOverhead"|"targetMarginPercent">,label:string,step="1"){
   return <label className="text-xs font-bold text-neutral-700">{label}
    <input type="number" min={key==="targetMarginPercent"?"25":key==="hourlyLaborCost"?"30":key==="cleaners"?"1":key==="hoursPerCleaner"?"0.5":"0"} max={key==="targetMarginPercent"?"50":undefined} step={step} value={inputs[key]}
      onChange={event=>setInputs(prev=>({...prev,[key]:Number(event.target.value)}))}
      className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"/>
   </label>;
 }
 return <section className="mt-4 rounded-xl border border-[#143d1a]/20 bg-white p-4" aria-label="High Dusting Cost Calculator">
  <h3 className="text-lg font-bold text-[#143d1a]">High Dusting Cost Calculator</h3>
  <p className="mt-1 text-xs text-neutral-600">Enter square footage and your labor and job costs for a live preliminary quote. Working height, scope, and access details can be confirmed during a walkthrough.</p>
  {pricingError && <p role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{pricingError}</p>}
  <div className="mt-4 grid gap-3 sm:grid-cols-2">
   <label className="text-xs font-bold text-neutral-700">Square Feet (required)
    <input type="number" min="1" step="1" required value={value.squareFeet || ""} onChange={event=>onChange({...value,squareFeet:Number(event.target.value)})} placeholder="Enter total area" className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"/>
   </label>
   {([["bathrooms","Bathrooms"],["kitchens","Kitchens"],["commonAreas","Common areas"],["units","Units"]] as const).map(([key,label])=><label key={key} className="text-xs font-bold text-neutral-700">{label}
    <input type="number" min="0" step="1" value={value[key]??0} onChange={event=>onChange({...value,[key]:Number(event.target.value)})} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"/>
   </label>)}
  </div>
  <div className="mt-4 grid gap-3 sm:grid-cols-2">
   {field("cleaners","Number of cleaners")}
   {field("hoursPerCleaner","Hours per cleaner","0.5")}
   {field("hourlyLaborCost","Fully burdened labor cost per hour ($)","0.01")}
   {field("equipment","Equipment and lift rental ($)","0.01")}
   {field("supplies","Dusting supplies and consumables ($)","0.01")}
   {field("travelAndOverhead","Travel, administrative and overhead costs ($)","0.01")}
   {field("targetMarginPercent","Target gross margin (%)","1")}
   <label className="text-xs font-bold text-neutral-700">Highest surface / working height
    <input value={height} onChange={e=>onChange({...value,workingHeight:e.target.value})} placeholder="e.g. 15 ft" maxLength={80} className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-sm"/>
   </label>
   <fieldset className="rounded-lg border border-neutral-200 p-3">
    <legend className="px-1 text-xs font-bold text-neutral-700">Access methods (select all that apply)</legend>
    <div className="space-y-2">
     {approvedHighDustingAccessMethods.map(method=><label key={method} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800">
      <input type="checkbox" checked={access.includes(method)} onChange={e=>onChange({...value,accessMethods:e.target.checked?[...access,method]:access.filter(item=>item!==method)})} className="size-4 accent-[#143d1a]"/>
      {method}
     </label>)}
    </div>
   </fieldset>
   <label className="text-xs font-bold text-neutral-700 sm:col-span-2">Elevated surfaces and scope
    <textarea value={areas} onChange={e=>onChange({...value,scope:e.target.value})} maxLength={2000} rows={3} placeholder="Describe accessible beams, vents, rafters, ledges, fixtures, exclusions..." className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-sm"/>
   </label>
  </div>
  {missingAssessment && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Assessment pending: record working height, elevated surface scope, and a verified safe access method before finalizing the client quote. Prices may change after the walkthrough.</p>}
 </section>;
}
