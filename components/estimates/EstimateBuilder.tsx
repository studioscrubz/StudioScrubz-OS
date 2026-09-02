"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { calculatePostConstructionCatalogEstimate, calculateCommercialEstimate, calculateResidentialEstimate } from "@/lib/pricing/estimates";
import { withAuthoritativeEstimatePrice } from "@/lib/pricing/authoritativePrice";
import { matchingRecurringRules } from "@/lib/pricing/pricingEngine";
import { createEstimate, findOrCreateEstimateClient, findOrCreateEstimateProperty, getEstimates, updateEstimate, updateEstimateRelationships } from "@/lib/services/estimates";
import { getAvailableServiceAddons, getServiceCatalog, isPostConstructionCatalogService } from "@/lib/services/serviceCatalog";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import type { CalculatorInput, CommercialCalculatorInput, Condition, CustomerInformation, EstimateDivision, EstimateResult, EstimateWithRelations, Frequency, PostConstructionCalculatorInput, PostConstructionDetailLevel, PostConstructionSeverity, ResidentialCalculatorInput } from "@/types/estimate";
import type { RecurringPricingRule, ServiceCatalogBundle } from "@/types/serviceCatalog";
import { CatalogAddonPicker } from "@/components/serviceCatalog/CatalogAddonPicker";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getClients } from "@/lib/services/clients";
import { getProperties } from "@/lib/services/properties";
import type { Client } from "@/types/client";
import type { PropertyWithClient } from "@/types/property";
import { UsStateSelect } from "@/components/forms/UsStateSelect";
import type { BusinessSettings } from "@/types/businessSettings";
import { serviceFrequencyLabel } from "@/lib/scheduling/frequency";
import { PostConstructionCalculatorFields } from "@/components/estimates/PostConstructionCalculatorFields";
import { PostConstructionBidSummary } from "@/components/estimates/PostConstructionBidSummary";

const frequencies: Frequency[] = ["One-Time", "Daily", "Weekly", "Biweekly", "Twice Monthly", "Monthly", "Custom"];
const frequencyLabels = new Map(frequencies.map((frequency) => [frequency, serviceFrequencyLabel(frequency)]));
const conditions: Condition[] = ["Light", "Average", "Heavy", "Extreme"];
const blankCustomer: CustomerInformation = { firstName: "", lastName: "", companyName: "", phone: "", email: "", address: "", addressLine2: "", city: "", state: "", zip: "" };
const defaultResidential: ResidentialCalculatorInput = { division: "Residential", serviceType: "Standard", frequency: "One-Time", condition: "Average", squareFeet: 1000, bedrooms: 2, bathrooms: 1, occupied: true, pets: false, additionalDiscountPercent: 0, taxRatePercent: 0, addOns: [] };
const defaultCommercial: CommercialCalculatorInput = { division: "Commercial", commercialType: "Office", frequency: "One-Time", squareFeet: 2500, floors: 1, restrooms: 2, kitchens: 1, stations: 0, units: 0, condition: "Average", targetCompletionHours: 4, workerHourlyPay: 22, targetProfitMarginPercent: 35, additionalDiscountPercent: 0, taxRatePercent: 0, additionalServices: [] };
const defaultPostConstruction: PostConstructionCalculatorInput = { calculatorType: "Post-Construction", division: "Residential", serviceType: "Post-Construction Cleaning", frequency: "One-Time", squareFeet: 2500, floors: 1, rooms: 0, bathrooms: 0, kitchens: 0, condition: "Average", dustSeverity: "Average", debrisSeverity: "Average", detailLevel: "Detailed", windowsOrGlassCount: 0, cabinetOrDrawerCount: 0, applianceInteriorCount: 0, stairFlights: 0, targetProjectDays: 1, workdayHours: 8, workerHourlyPay: 40, targetProfitMarginPercent: 35, additionalDiscountPercent: 0, taxRatePercent: 0, additionalServices: [] };
const estimateDraftKey = "studioscrubz:estimate-draft";

type EstimateDraft = {
  version: 1;
  customer: CustomerInformation;
  division: EstimateDivision;
  residential: ResidentialCalculatorInput;
  commercial: CommercialCalculatorInput;
  postConstruction?: PostConstructionCalculatorInput;
  serviceDescription: string;
  notes: string;
  terms?: string;
  manualPrice?: number | null;
};
type EstimateDraftDefaults = { residential:ResidentialCalculatorInput;commercial:CommercialCalculatorInput;postConstruction:PostConstructionCalculatorInput;serviceDescription:string;notes:string;terms:string };

export function EstimateBuilder({ estimate, onSaved }: { estimate?: EstimateWithRelations; onSaved?: () => void }) {
  const router = useRouter();
  const initialCustomer = estimate ? customerFromEstimate(estimate) : blankCustomer;
  const initialInput = estimate?.result.calculatorInput;
  const [customer, setCustomer] = useState(initialCustomer);
  const [division, setDivision] = useState<EstimateDivision>(estimate?.division ?? "Residential");
  const [residential, setResidential] = useState<ResidentialCalculatorInput>(initialInput?.division === "Residential" && !isPostConstructionInput(initialInput) ? initialInput : isPostConstructionInput(initialInput)&&estimate?.division==="Residential"?{...defaultResidential,serviceType:"Post-Construction"}:defaultResidential);
  const [commercial, setCommercial] = useState<CommercialCalculatorInput>(initialInput?.division === "Commercial" && !isPostConstructionInput(initialInput) ? initialInput : isPostConstructionInput(initialInput)&&estimate?.division==="Commercial"?{...defaultCommercial,commercialType:"Post-Construction"}:defaultCommercial);
  const [postConstruction, setPostConstruction] = useState<PostConstructionCalculatorInput>(isPostConstructionInput(initialInput) ? initialInput : defaultPostConstruction);
  const [serviceDescription, setServiceDescription] = useState(estimate?.result.serviceDescription ?? "");
  const [notes, setNotes] = useState(estimate?.notes ?? "");
  const [terms, setTerms] = useState(estimate?.terms ?? "");
  const [manualPrice, setManualPrice] = useState<number | null>(estimate?.result.manualPrice ?? null);
  const [defaults,setDefaults]=useState<BusinessSettings|null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(Boolean(estimate));
  const [catalog,setCatalog]=useState<ServiceCatalogBundle|null>(null);
  const [catalogLoading,setCatalogLoading]=useState(true);
  const [clients,setClients]=useState<Client[]>([]);
  const [properties,setProperties]=useState<PropertyWithClient[]>([]);
  const [selectedClientId,setSelectedClientId]=useState("");
  const [selectedPropertyId,setSelectedPropertyId]=useState("");
  const restoredDraft = useRef(false);
  const suppressDraftSave = useRef(false);
  const pendingCatalogSelection = useRef<{ division: EstimateDivision; selection: string } | null>(null);
  const activeSelection=division==="Residential"?residential.serviceType:commercial.commercialType;
  const selectedService=catalog?selectedCatalogService(catalog,division,activeSelection):undefined;
  const historicalPostConstructionFallback=isPostConstructionInput(initialInput);
  const postConstructionMode=isPostConstructionCatalogService(selectedService)||historicalPostConstructionFallback;
  const calculatorInput: CalculatorInput = postConstructionMode ? {...postConstruction,division,serviceCode:selectedService?.service_code??postConstruction.serviceCode??null} : division === "Residential" ? residential : commercial;
  const draftDefaults=useMemo<EstimateDraftDefaults>(()=>({residential:{...defaultResidential,taxRatePercent:0,addOns:[]},commercial:{...defaultCommercial,taxRatePercent:0,additionalServices:[]},postConstruction:{...defaultPostConstruction,taxRatePercent:0,additionalServices:[]},serviceDescription:catalog?selectedCatalogService(catalog,"Residential",defaultResidential.serviceType)?.description?.trim()??"":"",notes:defaults?.default_estimate_notes??"",terms:defaults?.default_estimate_terms??""}),[catalog,defaults]);
  useOperationalRealtime(["services", "service_addons", "service_addon_links", "service_price_tiers", "recurring_pricing_rules"], async () => {
    setCatalog(await getServiceCatalog());
  });
  function loadCustomerOptions() { return Promise.all([getClients(),getProperties()]).then(([nextClients,nextProperties])=>{setClients(nextClients);setProperties(nextProperties)}); }
  useOperationalRealtime(["clients", "properties"], loadCustomerOptions);
  useEffect(()=>{if(!estimate)void loadCustomerOptions().catch(x=>setError(x instanceof Error?x.message:"Clients and properties could not be loaded."))},[estimate]);
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
          setPostConstruction(parsed.postConstruction ?? defaultPostConstruction);
          setServiceDescription(parsed.serviceDescription ?? "");
          setNotes(parsed.notes);
          setTerms(parsed.terms??"");
          setManualPrice(parsed.manualPrice ?? null);
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
  useEffect(()=>{let active=true;void Promise.all([getServiceCatalog(),getBusinessSettings()]).then(([loaded,settings])=>{if(!active)return;setCatalog(loaded);setDefaults(settings);const pending=pendingCatalogSelection.current;if(pending){const selected=selectedCatalogService(loaded,pending.division,pending.selection);setServiceDescription(selected?.description?.trim()??"");pendingCatalogSelection.current=null}else if(!restoredDraft.current&&!estimate&&!serviceDescription.trim()){const selected=selectedCatalogService(loaded,division,division==="Residential"?residential.serviceType:commercial.commercialType);setServiceDescription(selected?.description?.trim()??"")}if(!estimate&&!restoredDraft.current){setNotes(value=>value||settings.default_estimate_notes||"");setTerms(settings.default_estimate_terms??"")}}).catch((x:unknown)=>{if(active)setError(x instanceof Error?x.message:"Pricing catalog could not be loaded.")}).finally(()=>{if(active)setCatalogLoading(false)});return()=>{active=false}},[estimate]);
  useEffect(() => {
    if (estimate || !draftReady) return;
    if (suppressDraftSave.current) {
      suppressDraftSave.current = false;
      window.sessionStorage.removeItem(estimateDraftKey);
      return;
    }
    if (!hasMeaningfulDraft(customer, division, residential, commercial, postConstruction, serviceDescription, notes, terms, draftDefaults)) {
      window.sessionStorage.removeItem(estimateDraftKey);
      return;
    }
    const draft: EstimateDraft = { version: 1, customer, division, residential, commercial, postConstruction, serviceDescription, notes, terms, manualPrice };
    try {
      window.sessionStorage.setItem(estimateDraftKey, JSON.stringify(draft));
    } catch (caught) {
      console.warn("Estimate draft could not be saved", caught);
    }
  }, [commercial, customer, division, draftDefaults, draftReady, estimate, manualPrice, notes, postConstruction, residential, serviceDescription, terms]);
  const calculation = useMemo(() => {if(!catalog)return{result:null,error:null};try{return{result:postConstructionMode?calculatePostConstructionCatalogEstimate({...postConstruction,division},catalog,selectedService):division === "Residential" ? calculateResidentialEstimate(residential,catalog,defaults?.upkeep_adjustment_percent ?? 30) : calculateCommercialEstimate(commercial,catalog),error:null}}catch(x){return{result:null,error:x instanceof Error?x.message:"Pricing could not be calculated."}}}, [catalog,commercial, defaults?.upkeep_adjustment_percent, division, postConstruction, postConstructionMode, residential, selectedService]);
  const result=calculation.result?withAuthoritativeEstimatePrice({...calculation.result,serviceDescription:serviceDescription.trim()||null},manualPrice):null;

  function selectCatalogService(nextDivision:EstimateDivision, selection:string) { if (!catalog) { pendingCatalogSelection.current={division:nextDivision,selection}; return; } const service=selectedCatalogService(catalog,nextDivision,selection); setServiceDescription(service?.description?.trim()??""); }

  function selectExistingClient(clientId:string) {
    setSelectedClientId(clientId);setSelectedPropertyId("");
    const client=clients.find(entry=>entry.id===clientId);
    if(!client){setCustomer({...blankCustomer});return}
    setCustomer({firstName:client.first_name??"",lastName:client.last_name??"",companyName:client.company_name??"",phone:client.phone??"",email:client.email??"",address:"",addressLine2:"",city:"",state:"",zip:""});
  }

  function selectExistingProperty(propertyId:string) {
    setSelectedPropertyId(propertyId);
    const property=properties.find(entry=>entry.id===propertyId&&entry.client_id===selectedClientId);
    setCustomer(current=>({...current,address:property?.address??"",addressLine2:property?.address_line_2??"",city:property?.city??"",state:property?.state??"",zip:property?.zip??""}));
  }

  function updateLocation(field:"address"|"addressLine2"|"city"|"state"|"zip",value:string) { setSelectedPropertyId("");setCustomer(current=>({...current,[field]:value})); }

  function changeDivision(value:EstimateDivision) {
    if(value!==division){setSelectedClientId("");setSelectedPropertyId("")}
    setDivision(value);
    selectCatalogService(value,value==="Residential"?residential.serviceType:commercial.commercialType);
  }

  async function save() {
    if(!result){setError(calculation.error??"Pricing is not ready.");return}
    const validation = validateCustomer(customer);
    if (validation) { setError(validation); return; }
    if (calculatorInput.frequency === "Custom" && (!Number.isInteger(calculatorInput.customIntervalDays) || !calculatorInput.customIntervalDays || calculatorInput.customIntervalDays < 1)) { setError("Enter a whole-number custom interval of at least 1 day."); return; }
    setSaving(true); setError(null); setSuccess(null);
    try {
      if (estimate) {
        await updateEstimateRelationships(estimate, customer, division);
        if (!estimate.client_id || !estimate.property_id) throw new Error("This historical Estimate is no longer linked to a Client and Property.");
        await updateEstimate(estimate.id, estimatePayload(estimate.client_id, estimate.property_id, customer, division, result, notes, terms, estimate.status));
        await getEstimates();
        setSuccess("Estimate updated successfully.");
      } else {
        const selectedClient = selectedClientId ? clients.find((entry)=>entry.id===selectedClientId) : null;
        if (selectedClientId && !selectedClient) throw new Error("The selected client no longer exists. Choose another client.");
        if (selectedClient?.archived_at) throw new Error("The selected client is archived. Choose an active client.");
        if (selectedClient && selectedClient.client_type!==division&&selectedClient.client_type!=="Contractor") throw new Error(`The selected client must be a ${division} or Contractor client.`);
        const client = selectedClient ?? await findOrCreateEstimateClient(customer, division);
        const selectedProperty = selectedPropertyId ? properties.find((entry)=>entry.id===selectedPropertyId) : null;
        if (selectedPropertyId && !selectedProperty) throw new Error("The selected property no longer exists. Choose another property.");
        if (selectedProperty?.archived_at) throw new Error("The selected property is archived. Choose an active property.");
        if (selectedProperty && selectedProperty.client_id!==client.id) throw new Error("The selected property does not belong to the selected client.");
        if (selectedProperty && selectedProperty.property_type!==division) throw new Error(`The selected property must be a ${division} property.`);
        const property = selectedProperty ?? await findOrCreateEstimateProperty(client.id, customer, division);
        await createEstimate(estimatePayload(client.id, property.id, customer, division, result, notes, terms, "Open"));
        await getEstimates();
        setSuccess("Estimate saved successfully and is available in Open Estimates.");
        clearNewEstimateDraft();
      }
      onSaved?.();
      if (!estimate) router.push("/open-estimates");
    } catch (caught) { console.error("Estimate save workflow failed", caught); setError(caught instanceof Error ? caught.message : "The estimate could not be saved. Please try again."); }
    finally { setSaving(false); }
  }

  function clearNewEstimateDraft() {
    suppressDraftSave.current = true;
    restoredDraft.current = false;
    window.sessionStorage.removeItem(estimateDraftKey);
    setCustomer({ ...blankCustomer });
    setDivision("Residential");
    setResidential({ ...draftDefaults.residential, addOns: [] });
    setCommercial({ ...draftDefaults.commercial, additionalServices: [] });
    setPostConstruction({ ...draftDefaults.postConstruction, additionalServices: [] });
    setServiceDescription(draftDefaults.serviceDescription);
    setNotes(draftDefaults.notes);
    setTerms(draftDefaults.terms);
    setDraftNotice(null);
    setSelectedClientId("");
    setSelectedPropertyId("");
  }

  function requestClearDraft() {
    if (hasMeaningfulDraft(customer, division, residential, commercial, postConstruction, serviceDescription, notes, terms, draftDefaults) && !window.confirm("Clear this unfinished estimate? This action cannot be undone.")) return;
    clearNewEstimateDraft();
    setSuccess("Estimate draft cleared.");
    setError(null);
  }

  return <div className="space-y-6">
    {draftNotice && <Alert kind="success" text={draftNotice} />}{success && <Alert kind="success" text={success} />}{error && <Alert kind="error" text={error} />}
    {!estimate && <div className="flex justify-end"><button type="button" onClick={requestClearDraft} className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-bold text-[#143d1a] hover:border-[#d4af37]">Clear Draft</button></div>}
    <Section title="Customer Information" subtitle="Customer and service-location details are matched automatically when you save.">
      {!estimate && <div className="mb-5 grid gap-4 rounded-xl border border-[#143d1a]/10 bg-[#f7f9f6] p-4 sm:grid-cols-2">
        <SelectField label="Existing Client" value={selectedClientId} options={["",...clients.filter(entry=>!entry.archived_at&&(entry.client_type===division||entry.client_type==="Contractor")).map(entry=>entry.id)]} labels={new Map(clients.map(entry=>[entry.id,clientOptionLabel(entry)]))} placeholder="New client / enter details below" set={selectExistingClient} />
        {selectedClientId && <SelectField label="Existing Property" value={selectedPropertyId} options={["",...properties.filter(entry=>entry.client_id===selectedClientId&&!entry.archived_at&&entry.property_type===division).map(entry=>entry.id)]} labels={new Map(properties.map(entry=>[entry.id,propertyOptionLabel(entry)]))} placeholder="New property / enter location below" set={selectExistingProperty} />}
      </div>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <TextField label="First Name" value={customer.firstName} set={(value) => setCustomer({ ...customer, firstName: value })} />
        <TextField label="Last Name" value={customer.lastName} set={(value) => setCustomer({ ...customer, lastName: value })} />
        {division === "Commercial" && <TextField label="Company Name" value={customer.companyName} set={(value) => setCustomer({ ...customer, companyName: value })} />}
        <TextField label="Phone Number" type="tel" value={customer.phone} set={(value) => setCustomer({ ...customer, phone: value })} />
        <TextField label="Email Address" type="email" value={customer.email} set={(value) => setCustomer({ ...customer, email: value })} />
        <div className="sm:col-span-2 xl:col-span-3"><TextField label="Property Address" required value={customer.address} set={(value) => updateLocation("address",value)} /></div>
        <TextField label="Address Line 2" value={customer.addressLine2} set={(value) => updateLocation("addressLine2",value)} />
        <TextField label="City" value={customer.city} set={(value) => updateLocation("city",value)} />
        <div className="grid grid-cols-2 gap-4"><label className="block"><Label text="State" /><UsStateSelect value={customer.state} onChange={(value)=>updateLocation("state",value)} className={inputClass}/></label><TextField label="ZIP Code" value={customer.zip} set={(value) => updateLocation("zip",value)} /></div>
      </div>
    </Section>
    <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,.75fr)]">
      <div className="space-y-6">
        <Section title="Estimate Calculator" subtitle="Choose a division and configure the service.">
          <DivisionToggle value={division} set={changeDivision} />
          {catalogLoading?<p className="mt-6 rounded-xl bg-neutral-50 p-5 text-sm">Loading current pricing…</p>:catalog&&<div className="mt-6">{calculation.error&&<div className="mb-4"><Alert kind="error" text={calculation.error}/></div>}{division === "Residential" ? <ResidentialFields value={residential} set={setResidential} postConstruction={postConstruction} setPostConstruction={setPostConstruction} catalog={catalog} serviceChanged={(selection)=>selectCatalogService("Residential",selection)} /> : <CommercialFields value={commercial} set={setCommercial} postConstruction={postConstruction} setPostConstruction={setPostConstruction} catalog={catalog} serviceChanged={(selection)=>selectCatalogService("Commercial",selection)} />}</div>}
        </Section>
        <Section title="Service Description" subtitle="Copied from the selected Service Catalog entry and saved with this Estimate."><div className="min-h-24 whitespace-pre-line rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm text-neutral-700">{serviceDescription||"No service description available."}</div></Section>
        <Section title="Estimate Notes"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className={inputClass} placeholder="Internal estimate notes" /></Section>
        <Section title="Estimate Terms & Conditions"><textarea value={terms} onChange={(event) => setTerms(event.target.value)} rows={6} className={inputClass} placeholder="Terms shown on the client Estimate" /></Section>
      </div>
      {result?(postConstructionMode?<PostConstructionBidSummary result={result} manualPrice={manualPrice} setManualPrice={setManualPrice} saving={saving} save={save} editing={Boolean(estimate)}/>:<EstimateSummary result={result} frequency={calculatorInput.frequency} manualPrice={manualPrice} setManualPrice={setManualPrice} saving={saving} save={save} editing={Boolean(estimate)} />):<aside className="rounded-2xl bg-[#143d1a] p-6 text-white"><h2 className="font-extrabold">Pricing unavailable</h2><p className="mt-2 text-sm text-white/70">A valid catalog price is required before this estimate can be saved.</p></aside>}
    </div>
  </div>;
}

function ResidentialFields({ value, set,postConstruction,setPostConstruction,catalog,serviceChanged }: { value: ResidentialCalculatorInput; set: (value: ResidentialCalculatorInput) => void;postConstruction:PostConstructionCalculatorInput;setPostConstruction:(value:PostConstructionCalculatorInput)=>void;catalog:ServiceCatalogBundle;serviceChanged:(selection:string)=>void }) { const services=catalog.services.filter(x=>x.division!=="Commercial").map(x=>x.service_name.replace(/ Cleaning$/,""));const service=selectedCatalogService(catalog,"Residential",value.serviceType);const addons=service?getAvailableServiceAddons(catalog,service.id,"Residential"):[];const postMode=isPostConstructionCatalogService(service);return <div className="space-y-6">
  <SelectField label="Service Type" value={value.serviceType} options={services} set={(v) => {const selected=selectedCatalogService(catalog,"Residential",v);set({ ...value, serviceType:v,...(!isPostConstructionCatalogService(selected)?{frequency:v==="StudioScrubz Upkeep Plan"?"Monthly":value.frequency,recurringPricingRuleId:null,addOns:[],addonSelections:[],...(selected?.pricing_config.requires_complete_prэлийн_config?{targetProjectDays:value.targetProjectDays??3,workdayHours:value.workdayHours??8}:{})}:{}) });serviceChanged(v)}} />
  {postMode?<PostConstructionCalculatorFields value={{...postConstruction,division:"Residential",serviceCode:service?.service_code??null}} onChange={setPostConstruction} service={service} catalog={catalog}/>:<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
  <SelectField label="Frequency" value={value.frequency} options={frequencies} labels={frequencyLabels} set={(v) => set({ ...value, frequency: v as Frequency, recurringPricingRuleId:null })} />
  <RecurringRuleField serviceId={service?.id} frequency={value.frequency} rules={catalog.recurringRules} value={value.recurringPricingRuleId??""} set={(recurringPricingRuleId)=>set({...value,recurringPricingRuleId:recurringPricingRuleId||null})}/>
  <SelectField label="Condition" value={value.condition} options={conditions} set={(v) => set({ ...value, condition: v as Condition })} />
  <NumberField label="Square Feet" value={value.squareFeet} set={(v) => set({ ...value, squareFeet: v })} />
  <NumberField label="Bedrooms" value={value.bedrooms} set={(v) => set({ ...value, bedrooms: v })} />
  <NumberField label="Bathrooms" step="0.5" value={value.bathrooms} set={(v) => set({ ...value, bathrooms: v })} />
  {service?.pricing_config.requires_complete_pricing_config&&<ProjectDurationFields days={value.targetProjectDays??3} workdayHours={value.workdayHours??8} setDays={(targetProjectDays)=>set({...value,targetProjectDays})} setWorkdayHours={(workdayHours)=>set({...value,workdayHours})}/>}
  <Check label="Occupied property" checked={value.occupied} set={(v) => set({ ...value, occupied: v })} /><Check label="Pets / heavy pet hair" checked={value.pets} set={(v) => set({ ...value, pets: v })} />
  <NumberField label="Additional Discount %" value={value.additionalDiscountPercent} set={(v) => set({ ...value, additionalDiscountPercent: v })} />
  <div className="sm:col-span-2 xl:col-span-3"><CatalogAddonPicker addons={addons} selected={value.addOns} setSelected={(addOns) => set({ ...value, addOns })} snapshots={value.addonSelections} setSnapshots={(addonSelections) => set({ ...value, addonSelections })} /></div></div>}
</div>; }

function CommercialFields({ value, set, postConstruction, setPostConstruction, catalog, serviceChanged }: { value: CommercialCalculatorInput; set: (value: CommercialCalculatorInput) => void; postConstruction: PostConstructionCalculatorInput; setPostConstruction: (value: PostConstructionCalculatorInput) => void; catalog: ServiceCatalogBundle; serviceChanged: (selection: string) => void }) {
  const services=catalog.services.filter(x=>x.division!=="Residential").map(x=>x.service_name.replace(/ Cleaning$/,""));
  const service=selectedCatalogService(catalog,"Commercial",value.commercialType);
  const addons=service?getAvailableServiceAddons(catalog,service.id,"Commercial"):[];
  function selectService(next:string){
    const selected=selectedCatalogService(catalog,"Commercial",next);
    if(isPostConstructionCatalogService(selected)){
      set({...value,commercialType:next});
    }else{
      const config=selected?.pricing_config;
      set({ ...value, commercialType:next,recurringPricingRuleId:null,additionalServices:[],addonSelections:[],...(config?.requires_complete_pricing_config?{targetCompletionHours:Number(config.default_target_completion_hours),workerHourlyPay:Number(config.default_worker_hourly_pay),targetProfitMarginPercent:Number(config.default_target_profit_margin_percent),targetProjectDays:value.targetProjectDays??3,workdayHours:value.workdayHours??8}:{}) });
    }
    serviceChanged(next);
  }
  return <div className="space-y-6">
    <SelectField label="Commercial Type" value={value.commercialType} options={services} set={selectService}/>
    {isPostConstructionCatalogService(service)?<PostConstructionCalculatorFields value={{...postConstruction,division:"Commercial",serviceCode:service?.service_code??null}} onChange={setPostConstruction} service={service} catalog={catalog}/>:<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <SelectField label="Frequency" value={value.frequency} options={frequencies} labels={frequencyLabels} set={(v) => set({ ...value, frequency: v as Frequency, customIntervalDays:v === "Custom" ? value.customIntervalDays ?? 1 : null, recurringPricingRuleId:null })} />{value.frequency === "Custom" && <CustomIntervalField value={value.customIntervalDays} set={(customIntervalDays) => set({ ...value, customIntervalDays })}/>}<RecurringRuleField serviceId={service?.id} frequency={value.frequency} rules={catalog.recurringRules} value={value.recurringPricingRuleId??""} set={(recurringPricingRuleId)=>set({...value,recurringPricingRuleId:recurringPricingRuleId||null})}/><SelectField label="Condition" value={value.condition} options={conditions} set={(v) => set({ ...value, condition: v as Condition })} />
      <NumberField label="Square Feet" value={value.squareFeet} set={(v) => set({ ...value, squareFeet: v })} /><NumberField label="Floors" value={value.floors} set={(v) => set({ ...value, floors: v })} /><NumberField label="Restrooms" value={value.restrooms} set={(v) => set({ ...value, restrooms: v })} /><NumberField label="Kitchens / Breakrooms" value={value.kitchens} set={(v) => set({ ...value, kitchens: v })} /><NumberField label="Stations / Booths" value={value.stations} set={(v) => set({ ...value, stations: v })} /><NumberField label="Number of Units" value={value.units} set={(v) => set({ ...value, units: v })} /><NumberField label="Target Completion Hours" step="0.5" value={value.targetCompletionHours} set={(v) => set({ ...value, targetCompletionHours: v })} /><NumberField label="Worker Hourly Pay" step="0.01" value={value.workerHourlyPay} set={(v) => set({ ...value, workerHourlyPay: v })} /><NumberField label="Target Profit Margin %" value={value.targetProfitMarginPercent} set={(v) => set({ ...value, targetProfitMarginPercent: v })} /><NumberField label="Additional Discount %" value={value.additionalDiscountPercent} set={(v) => set({ ...value, additionalDiscountPercent: v })} />
      {service?.pricing_config.requires_complete_pricing_config&&<ProjectDurationFields days={value.targetProjectDays??3} workdayHours={value.workdayHours??8} setDays={(targetProjectDays)=>set({...value,targetProjectDays})} setWorkdayHours={(workdayHours)=>set({...value,workdayHours})}/>}
      <div className="sm:col-span-2 xl:col-span-3"><CatalogAddonPicker addons={addons} selected={value.additionalServices} setSelected={(additionalServices) => set({ ...value, additionalServices })} snapshots={value.addonSelections} setSnapshots={(addonSelections) => set({ ...value, addonSelections })} /></div>
    </div>}
  </div>;
}

function PostConstructionFields({value,set,service,addons,catalog}:{value:PostConstructionCalculatorInput;set:(value:PostConstructionCalculatorInput)=>void;service:ServiceCatalogBundle["services"][number]|undefined;addons:ServiceCatalogBundle["addons"];catalog:ServiceCatalogBundle}){
  const severity:PostConstructionSeverity[]=["Light","Average","Heavy","Extreme"];
  const detail:PostConstructionDetailLevel[]=["Standard","Detailed","High Detail"];
  return <div className="space-y-6">
  <FieldGroup title="Property / Project"><NumberField label="Square Feet" value={value.squareFeet} set={(squareFeet)=>set({...value,squareFeet})}/><NumberField label="Floors" value={value.floors} set={(floors)=>set({...value,floors})}/><NumberField label="Rooms" value={value.rooms} set={(rooms)=>set({...value,rooms})}/><NumberField label="Bathrooms" value={value.bathrooms} set={(bathrooms)=>set({...value,bathrooms})}/><NumberField label="Kitchens" value={value.kitchens} set={(kitchens)=>set({...value,kitchens})}/></FieldGroup>
    <FieldGroup title="Construction Condition"><SelectField label="Overall Condition" value={value.condition} options={conditions} set={(condition)=>set({...value,condition:condition as Condition})}/><SelectField label="Construction Dust" value={value.dustSeverity} options={severity} set={(dustSeverity)=>set({...value,dustSeverity:dustSeverity as PostConstructionSeverity})}/><SelectField label="Construction Debris" value={value.debrisSeverity} options={severity} set={(debrisSeverity)=>set({...value,debrisSeverity:debrisSeverity as PostConstructionSeverity})}/><SelectField label="Detail Level" value={value.detailLevel} options={detail} set={(detailLevel)=>set({...value,detailLevel:detailLevel as PostConstructionDetailLevel})}/></FieldGroup>
    <FieldGroup title="Specialty Detail Quantities"><NumberField label="Windows / Glass" value={value.windowsOrGlassCount} set={(windowsOrGlassCount)=>set({...value,windowsOrGlassCount})}/><NumberField label="Cabinets / Drawers" value={value.cabinetOrDrawerCount} set={(cabinetOrDrawerCount)=>set({...value,cabinetOrDrawerCount})}/><NumberField label="Appliance Interiors" value={value.applianceInteriorCount} set={(applianceInteriorCount)=>set({...value,applianceInteriorCount})}/><NumberField label="Stair Flights" value={value.stairFlights} set={(stairFlights)=>set({...value,stairFlights})}/></FieldGroup>
    <FieldGroup title="Operations / Labor"><NumberField label="Target Project Days" value={value.targetProjectDays} set={(targetProjectDays)=>set({...value,targetProjectDays})}/><SelectField label="Workday Hours" value={String(value.workdayHours)} options={["8","10"]} set={(workdayHours)=>set({...value,workdayHours:Number(workdayHours) as 8|10})}/><NumberField label="Worker Hourly Cost" step="0.01" value={value.workerHourlyPay} set={(workerHourlyPay)=>set({...value,workerHourlyPay})}/><NumberField label="Target Profit Margin %" value={value.targetProfitMarginPercent} set={(targetProfitMarginPercent)=>set({...value,targetProfitMarginPercent})}/></FieldGroup>
    <FieldGroup title="Pricing"><SelectField label="Frequency" value={value.frequency} options={frequencies} labels={frequencyLabels} set={(frequency)=>set({...value,frequency:frequency as Frequency,customIntervalDays:frequency==="Custom"?value.customIntervalDays??1:null,recurringPricingRuleId:null})}/>{value.frequency==="Custom"&&<CustomIntervalField value={value.customIntervalDays} set={(customIntervalDays)=>set({...value,customIntervalDays})}/>}<RecurringRuleField serviceId={service?.id} frequency={value.frequency} rules={catalog.recurringRules} value={value.recurringPricingRuleId??""} set={(recurringPricingRuleId)=>set({...value,recurringPricingRuleId:recurringPricingRuleId||null})}/><NumberField label="Additional Discount %" value={value.additionalDiscountPercent} set={(additionalDiscountPercent)=>set({...value,additionalDiscountPercent})}/><NumberField label="Tax Rate %" value={value.taxRatePercent} set={(taxRatePercent)=>set({...value,taxRatePercent})}/><div className="sm:col-span-2 xl:col-span-4"><CatalogAddonPicker addons={addons} selected={value.additionalServices} setSelected={(additionalServices)=>set({...value,additionalServices})} snapshots={value.addonSelections} setSnapshots={(addonSelections)=>set({...value,addonSelections})}/></div></FieldGroup>
  </div>;
}

function EstimateSummary({ result, frequency, manualPrice, setManualPrice, saving, save, editing }: { result: EstimateResult; frequency: Frequency; manualPrice: number | null; setManualPrice: (value: number | null) => void; saving: boolean; save: () => Promise<void>; editing: boolean }) {
  const breakdown=result.postConstructionBreakdown;
  const rows = breakdown?[["Service",result.serviceName],["Total Estimated Labor Hours",`${breakdown.totalLaborHours} hrs`],["Recommended Crew Size",String(breakdown.recommendedCrewSize)],["Estimated Project Days",String(breakdown.estimatedProjectDays)],["Labor Cost",currency(result.laborCost)],["Supply Cost",currency(result.supplyCost)],["Recommended Price",currency(result.calculatedFinalPrice??result.finalPrice)],["Estimated Profit",currency(result.estimatedProfit)],["Projected Margin",`${breakdown.projectedMarginPercent}%`]]:[["Service", result.serviceName], ["Base Service Price",currency(result.basePrice)], ...result.adjustments.filter(item=>item.catalogAddonId).map(item=>[`Add-On: ${item.label}`,currency(item.amount)]), ["Subtotal",currency(result.oneTimePrice)],["Frequency", frequency], [`${frequency} Service Discount`,`${result.recurringDiscountPercent}%`],["Recurring Discount",`-${currency(result.recurringDiscount)}`],["Price After Recurring Discount",currency(Math.max(0,result.oneTimePrice-result.recurringDiscount))],["Manual / Custom Discount",`-${currency(result.manualDiscount)}`],...(result.taxes>0?[["Taxes",currency(result.taxes)]]:[]),["Calculated Price", currency(result.calculatedFinalPrice ?? result.finalPrice)], ["Authoritative Per-Visit Price", currency(result.finalPrice)], ["Estimated Monthly Total", result.monthlyPrice == null ? "—" : currency(result.monthlyPrice)], ["Labor Hours", `${result.laborHours} hrs`], ["Crew Size", String(result.crewSize)], ["Duration", `${result.estimatedDuration} hrs`], ["Estimated Profit", currency(result.estimatedProfit)]];
  return <aside className="sticky top-6 overflow-hidden rounded-2xl border border-[#143d1a]/10 bg-[#143d1a] text-white shadow-[0_18px_45px_rgba(20,61,26,.2)]"><div className="border-b border-white/10 p-6"><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#d4af37]">Live calculation</p><h2 className="mt-2 text-xl font-extrabold">Estimate Summary</h2></div><div className="border-b border-white/10 px-6 py-4"><label className="text-xs font-bold text-white/70">Manual / Custom Estimate Amount<input aria-label="Manual or custom estimate amount" type="number" min="0" step="0.01" value={manualPrice ?? ""} placeholder={String(result.calculatedFinalPrice ?? result.finalPrice)} onChange={event=>setManualPrice(event.target.value===""?null:Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-white/20 bg-white px-3 text-sm font-bold text-[#143d1a]" /></label><button type="button" disabled={manualPrice===null} onClick={()=>setManualPrice(null)} className="mt-2 text-xs font-bold text-[#d4af37] disabled:opacity-40">Use Calculated Price</button><p className="mt-2 text-xs text-white/55">A custom amount remains authoritative until you explicitly use the calculated price.</p></div>{breakdown&&<div className="border-b border-white/10 px-6 py-5"><h3 className="text-xs font-extrabold uppercase tracking-[.14em] text-[#d4af37]">Labor Estimate</h3><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-4"><dt className="text-white/65">Base square-footage production</dt><dd className="font-bold">{breakdown.baseProductionHours} hrs</dd></div>{breakdown.adjustments.filter(item=>item.laborHours!==0).map(item=><div key={item.label} className="flex justify-between gap-4"><dt className="text-white/65">{item.label}</dt><dd className="font-bold">{item.laborHours} hrs</dd></div>)}<div className="flex justify-between gap-4 border-t border-white/15 pt-2"><dt className="font-bold">Total</dt><dd className="font-extrabold text-[#d4af37]">{breakdown.totalLaborHours} hrs</dd></div></dl></div>}<dl className="divide-y divide-white/10 px-6">{rows.map(([label, display]) => <div key={label} className="flex justify-between gap-4 py-3 text-sm"><dt className="text-white/60">{label}</dt><dd className="text-right font-bold">{display}</dd></div>)}</dl><div className="bg-[#0d2b12] p-6"><p className="text-xs font-bold uppercase tracking-[.12em] text-white/55">Final Price</p><p className="mt-1 text-4xl font-extrabold text-[#d4af37]">{currency(result.finalPrice)}</p><button type="button" disabled={saving} onClick={() => void save()} className="mt-5 w-full rounded-lg bg-[#d4af37] px-5 py-3 text-sm font-extrabold text-[#143d1a] hover:bg-[#e1c056] disabled:opacity-60">{saving ? "Saving…" : editing ? "Update Estimate" : "Save Estimate"}</button></div></aside>;
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-[0_8px_25px_rgba(20,61,26,.045)] sm:p-6"><h2 className="text-lg font-extrabold text-[#143d1a]">{title}</h2>{subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}<div className="mt-5">{children}</div></section>; }
function FieldGroup({title,children}:{title:string;children:React.ReactNode}){return <fieldset className="rounded-xl border border-[#143d1a]/10 bg-[#f7f9f6] p-4"><legend className="px-2 text-xs font-extrabold uppercase tracking-[.12em] text-[#143d1a]">{title}</legend><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div></fieldset>}
function DivisionToggle({ value, set }: { value: EstimateDivision; set: (value: EstimateDivision) => void }) { return <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#f1f4f0] p-1.5">{(["Residential", "Commercial"] as const).map((item) => <button type="button" key={item} onClick={() => set(item)} className={`rounded-lg px-4 py-3 text-sm font-bold ${value === item ? "bg-white text-[#143d1a] shadow-sm" : "text-neutral-500"}`}>{item}</button>)}</div>; }
function TextField({ label, value, set, type = "text", required }: { label: string; value: string; set: (value: string) => void; type?: string; required?: boolean }) { return <label className="block"><Label text={label} required={required} /><input type={type} value={value} onChange={(e) => set(e.target.value)} className={inputClass} /></label>; }
function ProjectDurationFields({ days, workdayHours, setDays, setWorkdayHours }: { days:number; workdayHours:8|10; setDays:(value:number)=>void; setWorkdayHours:(value:8|10)=>void }) { const preset=[1,2,3].includes(days)?String(days):"Custom";return <><label className="block"><Label text="Target Completion Days"/><select className={inputClass} value={preset} onChange={(event)=>setDays(event.target.value==="Custom"?Math.max(4,days):Number(event.target.value))}><option value="1">1 Day</option><option value="2">2 Days</option><option value="3">3 Days</option><option value="Custom">Custom</option></select></label>{preset==="Custom"&&<NumberField label="Custom Target Days" value={days} set={setDays}/>}<SelectField label="Workday Length" value={String(workdayHours)} options={["8","10"]} set={(value)=>setWorkdayHours(Number(value) as 8|10)}/></>; }
function NumberField({ label, value, set, step = "1" }: { label: string; value: number; set: (value: number) => void; step?: string }) { return <label className="block"><Label text={label} /><input type="number" min="0" step={step} value={value} onChange={(e) => set(Number(e.target.value))} className={inputClass} /></label>; }
function CustomIntervalField({ value, set }: { value: number | null | undefined; set: (value: number | null) => void }) { return <label className="block"><Label text="Repeat every (days)" required /><input type="number" min="1" step="1" required value={value ?? ""} onChange={(event) => set(event.target.value === "" ? null : Number(event.target.value))} className={inputClass} /></label>; }
function SelectField({ label, value, set, options, labels, placeholder }: { label: string; value: string; set: (value: string) => void; options: readonly string[]; labels?: ReadonlyMap<string,string>; placeholder?: string }) { return <label className="block"><Label text={label} /><select value={value} onChange={(e) => set(e.target.value)} className={inputClass}>{options.map((option) => <option key={option} value={option}>{option===""&&placeholder?placeholder:labels?.get(option)??option}</option>)}</select></label>; }
function RecurringRuleField({serviceId,frequency,rules,value,set}:{serviceId?:string;frequency:Frequency;rules:RecurringPricingRule[];value:string;set:(value:string)=>void}){const matches=serviceId?matchingRecurringRules(frequency,rules,serviceId):[];if(frequency==="One-Time"||!matches.length)return null;const effective=value||(matches.length===1?matches[0].id:"");return <label className="block"><Label text="Pricing Rule" required={matches.length>1}/><select className={inputClass} value={effective} onChange={event=>set(event.target.value)}><option value="">{matches.length>1?"Select pricing rule":"Standard frequency pricing"}</option>{matches.map(rule=><option key={rule.id} value={rule.id}>{rule.rule_name??`${rule.frequency} rule (historical)`}</option>)}</select></label>}
function Check({ label, checked, set }: { label: string; checked: boolean; set: (value: boolean) => void }) { return <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 px-3.5 text-sm font-semibold text-neutral-700"><input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} className="size-4 accent-[#143d1a]" />{label}</label>; }
function Label({ text, required }: { text: string; required?: boolean }) { return <span className="mb-2 block text-xs font-bold text-neutral-700">{text}{required && <span className="ml-1 text-[#9a7a17]">*</span>}</span>; }
function Alert({ kind, text }: { kind: "success" | "error"; text: string }) { return <div role={kind === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-[#143d1a]/15 bg-[#edf4ec] text-[#143d1a]"}`}>{text}</div>; }
function validateCustomer(customer: CustomerInformation): string | null { if (!customer.firstName.trim() && !customer.lastName.trim() && !customer.companyName.trim() && !customer.email.trim() && !customer.phone.trim()) return "Enter a name, company, email, or phone number to identify the client."; if (!customer.address.trim()) return "Enter the property address before saving."; return null; }
function isEstimateDraft(value: unknown): value is EstimateDraft { if (!value || typeof value !== "object") return false; const draft=value as Partial<EstimateDraft>; return draft.version===1&&(draft.division==="Residential"||draft.division==="Commercial")&&typeof draft.notes==="string"&&Boolean(draft.customer&&typeof draft.customer==="object")&&draft.residential?.division==="Residential"&&Array.isArray(draft.residential.addOns)&&draft.commercial?.division==="Commercial"&&Array.isArray(draft.commercial.additionalServices)&&(!draft.postConstruction||isPostConstructionInput(draft.postConstruction)); }
function hasMeaningfulDraft(customer: CustomerInformation, division: EstimateDivision, residential: ResidentialCalculatorInput, commercial: CommercialCalculatorInput, postConstruction:PostConstructionCalculatorInput, serviceDescription:string, notes: string, terms:string, defaults:EstimateDraftDefaults): boolean { return Object.values(customer).some((value)=>value.trim())||division!=="Residential"||serviceDescription.trim()!==defaults.serviceDescription.trim()||notes.trim()!==defaults.notes.trim()||terms.trim()!==defaults.terms.trim()||JSON.stringify(residential)!==JSON.stringify(defaults.residential)||JSON.stringify(commercial)!==JSON.stringify(defaults.commercial)||JSON.stringify(postConstruction)!==JSON.stringify(defaults.postConstruction); }
function estimatePayload(clientId: string, propertyId: string, customer: CustomerInformation, division: EstimateDivision, result: EstimateResult, notes: string, terms:string, status: "Open" | "Archived") { return { client_id: clientId, property_id: propertyId, division, customer_first_name: clean(customer.firstName), customer_last_name: clean(customer.lastName), customer_phone: clean(customer.phone), customer_email: clean(customer.email), customer_address: customer.address.trim(), frequency: result.calculatorInput.frequency, service_name: result.serviceName, status, result, notes: clean(notes), terms:clean(terms) }; }
function customerFromEstimate(estimate: EstimateWithRelations): CustomerInformation { return { firstName: estimate.customer_first_name ?? "", lastName: estimate.customer_last_name ?? "", companyName: estimate.client?.company_name ?? "", phone: estimate.customer_phone ?? "", email: estimate.customer_email ?? "", address: estimate.property?.address ?? estimate.customer_address ?? "", addressLine2: estimate.property?.address_line_2 ?? "", city: estimate.property?.city ?? "", state: estimate.property?.state ?? "", zip: estimate.property?.zip ?? "" }; }
function clientOptionLabel(client:Client){const contact=[client.first_name,client.last_name].filter(Boolean).join(" ");return client.company_name&&contact?`${client.company_name} - ${contact}`:client.company_name||contact||client.email||"Unnamed client"}
function propertyOptionLabel(property:PropertyWithClient){return [property.property_name,property.address,property.city,property.state].filter(Boolean).join(" - ")||"Unnamed property"}
function clean(value: string): string | null { return value.trim() || null; }
function selectedCatalogService(catalog:ServiceCatalogBundle,division:EstimateDivision,selection:string){const normalized=normalizeServiceSelection(selection);return catalog.services.find(service=>(service.division===division||service.division==="Both")&&normalizeServiceSelection(service.service_name)===normalized)}
function normalizeServiceSelection(value:string){return value.replace(/ Cleaning$/i,"").trim().toLowerCase()}
function isPostConstructionInput(value:CalculatorInput|undefined):value is PostConstructionCalculatorInput{return Boolean(value&&"calculatorType" in value&&value.calculatorType==="Post-Construction")}
function currency(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
const inputClass = "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 outline-none transition focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
