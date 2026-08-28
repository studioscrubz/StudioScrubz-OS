"use client";
import { useEffect, useState } from "react";
import { getBusinessSettings, updateBusinessSettings } from "@/lib/services/businessSettings";
import type { BusinessSettings, BusinessSettingsUpdate } from "@/types/businessSettings";
import { UsStateSelect } from "@/components/forms/UsStateSelect";
import { GoogleCalendarSettings } from "@/components/settings/GoogleCalendarSettings";

const textFields: Array<[keyof BusinessSettings, string]> = [
  ["business_name","Business Name"],["tagline","Tagline"],["business_email","Business Email"],
  ["business_phone","Business Phone"],["website","Website"],["address","Address"],["city","City"],
  ["zip","ZIP"],["timezone","Timezone"],["currency","Currency"],
];
export function BusinessSettingsPage(){
  const [value,setValue]=useState<BusinessSettings|null>(null),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[saving,setSaving]=useState(false);
  useEffect(()=>{void getBusinessSettings().then(setValue).catch(x=>setError(msg(x)))},[]);
  if(!value)return <>{error?<Alert text={error}/>:<div className="h-72 animate-pulse rounded-xl bg-neutral-100"/>}</>;
  function set<K extends keyof BusinessSettings>(key:K,next:BusinessSettings[K]){setValue(current=>current?{...current,[key]:next}:current)}
  async function save(){if(!value)return;setSaving(true);setError(null);try{const{id:_,created_at:__,updated_at:___,...input}=value;setValue(await updateBusinessSettings(input as BusinessSettingsUpdate));setNotice("Business settings saved.")}catch(x){setError(msg(x))}finally{setSaving(false)}}
  return <><header className="border-b pb-7"><h1 className="text-3xl font-extrabold text-[#143d1a]">Business Settings</h1><p className="mt-3 text-neutral-600">Manage StudioScrubz business information and default document settings.</p></header>{error&&<Alert text={error}/>} {notice&&<Alert text={notice} good/>}
    <Section title="Company Information"><Grid>{textFields.map(([key,label])=><Field key={key} label={label} value={String(value[key]??"")} set={next=>setValue(current=>current?{...current,[key]:next||null}:current)}/>)}<label className="text-sm font-bold">State<UsStateSelect className={input} value={value.state??""} onChange={next=>set("state",next||null)}/></label></Grid></Section>
    <Section title="Estimate Defaults"><Grid><NumberField label="Default estimate expiration days" value={value.default_estimate_expiration_days} set={x=>set("default_estimate_expiration_days",x)}/><Area label="Default estimate notes" value={value.default_estimate_notes??""} set={x=>set("default_estimate_notes",x||null)}/><Area label="Default Estimate Terms & Conditions" value={value.default_estimate_terms??""} set={x=>set("default_estimate_terms",x||null)}/></Grid></Section>
    <Section title="Proposal Defaults"><Grid><NumberField label="Default proposal expiration days" value={value.default_proposal_expiration_days} set={x=>set("default_proposal_expiration_days",x)}/><Area label="Default proposal terms" value={value.default_proposal_terms??""} set={x=>set("default_proposal_terms",x||null)}/></Grid></Section>
    <Section title="Service Agreement Defaults"><Grid><Area label="Default Service Agreement Terms" value={value.default_service_agreement_terms??""} set={x=>set("default_service_agreement_terms",x||null)} large/><Area label="Default Cancellation Terms" value={value.default_cancellation_terms??""} set={x=>set("default_cancellation_terms",x||null)} large/></Grid></Section>
    <Section title="Invoice Defaults"><Grid><NumberField label="Default invoice due days" value={value.default_invoice_due_days} set={x=>set("default_invoice_due_days",x)}/><Area label="Default payment terms" value={value.default_payment_terms??""} set={x=>set("default_payment_terms",x||null)}/><Area label="Default invoice terms" value={value.default_invoice_terms??""} set={x=>set("default_invoice_terms",x||null)}/></Grid></Section>
    <GoogleCalendarSettings/><button disabled={saving} className="mt-6 rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white" onClick={()=>void save()}>{saving?"Saving…":"Save Business Settings"}</button></>;
}
function Section({title,children}:{title:string;children:React.ReactNode}){return <section className="mt-6 rounded-xl border bg-white p-6"><h2 className="text-lg font-extrabold text-[#143d1a]">{title}</h2><div className="mt-4">{children}</div></section>}
function Grid({children}:{children:React.ReactNode}){return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>}
function Field({label,value,set}:{label:string;value:string;set:(x:string)=>void}){return <label className="text-sm font-bold">{label}<input className={input} value={value} onChange={e=>set(e.target.value)}/></label>}
function NumberField({label,value,set}:{label:string;value:number;set:(x:number)=>void}){return <label className="text-sm font-bold">{label}<input type="number" min="0" step="0.01" className={input} value={value} onChange={e=>set(globalThis.Number(e.target.value))}/></label>}
function Area({label,value,set,large=false}:{label:string;value:string;set:(x:string)=>void;large?:boolean}){return <label className="block text-sm font-bold">{label}<textarea className={`${input} ${large?"h-96":"h-24"} py-2`} value={value} onChange={e=>set(e.target.value)}/></label>}
function Alert({text,good}:{text:string;good?:boolean}){return <p className={`mt-4 rounded-lg p-3 ${good?"bg-green-50 text-green-700":"bg-red-50 text-red-700"}`}>{text}</p>}
function msg(x:unknown){return x instanceof Error?x.message:"Settings operation failed."}const input="mt-1 h-11 w-full rounded-lg border px-3 font-normal";
