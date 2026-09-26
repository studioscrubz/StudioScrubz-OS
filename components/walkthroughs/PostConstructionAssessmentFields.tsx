"use client";

import type { PostConstructionAssessment, WalkthroughMeasurements } from "@/types/walkthrough";

const detailedScope = ["Kitchens", "Bathrooms", "Cabinets", "Closets", "Built-Ins", "Fixtures", "Baseboards", "Trim", "Doors", "Interior Glass", "Windows", "Floors", "Stairs", "Elevators"];
const exclusions = ["Heavy Debris", "Hazardous Material", "Mold", "Asbestos", "Repairs", "Trade Work"];
const residues = ["Adhesive", "Labels", "Paint", "Grout", "Caulk", "Surface Residue"];
const surfaces = ["Wood", "Stone", "Tile", "Concrete", "Glass", "Metal", "Laminate", "Carpet"];

export const EMPTY_POST_CONSTRUCTION_ASSESSMENT: PostConstructionAssessment = {
  projectType: "", propertyUse: "", projectPhase: "", expectedConstructionCompletionDate: null,
  desiredReadinessDate: null, occupancyStatus: "", dustLevel: "", debrisCondition: "",
  utilities: { water: false, electricity: false, restroom: false }, decisionMakerStatus: "",
  contactStatus: "Not Contacted", nextFollowUpAt: null, roomsAreas: [], detailedScope: [],
  surfaceMaterials: [], residues: [], lightDebrisInScope: false, exclusions: [...exclusions],
  applianceInteriors: false, interiorCabinets: false, workingHourRestrictions: "",
  readinessBlockers: "", siteSafetyConcerns: "", customerPriorities: "", internalObservations: "",
  recommendedExclusions: [], proposalNotes: "",
};

export function PostConstructionAssessmentFields({ value, set }: { value: WalkthroughMeasurements; set: (value: WalkthroughMeasurements) => void }) {
  const current = value.postConstructionAssessment ?? EMPTY_POST_CONSTRUCTION_ASSESSMENT;
  const update = <K extends keyof PostConstructionAssessment>(key: K, next: PostConstructionAssessment[K]) => set({ ...value, postConstructionAssessment: { ...current, [key]: next } });
  return <section className="rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-sm sm:p-6"><h3 className="font-extrabold text-[#143d1a]">Post-Construction Assessment</h3><p className="mt-1 text-sm text-neutral-500">Structured scope and site-readiness record used by Pricing Review and Proposal handoff.</p>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Choice label="Project Type" value={current.projectType} options={["New Construction","Renovation / Remodel","Tenant Improvement","Restoration","Other"]} set={v=>update("projectType",v as PostConstructionAssessment["projectType"])}/>
      <Choice label="Residential / Commercial" value={current.propertyUse} options={["Residential","Commercial"]} set={v=>update("propertyUse",v as PostConstructionAssessment["propertyUse"])}/>
      <Choice label="Project Phase" value={current.projectPhase} options={["Planning","Active Construction","Punch List","Substantially Complete","Ready for Cleaning"]} set={v=>update("projectPhase",v as PostConstructionAssessment["projectPhase"])}/>
      <Input label="Expected Construction Completion" type="date" value={current.expectedConstructionCompletionDate??""} set={v=>update("expectedConstructionCompletionDate",v||null)}/>
      <Input label="Desired Cleaning / Readiness Date" type="date" value={current.desiredReadinessDate??""} set={v=>update("desiredReadinessDate",v||null)}/>
      <Choice label="Occupancy" value={current.occupancyStatus} options={["Vacant","Partially Occupied","Occupied"]} set={v=>update("occupancyStatus",v as PostConstructionAssessment["occupancyStatus"])}/>
      <Choice label="Fine Construction Dust" value={current.dustLevel} options={["Light","Average","Heavy","Extreme"]} set={v=>update("dustLevel",v as PostConstructionAssessment["dustLevel"])}/>
      <Choice label="General Debris" value={current.debrisCondition} options={["None","Light","Moderate","Heavy"]} set={v=>update("debrisCondition",v as PostConstructionAssessment["debrisCondition"])}/>
      <Choice label="Decision-Maker Status" value={current.decisionMakerStatus} options={["Decision Maker","Influencer","Awaiting Decision Maker","Unknown"]} set={v=>update("decisionMakerStatus",v as PostConstructionAssessment["decisionMakerStatus"])}/>
      <Choice label="Contact Status" value={current.contactStatus} options={["Not Contacted","Attempting Contact","Contacted","Qualified","Not Qualified"]} set={v=>update("contactStatus",v as PostConstructionAssessment["contactStatus"])}/>
      <Input label="Next Follow-Up" type="datetime-local" value={current.nextFollowUpAt??""} set={v=>update("nextFollowUpAt",v||null)}/>
      <Input label="Rooms / Areas in Scope" value={current.roomsAreas.join(", ")} set={v=>update("roomsAreas",split(v))}/>
    </div>
    <Checks title="Utilities Available" values={Object.entries(current.utilities).filter(([,v])=>v).map(([k])=>k)} options={["water","electricity","restroom"]} set={items=>update("utilities",{water:items.includes("water"),electricity:items.includes("electricity"),restroom:items.includes("restroom")})}/>
    <Checks title="Detailed Scope" values={current.detailedScope} options={detailedScope} set={v=>update("detailedScope",v)}/>
    <Checks title="Surface / Material Considerations" values={current.surfaceMaterials} options={surfaces} set={v=>update("surfaceMaterials",v)}/>
    <Checks title="Residue Conditions" values={current.residues} options={residues} set={v=>update("residues",v)}/>
    <Checks title="Explicit Exclusions" values={current.exclusions} options={exclusions} set={v=>update("exclusions",v)}/>
    <div className="mt-5 grid gap-3 sm:grid-cols-3"><Toggle label="Light Debris in Scope" checked={current.lightDebrisInScope} set={v=>update("lightDebrisInScope",v)}/><Toggle label="Appliance Interiors" checked={current.applianceInteriors} set={v=>update("applianceInteriors",v)}/><Toggle label="Interior Cabinets" checked={current.interiorCabinets} set={v=>update("interiorCabinets",v)}/></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2"><Area label="Working-Hour Restrictions" value={current.workingHourRestrictions} set={v=>update("workingHourRestrictions",v)}/><Area label="Readiness Blockers" value={current.readinessBlockers} set={v=>update("readinessBlockers",v)}/><Area label="Site-Safety Concerns" value={current.siteSafetyConcerns} set={v=>update("siteSafetyConcerns",v)}/><Area label="Customer Priorities" value={current.customerPriorities} set={v=>update("customerPriorities",v)}/><Area label="Internal Observations" value={current.internalObservations} set={v=>update("internalObservations",v)}/><Area label="Proposal Notes" value={current.proposalNotes} set={v=>update("proposalNotes",v)}/><Area label="Recommended Exclusions" value={current.recommendedExclusions.join(", ")} set={v=>update("recommendedExclusions",split(v))}/></div>
  </section>;
}

function Choice({label,value,options,set}:{label:string;value:string;options:string[];set:(v:string)=>void}){return <label><Span text={label}/><select className={input} value={value} onChange={e=>set(e.target.value)}><option value="">Select</option>{options.map(x=><option key={x}>{x}</option>)}</select></label>}
function Input({label,value,set,type="text"}:{label:string;value:string;set:(v:string)=>void;type?:string}){return <label><Span text={label}/><input className={input} type={type} value={value} onChange={e=>set(e.target.value)}/></label>}
function Area({label,value,set}:{label:string;value:string;set:(v:string)=>void}){return <label><Span text={label}/><textarea className={input} rows={3} value={value} onChange={e=>set(e.target.value)}/></label>}
function Toggle({label,checked,set}:{label:string;checked:boolean;set:(v:boolean)=>void}){return <label className="flex items-center gap-2 rounded-lg border p-3 text-sm font-semibold"><input type="checkbox" checked={checked} onChange={e=>set(e.target.checked)}/>{label}</label>}
function Checks({title,values,options,set}:{title:string;values:string[];options:string[];set:(v:string[])=>void}){return <fieldset className="mt-5"><legend className="text-xs font-bold text-neutral-700">{title}</legend><div className="mt-2 flex flex-wrap gap-2">{options.map(x=><label key={x} className="flex items-center gap-2 rounded-full border bg-neutral-50 px-3 py-2 text-xs font-semibold"><input type="checkbox" checked={values.includes(x)} onChange={e=>set(e.target.checked?[...values,x]:values.filter(v=>v!==x))}/>{x}</label>)}</div></fieldset>}
function Span({text}:{text:string}){return <span className="mb-2 block text-xs font-bold text-neutral-700">{text}</span>}
const input="w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm";
const split=(value:string)=>value.split(",").map(x=>x.trim()).filter(Boolean);
