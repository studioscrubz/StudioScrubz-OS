"use client";

import { GuidedWalkthroughChoice } from "@/components/walkthroughs/GuidedWalkthroughChoice";
import { POST_CONSTRUCTION_SCOPE_OPTIONS, normalizePostConstructionScopeAreas } from "@/lib/postConstructionScope";
export { normalizePostConstructionScopeAreas } from "@/lib/postConstructionScope";

export function PostConstructionScopeFields({ areas, bedrooms, bathrooms, otherArea, areasExcluded, onAreasChange, onBedroomsChange, onBathroomsChange, onOtherAreaChange, onAreasExcludedChange }: {
  areas: unknown; bedrooms: number | null; bathrooms: number | null; otherArea: string; areasExcluded: string;
  onAreasChange: (value: string[]) => void; onBedroomsChange: (value: number | null) => void; onBathroomsChange: (value: number | null) => void;
  onOtherAreaChange: (value: string) => void; onAreasExcludedChange: (value: string) => void;
}) {
  const selected = normalizePostConstructionScopeAreas(areas);
  const legacyOptions = selected.filter(item => !POST_CONSTRUCTION_SCOPE_OPTIONS.includes(item as (typeof POST_CONSTRUCTION_SCOPE_OPTIONS)[number]));
  const options = [...POST_CONSTRUCTION_SCOPE_OPTIONS, ...legacyOptions];
  const toggle = (option: string) => onAreasChange(selected.includes(option) ? selected.filter(item => item !== option) : [...selected, option]);
  return <div className="mt-5 space-y-4">
    <GuidedWalkthroughChoice label="Rooms / Areas in Scope" options={options} selected={selected} multiple onSelect={toggle}/>
    <div className="grid gap-3 sm:grid-cols-2">
      {selected.includes("Bedrooms")&&<Quantity label="Bedroom Quantity" value={bedrooms} onChange={onBedroomsChange}/>} 
      {selected.includes("Bathrooms")&&<Quantity label="Bathroom Quantity" value={bathrooms} onChange={onBathroomsChange}/>} 
    </div>
    {selected.includes("Other")&&<Text label="Other Area in Scope" value={otherArea} onChange={onOtherAreaChange}/>} 
    <Text label="Areas Excluded From Scope" value={areasExcluded} onChange={onAreasExcludedChange} placeholder="Enter None if there are no excluded areas."/>
  </div>;
}

function Quantity({label,value,onChange}:{label:string;value:number|null;onChange:(value:number|null)=>void}){return <label className="block font-medium">{label}<input className={input} type="number" min="0" step="1" value={value??""} onChange={event=>onChange(event.target.value===""?null:Number(event.target.value))}/></label>}
function Text({label,value,onChange,placeholder}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string}){return <label className="block font-medium">{label}<textarea className={input} rows={3} maxLength={5000} placeholder={placeholder} value={value} onChange={event=>onChange(event.target.value)}/></label>}
const input="mt-1 block w-full rounded-lg border border-neutral-300 p-2";
