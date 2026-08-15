"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calculateCommercialEstimate, calculateResidentialEstimate } from "@/lib/pricing/estimates";
import { createEstimate, findOrCreateEstimateClient, findOrCreateEstimateProperty, getEstimates, updateEstimate, updateEstimateRelationships } from "@/lib/services/estimates";
import { getServiceCatalog } from "@/lib/services/serviceCatalog";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import type { CalculatorInput, CommercialCalculatorInput, Condition, CustomerInformation, EstimateDivision, EstimateResult, EstimateWithRelations, Frequency, ResidentialCalculatorInput } from "@/types/estimate";
import type { ServiceCatalogBundle } from "@/types/serviceCatalog";

const frequencies: Frequency[] = ["One-Time", "Weekly", "Biweekly", "Monthly"];
const conditions: Condition[] = ["Light", "Average", "Heavy", "Extreme"];
const blankCustomer: CustomerInformation = { firstName: "", lastName: "", companyName: "", phone: "", email: "", address: "", addressLine2: "", city: "", state: "", zip: "" };
const defaultResidential: ResidentialCalculatorInput = { division: "Residential", serviceType: "Standard", frequency: "One-Time", condition: "Average", squareFeet: 1000, bedrooms: 2, bathrooms: 1, occupied: true, pets: false, additionalDiscountPercent: 0, taxRatePercent: 0, addOns: [] };
const defaultCommercial: CommercialCalculatorInput = { division: "Commercial", commercialType: "Office", frequency: "One-Time", squareFeet: 2500, floors: 1, restrooms: 2, kitchens: 1, stations: 0, units: 0, condition: "Average", targetCompletionHours: 4, workerHourlyPay: 22, targetProfitMarginPercent: 35, additionalDiscountPercent: 0, taxRatePercent: 0, additionalServices: [] };
const estimateDraftKey = "studioscrubz:estimate-draft";

type EstimateDraft = {
  version: 1;
  customer: CustomerInformation;
  division: EstimateDivision;
  residential: ResidentialCalculatorInput;
  commercial: CommercialCalculatorInput;
  notes: string;
};

export function EstimateBuilder({ estimate, onSaved }: { estimate?: EstimateWithRelations; onSaved?: () => void }) {
  const initialCustomer = estimate ? customerFromEstimate(estimate) : blankCustomer;
  const initialInput = estimate?.result.calculatorInput;
  const [customer, setCustomer] = useState(initialCustomer);
  const [division, setDivision] = useState<EstimateDivision>(estimate?.division ?? "Residential");
  const [residential, setResidential] = useState<ResidentialCalculatorInput>(initialInput?.division === "Residential" ? initialInput : defaultResidential);
  const [commercial, setCommercial] = useState<CommercialCalculatorInput>(initialInput?.division === "Commercial" ? initialInput : defaultCommercial);
  const [notes, setNotes] = useState(estimate?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(Boolean(estimate));
  const [catalog,setCatalog]=useState<ServiceCatalogBundle|null>(null);
  const [catalogLoading,setCatalogLoading]=useState(true);
  const restoredDraft = useRef(false);
  const suppressDraftSave = useRef(false);
  const calculatorInput: CalculatorInput = division === "Residential" ? residential : commercial;
  useEffect(() => {
    if (estimate) return;
    try {
      const saved = window.sessionStorage.getItem(estimateDraftKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isEstimateDraft(parsed)) {
          restoredDraft.current = true;
          // Restore the external session snapshot once after client hydration.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setCustomer(parsed.customer);
          setDivision(parsed.division);
          setResidential(parsed.residential);
          setCommercial(parsed.commercial);
          setNotes(parsed.notes);
          setDraftNotice("Your unfinished estimate was restored.");
        } else {
          window.sessionStorage.removeItem(estimateDraftKey);
        }
      }
    } catch (caught) {
      console.warn("Estimate draft could not be restored", caught);
    } finally {
      setDraftReady(true);
    }
  }, [estimate]);
  useEffect(()=>{let active=true;void Promise.all([getServiceCatalog(),getBusinessSettings()]).then(([loaded,settings])=>{if(!active)return;setCatalog(loaded);if(!estimate&&!restoredDraft.current){setResidential(x=>x.taxRatePercent===0?{...x,taxRatePercent:settings.default_tax_rate}:x);setCommercial(x=>x.taxRatePercent===0?{...x,taxRatePercent:settings.default_tax_rate}:x);setNotes(value=>value||settings.default_estimate_notes||"")}}).catch((x:unknown)=>{if(active)setError(x instanceof Error?x.message:"Pricing catalog could not be loaded.")}).finally(()=>{if(active)setCatalogLoading(false)});return()=>{active=false}},[estimate]);
  useEffect(() => {
    if (estimate || !draftReady) return;
    if (suppressDraftSave.current) {
      suppressDraftSave.current = false;
      window.sessionStorage.removeItem(estimateDraftKey);
      return;
    }
    if (!hasMeaningfulDraft(customer, division, residential, commercial, notes)) {
      window.sessionStorage.removeItem(estimateDraftKey);
      return;
    }
    const draft: EstimateDraft = { version: 1, customer, division, residential, commercial, notes };
    try {
      window.sessionStorage.setItem(estimateDraftKey, JSON.stringify(draft));
    } catch (caught) {
      console.warn("Estimate draft could not be saved", caught);
    }
  }, [commercial, customer, division, draftReady, estimate, notes, residential]);
  const calculation = useMemo(() => {if(!catalog)return{result:null,error:null};try{return{result:division === "Residential" ? calculateResidentialEstimate(residential,catalog) : calculateCommercialEstimate(commercial,catalog),error:null}}catch(x){return{result:null,error:x instanceof Error?x.message:"Pricing could not be calculated."}}}, [catalog,commercial, division, residential]);
  const result=calculation.result;

  async function save() {
    if(!result){setError(calculation.error??"Pricing is not ready.");return}
    const validation = validateCustomer(customer);
    if (validation) { setError(validation); return; }
    setSaving(true); setError(null); setSuccess(null);
    try {
      if (estimate) {
        await updateEstimateRelationships(estimate, customer, division);
        if (!estimate.client_id || !estimate.property_id) throw new Error("This historical Estimate is no longer linked to a Client and Property.");
        await updateEstimate(estimate.id, estimatePayload(estimate.client_id, estimate.property_id, customer, division, result, notes, estimate.status));
        await getEstimates();
        setSuccess("Estimate updated successfully.");
      } else {
        const client = await findOrCreateEstimateClient(customer, division);
        const property = await findOrCreateEstimateProperty(client.id, customer, division);
        await createEstimate(estimatePayload(client.id, property.id, customer, division, result, notes, "Open"));
        await getEstimates();
        setSuccess("Estimate saved successfully and is available in Open Estimates.");
        clearNewEstimateDraft();
      }
      onSaved?.();
    } catch (caught) { console.error("Estimate save workflow failed", caught); setError(caught instanceof Error ? caught.message : "The estimate could not be saved. Please try again."); }
    finally { setSaving(false); }
  }

  function clearNewEstimateDraft() {
    suppressDraftSave.current = true;
    restoredDraft.current = false;
    window.sessionStorage.removeItem(estimateDraftKey);
    setCustomer({ ...blankCustomer });
    setDivision("Residential");
    setResidential({ ...defaultResidential, addOns: [] });
    setCommercial({ ...defaultCommercial, additionalServices: [] });
    setNotes("");
    setDraftNotice(null);
  }

  function requestClearDraft() {
    if (hasMeaningfulDraft(customer, division, residential, commercial, notes) && !window.confirm("Clear this unfinished estimate? This action cannot be undone.")) return;
    clearNewEstimateDraft();
    setSuccess("Estimate draft cleared.");
    setError(null);
  }

  return <div className="space-y-6">
    {draftNotice && <Alert kind="success" text={draftNotice} />}{success && <Alert kind="success" text={success} />}{error && <Alert kind="error" text={error} />}
    {!estimate && <div className="flex justify-end"><button type="button" onClick={requestClearDraft} className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-bold text-[#143d1a] hover:border-[#d4af37]">Clear Draft</button></div>}
    <Section title="Customer Information" subtitle="Customer and service-location details are matched automatically when you save.">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <TextField label="First Name" value={customer.firstName} set={(value) => setCustomer({ ...customer, firstName: value })} />
        <TextField label="Last Name" value={customer.lastName} set={(value) => setCustomer({ ...customer, lastName: value })} />
        {division === "Commercial" && <TextField label="Company Name" value={customer.companyName} set={(value) => setCustomer({ ...customer, companyName: value })} />}
        <TextField label="Phone Number" type="tel" value={customer.phone} set={(value) => setCustomer({ ...customer, phone: value })} />
        <TextField label="Email Address" type="email" value={customer.email} set={(value) => setCustomer({ ...customer, email: value })} />
        <div className="sm:col-span-2 xl:col-span-3"><TextField label="Property Address" required value={customer.address} set={(value) => setCustomer({ ...customer, address: value })} /></div>
        <TextField label="Address Line 2" value={customer.addressLine2} set={(value) => setCustomer({ ...customer, addressLine2: value })} />
        <TextField label="City" value={customer.city} set={(value) => setCustomer({ ...customer, city: value })} />
        <div className="grid grid-cols-2 gap-4"><TextField label="State" value={customer.state} set={(value) => setCustomer({ ...customer, state: value })} /><TextField label="ZIP Code" value={customer.zip} set={(value) => setCustomer({ ...customer, zip: value })} /></div>
      </div>
    </Section>
    <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,.75fr)]">
      <div className="space-y-6">
        <Section title="Estimate Calculator" subtitle="Choose a division and configure the service.">
          <DivisionToggle value={division} set={(value) => setDivision(value)} />
          {catalogLoading?<p className="mt-6 rounded-xl bg-neutral-50 p-5 text-sm">Loading current pricing…</p>:calculation.error?<Alert kind="error" text={calculation.error}/>:catalog&&<div className="mt-6">{division === "Residential" ? <ResidentialFields value={residential} set={setResidential} catalog={catalog} /> : <CommercialFields value={commercial} set={setCommercial} catalog={catalog} />}</div>}
        </Section>
        <Section title="Estimate Notes"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className={inputClass} placeholder="Internal estimate notes" /></Section>
      </div>
      {result?<EstimateSummary result={result} frequency={calculatorInput.frequency} saving={saving} save={save} editing={Boolean(estimate)} />:<aside className="rounded-2xl bg-[#143d1a] p-6 text-white"><h2 className="font-extrabold">Pricing unavailable</h2><p className="mt-2 text-sm text-white/70">A valid catalog price is required before this estimate can be saved.</p></aside>}
    </div>
  </div>;
}

function ResidentialFields({ value, set,catalog }: { value: ResidentialCalculatorInput; set: (value: ResidentialCalculatorInput) => void;catalog:ServiceCatalogBundle }) { const services=catalog.services.filter(x=>x.division!=="Commercial").map(x=>x.service_name.replace(/ Cleaning$/,""));const addons=catalog.addons.filter(x=>x.division!=="Commercial").map(x=>x.addon_name);return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
  <SelectField label="Service Type" value={value.serviceType} options={services} set={(v) => set({ ...value, serviceType: v as ResidentialCalculatorInput["serviceType"] })} />
  <SelectField label="Frequency" value={value.frequency} options={frequencies} set={(v) => set({ ...value, frequency: v as Frequency })} />
  <SelectField label="Condition" value={value.condition} options={conditions} set={(v) => set({ ...value, condition: v as Condition })} />
  <NumberField label="Square Feet" value={value.squareFeet} set={(v) => set({ ...value, squareFeet: v })} />
  <NumberField label="Bedrooms" value={value.bedrooms} set={(v) => set({ ...value, bedrooms: v })} />
  <NumberField label="Bathrooms" step="0.5" value={value.bathrooms} set={(v) => set({ ...value, bathrooms: v })} />
  <Check label="Occupied property" checked={value.occupied} set={(v) => set({ ...value, occupied: v })} /><Check label="Pets / heavy pet hair" checked={value.pets} set={(v) => set({ ...value, pets: v })} />
  <NumberField label="Additional Discount %" value={value.additionalDiscountPercent} set={(v) => set({ ...value, additionalDiscountPercent: v })} /><NumberField label="Tax Rate %" step="0.01" value={value.taxRatePercent} set={(v) => set({ ...value, taxRatePercent: v })} />
  <div className="sm:col-span-2 xl:col-span-3"><OptionGrid title="Add-Ons" options={addons} selected={value.addOns} set={(addOns) => set({ ...value, addOns })} /></div>
</div>; }

function CommercialFields({ value, set,catalog }: { value: CommercialCalculatorInput; set: (value: CommercialCalculatorInput) => void;catalog:ServiceCatalogBundle }) { const services=catalog.services.filter(x=>x.division!=="Residential").map(x=>x.service_name.replace(/ Cleaning$/,""));const addons=catalog.addons.filter(x=>x.division!=="Residential").map(x=>x.addon_name);return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
  <SelectField label="Commercial Type" value={value.commercialType} options={services} set={(v) => set({ ...value, commercialType: v })} /><SelectField label="Frequency" value={value.frequency} options={frequencies} set={(v) => set({ ...value, frequency: v as Frequency })} /><SelectField label="Condition" value={value.condition} options={conditions} set={(v) => set({ ...value, condition: v as Condition })} />
  <NumberField label="Square Feet" value={value.squareFeet} set={(v) => set({ ...value, squareFeet: v })} /><NumberField label="Floors" value={value.floors} set={(v) => set({ ...value, floors: v })} /><NumberField label="Restrooms" value={value.restrooms} set={(v) => set({ ...value, restrooms: v })} /><NumberField label="Kitchens / Breakrooms" value={value.kitchens} set={(v) => set({ ...value, kitchens: v })} /><NumberField label="Stations / Booths" value={value.stations} set={(v) => set({ ...value, stations: v })} /><NumberField label="Number of Units" value={value.units} set={(v) => set({ ...value, units: v })} /><NumberField label="Target Completion Hours" step="0.5" value={value.targetCompletionHours} set={(v) => set({ ...value, targetCompletionHours: v })} /><NumberField label="Worker Hourly Pay" step="0.01" value={value.workerHourlyPay} set={(v) => set({ ...value, workerHourlyPay: v })} /><NumberField label="Target Profit Margin %" value={value.targetProfitMarginPercent} set={(v) => set({ ...value, targetProfitMarginPercent: v })} /><NumberField label="Additional Discount %" value={value.additionalDiscountPercent} set={(v) => set({ ...value, additionalDiscountPercent: v })} /><NumberField label="Tax Rate %" step="0.01" value={value.taxRatePercent} set={(v) => set({ ...value, taxRatePercent: v })} />
  <div className="sm:col-span-2 xl:col-span-3"><OptionGrid title="Additional Services" options={addons} selected={value.additionalServices} set={(additionalServices) => set({ ...value, additionalServices })} /></div>
</div>; }

function EstimateSummary({ result, frequency, saving, save, editing }: { result: EstimateResult; frequency: Frequency; saving: boolean; save: () => Promise<void>; editing: boolean }) { const rows = [["Service", result.serviceName], ["Per Visit Price", currency(result.finalPrice)], ["Frequency", frequency], ["Monthly Contract", result.monthlyPrice == null ? "—" : currency(result.monthlyPrice)], ["Labor Hours", `${result.laborHours} hrs`], ["Crew Size", String(result.crewSize)], ["Duration", `${result.estimatedDuration} hrs`], ["Estimated Profit", currency(result.estimatedProfit)], ["One-Time Price", currency(result.oneTimePrice)], ["Discounts", `-${currency(result.totalDiscount)}`], ["Taxes", currency(result.taxes)]]; return <aside className="sticky top-6 overflow-hidden rounded-2xl border border-[#143d1a]/10 bg-[#143d1a] text-white shadow-[0_18px_45px_rgba(20,61,26,.2)]"><div className="border-b border-white/10 p-6"><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#d4af37]">Live calculation</p><h2 className="mt-2 text-xl font-extrabold">Estimate Summary</h2></div><dl className="divide-y divide-white/10 px-6">{rows.map(([label, display]) => <div key={label} className="flex justify-between gap-4 py-3 text-sm"><dt className="text-white/60">{label}</dt><dd className="text-right font-bold">{display}</dd></div>)}</dl><div className="bg-[#0d2b12] p-6"><p className="text-xs font-bold uppercase tracking-[.12em] text-white/55">Final Price</p><p className="mt-1 text-4xl font-extrabold text-[#d4af37]">{currency(result.finalPrice)}</p><button type="button" disabled={saving} onClick={() => void save()} className="mt-5 w-full rounded-lg bg-[#d4af37] px-5 py-3 text-sm font-extrabold text-[#143d1a] hover:bg-[#e1c056] disabled:opacity-60">{saving ? "Saving…" : editing ? "Update Estimate" : "Save Estimate"}</button></div></aside>; }

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-[0_8px_25px_rgba(20,61,26,.045)] sm:p-6"><h2 className="text-lg font-extrabold text-[#143d1a]">{title}</h2>{subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}<div className="mt-5">{children}</div></section>; }
function DivisionToggle({ value, set }: { value: EstimateDivision; set: (value: EstimateDivision) => void }) { return <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#f1f4f0] p-1.5">{(["Residential", "Commercial"] as const).map((item) => <button type="button" key={item} onClick={() => set(item)} className={`rounded-lg px-4 py-3 text-sm font-bold ${value === item ? "bg-white text-[#143d1a] shadow-sm" : "text-neutral-500"}`}>{item}</button>)}</div>; }
function TextField({ label, value, set, type = "text", required }: { label: string; value: string; set: (value: string) => void; type?: string; required?: boolean }) { return <label className="block"><Label text={label} required={required} /><input type={type} value={value} onChange={(e) => set(e.target.value)} className={inputClass} /></label>; }
function NumberField({ label, value, set, step = "1" }: { label: string; value: number; set: (value: number) => void; step?: string }) { return <label className="block"><Label text={label} /><input type="number" min="0" step={step} value={value} onChange={(e) => set(Number(e.target.value))} className={inputClass} /></label>; }
function SelectField({ label, value, set, options }: { label: string; value: string; set: (value: string) => void; options: readonly string[] }) { return <label className="block"><Label text={label} /><select value={value} onChange={(e) => set(e.target.value)} className={inputClass}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>; }
function Check({ label, checked, set }: { label: string; checked: boolean; set: (value: boolean) => void }) { return <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 px-3.5 text-sm font-semibold text-neutral-700"><input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} className="size-4 accent-[#143d1a]" />{label}</label>; }
function OptionGrid({ title, options, selected, set }: { title: string; options: readonly string[]; selected: string[]; set: (value: string[]) => void }) { return <fieldset><legend className="mb-2 text-xs font-bold text-neutral-700">{title}</legend><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{options.map((option) => <Check key={option} label={option} checked={selected.includes(option)} set={(checked) => set(checked ? [...selected, option] : selected.filter((item) => item !== option))} />)}</div></fieldset>; }
function Label({ text, required }: { text: string; required?: boolean }) { return <span className="mb-2 block text-xs font-bold text-neutral-700">{text}{required && <span className="ml-1 text-[#9a7a17]">*</span>}</span>; }
function Alert({ kind, text }: { kind: "success" | "error"; text: string }) { return <div role={kind === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-[#143d1a]/15 bg-[#edf4ec] text-[#143d1a]"}`}>{text}</div>; }
function validateCustomer(customer: CustomerInformation): string | null { if (!customer.firstName.trim() && !customer.lastName.trim() && !customer.companyName.trim() && !customer.email.trim() && !customer.phone.trim()) return "Enter a name, company, email, or phone number to identify the client."; if (!customer.address.trim()) return "Enter the property address before saving."; return null; }
function isEstimateDraft(value: unknown): value is EstimateDraft { if (!value || typeof value !== "object") return false; const draft=value as Partial<EstimateDraft>; return draft.version===1&&(draft.division==="Residential"||draft.division==="Commercial")&&typeof draft.notes==="string"&&Boolean(draft.customer&&typeof draft.customer==="object")&&draft.residential?.division==="Residential"&&Array.isArray(draft.residential.addOns)&&draft.commercial?.division==="Commercial"&&Array.isArray(draft.commercial.additionalServices); }
function hasMeaningfulDraft(customer: CustomerInformation, division: EstimateDivision, residential: ResidentialCalculatorInput, commercial: CommercialCalculatorInput, notes: string): boolean { return Object.values(customer).some((value)=>value.trim())||division!=="Residential"||notes.trim()!==""||JSON.stringify(residential)!==JSON.stringify(defaultResidential)||JSON.stringify(commercial)!==JSON.stringify(defaultCommercial); }
function estimatePayload(clientId: string, propertyId: string, customer: CustomerInformation, division: EstimateDivision, result: EstimateResult, notes: string, status: "Open" | "Archived") { return { client_id: clientId, property_id: propertyId, division, customer_first_name: clean(customer.firstName), customer_last_name: clean(customer.lastName), customer_phone: clean(customer.phone), customer_email: clean(customer.email), customer_address: customer.address.trim(), frequency: result.calculatorInput.frequency, service_name: result.serviceName, status, result, notes: clean(notes) }; }
function customerFromEstimate(estimate: EstimateWithRelations): CustomerInformation { return { firstName: estimate.customer_first_name ?? "", lastName: estimate.customer_last_name ?? "", companyName: estimate.client?.company_name ?? "", phone: estimate.customer_phone ?? "", email: estimate.customer_email ?? "", address: estimate.property?.address ?? estimate.customer_address ?? "", addressLine2: estimate.property?.address_line_2 ?? "", city: estimate.property?.city ?? "", state: estimate.property?.state ?? "", zip: estimate.property?.zip ?? "" }; }
function clean(value: string): string | null { return value.trim() || null; }
function currency(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
const inputClass = "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 outline-none transition focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
