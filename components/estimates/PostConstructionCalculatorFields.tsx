"use client";

import { matchingRecurringRules, serviceFrequencyDiscountLabel } from "@/lib/pricing/pricingEngine";

import { WeeklyServiceDaysField } from "@/components/forms/WeeklyServiceDaysField";
import { isPostConstructionV2Estimate, type PostConstructionEstimateInput } from "@/lib/pricing/estimates";
import { calculatePostConstructionV2, resolvePostConstructionV2Hours } from "@/lib/pricing/postConstruction";
import type { PostConstructionV2Input } from "@/types/estimate";
import type { Condition, Frequency, PostConstructionCalculatorInput, PostConstructionDetailLevel, PostConstructionSeverity } from "@/types/estimate";
import type { CatalogService, ServiceCatalogBundle } from "@/types/serviceCatalog";
import { MINIMUM_WORKER_HOURLY_PAY } from "@/lib/pricing/workerHourlyPay";
import { useAuth } from "@/components/auth/AuthProvider";

const frequencies:Frequency[]=["One-Time","Daily","Weekly","Biweekly","Twice Monthly","Monthly","Multiple Days Per Week"];
const conditions:Condition[]=["Light","Average","Heavy","Extreme"];
const severities:PostConstructionSeverity[]=["Light","Average","Heavy","Extreme"];
const details:PostConstructionDetailLevel[]=["Standard","Detailed","High Detail"];

export function PostConstructionCalculatorFields({value,onChange,service,catalog,salesSafe=false}:{value:PostConstructionEstimateInput;onChange:(value:PostConstructionEstimateInput)=>void;service:CatalogService|undefined;catalog:ServiceCatalogBundle;salesSafe?:boolean}){
  const { profile } = useAuth();
  salesSafe = salesSafe || profile?.role === "Sales";
  const detailedMode = isPostConstructionV2Estimate(value);
  const changeMode = (next: "Automatic" | "Detailed") => {
    if ((next === "Detailed") === detailedMode || salesSafe) return;
    if (next === "Detailed") {
      onChange({
        ...value,
        version: 2,
        projectCosting: {
          version: 2,
          calculatorType: "Post-Construction",
          totalSquareFeet: value.squareFeet,
          scope: [],
          estimatedPersonHours: 0,
          crewSize: 1,
          workerHourlyPay: value.workerHourlyPay,
          plannedProjectDays: Math.max(1, value.targetProjectDays || 1),
          workdayHours: value.workdayHours === 10 ? 10 : 8,
          suppliesCost: 0, equipmentRentalCost: 0, travelLogisticsCost: 0,
          disposalDebrisCost: 0, supervisionAdminCost: 0, contingencyCost: 0,
          desiredMarginPercent: value.targetProfitMarginPercent,
        },
      });
    } else {
      const legacy = { ...value } as PostConstructionEstimateInput;
      const oldProject = legacy.projectCosting;
      delete legacy.version;
      delete legacy.projectCosting;
      if (oldProject) {
        legacy.squareFeet = oldProject.totalSquareFeet;
        legacy.workerHourlyPay = oldProject.workerHourlyPay;
        legacy.targetProjectDays = oldProject.plannedProjectDays;
        legacy.workdayHours = oldProject.workdayHours;
        legacy.targetProfitMarginPercent = oldProject.desiredMarginPercent;
      }
      onChange(legacy);
    }
  };
  const modeSelector = !salesSafe && <fieldset className="rounded-xl border border-[#143d1a]/20 bg-white p-4">
    <legend className="px-2 text-sm font-bold text-[#143d1a]">Post-Construction pricing method</legend>
    <div className="flex flex-wrap gap-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="radio" name="post-construction-pricing-method" checked={!detailedMode} onChange={() => changeMode("Automatic")} />
        Automatic estimate — square footage, condition and scope
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="radio" name="post-construction-pricing-method" checked={detailedMode} onChange={() => changeMode("Detailed")} />
        Detailed project costing (V2) — total person-hours and expenses
      </label>
    </div>
    <p className="mt-2 text-xs text-neutral-600">Automatic pricing generates a quote as you enter property details. Detailed V2 is optional and requires total person-hours, crew size and project expenses. Changing methods recalculates the quote; review the new price before saving.</p>
  </fieldset>;
  if (detailedMode) return salesSafe?<div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Post-Construction project costing contains protected internal costs and must be completed by management.</div>:<div className="space-y-4">{modeSelector}{value.division === "Residential" && <Group title="Residential Property Scope"><NumberField label="Bedrooms" value={value.rooms} set={rooms => onChange({ ...value, rooms })}/><NumberField label="Bathrooms" value={value.bathrooms} step="0.5" set={bathrooms => onChange({ ...value, bathrooms })}/><NumberField label="Floors" value={value.floors} set={floors => onChange({ ...value, floors })}/><NumberField label="Kitchens" value={value.kitchens} set={kitchens => onChange({ ...value, kitchens })}/><p className="text-xs text-neutral-600 sm:col-span-2 xl:col-span-4">Scope for walkthrough preparation and labor planning. Total square feet is entered below; these counts do not add pricing charges.</p></Group>}<ProjectCostFields parent={value} value={value.projectCosting} onChange={projectCosting => onChange({ ...value, squareFeet: projectCosting.totalSquareFeet, projectCosting })}/></div>;
  const set=<K extends keyof PostConstructionCalculatorInput>(key:K,next:PostConstructionCalculatorInput[K])=>onChange({...value,[key]:next});
  return <div className="space-y-5">
    {modeSelector}
    <Group title="Project Scope"><NumberField label="Square Feet" value={value.squareFeet} set={next=>set("squareFeet",next)}/><NumberField label="Floors" value={value.floors} set={next=>set("floors",next)}/><NumberField label="Rooms / Bedrooms" value={value.rooms} set={next=>set("rooms",next)}/><NumberField label="Bathrooms / Restrooms" value={value.bathrooms} set={next=>set("bathrooms",next)}/><NumberField label="Kitchens / Breakrooms" value={value.kitchens} set={next=>set("kitchens",next)}/></Group>
    <Group title="Site Condition"><SelectField label="Overall Condition" value={value.condition} options={conditions} set={next=>set("condition",next as Condition)}/><SelectField label="Construction Dust" value={value.dustSeverity} options={severities} set={next=>set("dustSeverity",next as PostConstructionSeverity)}/><SelectField label="Construction Debris" value={value.debrisSeverity} options={severities} set={next=>set("debrisSeverity",next as PostConstructionSeverity)}/><SelectField label="Detail Level" value={value.detailLevel} options={details} set={next=>set("detailLevel",next as PostConstructionDetailLevel)}/></Group>
    <Group title="Specialty / Detail Work"><NumberField label="Windows / Glass" value={value.windowsOrGlassCount} set={next=>set("windowsOrGlassCount",next)}/><NumberField label="Cabinets / Drawers" value={value.cabinetOrDrawerCount} set={next=>set("cabinetOrDrawerCount",next)}/><NumberField label="Appliance Interiors" value={value.applianceInteriorCount} set={next=>set("applianceInteriorCount",next)}/><NumberField label="Stair Flights" value={value.stairFlights} set={next=>set("stairFlights",next)}/></Group>
    <Group title="Production Plan"><NumberField label="Target Completion Days" value={value.targetProjectDays} set={next=>set("targetProjectDays",next)}/><NumberField label="Workday Hours" value={value.workdayHours} set={next=>set("workdayHours",next)}/>{!salesSafe&&<><NumberField label="Worker Hourly Cost" value={value.workerHourlyPay} min={MINIMUM_WORKER_HOURLY_PAY} error={workerPayError(value.workerHourlyPay)} step="0.01" set={next=>set("workerHourlyPay",next)}/><NumberField label="Target Profit Margin %" value={value.targetProfitMarginPercent} step="0.1" set={next=>set("targetProfitMarginPercent",next)}/></>}</Group>
    <Group title="Pricing"><SelectField label="Frequency" value={value.frequency} options={value.frequency==="Custom"?[...frequencies,"Custom"]:frequencies} labels={new Map(frequencies.map(item=>[item,serviceFrequencyDiscountLabel(item,catalog.recurringRules,service?.id)]))} set={next=>onChange({...value,frequency:next as Frequency,serviceDaysOfWeek:next==="Multiple Days Per Week"?value.serviceDaysOfWeek??[]:[],customIntervalDays:next==="Custom"?value.customIntervalDays??1:null,recurringPricingRuleId:null})}/>{value.frequency==="Multiple Days Per Week"&&<WeeklyServiceDaysField value={value.serviceDaysOfWeek} onChange={serviceDaysOfWeek=>set("serviceDaysOfWeek",serviceDaysOfWeek)}/>} {value.frequency==="Custom"&&<NumberField label="Repeat every (days)" value={value.customIntervalDays??1} set={next=>set("customIntervalDays",next)}/>}<RecurringRule service={service} catalog={catalog} value={value} onChange={onChange}/><NumberField label="Additional Discount %" value={value.additionalDiscountPercent} step="0.1" set={next=>set("additionalDiscountPercent",next)}/><NumberField label="Tax Rate %" value={value.taxRatePercent} step="0.1" set={next=>set("taxRatePercent",next)}/></Group>
  </div>;
}

function RecurringRule({service,catalog,value,onChange}:{service:CatalogService|undefined;catalog:ServiceCatalogBundle;value:PostConstructionCalculatorInput;onChange:(value:PostConstructionCalculatorInput)=>void}){const matches=service?matchingRecurringRules(value.frequency,catalog.recurringRules,service.id):[];if(value.frequency==="One-Time"||!matches.length)return null;const selected=value.recurringPricingRuleId??(matches.length===1?matches[0].id:"");return <label><Label text="Pricing Rule"/><select className={inputClass} value={selected} onChange={event=>onChange({...value,recurringPricingRuleId:event.target.value||null})}><option value="">{matches.length>1?"Select pricing rule":"Standard frequency pricing"}</option>{matches.map(rule=><option key={rule.id} value={rule.id}>{rule.rule_name??`${rule.frequency} rule`}</option>)}</select></label>}
function Group({title,children}:{title:string;children:React.ReactNode}){return <fieldset className="rounded-xl border border-[#143d1a]/10 bg-[#f7f9f6] p-4"><legend className="px-2 text-xs font-extrabold uppercase tracking-[.12em] text-[#143d1a]">{title}</legend><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div></fieldset>}
function Label({text}:{text:string}){return <span className="mb-2 block text-xs font-bold text-neutral-700">{text}</span>}
function NumberField({label,value,set,step="1",min=0,error}:{label:string;value:number;set:(value:number)=>void;step?:string;min?:number;error?:string|null}){return <label><Label text={label}/><input className={inputClass} type="number" min={min} step={step} value={value} aria-invalid={Boolean(error)} onChange={event=>set(Number(event.target.value))}/>{error&&<span className="mt-1 block text-xs font-semibold text-red-700">{error}</span>}</label>}
function SelectField({label,value,options,set,labels}:{label:string;value:string;options:readonly string[];set:(value:string)=>void;labels?:ReadonlyMap<string,string>}){return <label><Label text={label}/><select className={inputClass} value={value} onChange={event=>set(event.target.value)}>{options.map(option=><option key={option} value={option}>{labels?.get(option)??option}</option>)}</select></label>}
const inputClass="w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 outline-none transition focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";

export function projectCostingIncompleteMessage(value: PostConstructionV2Input | undefined): string | null {
  if (!value) return "Detailed project costing is missing required inputs. Select Automatic estimate or complete the V2 project information.";
  if (value.estimatedPersonHours === 0 && (!Number.isFinite(value.totalSquareFeet) || value.totalSquareFeet <= 0)) return "Enter total square feet to calculate project person-hours automatically, or enter the person-hours manually.";
  if (value.crewSize === 0 || value.plannedProjectDays === 0 || Number(value.workdayHours) === 0) return "Enter crew size, planned project days, and workday hours to calculate project pricing.";
  return null;
}

export function projectCostingErrorMessage(message: string): string {
  const labels: Record<string, string> = {
    estimatedPersonHours: "Estimated total person-hours", crewSize: "Crew size", plannedProjectDays: "Planned project days",
    workdayHours: "Workday hours", totalSquareFeet: "Total square feet", workerHourlyPay: "Worker hourly pay",
    suppliesCost: "Supplies cost", equipmentRentalCost: "Equipment / rental cost", travelLogisticsCost: "Travel / logistics cost",
    disposalDebrisCost: "Disposal / debris cost", supervisionAdminCost: "Supervision / admin cost", contingencyCost: "Contingency cost",
  };
  return message.replace(/^[a-zA-Z]+/, key => labels[key] ?? key);
}

function ProjectCostFields({ parent, value, onChange }: { parent: PostConstructionEstimateInput; value: PostConstructionV2Input; onChange: (value: PostConstructionV2Input) => void }) {
  if (!value) return <p role="alert">Version 2 project inputs are missing.</p>;
  const fields = [
    ["totalSquareFeet", "Total square feet"], ["estimatedPersonHours", "Estimated total person-hours"],
    ["crewSize", "Crew size"], ["workerHourlyPay", "Worker hourly pay"], ["plannedProjectDays", "Planned project days"],
    ["suppliesCost", "Supplies"], ["equipmentRentalCost", "Equipment / rental"], ["travelLogisticsCost", "Travel / logistics"],
    ["supervisionAdminCost", "Supervision / admin"], ["contingencyCost", "Contingency"],
    ["desiredMarginPercent", "Desired margin % (0–70)"],
  ] as const;
  let result;
  let error = "";
  const incomplete = projectCostingIncompleteMessage(value);
  if (!incomplete) { try { result = calculatePostConstructionV2(resolvePostConstructionV2Hours(parent)); } catch (cause) { error = projectCostingErrorMessage(cause instanceof Error ? cause.message : "Check project inputs."); } }
  const money = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const rows = result ? [
    ["Labor cost", money(result.laborCost)], ["Non-labor costs", money(result.nonLaborProjectCosts)],
    ["Total estimated project cost", money(result.totalEstimatedProjectCost)], ["Recommended project price", money(result.recommendedProjectPrice)],
    ["Approved project price", money(result.approvedProjectPrice)], ["Projected gross profit", money(result.projectedGrossProfit)],
    ["Projected gross margin", `${result.projectedGrossMarginPercent.toFixed(2)}%`],
    ["Estimated completion days", result.estimatedCompletionDays.toFixed(2)], ["Crew utilization", `${result.crewUtilizationPercent.toFixed(2)}%`],
  ] : [];
  return <div className="space-y-4"><p className="text-sm text-neutral-600">Post-Construction V2: one-time project costing. Enter total person-hours across all workers, not hours per worker. Leave the value at 0 to estimate hours automatically from square footage, condition and scope.</p>
    <Group title="Project Costing">{fields.map(([key,label]) => <NumberField key={key} label={label} value={value[key]} min={key === "workerHourlyPay" ? MINIMUM_WORKER_HOURLY_PAY : 0} error={key === "workerHourlyPay" ? workerPayError(value.workerHourlyPay) : null} step={key === "crewSize" ? "1" : "any"} set={next => onChange({ ...value, [key]: next })}/>)}
      <SelectField label="Workday hours" value={String(value.workdayHours)} options={["8","10"]} set={next => onChange({ ...value, workdayHours: Number(next) as 8 | 10 })}/>
      <label><Label text="Manual project price override (optional)"/><input className={inputClass} type="number" min="0.01" step="0.01" value={value.manualProjectPriceOverride ?? ""} onChange={event => { const next = { ...value }; if (event.target.value === "") delete next.manualProjectPriceOverride; else next.manualProjectPriceOverride = Number(event.target.value); onChange(next); }}/></label>
    </Group>
    <label className="block"><Label text="Scope / areas (one per line)"/><textarea className={inputClass} rows={3} value={(value.scope ?? []).join("\n")} onChange={event => onChange({ ...value, scope: event.target.value.split("\n") })}/></label>
    {value.estimatedPersonHours === 0 && result && <p className="rounded-lg border border-[#143d1a]/15 bg-white p-3 text-sm text-[#143d1a]" role="status">Automatically estimated {result.totalLaborHours.toFixed(1)} total person-hours from square footage, condition and scope. Enter a nonzero total person-hours value above to override this estimate.</p>}
    {incomplete && <p className="text-sm text-neutral-600">{incomplete}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <dl className="grid gap-3 rounded-xl bg-[#f7f9f6] p-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map(([label,display]) => <div key={label}><dt className="text-xs text-neutral-600">{label}</dt><dd className="mt-1 font-bold text-[#143d1a]">{display}</dd></div>)}</dl>}
  </div>;
}

function workerPayError(value:number){return value<MINIMUM_WORKER_HOURLY_PAY?"Minimum worker hourly pay is $30.00/hour.":null}
