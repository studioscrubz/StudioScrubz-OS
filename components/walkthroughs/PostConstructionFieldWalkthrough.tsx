"use client";

import type { FieldMeasurements, FieldWalkthroughAnswer, PostConstructionFieldAssessment } from "@/types/fieldWalkthrough";
import type { OperationalPhotoWithUrl, WalkthroughPhotoCategory } from "@/types/photo";

export const POST_CONSTRUCTION_FIELD_SECTIONS = [
  "Project Overview & Boundaries", "Construction Readiness", "Property Measurements", "Cleaning Standard",
  "Windows & Glass", "Floors & Construction Residue", "Cabinets, Drawers & Closets", "Appliances",
  "Debris & Exclusions", "Specialty Surfaces", "Access, Utilities & Equipment Staging", "Schedule & Deadline",
  "Active Trades & Re-cleaning Responsibility", "Crew & Site Restrictions", "Completion & Sign-Off",
] as const;

const questions = [
  ["includedAreas", "Which areas are included?", "textarea"], ["siteReady", "Is construction ready for assessment?", "critical"],
  ["measurementsVerified", "Were measurements and floor count verified?", "critical"], ["cleaningStandard", "Required cleaning standard", "select"],
  ["windowsGlass", "Window/glass scope, quantity, access and condition", "textarea"], ["floorsResidue", "Floor types, residue locations and damage", "textarea"],
  ["cabinetScope", "Cabinets, drawers, closets and built-ins in scope", "textarea"], ["applianceScope", "Appliances and interiors in scope", "textarea"],
  ["debrisExclusions", "Light debris included; heavy/hazardous/trade work excluded", "textarea"], ["specialtySurfaces", "Specialty surfaces and required care", "textarea"],
  ["accessUtilities", "Access, parking, loading, elevator, utilities and staging", "textarea"], ["scheduleDeadline", "Readiness date, deadline and working hours", "textarea"],
  ["activeTrades", "Are trades active and who owns re-cleaning?", "critical"], ["crewRestrictions", "Crew, security, PPE and site restrictions", "textarea"],
  ["finalSignOff", "Was scope reviewed and follow-up identified?", "critical"],
] as const;

export function postConstructionCompletionIssues(measurements: FieldMeasurements) {
  const field = measurements.postConstructionAssessment?.fieldWalkthrough;
  return POST_CONSTRUCTION_FIELD_SECTIONS.filter((_, index) => !field?.sectionConfirmations?.[String(index + 1)] || !field?.answers?.[questions[index][0]]);
}

export function PostConstructionFieldWalkthrough({measurements,onChange,photos,onPhoto}: {
  measurements: FieldMeasurements; onChange: (next: FieldMeasurements) => void; photos: OperationalPhotoWithUrl[];
  onPhoto: (file: File, category: WalkthroughPhotoCategory, caption: string) => void;
}) {
  const assessment = measurements.postConstructionAssessment ?? {};
  const field: PostConstructionFieldAssessment = assessment.fieldWalkthrough ?? {sectionConfirmations:{},answers:{}};
  const issues = postConstructionCompletionIssues(measurements);
  const completed = POST_CONSTRUCTION_FIELD_SECTIONS.length - issues.length;
  const update = (key:string, value:string|number|string[]|boolean|null) => onChange({...measurements,postConstructionAssessment:{...assessment,fieldWalkthrough:{...field,answers:{...field.answers,[key]:value}}}});
  const confirm = (section:number,value:FieldWalkthroughAnswer) => onChange({...measurements,postConstructionAssessment:{...assessment,fieldWalkthrough:{...field,sectionConfirmations:{...field.sectionConfirmations,[String(section)]:value}}}});
  const photoInputs: Record<number, Array<[string,WalkthroughPhotoCategory]>> = {2:[["Damage","Damage / Concern"]],5:[["Windows","Interior"]],6:[["Floors","Flooring"],["Construction residue","Damage / Concern"]],10:[["Specialty surfaces","Other"]]};
  return <div className="mt-6">
    <div className="sticky top-0 z-10 rounded-lg bg-white py-3"><p className="font-bold">Walkthrough progress: {completed} of 15 sections complete</p><progress className="w-full" max={15} value={completed}/></div>
    {POST_CONSTRUCTION_FIELD_SECTIONS.map((title,index)=>{const [key,prompt,kind]=questions[index]; const section=index+1; const value=field.answers?.[key]; return <section key={title} className="my-4 rounded-xl border p-4" data-walkthrough-section={section}>
      <h3 className="text-lg font-bold text-[#143d1a]">{section}. {title}</h3>
      <label className="mt-3 block">{prompt}{kind==="critical"?<select aria-label={prompt} className={input} value={String(value??"")} onChange={e=>update(key,e.target.value)}>{["","Yes","No","Unknown / Confirm Later"].map(v=><option key={v} value={v}>{v||"Select an answer"}</option>)}</select>:kind==="select"?<select aria-label={prompt} className={input} value={String(value??"")} onChange={e=>update(key,e.target.value)}>{["","Broom clean","Rough clean","Final clean","White-glove","Unknown / Confirm Later"].map(v=><option key={v} value={v}>{v||"Select standard"}</option>)}</select>:<textarea aria-label={prompt} className={input} maxLength={5000} value={String(value??"")} onChange={e=>update(key,e.target.value)}/>}</label>
      {section===1&&<div className="mt-3 grid gap-3 sm:grid-cols-2"><label>Excluded areas<textarea className={input} value={String(field.answers?.excludedAreas??"")} onChange={e=>update("excludedAreas",e.target.value)}/></label><label>Items requiring pricing review<textarea className={input} value={String(field.answers?.pricingReviewItems??"")} onChange={e=>update("pricingReviewItems",e.target.value)}/></label></div>}
      {section===3&&<div className="mt-3 grid gap-3 sm:grid-cols-2"><NumberField label="Square feet" value={measurements.squareFeet} onChange={v=>onChange({...measurements,squareFeet:v})}/><NumberField label="Floors" value={measurements.floors} onChange={v=>onChange({...measurements,floors:v})}/></div>}
      {photoInputs[section]?.map(([caption,category])=><label key={caption} className="mt-3 block">Add {caption.toLowerCase()} photo<input type="file" accept="image/*" className="mt-1 block" onChange={e=>{const file=e.target.files?.[0];if(file)onPhoto(file,category,caption);e.target.value="";}}/></label>)}
      <label className="mt-3 block font-medium">Section status<select aria-label={`${title} status`} className={input} value={field.sectionConfirmations?.[String(section)]??""} onChange={e=>confirm(section,e.target.value as FieldWalkthroughAnswer)}>{["","Yes","No","Unknown / Confirm Later"].map(v=><option key={v} value={v}>{v||"Mark section"}</option>)}</select></label>
    </section>;})}
    <h3 className="mt-5 font-bold">Area-specific photos</h3><div className="mt-3 grid grid-cols-2 gap-3">{photos.map(photo=><figure key={photo.id}>{photo.signedUrl&&<img src={photo.signedUrl} alt={photo.caption||photo.category} className="max-h-64 w-full rounded-lg object-contain"/>}<figcaption className="text-sm">{photo.caption||photo.category}</figcaption></figure>)}</div>
    {issues.length>0&&<p className="mt-4 text-amber-800">Final completion requires an answer and section status for all 15 sections. Use “Unknown / Confirm Later” where follow-up is required.</p>}
  </div>;
}
function NumberField({label,value,onChange}:{label:string;value:number|null|undefined;onChange:(value:number|null)=>void}){return <label>{label}<input type="number" min="0" step="any" className={input} value={value??""} onChange={e=>onChange(e.target.value===""?null:Number(e.target.value))}/></label>}
const input="mt-1 block w-full rounded-lg border border-neutral-300 p-2";
