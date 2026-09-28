"use client";

import { useState } from "react";
import { StandardResidentialCarryForward } from "@/components/walkthroughs/StandardResidentialFieldWalkthrough";
import type { FieldMeasurements, OfficeCleaningFieldAssessment, StandardResidentialContext } from "@/types/fieldWalkthrough";

type Props={measurements:FieldMeasurements;context:StandardResidentialContext;includedAddons:string[];onChange:(v:FieldMeasurements)=>void};
type Value=string|string[]|number|boolean|null;
type Answers=Record<string,Value>;
const sections=["Office Type / Layout","Occupancy During Service","Overall Condition","Workstations / Desks","Conference Rooms","Reception / Lobby","Breakroom / Kitchen","Restrooms","Flooring","Glass","Trash / Recycling","High-Touch Areas","Sensitive Equipment / Areas","Areas Requiring Extra Attention","Service Frequency Observation","Service Suitability","Expected Labor","Exceptions","Final Confirmation"] as const;
const levels=["Light","Moderate","Heavy","Severe"];
export function isOfficeCleaningService(service:string|null|undefined){return service?.trim()==="Office Cleaning"}
export function officeCleaningCompletionIssues(m:FieldMeasurements,_c:StandardResidentialContext){const a=assessment(m).answers??{};return sections.filter((_,i)=>issues(i,a).length)}

export function OfficeCleaningFieldWalkthrough({measurements,context,includedAddons,onChange}:Props){
  const [current,setCurrent]=useState(0),a=assessment(measurements).answers??{},missing=issues(current,a);
  const set=(k:string,v:Value)=>onChange({...measurements,officeCleaningAssessment:{...measurements.officeCleaningAssessment,fieldWalkthrough:{answers:{...a,[k]:v}}}});
  const toggle=(k:string,v:string,exclusive="None")=>{const old=list(a[k]);set(k,old.includes(v)?old.filter(x=>x!==v):v===exclusive?[v]:[...old.filter(x=>x!==exclusive),v])};
  return <div>
    <StandardResidentialCarryForward context={context}/>
    <aside className="mt-3 rounded-xl bg-blue-50 p-4"><b>Included Add-ons / Scope</b><p className="mt-1 text-sm">{includedAddons.length?includedAddons.join(", "):"No included add-ons were provided."}</p></aside>
    <div className="mt-6 flex justify-between text-sm"><b>{current+1} of {sections.length}</b><span>{Math.round((current+1)/sections.length*100)}% complete</span></div>
    <div className="mt-2 h-2 rounded-full bg-neutral-200"><div className="h-full rounded-full bg-[#143d1a]" style={{width:`${(current+1)/sections.length*100}%`}}/></div>
    <section className="mt-5 rounded-xl border p-4"><h3 className="text-lg font-extrabold text-[#143d1a]">{sections[current]}</h3><div className="mt-4 space-y-5">{render(current,a,includedAddons,set,toggle)}</div></section>
    {!!missing.length&&<div role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm"><b>Before continuing:</b><ul className="list-disc pl-5">{missing.map(x=><li key={x}>{x}</li>)}</ul></div>}
    <div className="mt-5 flex justify-between"><button type="button" className={secondary} disabled={!current} onClick={()=>setCurrent(x=>x-1)}>Previous</button><button type="button" className={primary} disabled={!!missing.length||current===18} onClick={()=>setCurrent(x=>x+1)}>Continue</button></div>
  </div>;
}

function render(i:number,a:Answers,addons:string[],set:(k:string,v:Value)=>void,toggle:(k:string,v:string,e?:string)=>void){
  switch(i){
    case 0:return <><Checks q="Which office layouts apply?" k="officeLayout" values={["Private offices","Open workstations","Conference rooms","Reception/lobby","Breakroom/kitchen","Restrooms","Copy/print room","Storage/file rooms","Other"]} a={a} toggle={(k,v)=>toggle(k,v,"")}/>{list(a.officeLayout).includes("Other")&&<Notes q="Describe the other office area." k="officeLayoutOther" a={a} set={set}/>}</>;
    case 1:return <><Radio q="What is the occupancy during service?" k="occupancy" values={["Vacant after hours","Employees present","Partially occupied","Varies"]} a={a} set={set}/>{a.occupancy&&a.occupancy!=="Vacant after hours"&&<Radio q="Does occupancy create cleaning limitations?" k="occupancyLimits" values={["Yes","No"]} a={a} set={set}/>} {a.occupancyLimits==="Yes"&&<Notes q="Describe the cleaning limitations." k="occupancyNotes" a={a} set={set}/>}</>;
    case 2:return <Radio q="What is the office's overall condition?" k="overallCondition" values={levels} a={a} set={set}/>;
    case 3:return <><Area q="What is the workstation or desk condition?" prefix="workstation" observations={["Significant dust","Clutter limits cleaning","Electronics require precautions","High-touch surfaces need extra attention"]} a={a} set={set}/><p className="text-xs text-neutral-500">Do not move paperwork, personal belongings, or sensitive documents.</p></>;
    case 4:return <Area q="What is the conference-room condition?" prefix="conference" observations={["Tables or surfaces","Chairs","Glass","Electronics","High-touch surfaces","Trash"]} a={a} set={set}/>;
    case 5:return <Area q="What is the reception or lobby condition?" prefix="reception" observations={["Entry glass","Reception surfaces","Furniture","Floors","High-touch surfaces"]} a={a} set={set}/>;
    case 6:return <Area q="What is the breakroom or kitchen condition?" prefix="breakroom" observations={["Counter buildup","Sink buildup","Cabinet exterior buildup","Appliance exterior buildup","Food residue","Trash accumulation"]} a={a} set={set}/>;
    case 7:return <><Radio q="What is the restroom condition?" k="restroomCondition" values={levels} a={a} set={set}/>{yesNo(["Soap or mineral buildup?","Toilet or urinal heavy detailing?","Fixture buildup?","Floor buildup?","Odor concern?","Visible mildew-like buildup?"],["restroomMineral","restroomToilet","restroomFixture","restroomFloor","restroomOdor","mildewLikeBuildup"],a,set)}<p className="text-xs text-neutral-500">Observational only; this is not a professional diagnosis.</p></>;
    case 8:return <><Checks q="Which flooring materials are present?" k="flooring" values={["Carpet","Hardwood","Laminate","Tile","Vinyl","Concrete","Natural stone","Other"]} a={a} toggle={(k,v)=>toggle(k,v,"")}/>{yesNo(["Heavy buildup?","Staining or soiling?","Sticky residue?","Special precautions?"],["floorBuildup","floorStaining","floorSticky","floorPrecautions"],a,set)}{(list(a.flooring).includes("Other")||["floorBuildup","floorStaining","floorSticky","floorPrecautions"].some(k=>a[k]==="Yes"))&&<Notes q="Describe flooring conditions or precautions." k="floorNotes" a={a} set={set}/>}</>;
    case 9:return <><p className="rounded-lg bg-blue-50 p-3 text-sm"><b>Upstream window/glass scope:</b> {addons.filter(x=>/(window|glass)/i.test(x)).join(", ")||"No matching included scope provided."}</p>{yesNo(["Entry glass?","Interior office glass?","Conference-room glass?","Glass partitions?","Mirrors?","Heavy buildup?","Access limitations?"],["entryGlass","officeGlass","conferenceGlass","glassPartitions","mirrors","glassBuildup","glassAccess"],a,set)}{a.glassAccess==="Yes"&&<Notes q="Describe glass access limitations." k="glassNotes" a={a} set={set}/>}</>;
    case 10:return <><Radio q="What is the trash and recycling condition?" k="trashCondition" values={["Light","Moderate","Heavy","Excessive"]} a={a} set={set}/>{yesNo(["Individual desk bins?","Central trash stations?","Recycling stations?","Shredding or security-sensitive disposal present?","Large receptacles?"],["deskBins","centralTrash","recyclingStations","secureDisposal","largeReceptacles"],a,set)}<p className="text-xs text-neutral-500">This does not imply handling confidential documents or restricted waste.</p></>;
    case 11:return <Checks q="Which high-touch areas apply?" k="highTouchAreas" values={["Door handles","Light switches","Elevator buttons","Shared equipment","Conference-room surfaces","Breakroom surfaces","Reception surfaces","Other","None"]} a={a} toggle={toggle}/>;
    case 12:return <><Radio q="Are sensitive equipment or areas present?" k="sensitiveAreas" values={["Yes","No"]} a={a} set={set}/>{a.sensitiveAreas==="Yes"&&<><Checks q="Which sensitive areas apply?" k="sensitiveAreaTypes" values={["Computers/electronics","Server/IT areas","Copy/print equipment","Confidential document areas","Executive offices","Specialty furniture/surfaces","Other"]} a={a} toggle={(k,v)=>toggle(k,v,"")}/><Notes q="Describe required precautions." k="sensitiveNotes" a={a} set={set}/></>}<p className="text-xs text-neutral-500">Observational only.</p></>;
    case 13:return <Checks q="Which areas require extra attention?" k="extraAttention" values={["Workstations","Offices","Conference rooms","Reception","Breakroom","Restrooms","Floors","Glass","Trash/recycling","High-touch areas","Other","None"]} a={a} toggle={toggle}/>;
    case 14:return <><Radio q="Based on physical condition, does the scheduled frequency appear appropriate?" k="frequencyObservation" values={["Scheduled frequency appears appropriate","More frequent service may be needed","Less frequent service may be sufficient","Management review needed"]} a={a} set={set}/>{a.frequencyObservation&&a.frequencyObservation!=="Scheduled frequency appears appropriate"&&<Notes q="Explain the frequency observation." k="frequencyNotes" a={a} set={set}/>}<p className="text-xs">Technicians cannot change contract frequency.</p></>;
    case 15:return <><Radio q="Does Office Cleaning appear appropriate?" k="serviceSuitable" values={["Yes — Office Cleaning appears appropriate","Additional service may be required","Management review needed"]} a={a} set={set}/>{a.serviceSuitable==="Additional service may be required"&&<Checks q="Which additional service may be required?" k="recommendedServices" values={["Carpet cleaning","Window cleaning","Deep cleaning","Floor treatment","Other"]} a={a} toggle={(k,v)=>toggle(k,v,"")}/>} {a.serviceSuitable&&a.serviceSuitable!=="Yes — Office Cleaning appears appropriate"&&<Notes q="Explain the recommendation." k="serviceNotes" a={a} set={set}/>}<p className="text-xs">Observation only; technicians cannot add services or pricing.</p></>;
    case 16:return <><Radio q="What is the expected labor level?" k="laborLevel" values={["Normal","Above normal","Significantly above normal"]} a={a} set={set}/><Radio q="What crew size is recommended?" k="recommendedCrew" values={["1","2","3","4+"]} a={a} set={set}/><Radio q="What is the estimated duration?" k="serviceDuration" values={["Under 2 hours","2–4 hours","4–6 hours","6–8 hours","8+ hours"]} a={a} set={set}/></>;
    case 17:return <><Radio q="Did you observe anything else that could materially affect service?" k="materialException" values={["No","Yes"]} a={a} set={set}/>{a.materialException==="Yes"&&<Notes q="Explain the exception." k="exceptionNotes" a={a} set={set}/>}</>;
    default:return <label className="flex gap-3 rounded-lg border p-3 text-sm font-semibold"><input type="checkbox" checked={a.technicianConfirmation===true} onChange={e=>set("technicianConfirmation",e.target.checked)}/>I have physically reviewed the accessible service areas and completed this walkthrough based on the property&apos;s observed condition.</label>;
  }
}

function issues(i:number,a:Answers){
  const out:string[]=[];const need=(k:string,l:string)=>{if(a[k]==null||a[k]===""||(Array.isArray(a[k])&&!a[k].length))out.push(l)};
  const area=(p:string,count:number)=>{need(`${p}Condition`,"Select the condition.");if(a[`${p}Condition`]!=="Not applicable")for(let n=1;n<=count;n++)need(`${p}Observation${n}`,"Complete every observation.")};
  switch(i){
    case 0:need("officeLayout","Select office areas.");if(list(a.officeLayout).includes("Other"))need("officeLayoutOther","Describe the other area.");break;
    case 1:need("occupancy","Select occupancy.");if(a.occupancy!=="Vacant after hours")need("occupancyLimits","Answer the limitations question.");if(a.occupancyLimits==="Yes")need("occupancyNotes","Describe limitations.");break;
    case 2:need("overallCondition","Select overall condition.");break;
    case 3:area("workstation",4);break;case 4:area("conference",6);break;case 5:area("reception",5);break;case 6:area("breakroom",6);break;
    case 7:["restroomCondition","restroomMineral","restroomToilet","restroomFixture","restroomFloor","restroomOdor","mildewLikeBuildup"].forEach(k=>need(k,"Complete restroom observations."));break;
    case 8:["flooring","floorBuildup","floorStaining","floorSticky","floorPrecautions"].forEach(k=>need(k,"Complete flooring."));if(list(a.flooring).includes("Other")||["floorBuildup","floorStaining","floorSticky","floorPrecautions"].some(k=>a[k]==="Yes"))need("floorNotes","Describe flooring.");break;
    case 9:["entryGlass","officeGlass","conferenceGlass","glassPartitions","mirrors","glassBuildup","glassAccess"].forEach(k=>need(k,"Complete glass observations."));if(a.glassAccess==="Yes")need("glassNotes","Describe access limitations.");break;
    case 10:["trashCondition","deskBins","centralTrash","recyclingStations","secureDisposal","largeReceptacles"].forEach(k=>need(k,"Complete trash observations."));break;
    case 11:need("highTouchAreas","Select high-touch areas or None.");break;
    case 12:need("sensitiveAreas","Answer the sensitive-area question.");if(a.sensitiveAreas==="Yes"){need("sensitiveAreaTypes","Select sensitive areas.");need("sensitiveNotes","Describe precautions.")}break;
    case 13:need("extraAttention","Select areas or None.");break;
    case 14:need("frequencyObservation","Select frequency observation.");if(a.frequencyObservation&&a.frequencyObservation!=="Scheduled frequency appears appropriate")need("frequencyNotes","Explain frequency observation.");break;
    case 15:need("serviceSuitable","Select suitability.");if(a.serviceSuitable==="Additional service may be required")need("recommendedServices","Select recommended services.");if(a.serviceSuitable&&a.serviceSuitable!=="Yes — Office Cleaning appears appropriate")need("serviceNotes","Explain recommendation.");break;
    case 16:["laborLevel","recommendedCrew","serviceDuration"].forEach(k=>need(k,"Complete expected labor."));break;
    case 17:need("materialException","Answer exceptions.");if(a.materialException==="Yes")need("exceptionNotes","Explain exception.");break;
    case 18:if(a.technicianConfirmation!==true)out.push("Confirm the technician statement.");
  }
  return [...new Set(out)];
}

function Area({q,prefix,observations,a,set}:{q:string;prefix:string;observations:string[];a:Answers;set:(k:string,v:Value)=>void}){return <><Radio q={q} k={`${prefix}Condition`} values={["Not applicable",...levels]} a={a} set={set}/>{a[`${prefix}Condition`]!=="Not applicable"&&yesNo(observations,observations.map((_,i)=>`${prefix}Observation${i+1}`),a,set)}</>}
function Radio({q,k,values,a,set}:{q:string;k:string;values:string[];a:Answers;set:(k:string,v:Value)=>void}){return <fieldset><legend className="text-sm font-bold">{q}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{values.map(v=><label key={v} className="flex gap-2 rounded-lg border p-3 text-sm"><input type="radio" name={k} checked={a[k]===v} onChange={()=>set(k,v)}/>{v}</label>)}</div></fieldset>}
function Checks({q,k,values,a,toggle}:{q:string;k:string;values:string[];a:Answers;toggle:(k:string,v:string)=>void}){return <fieldset><legend className="text-sm font-bold">{q}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{values.map(v=><label key={v} className="flex gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={list(a[k]).includes(v)} onChange={()=>toggle(k,v)}/>{v}</label>)}</div></fieldset>}
function Notes({q,k,a,set}:{q:string;k:string;a:Answers;set:(k:string,v:Value)=>void}){return <label className="block text-sm font-bold">{q}<textarea maxLength={5000} className="mt-2 block min-h-24 w-full rounded-lg border p-2 font-normal" value={typeof a[k]==="string"?a[k]:""} onChange={e=>set(k,e.target.value)}/></label>}
function yesNo(q:string[],k:string[],a:Answers,set:(k:string,v:Value)=>void){return q.map((x,i)=><Radio key={x} q={x} k={k[i]} values={["Yes","No"]} a={a} set={set}/>)}
function assessment(m:FieldMeasurements):OfficeCleaningFieldAssessment{return m.officeCleaningAssessment?.fieldWalkthrough??{answers:{}}}
function list(v:unknown):string[]{return Array.isArray(v)?v.filter((x):x is string=>typeof x==="string"):[]}
const primary="rounded-lg bg-[#143d1a] px-4 py-2 font-bold text-white disabled:opacity-40",secondary="rounded-lg border px-4 py-2 font-bold disabled:opacity-40";
