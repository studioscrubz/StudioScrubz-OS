"use client";
import { ElevatedSurfaceMultiSelect } from "@/components/estimates/ElevatedSurfaceMultiSelect";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StudioScrubzLogo } from "@/components/branding/StudioScrubzLogo";
import { UsStateSelect } from "@/components/forms/UsStateSelect";
import { serviceFrequencyLabel } from "@/lib/scheduling/frequency";
import { approvedHighDustingAccessMethods } from "@/lib/pricing/highDusting";

type Division="Residential"|"Commercial"; type PublicAddon={name:string;description:string|null;pricingType:"Flat Price"|"Per Unit";unitName:string|null}; type Service={name:string;description:string|null;division:Division;recurring:boolean;discounts?:Record<string,number>;fields:string[];addons:PublicAddon[]};
type Confirmation={estimateNumber:string;service:string;price:number;customerName:string;address:string};
const blank={firstName:"",lastName:"",companyName:"",phone:"",email:"",address:"",addressLine2:"",city:"",state:"",zip:""};
const input="w-full rounded-xl border border-[#d7ddd5] bg-white px-4 py-3 text-base text-[#18201a] outline-none transition focus:border-[#d4af37] focus:ring-4 focus:ring-[#d4af37]/15";
export function PublicEstimateRequest(){
  const [representatives, setRepresentatives] = useState<Array<{ id: string; displayName: string }>>([]);
  const [leadRepresentativeId, setLeadRepresentativeId] = useState("");
  const [representativeError, setRepresentativeError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/request-estimate/representatives", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Representatives are temporarily unavailable. You can still submit without a representative.");
      setRepresentatives(await response.json());
    }).catch(error => { if (!controller.signal.aborted) setRepresentativeError(error.message); });
    return () => controller.abort();
  }, []);
  const [petCount,setPetCount]=useState("");
  const [petTypes,setPetTypes]=useState<string[]>([]);
  const [step,setStep]=useState(0);
  const stepNames=["Service","Property","Customize","Review"];
  function goToStep(next:number){setStep(next);window.scrollTo(0,0)}
  const [sizeRange, setSizeRange] = useState("1000");
  const[services,setServices]=useState<Service[]>([]),[division,setDivision]=useState<Division>("Residential"),[service,setService]=useState(""),[customer,setCustomer]=useState(blank),[preferredContactMethod,setPreferredContactMethod]=useState(""),[preferredContactTime,setPreferredContactTime]=useState("Anytime"),[frequency,setFrequency]=useState("One-Time"),[condition,setCondition]=useState("Average"),[squareFeet,setSquareFeet]=useState(1000),[values,setValues]=useState({bedrooms:NaN,bathrooms:NaN,floors:1,restrooms:2,kitchens:1,stations:NaN,units:NaN}),[occupied,setOccupied]=useState(true),[pets,setPets]=useState(false),[addons,setAddons]=useState<string[]>([]),[addonQuantities,setAddonQuantities]=useState<Record<string,number>>({}),[preferredDate,setPreferredDate]=useState(""),[notes,setNotes]=useState(""),[price,setPrice]=useState<number|null>(null),[quoteError,setQuoteError]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState<Confirmation|null>(null),[website,setWebsite]=useState("");
  const [commonAreas,setCommonAreas]=useState(0);
  const [highDustingHeight,setHighDustingHeight]=useState("");
  const [highDustingAccessMethods,setHighDustingAccessMethods]=useState<string[]>([]);
  const [highDustingScope,setHighDustingScope]=useState("");
  const [quoteDiscount, setQuoteDiscount]=useState<{configured:number;applied:number;name:string|null}|null>(null);
  const available=useMemo(()=>services.filter(x=>x.division===division&&(frequency==="One-Time"||x.recurring)),[services,division,frequency]),selected=available.find(x=>x.name===service)??available[0];
  const isHighDusting = division === "Commercial" && selected?.name === "High Dusting";
  useEffect(()=>{fetch("/api/public/request-estimate/catalog").then(r=>r.json()).then(data=>{if(data.error)throw new Error(data.error);setServices(data.services)}).catch(e=>setError(e.message))},[]);
  const payload=useMemo(()=>({division,customer,preferredContactMethod,preferredContactTime,service:selected?.name??service,frequency,condition,squareFeet,...values,occupied,pets,addons,addonQuantities,preferredDate,notes,website,commonAreas,highDustingHeight,highDustingAccessMethods,highDustingScope}),[addonQuantities,addons,condition,customer,division,frequency,notes,occupied,pets,preferredContactMethod,preferredContactTime,preferredDate,selected,service,squareFeet,values,website,commonAreas,highDustingHeight,highDustingAccessMethods,highDustingScope]);
  useEffect(()=>{if(!selected)return;const controller=new AbortController(),timer=setTimeout(()=>fetch("/api/public/request-estimate/quote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:controller.signal}).then(async r=>{const data=await r.json();if(r.ok){setPrice(data.price);setQuoteDiscount({configured:Number(data.configuredRecurringDiscountPercent??0),applied:Number(data.appliedRecurringDiscount??0),name:typeof data.recurringPricingRuleName==="string"?data.recurringPricingRuleName:null});setQuoteError("")}else{setPrice(null);setQuoteDiscount(null);setQuoteError(isHighDusting && (!highDustingHeight.trim() || !highDustingScope.trim() || !highDustingAccessMethods.length) ? "" : data.error||"Enter the required cleaning details to see pricing.")}}).catch(cause=>{if(cause instanceof Error&&cause.name==="AbortError")return;setPrice(null);setQuoteDiscount(null);setQuoteError("Pricing is temporarily unavailable. Please try again.")}),350);return()=>{clearTimeout(timer);controller.abort()}},[payload,selected]);
  async function submit(e:React.FormEvent){e.preventDefault();if(step===1&&division==="Residential"&&(!Number.isFinite(values.bedrooms)||!Number.isFinite(values.bathrooms))){setError("Select the number of bedrooms and bathrooms.");return;}if(step===1&&division==="Residential"&&pets&&Number(petCount)>0&&!petTypes.length){setError("Select Cats, Dogs, or both.");return;}if(step<3){setError("");goToStep(step+1);return;}setBusy(true);setError("");try{const response=await fetch("/api/public/request-estimate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,notes:division==="Residential"&&pets?[`Pets: ${petCount}`,Number(petCount)>0 ? petTypes.join(", ") : "",notes.trim()].filter(Boolean).join("\n").slice(0,2000):notes,leadRepresentativeId:leadRepresentativeId||null})}),data=await response.json();if(!response.ok)throw new Error(data.error);setConfirmation(data)}catch(cause){setError(cause instanceof Error?cause.message:"Submission failed.")}finally{setBusy(false)}}
  if(confirmation)return <Confirmation result={confirmation} restart={()=>{setConfirmation(null);setStep(0);setPets(false);setPetCount("");setPetTypes([]);setLeadRepresentativeId("");setCustomer(blank);setNotes("");setPreferredDate("");setAddons([]);setAddonQuantities({})}}/>;
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff9df_0,#f5f6f4_36rem)] px-4 py-8 sm:px-6"><div className="mx-auto max-w-2xl"><header className="mb-7 text-center"><Link href="https://studioscrubz.com/" aria-label="StudioScrubz home" className="mx-auto mb-4 block w-fit"><StudioScrubzLogo size={112} priority className="drop-shadow-[0_8px_18px_rgba(20,61,26,.18)] sm:!h-32 sm:!w-32"/></Link><p className="text-sm font-black uppercase tracking-[.28em] text-[#143d1a]">StudioScrubz</p><h1 className="mt-2 text-3xl font-black text-[#143d1a] sm:text-5xl">Request an Estimate</h1><p className="mt-2 text-lg font-semibold text-neutral-600">No mess. No stress.</p></header>
  <form onSubmit={submit} className="space-y-6 rounded-3xl border border-[#e4e8df] bg-[#f8f7f2] p-4 shadow-sm sm:p-8">
  <div className="space-y-2">
    <div className="flex justify-between text-sm font-bold text-[#143d1a]">
      <span>Step {step+1} of {stepNames.length} · {stepNames[step]}</span>
      <span>{Math.round((step+1)/stepNames.length*100)}%</span>
    </div>
    <progress aria-label="Quote progress" value={step+1} max={stepNames.length}
      className="block h-2 w-full overflow-hidden rounded-full bg-[#e0e6dc] accent-[#143d1a] [&::-webkit-progress-bar]:bg-[#e0e6dc] [&::-webkit-progress-value]:bg-[#143d1a]"/>
  </div><fieldset hidden={step!==0} disabled={step!==0} className="min-w-0 space-y-7"><Card title="What can we clean for you?"><div className="grid grid-cols-2 gap-3">{(["Residential","Commercial"] as Division[]).map(x=><button key={x} type="button" onClick={()=>{setDivision(x);setService("");setAddons([]);setAddonQuantities({});setHighDustingHeight("");setHighDustingAccessMethods([]);setHighDustingScope("");setCommonAreas(0)}} className={`rounded-xl border-2 px-4 py-4 font-extrabold ${division===x?"border-[#d4af37] bg-[#143d1a] text-white":"border-neutral-200 bg-white text-[#143d1a]"}`}>{x}</button>)}</div></Card>
  <Card title="How often do you need cleaning?">
    <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <legend className="sr-only">Cleaning frequency</legend>
      {["One-Time","Daily","Weekly","Biweekly","Twice Monthly","Monthly"].map(option=><button
        key={option} type="button" aria-pressed={frequency===option}
        className={`min-h-11 rounded-full border px-3 py-2 text-sm font-bold ${frequency===option?"border-[#143d1a] bg-[#143d1a] text-white":"border-[#d7ddd5] bg-white text-[#143d1a]"}`}
        onClick={()=>{setFrequency(option);setService("");setAddons([]);setAddonQuantities({});}}>
        {serviceFrequencyLabel(option)}
      </button>)}
    </fieldset>
  </Card>
  <Card title="Cleaning details"><div className="grid gap-4 sm:grid-cols-2"><Select label={division==="Commercial"?"Property / Service Type":"Service Type"} value={selected?.name??""} options={available.map(x=>x.name)} placeholder={available.length?"Select a service":"No services available for this frequency"} set={v=>{setService(v);setAddons([]);setAddonQuantities({});if(v==="High Dusting")setValues(current=>({...current,restrooms:NaN,kitchens:NaN,units:NaN}));setHighDustingHeight("");setHighDustingAccessMethods([]);setHighDustingScope("");setCommonAreas(0)}}/></div></Card></fieldset><fieldset hidden={step!==1} disabled={step!==1} className="min-w-0 space-y-7"><Card title="Tell us about the space"><div className="grid gap-4 sm:grid-cols-2"><div><Select label={isHighDusting?"Square footage *":"Square footage"} value={sizeRange}
  options={Object.keys(squareFootageRanges)} labels={squareFootageLabels} set={range=>{
    setSizeRange(range);
    setSquareFeet(squareFootageRanges[range]||NaN);
  }}/>
  {sizeRange==="exact"?<NumberField label={isHighDusting?"Square Feet *":"Exact square footage"} value={squareFeet} set={setSquareFeet}/>:sizeRange&&<p className="mt-1 text-xs text-neutral-600">Estimate uses the upper end of the selected range.</p>}</div><Select label="Property Condition" value={condition} options={["Light","Average","Heavy","Extreme"]} set={setCondition}/>{division==="Residential"?<><RoomCount label="Bedrooms" options={[0,1,2,3,4,5]} increment={1} value={values.bedrooms} set={v=>setValues(current=>({...current,bedrooms:v}))}/><RoomCount label="Bathrooms" options={[0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5]} increment={0.5} value={values.bathrooms} set={v=>setValues(current=>({...current,bathrooms:v}))}/><Check label="Property is occupied" checked={occupied} set={setOccupied}/><Check label="Pets / heavy pet hair" checked={pets} set={setPets}/>
  {pets&&<><label className="text-sm font-bold text-[#143d1a]">Number of pets
    <input className={input} type="number" min="0" step="1" required value={petCount} onChange={e=>setPetCount(e.target.value)}/>
  </label>{Number(petCount)>0&&<fieldset className="flex flex-wrap gap-3">
    <legend className="mb-2 text-sm font-bold text-[#143d1a]">Pet types</legend>
    {["Cats","Dogs"].map(type=><label key={type} className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <input type="checkbox" checked={petTypes.includes(type)} onChange={e=>{
        setPetTypes(current=>e.target.checked?[...current,type]:current.filter(item=>item!==type));
        setError("");
      }}/>{type}
    </label>)}
  </fieldset>}</>}{error&&step===1&&<p role="alert" className="text-sm text-red-800">{error}</p>}</>:(isHighDusting?[]:selected?.fields??[]).map(field=><NumberField key={field} label={labels[field]} value={values[field as keyof typeof values]} set={v=>setValues({...values,[field]:v})}/>)}</div>{isHighDusting&&<div className="mt-5 rounded-xl border border-[#143d1a]/15 bg-[#f7f9f5] p-4">
    <h3 className="font-black text-[#143d1a]">High Dusting property details</h3>
    <p className="mt-1 text-sm text-neutral-600">Tell us about the elevated areas. Your preliminary estimate will be confirmed after a site assessment, including equipment access and safety.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <NumberField label="Bathrooms" value={values.restrooms} set={v=>setValues(prev=>({...prev,restrooms:v}))}/>
      <NumberField label="Kitchens" value={values.kitchens} set={v=>setValues(prev=>({...prev,kitchens:v}))}/>
      <NumberField label="Common Areas" value={commonAreas} set={setCommonAreas}/>
      <NumberField label="Units" value={values.units} set={v=>setValues(prev=>({...prev,units:v}))}/>
      <label className="text-sm font-bold text-[#143d1a] sm:col-span-2">Highest surface / working height *
        <input required value={highDustingHeight} onChange={e=>setHighDustingHeight(e.target.value)} maxLength={80} placeholder="Example: 15 feet" className={`${input} mt-1.5`}/>
      </label>
      <fieldset className="sm:col-span-2">
       <legend className="mb-2 text-sm font-bold text-[#143d1a]">Access methods (select all that apply) *</legend>
       <div className="grid gap-2 sm:grid-cols-2">
       {approvedHighDustingAccessMethods.map(method=><label key={method} className="flex items-center gap-2 rounded-xl border border-[#d7ddd5] bg-white p-3 text-sm text-[#143d1a]">
         <input type="checkbox" checked={highDustingAccessMethods.includes(method)} onChange={e=>setHighDustingAccessMethods(current=>e.target.checked?[...current,method]:current.filter(x=>x!==method))} className="size-4 accent-[#143d1a]"/>{method}
       </label>)}
       </div>
      </fieldset>
      <ElevatedSurfaceMultiSelect required value={highDustingScope} onChange={setHighDustingScope}/>
    </div>
   </div>}</Card></fieldset><fieldset hidden={step!==2} disabled={step!==2} className="min-w-0 space-y-7"><Card title="Customize your cleaning">{selected?.description&&<CleaningScope description={selected.description}/>}
  {selected?.addons.length&&!isHighDusting?<AddonMultiSelect options={selected.addons} selected={addons} set={setAddons} quantities={addonQuantities} setQuantities={setAddonQuantities}/>:null}</Card></fieldset><fieldset hidden={step!==3} disabled={step!==3} className="min-w-0 space-y-7"><Card title="Your information"><div className="grid gap-4 sm:grid-cols-2"><Field label="First Name *" value={customer.firstName} set={v=>setCustomer({...customer,firstName:v})}/><Field label="Last Name *" value={customer.lastName} set={v=>setCustomer({...customer,lastName:v})}/>{division==="Commercial"&&<Field label="Company Name *" value={customer.companyName} set={v=>setCustomer({...customer,companyName:v})}/>}<Field label="Phone *" type="tel" value={customer.phone} set={v=>setCustomer({...customer,phone:v})}/><Field label="Email *" type="email" value={customer.email} set={v=>setCustomer({...customer,email:v})}/><Select label="Preferred Contact Method *" value={preferredContactMethod} options={["Call","Text","Email"]} placeholder="Select contact method" required set={setPreferredContactMethod}/><Select label="Best Time to Contact" value={preferredContactTime} options={["Anytime","Morning","Afternoon","Evening"]} set={setPreferredContactTime}/></div><label className="mt-4 block text-sm font-bold text-[#143d1a]">StudioScrubz Representative (Optional)<select className={`${input} mt-1.5`} value={leadRepresentativeId} onChange={event=>setLeadRepresentativeId(event.target.value)} aria-describedby="representative-help"><option value="">None / I found StudioScrubz myself</option>{representatives.map(rep=><option key={rep.id} value={rep.id}>{rep.displayName}</option>)}</select></label><p id="representative-help" className="mb-4 text-sm text-neutral-500">Select the representative who contacted or referred you.</p>{representativeError&&<p role="status" className="mb-4 text-sm text-neutral-600">{representativeError}</p>}<p className="mt-4 text-sm text-neutral-500">We’ll use this preference to follow up and schedule a walkthrough.</p></Card>
  <Card title="Service location"><div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Field label="Address *" value={customer.address} set={v=>setCustomer({...customer,address:v})}/></div><div className="sm:col-span-2"><Field label="Address Line 2" value={customer.addressLine2} set={v=>setCustomer({...customer,addressLine2:v})}/></div><Field label="City *" value={customer.city} set={v=>setCustomer({...customer,city:v})}/><label className="text-sm font-bold text-[#143d1a]">State *<UsStateSelect required value={customer.state} onChange={state=>setCustomer({...customer,state})} className={`${input} mt-1.5`}/></label><Field label="ZIP *" value={customer.zip} set={v=>setCustomer({...customer,zip:v})}/></div></Card>
  <Card title="Anything else?"><div className="grid gap-4"><Field label="Preferred Service Date" type="date" value={preferredDate} set={setPreferredDate}/><label className="text-sm font-bold text-[#143d1a]">Special Requests / Notes<textarea value={notes} maxLength={2000} onChange={e=>setNotes(e.target.value)} rows={4} className={`${input} mt-1.5 resize-y`}/></label><label className="absolute left-[-10000px]" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></label></div></Card>
  <section className="document-print-root rounded-3xl bg-[#143d1a] p-6 text-white shadow-xl sm:p-8"><p className="text-sm font-bold uppercase tracking-widest text-[#d4af37]">{isHighDusting?"Preliminary High Dusting Estimate":"Estimated Service Price"}</p><p className="mt-2 text-4xl font-black">{price===null?"—":money(price)}</p>{frequency!=="One-Time"&&quoteDiscount!==null&&quoteDiscount.configured>0&&<div role="status" className="mt-4 rounded-xl border border-white/20 bg-white/10 p-3 text-sm"><p className="font-bold text-[#d4af37]">Recurring discount: up to {quoteDiscount.configured}%</p><p className="mt-1">Applied savings: {money(quoteDiscount.applied)} per visit</p>{quoteDiscount.applied===0&&<p className="mt-1 text-white/70">Minimum service pricing may limit the discount.</p>}</div>}{quoteError&&<p role="status" className="mt-3 rounded-lg bg-white/10 p-3 text-sm font-semibold text-white">{quoteError}</p>}<p className="mt-4 max-w-2xl text-sm leading-6 text-white/75">This estimate is based on the information provided and is subject to review. High Dusting access methods, equipment, and labor requirements must be verified before a final quote is approved.</p><button disabled={busy||price===null||(isHighDusting&&(!highDustingHeight.trim()||!highDustingScope.trim()||!highDustingAccessMethods.length||squareFeet<=0))} className="mt-6 w-full rounded-xl bg-[#d4af37] px-6 py-4 text-lg font-black text-[#143d1a] disabled:cursor-not-allowed disabled:opacity-50">{busy?"Submitting…":"Submit Estimate Request"}</button>{error&&<p role="alert" className="mt-4 rounded-lg bg-red-950/40 p-3 font-semibold text-red-100">{error}</p>}</section></fieldset>
  <div className="flex flex-wrap items-center gap-3 border-t border-[#d7ddd5] pt-4">
    {step>0&&<button type="button" disabled={busy} onClick={()=>goToStep(step-1)}
      className="min-h-11 rounded-full border border-[#d7ddd5] bg-white px-5 py-2 font-bold text-[#143d1a]">Back</button>}
    {step<3&&<>
      {step>0&&price!==null&&<span className="text-sm font-bold text-[#143d1a]">Estimated {money(price)}</span>}
      <button type="submit" disabled={step===0&&!selected}
        className="ml-auto min-h-11 flex-1 rounded-full bg-[#143d1a] px-5 py-2 font-bold text-white disabled:opacity-50 sm:flex-none">Continue</button>
    </>}
  </div>
</form><p className="py-8 text-center text-xs text-neutral-500">Your information is used only to prepare and review your estimate request.</p></div></main>}
function Card({title,children}:{title:string;children:React.ReactNode}){return <section className="min-w-0"><h2 className="mb-3 text-xl font-extrabold tracking-tight text-[#143d1a]">{title}</h2>{children}</section>}
function Field({label,value,set,type="text",maxLength}:{label:string;value:string;set:(v:string)=>void;type?:string;maxLength?:number}){return <label className="text-sm font-bold text-[#143d1a]">{label}<input required={label.endsWith("*")} type={type} maxLength={maxLength} value={value} onChange={e=>set(e.target.value)} className={`${input} mt-1.5`}/></label>}
function Select({label,value,options,set,placeholder,required,labels}:{label:string;value:string;options:string[];set:(v:string)=>void;placeholder?:string;required?:boolean;labels?:Record<string,string>}){return <label className="text-sm font-bold text-[#143d1a]">{label}<select required={required} value={value} onChange={e=>set(e.target.value)} className={`${input} mt-1.5`}>{placeholder&&<option value="">{placeholder}</option>}{options.map(x=><option key={x} value={x}>{labels?.[x]??(label==="Frequency"?serviceFrequencyLabel(x):x)}</option>)}</select></label>}
function RoomCount({label,options,increment,value,set}:{label:string;options:number[];increment:number;value:number;set:(value:number)=>void}){
  const [exact,setExact]=useState(false);
  const maximum=options[options.length-1];
  const showExact=exact||value>maximum;
  const pill=(selected:boolean)=>`min-h-11 rounded-full border px-3 py-2 text-sm font-bold ${selected?"border-[#143d1a] bg-[#143d1a] text-white":"border-[#d7ddd5] bg-white text-[#143d1a]"}`;
  return <fieldset className="min-w-0 sm:col-span-2">
    <legend className="mb-2 text-sm font-bold text-[#143d1a]">{label}{increment===0.5?" (include half baths)":""}</legend>
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {options.map(count=><button key={count} type="button" className={pill(!showExact&&value===count)}
        aria-pressed={!showExact&&value===count} onClick={()=>{setExact(false);set(count)}}>
        {count===0&&increment===1?"Studio":count}
      </button>)}
      <button type="button" className={pill(showExact)} aria-pressed={showExact}
        onClick={()=>{setExact(true);if(!showExact)set(NaN)}}>{maximum}+</button>
    </div>
    {showExact&&<label className="mt-3 block text-sm font-bold text-[#143d1a]">Exact {label.toLowerCase()}
      <input required type="number" min={maximum+increment} step={increment}
        value={Number.isFinite(value)?value:""} onChange={event=>set(event.target.valueAsNumber)} className={input}/>
    </label>}
  </fieldset>;
}
function NumberField({label,value,set}:{label:string;value:number;set:(v:number)=>void}){return <label className="text-sm font-bold text-[#143d1a]">{label}<input required type="number" min="0" value={Number.isFinite(value)?value:""} onChange={e=>set(e.target.valueAsNumber)} className={`${input} mt-1.5`}/></label>}
function Check({label,detail,checked,set}:{label:string;detail?:string|null;checked:boolean;set:(v:boolean)=>void}){return <label className="flex cursor-pointer gap-3 rounded-xl border border-neutral-200 bg-white p-4"><input type="checkbox" checked={checked} onChange={e=>set(e.target.checked)} className="mt-1 h-5 w-5 accent-[#143d1a]"/><span><span className="block font-bold text-[#143d1a]">{label}</span>{detail&&<span className="mt-1 block text-xs text-neutral-500">{detail}</span>}</span></label>}
function CleaningScope({description}:{description:string}){
  const items=description.trim().split(/(?:^|\s+)-\s+/).filter(Boolean);
  return items.length>1
    ? <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-600">{items.map((item,index)=><li key={index}>{item}</li>)}</ul>
    : <p className="text-sm text-neutral-600">{description}</p>;
}
function AddonMultiSelect({options,selected,set,quantities,setQuantities}:{options:PublicAddon[];selected:string[];set:(value:string[])=>void;quantities:Record<string,number>;setQuantities:React.Dispatch<React.SetStateAction<Record<string,number>>>}){
  return <fieldset className="mt-6">
    <legend className="mb-2 font-extrabold text-[#143d1a]">Available add-ons</legend>
    <div className="divide-y rounded-xl border bg-white px-3">
      {options.map(option=>{
        const checked=selected.includes(option.name);
        const perUnit=option.pricingType==="Per Unit";
        return <div key={option.name} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <label htmlFor={`addon-${option.name}`} className="text-sm font-bold text-[#143d1a]">{option.name}</label>
            {option.description&&<p className="text-xs text-neutral-600">{option.description}</p>}
          </div>
          {perUnit&&<input aria-label={`${option.name} quantity`} type="number" min="1" step="1"
            required={checked} disabled={!checked} placeholder="Qty"
            className="h-11 w-20 shrink-0 rounded-lg border border-neutral-300 px-2 text-sm disabled:opacity-50"
            value={Number.isFinite(quantities[option.name])?quantities[option.name]:""}
            onChange={event=>{
              const quantity=event.target.valueAsNumber;
              setQuantities(current=>({...current,[option.name]:quantity}));
            }}/>}
          <input id={`addon-${option.name}`} type="checkbox" checked={checked} className="size-5 shrink-0 accent-[#143d1a]"
            onChange={event=>{
              const on=event.target.checked;
              set(on?[...selected,option.name]:selected.filter(name=>name!==option.name));
              if(perUnit)setQuantities(current=>{
                const next={...current};
                if(on)next[option.name]=1;
                else delete next[option.name];
                return next;
              });
            }}/>
        </div>;
      })}
    </div>
  </fieldset>;
}
function Confirmation({result,restart}:{result:Confirmation;restart:()=>void}){return <main className="min-h-screen bg-[#f5f6f4] px-4 py-10"><article className="document-print-root mx-auto max-w-2xl rounded-3xl bg-white p-7 shadow-xl sm:p-12"><p className="text-sm font-black uppercase tracking-[.25em] text-[#d4af37]">StudioScrubz</p><h1 className="mt-3 text-3xl font-black text-[#143d1a]">Estimate Request Received</h1><p className="mt-3 text-neutral-600">Thank you for choosing StudioScrubz. Your estimate has been submitted for review.</p><dl className="mt-8 grid gap-5 border-y border-neutral-200 py-6 sm:grid-cols-2"><Item label="Estimate Number" value={result.estimateNumber}/><Item label="Service" value={result.service}/><Item label={result.service==="High Dusting Cleaning"?"Preliminary Estimate":"Estimated Price"} value={money(result.price)}/><Item label="Customer Name" value={result.customerName}/><div className="sm:col-span-2"><Item label="Service Address" value={result.address}/></div></dl><p className="mt-6 text-sm text-neutral-500">This estimate is based on the information provided and is subject to review. Final pricing, especially for High Dusting requiring elevated access or equipment, may change after assessment.</p><div className="mt-8 flex flex-col gap-3 sm:flex-row print:hidden"><button onClick={()=>window.print()} className="rounded-xl bg-[#143d1a] px-5 py-3 font-extrabold text-white">Print / Save Estimate</button><button onClick={restart} className="rounded-xl border border-[#143d1a] px-5 py-3 font-extrabold text-[#143d1a]">Start Another Estimate</button></div></article></main>}
function Item({label,value}:{label:string;value:string}){return <div><dt className="text-xs font-bold uppercase tracking-wider text-neutral-500">{label}</dt><dd className="mt-1 font-extrabold text-[#143d1a]">{value}</dd></div>}
const labels:Record<string,string>={floors:"Floors",restrooms:"Restrooms",kitchens:"Kitchens / Breakrooms",stations:"Stations / Booths",units:"Units"};function money(v:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(v)}

const squareFootageLabels: Record<string,string> = {
  "1000": "Up to 1,000 sq ft",
  "1500": "1,001–1,500 sq ft",
  "2000": "1,501–2,000 sq ft",
  "2500": "2,001–2,500 sq ft",
  "3000": "2,501–3,000 sq ft",
  "4000": "3,001–4,000 sq ft",
  "5000": "4,001–5,000 sq ft",
  exact: "Enter exact square footage",
};
const squareFootageRanges: Record<string,number> = Object.fromEntries(
  Object.keys(squareFootageLabels).map(range=>[range,Number(range)||0]),
);
