"use client";

import { useState } from "react";

type Inputs = {
  cleaners: number; hoursPerCleaner: number; hourlyLaborCost: number;
  equipment: number; supplies: number; travelAndOverhead: number; targetMarginPercent: number;
};
const initial: Inputs = {cleaners:2,hoursPerCleaner:5,hourlyLaborCost:30,equipment:75,supplies:35,travelAndOverhead:60,targetMarginPercent:35};
export function calculateHighDustingCostEstimate(value: Inputs) {
 const numbers=Object.values(value);
 if(numbers.some(n=>!Number.isFinite(n)||n<0)||!Number.isInteger(value.cleaners)||value.cleaners<1||value.hoursPerCleaner<=0||value.hourlyLaborCost<=0||value.targetMarginPercent<25||value.targetMarginPercent>50){
   return null;
 }
 const labor=value.cleaners*value.hoursPerCleaner*value.hourlyLaborCost;
 const directCosts=labor+value.equipment+value.supplies+value.travelAndOverhead;
 const recommendedPrice=Math.ceil(directCosts/(1-value.targetMarginPercent/100)*100)/100;
 return {labor,directCosts,recommendedPrice,expectedGrossProfit:recommendedPrice-directCosts};
}
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);

export function HighDustingQuoteCalculator({onApply,disabled=false}:{
 onApply:(amount:number,scope:string)=>void;disabled?:boolean;
}){
 const [inputs,setInputs]=useState<Inputs>(initial);
 const [height,setHeight]=useState("");
 const [access,setAccess]=useState<string[]>([]);
 const [areas,setAreas]=useState("");
 const result=calculateHighDustingCostEstimate(inputs);
 function field(key:keyof Inputs,label:string,step="1"){
   return <label className="text-xs font-bold text-neutral-700">{label}
    <input type="number" min={key==="targetMarginPercent"?"25":"0"} max={key==="targetMarginPercent"?"50":undefined} step={step} value={inputs[key]}
      onChange={event=>setInputs(prev=>({...prev,[key]:Number(event.target.value)}))}
      className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"/>
   </label>;
 }
 return <section className="mt-4 rounded-xl border border-[#143d1a]/20 bg-white p-4" aria-label="High Dusting Cost Calculator">
  <h3 className="text-lg font-bold text-[#143d1a]">High Dusting Cost Calculator</h3>
  <p className="mt-1 text-xs text-neutral-600">Internal pricing worksheet. Assess safe access and equipment requirements before sending a quote. The suggested price does not replace management approval.</p>
  <div className="mt-4 grid gap-3 sm:grid-cols-2">
   {field("cleaners","Number of cleaners")}
   {field("hoursPerCleaner","Hours per cleaner","0.5")}
   {field("hourlyLaborCost","Fully burdened labor cost per hour ($)","0.01")}
   {field("equipment","Equipment and lift rental ($)","0.01")}
   {field("supplies","Dusting supplies and consumables ($)","0.01")}
   {field("travelAndOverhead","Travel, administrative and overhead costs ($)","0.01")}
   {field("targetMarginPercent","Target gross margin (%)","1")}
   <label className="text-xs font-bold text-neutral-700">Highest surface / working height
    <input value={height} onChange={e=>setHeight(e.target.value)} placeholder="e.g. 15 ft" maxLength={80} className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-sm"/>
   </label>
   <fieldset className="rounded-lg border border-neutral-200 p-3">
    <legend className="px-1 text-xs font-bold text-neutral-700">Access methods (select all that apply)</legend>
    <div className="space-y-2">
     {["Approved extension tools","Appropriate ladder setup","Scissor lift","Other reviewed access method"].map(method=><label key={method} className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800">
      <input type="checkbox" checked={access.includes(method)} onChange={e=>setAccess(current=>e.target.checked?[...current,method]:current.filter(item=>item!==method))} className="size-4 accent-[#143d1a]"/>
      {method}
     </label>)}
    </div>
   </fieldset>
   <label className="text-xs font-bold text-neutral-700 sm:col-span-2">Elevated surfaces and scope
    <textarea value={areas} onChange={e=>setAreas(e.target.value)} maxLength={2000} rows={3} placeholder="Describe accessible beams, vents, rafters, ledges, fixtures, exclusions..." className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-sm"/>
   </label>
  </div>
  {result&&<div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f4f7f1] p-3">
   <div><p className="text-xs text-neutral-600">Estimated project costs: {money(result.directCosts)}</p><p className="text-xs text-neutral-600">Expected gross profit: {money(result.expectedGrossProfit)}</p><p className="text-lg font-extrabold text-[#143d1a]">Suggested quote: {money(result.recommendedPrice)}</p></div>
   <button type="button" disabled={disabled || !areas.trim() || !height.trim() || access.length === 0}
     onClick={()=>onApply(result.recommendedPrice, `High Dusting: ${areas.trim()}. Height: ${height.trim()}. Access methods: ${access.join(", ")}. Equipment and site safety to be confirmed during walkthrough.`)}
     className="rounded-lg bg-[#143d1a] px-4 py-3 text-sm font-bold text-white disabled:opacity-40">Apply Separate Quote</button>
  </div>}
  {!result&&<p role="alert" className="mt-2 text-sm text-red-700">Enter valid labor, hours, costs, and a margin from 25% to 50%.</p>}
  {result&&(!areas.trim()||!height.trim()||access.length===0)&&<p className="mt-2 text-xs text-amber-800">Record scope, height and access method to apply the suggested quote.</p>}
 </section>;
}
