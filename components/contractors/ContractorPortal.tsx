"use client";
import { contractorPropertyConditions, contractorPropertyTypes, contractorScopeOptions, editableContractorRequestStatuses, type ContractorJobOptions, type ContractorPropertyType, type ContractorRequestOptions } from "@/lib/contractors/jobOptions";
import { contractorPage } from "@/lib/contractors/host";
import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {getSupabaseClient} from "@/lib/supabase/client";
import {StudioScrubzLogo} from "@/components/branding/StudioScrubzLogo";
type Opportunity={id:string;opportunity_number:string;service_type:string;property_address:string;property_name:string|null;property_type:ContractorPropertyType;request_options:Partial<ContractorRequestOptions>|null;updated_at:string;submitted_by:string|null;internal_confirmed_at:string|null;square_feet:number|null;bedrooms:number|null;bathrooms:number|null;estimated_person_hours:number;cleaner_count:number;pricing_basis:string;special_instructions:string|null;access_arrangements:string|null;property_condition:string|null;scope_of_work:string;requested_date:string;requested_time:string|null;proposed_amount:number;agreed_amount:number|null;status:string;final_scope:string|null;linked_job_id:string|null;partner_confirmed_at:string|null};
type Offer={id:string;opportunity_id:string;offered_by_side:string;amount:number;scope_text:string;created_at:string};
type Msg={id:string;opportunity_id:string|null;sender_side:string;body:string;created_at:string;read_at:string|null};
type Invoice={id:string;job_id:string;invoice_number:string;status:string;total:number;amount_paid:number;due_date:string|null};
type Job={id:string;status:string;scheduled_date:string|null;start_time:string|null;completed_at:string|null};
type Document={id:string;opportunity_id:string|null;file_name:string;category:string};
type Portal={role:string;viewerId:string;company:{id:string;name:string;contractor_code:string;contact_name:string;contact_email:string;phone:string|null;business_address:string|null;status:string;payment_terms:string|null};opportunities:Opportunity[];offers:Offer[];messages:Msg[];operationsManager:{name:string}|null;jobs:Job[];invoices:Invoice[];documents:Document[]};
const input="mt-1 w-full rounded-lg border border-neutral-300 bg-white p-3 text-neutral-900";
const primary="rounded-lg bg-[#143d1a] px-4 py-2.5 font-bold text-white disabled:opacity-50";
const secondary="rounded-lg border border-[#143d1a]/30 bg-white px-4 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-50";
const currency=(x:number|null)=>x==null?"Pending":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(x));
type Tab="dashboard"|"submit"|"jobs"|"messages"|"company";
export function ContractorPortal(){
 const router=useRouter();
 const [data,setData]=useState<Portal|null>(null),[tab,setTab]=useState<Tab>("dashboard");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [opportunityId,setOpportunityId]=useState(""),[message,setMessage]=useState("");
 const [profileEdit,setProfileEdit]=useState<Record<string,string>>({});
 const [editing,setEditing]=useState<{id:string;updatedAt:string}|null>(null);
 const [propertyName,setPropertyName]=useState("");
 const [submissionKey,setSubmissionKey]=useState(()=>crypto.randomUUID());
 const [serviceType,setServiceType]=useState(""),[address,setAddress]=useState(""),[propertyType,setPropertyType]=useState<ContractorPropertyType>("Residential");
 const [squareFeet,setSquareFeet]=useState(""),[bedrooms,setBedrooms]=useState(""),[bathrooms,setBathrooms]=useState("");
 const [jobOptions,setJobOptions]=useState<ContractorJobOptions|null>(null);
 const [jobOptionsError,setJobOptionsError]=useState("");
 const [jobOptionsRetry,setJobOptionsRetry]=useState(0);
 const [scopeItems,setScopeItems]=useState<string[]>([]),[addons,setAddons]=useState<string[]>([]);
 const [scopeDetails,setScopeDetails]=useState(""),[condition,setCondition]=useState(""),[requestedDate,setRequestedDate]=useState(""),[requestedTime,setRequestedTime]=useState(""),[hours,setHours]=useState("");
 const [cleaners,setCleaners]=useState("2"),[amount,setAmount]=useState(""),[basis,setBasis]=useState("Flat Price"),[instructions,setInstructions]=useState(""),[access,setAccess]=useState("");
 const [file,setFile]=useState<File|null>(null),[counterAmount,setCounterAmount]=useState(""),[counterScope,setCounterScope]=useState(""),[exceptionReason,setExceptionReason]=useState("");
 const [companyFile,setCompanyFile]=useState<File|null>(null),[companyCategory,setCompanyCategory]=useState("Insurance");
 const [approvedPhotos,setApprovedPhotos]=useState<Array<{id:string;category:string;caption:string|null;url:string}>>([]);
 const reload=useCallback(async()=>{
  const res=await fetch("/api/contractors",{cache:"no-store"});const body=await res.json();
  if(res.status===401){router.replace(contractorPage("/login"));return;}
  if(!res.ok){setData(null);throw new Error(body.error??"Company account unavailable");}
  if(!["Member","Company Admin"].includes(body.role))throw new Error("Contractor portal access is required.");
  setData(body);setOpportunityId(current=>current||body.opportunities?.[0]?.id||"");
 },[router]);
 useEffect(()=>{let alive=true;void reload().catch(e=>{if(alive)setError(e instanceof Error?e.message:"Portal unavailable")}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false};},[reload]);
 useEffect(()=>{
  if(tab!=="submit")return;
  const controller=new AbortController();
  void fetch("/api/contractors?view=job-options",{signal:controller.signal,cache:"no-store"}).then(async response=>{
   const options=await response.json();
   if(!response.ok)throw new Error(options.error??"Job options could not be loaded.");
   if(!controller.signal.aborted){setJobOptions(options);setJobOptionsError("");}
  }).catch(error=>{if(!controller.signal.aborted){setJobOptions(null);setJobOptionsError(error instanceof Error?error.message:"Job options could not be loaded.");}});
  return()=>controller.abort();
 },[tab,jobOptionsRetry]);
 const availableServices=jobOptions?.services.filter(service=>service.division===propertyType)??[];
 const selectedService=availableServices.find(service=>service.name===serviceType);
 const action=async(name:string,args:Record<string,unknown>)=>{
  setBusy(true);setError("");setNotice("");
  try{const r=await fetch("/api/contractors",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({action:name,...args})});const result=await r.json();
   if(!r.ok)throw new Error(result.error??"Request failed");
   setNotice("Saved successfully.");await reload();return result;
  }catch(e){setError(e instanceof Error?e.message:"Request failed");return null;}finally{setBusy(false);}
 };
 const chosen=data?.opportunities.find(x=>x.id===opportunityId);
 const canEdit=Boolean(chosen&&chosen.submitted_by===data?.viewerId&&!chosen.linked_job_id&&!chosen.internal_confirmed_at&&editableContractorRequestStatuses.includes(chosen.status));
 const resetJobForm=()=>{
  setEditing(null);setPropertyName("");setPropertyType("Residential");setServiceType("");setAddress("");
  setSquareFeet("");setBedrooms("");setBathrooms("");setScopeItems([]);setScopeDetails("");setAddons([]);
  setCondition("");setRequestedDate("");setRequestedTime("");setHours("");setCleaners("2");setAmount("");setBasis("Flat Price");setInstructions("");setAccess("");
 };
 const editJob=(request:Opportunity)=>{
  const options=request.request_options;
  setEditing({id:request.id,updatedAt:request.updated_at});
  setPropertyName(request.property_name??"");setPropertyType(request.property_type);setAddress(request.property_address);setServiceType(request.service_type);
  setSquareFeet(String(request.square_feet??""));setBedrooms(String(request.bedrooms??""));setBathrooms(String(request.bathrooms??""));
  setScopeItems(options?.scopeItems??["Other"]);setScopeDetails(options?.scopeItems?options.scopeDetails??"":request.scope_of_work);setAddons(options?.addons??[]);
  setCondition(contractorPropertyConditions.some(option=>option===request.property_condition)?request.property_condition??"":"");
  setRequestedDate(request.requested_date);setRequestedTime(request.requested_time?.slice(0,5)??"");
  setHours(String(request.estimated_person_hours));setCleaners(String(request.cleaner_count));setAmount(String(request.proposed_amount));
  setBasis(request.pricing_basis);setInstructions(request.special_instructions??"");setAccess(request.access_arrangements??"");setTab("submit");
 };
 const currentJob=data?.jobs.find(x=>x.id===chosen?.linked_job_id);
 const currentInvoices=data?.invoices.filter(x=>x.job_id===chosen?.linked_job_id)??[];
 if(loading)return <main className="grid min-h-screen place-items-center">Loading private contractor portal…</main>;
 return <main className="min-h-screen bg-[#f5f6f4] text-neutral-900">
  <header className="bg-[#143d1a] px-4 py-4 text-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
   <div className="flex items-center gap-4"><StudioScrubzLogo size={72}/><div><h1 className="text-xl font-extrabold">Contractor Portal</h1><p className="text-sm text-white/85">{data?.company.name??"StudioScrubz"}</p></div></div>
   <button className="rounded border border-white/60 px-3 py-2 text-sm" onClick={async()=>{await getSupabaseClient().auth.signOut({scope:"local"});router.replace(contractorPage("/login"))}}>Sign out</button>
  </div></header>
  <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
   <div className="flex flex-wrap gap-2">{(["dashboard","submit","jobs","messages","company"] as Tab[]).map(t=><button key={t} className={tab===t?primary:secondary} onClick={()=>{if(t==="submit"&&editing)resetJobForm();setTab(t);}}>{({dashboard:"Dashboard",submit:"Submit New Job",jobs:"My Requests & Jobs",messages:"Messages",company:"Company Profile"} as Record<Tab,string>)[t]}</button>)}</div>
   {error&&<p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</p>}
   {notice&&<p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-[#143d1a]">{notice}</p>}
   {!data&&<p>Company membership is not active. Contact StudioScrubz Operations to request access.</p>}
   {data&&tab==="dashboard"&&<><div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    {[["Submitted opportunities",data.opportunities.length],["Pending decisions",data.opportunities.filter(x=>["New Opportunity","Information Requested","Negotiating","Awaiting Approval"].includes(x.status)).length],
     ["Accepted jobs",data.opportunities.filter(x=>Boolean(x.linked_job_id)).length],["Outstanding invoices",currency(data.invoices.reduce((sum,x)=>sum+Math.max(0,Number(x.total)-Number(x.amount_paid)),0))]].map(([label,value])=><div key={String(label)} className="rounded-xl border bg-white p-4"><p className="text-xs text-neutral-600">{label}</p><p className="mt-2 text-2xl font-extrabold text-[#143d1a]">{value}</p></div>)}</div>
    <PortalPanel title="Recent opportunities">{data.opportunities.slice(0,15).map(x=><button key={x.id} className="flex w-full flex-wrap items-center justify-between gap-2 border-b p-3 text-left hover:bg-neutral-50" onClick={()=>{setOpportunityId(x.id);setTab("jobs")}}><span><b>{x.property_name??x.property_address}</b><small className="block">{x.opportunity_number} · {x.service_type}</small></span><span>{x.status}</span></button>)}</PortalPanel></>}
   {data&&tab==="submit"&&<PortalPanel title={editing?"Edit job request":"Submit a cleaning opportunity"}>
    <p className="mb-4 text-sm text-neutral-600">Submitted prices and scope are proposals until StudioScrubz Operations confirms the final terms.</p>
    <form className="grid gap-4 md:grid-cols-2" onSubmit={async e=>{e.preventDefault();const r=await action(editing?"editOpportunity":"submitOpportunity",{opportunityId:editing?.id,updatedAt:editing?.updatedAt,propertyName,serviceType,address,propertyType,squareFeet:squareFeet||null,bedrooms:bedrooms||null,bathrooms:bathrooms||null,scopeItems,scopeDetails,addons,condition,requestedDate,requestedTime:requestedTime||null,estimatedHours:Number(hours),cleaners:Number(cleaners),amount:Number(amount),pricingBasis:basis,instructions,access,externalReference:submissionKey});if(r){setSubmissionKey(crypto.randomUUID());resetJobForm();setTab("jobs");setOpportunityId(r.opportunity.id);}}}>
     <label className="text-sm font-bold">Property type<select className={input} value={propertyType} onChange={e=>{setPropertyType(e.target.value as ContractorPropertyType);setServiceType("");setScopeItems([]);setScopeDetails("");setAddons([]);}}>
      {contractorPropertyTypes.map(type=><option key={type}>{type}</option>)}
     </select></label>
     <label className="text-sm font-bold">Service type<select className={input} value={serviceType} required disabled={!jobOptions} onChange={e=>{setServiceType(e.target.value);setAddons([]);}}>
      <option value="">{jobOptions?"Select service type":"Loading service types…"}</option>
      {availableServices.map(service=><option key={service.name}>{service.name}</option>)}
     </select></label>
     {jobOptionsError&&<div className="md:col-span-2"><p role="alert" className="mb-2 text-sm text-red-700">{jobOptionsError}</p><button type="button" className={secondary} onClick={()=>{setJobOptionsError("");setJobOptionsRetry(value=>value+1);}}>Retry loading options</button></div>}
     {jobOptions&&!availableServices.length&&<p className="text-sm text-neutral-600 md:col-span-2">No services are currently available for this property type.</p>}
     <PortalField label={propertyType==="Residential"?"Residential customer or property name":"Property name"} value={propertyName} set={setPropertyName} required={propertyType==="Residential"}/>
     <PortalField label="Property address" value={address} set={setAddress} required/>
     <PortalField label="Square footage, if known" value={squareFeet} set={setSquareFeet} type="number"/>
     {propertyType==="Residential"&&<><PortalField label="Bedrooms" value={bedrooms} set={setBedrooms} type="number"/><PortalField label="Bathrooms" value={bathrooms} set={setBathrooms} type="number"/></>}
     <label className="text-sm font-bold">Property condition<select className={input} value={condition} required onChange={e=>setCondition(e.target.value)}>
      <option value="">Select property condition</option>{contractorPropertyConditions.map(option=><option key={option}>{option}</option>)}
     </select></label>
     <PortalField label="Requested service date" value={requestedDate} set={setRequestedDate} type="date" required/>
     <PortalField label="Requested start time" value={requestedTime} set={setRequestedTime} type="time"/>
     <PortalField label="Estimated total person-hours" value={hours} set={setHours} type="number" required/>
     <PortalField label="Suggested cleaners" value={cleaners} set={setCleaners} type="number" required/>
     <PortalField label="Proposed payment amount ($)" value={amount} set={setAmount} type="number" required/>
     <PortalField label="Pricing basis" value={basis} set={setBasis} required/>
     <JobCheckboxes label="Scope of work" help="Select at least one area or task." options={contractorScopeOptions[propertyType]} value={scopeItems} set={setScopeItems}/>
     {scopeItems.includes("Other")&&<label className="block text-sm font-bold md:col-span-2">Other scope details<textarea className={input} rows={2} required maxLength={2000} value={scopeDetails} onChange={e=>setScopeDetails(e.target.value)}/></label>}
     <JobCheckboxes label="Add-ons" help={selectedService?(selectedService.addons.length?"Select any additional services to request.":"No add-ons are available for this service."):"Select a service type to see its available add-ons."} options={selectedService?.addons??[]} value={addons} set={setAddons}/>
     <label className="block text-sm font-bold">Special instructions<textarea className={input} rows={2} value={instructions} onChange={e=>setInstructions(e.target.value)}/></label>
     <label className="block text-sm font-bold">Access arrangements<textarea className={input} rows={2} value={access} onChange={e=>setAccess(e.target.value)}/></label>
     <div className="md:col-span-2"><button className={primary} disabled={busy||!selectedService||!scopeItems.length}>{editing?"Save changes":"Submit opportunity"}</button>{editing&&<button type="button" className={`${secondary} ml-2`} onClick={()=>{resetJobForm();setTab("jobs");}}>Cancel edit</button>}</div>
    </form>
   </PortalPanel>}
   {data&&tab==="jobs"&&<div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
    <PortalPanel title="Requests & jobs"><p className="mb-3 text-sm text-neutral-600">Track cleaning requests you’ve submitted and see the schedule, completion details, and invoice status once a job is accepted.</p>{data.opportunities.map(x=><button key={x.id} type="button" className={`mb-2 block w-full rounded-lg border p-3 text-left text-sm ${opportunityId===x.id?"border-[#143d1a] bg-green-50":"bg-white"}`} onClick={()=>setOpportunityId(x.id)}>
     <b>{x.property_name??x.property_address}</b><span className="mt-1 block">{x.opportunity_number} · {x.service_type} · {x.status}</span></button>)}
     {!data.opportunities.length&&<p className="text-sm text-neutral-600">No opportunities submitted yet.</p>}</PortalPanel>
    <PortalPanel title={chosen?.opportunity_number??"Select an opportunity"}>{chosen&&<div className="space-y-3 text-sm">
          {chosen.property_name&&<p><b>Name:</b> {chosen.property_name}</p>}
     {canEdit&&<div><button type="button" className={secondary} onClick={()=>editJob(chosen)}>Edit request</button>
      <p className="mt-1 text-xs text-neutral-600">Changes return this request to Operations for review and clear any previous confirmation.</p></div>}
     {(chosen.linked_job_id||chosen.internal_confirmed_at)&&<p className="font-bold text-[#143d1a]">Approved request · editing locked</p>}
     <p><b>Service:</b> {chosen.service_type}</p><p><b>Address:</b> {chosen.property_address}</p>
     <p><b>Requested:</b> {chosen.requested_date}</p><p><b>Status:</b> {chosen.status}</p>
     <p><b>Original compensation:</b> {currency(chosen.proposed_amount)}</p><p><b>Agreed compensation:</b> {currency(chosen.agreed_amount)}</p>
     {chosen.property_condition&&<p><b>Property condition:</b> {chosen.property_condition}</p>}
     <p className="whitespace-pre-line"><b>Scope:</b> {chosen.final_scope??chosen.scope_of_work}</p>
     {currentJob&&<p><b>Scheduled:</b> {currentJob.scheduled_date??"Pending"} · {currentJob.status} {currentJob.start_time??""}</p>}
     {currentJob?.completed_at&&<p><b>Completed:</b> {new Date(currentJob.completed_at).toLocaleDateString()}</p>}
     {currentJob?.completed_at&&<div><button type="button" className={secondary} onClick={async()=>{
      setError("");
      try{const res=await fetch(`/api/contractors/completion-photos?jobId=${currentJob.id}`,{cache:"no-store"});
       const body=await res.json();if(!res.ok)throw new Error(body.error||"Photos not available");setApprovedPhotos(body.photos??[]);
      }catch(e){setError(e instanceof Error?e.message:"Photos not available");}
     }}>View authorized completion photos</button>
     {approvedPhotos.length>0&&<div className="mt-3 grid grid-cols-2 gap-2">{approvedPhotos.map(photo=><a href={photo.url} key={photo.id} target="_blank" rel="noreferrer" className="block rounded border p-2"><img alt={photo.caption||photo.category} src={photo.url} className="h-32 w-full object-cover"/><small>{photo.caption||photo.category}</small></a>)}</div>}</div>}
     {currentInvoices.map(inv=><p key={inv.id}><b>Invoice:</b> {inv.invoice_number} · {inv.status} · {currency(inv.total)} total · {currency(inv.amount_paid)} paid · Due {inv.due_date??"unspecified"}</p>)}
     <div className="rounded-lg border p-3"><h3 className="mb-2 font-bold">Changes, cancellations and disputes</h3>
      <label className="block text-sm font-semibold">Describe your request or concern<textarea className={input} rows={2} value={exceptionReason} onChange={e=>setExceptionReason(e.target.value)}/></label>
      <div className="mt-2 flex flex-wrap gap-2">
       <button type="button" className={secondary} disabled={busy||exceptionReason.trim().length<8} onClick={()=>void action("requestReschedule",{opportunityId:chosen.id,reason:exceptionReason})}>Request reschedule</button>
       {!chosen.linked_job_id&&<button type="button" className={secondary} disabled={busy||exceptionReason.trim().length<8} onClick={()=>void action("cancelOpportunity",{opportunityId:chosen.id,reason:exceptionReason})}>Cancel opportunity</button>}
       <button type="button" className={secondary} disabled={busy||exceptionReason.trim().length<8} onClick={()=>void action("disputeOpportunity",{opportunityId:chosen.id,reason:exceptionReason})}>Open dispute</button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">Accepted Jobs can only be cancelled or rescheduled by StudioScrubz Operations.</p>
     </div>
     <h3 className="pt-3 font-extrabold">Price negotiations</h3>
     {data.offers.filter(x=>x.opportunity_id===chosen.id).map(o=><p key={o.id} className="rounded-lg border p-3"><b>{o.offered_by_side}</b> · {currency(o.amount)}<br/>{o.scope_text}</p>)}
     {["New Opportunity","Information Requested","Negotiating"].includes(chosen.status)&&<>
      <PortalField label="Your counteroffer amount" value={counterAmount} set={setCounterAmount} type="number"/>
      <label className="block font-bold">Counteroffer scope<textarea className={input} rows={3} value={counterScope} onChange={e=>setCounterScope(e.target.value)}/></label>
      <button type="button" disabled={busy||!counterAmount||!counterScope} className={secondary} onClick={()=>void action("offer",{opportunityId:chosen.id,amount:Number(counterAmount),scope:counterScope})}>Submit counteroffer</button>
     </>}
     {["New Opportunity","Negotiating","Information Requested"].includes(chosen.status)&&!chosen.partner_confirmed_at&&<div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="mb-3">Confirm the latest scope and price in writing before StudioScrubz can accept this job. Confirmation does not guarantee acceptance.</p>
      <button className={primary} disabled={busy} onClick={()=>void action("confirmOffer",{opportunityId:chosen.id,confirmed:true,amount:Number(chosen.agreed_amount??chosen.proposed_amount),scope:chosen.final_scope??chosen.scope_of_work})}>Confirm final scope and compensation</button></div>}
     <h3 className="pt-3 font-extrabold">Authorized attachments</h3>
     <div>{data.documents.filter(d=>d.opportunity_id===chosen.id).map(d=><a key={d.id} className="mr-3 text-[#143d1a] underline" href={`/api/contractors/files?id=${d.id}`}>{d.file_name} ({d.category})</a>)}</div>
     <label className="block font-bold">Upload photo or scope PDF<input className={input} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
     <button className={secondary} type="button" disabled={busy||!file} onClick={()=>void upload(chosen.id)}>Upload attachment</button>
    </div>}</PortalPanel>
   </div>}
   {data&&tab==="messages"&&<PortalPanel title="Private messages with Operations">
    <p className="mb-3 text-sm text-neutral-600">{data.operationsManager
     ?`Your conversation with ${data.operationsManager.name} is private to you and your assigned Operations Manager.`
     :"StudioScrubz will enable messaging when an Operations Manager is assigned."}</p>
    {data.operationsManager&&<>
     <p className="mb-2 text-sm">Unread: {data.messages.filter(x=>x.sender_side==="StudioScrubz"&&!x.read_at).length}</p>
     <button type="button" className={secondary} disabled={busy} onClick={()=>void action("markMessagesRead",{})}>Mark messages read</button>
     <div className="mt-3 max-h-96 space-y-2 overflow-auto">{data.messages.map(x=><div key={x.id} className="rounded-lg bg-neutral-50 p-3 text-sm"><b>{x.sender_side==="Contractor"?"You":data.operationsManager?.name}</b><p className="text-xs text-neutral-500">{new Date(x.created_at).toLocaleString()}</p><p>{x.body}</p></div>)}</div>
     <label className="mt-3 block font-bold">Your message<textarea className={input} rows={3} value={message} onChange={e=>setMessage(e.target.value)}/></label>
     <button className={primary} disabled={busy||!message.trim()} onClick={async()=>{const r=await action("message",{message});if(r)setMessage("");}}>Send to Operations Manager</button>
    </>}
   </PortalPanel>}
   {data&&tab==="company"&&<div className="grid gap-4 lg:grid-cols-2">
    <PortalPanel title="Company profile"><p className="text-sm"><b>{data.company.name}</b> · {data.company.contractor_code}</p><p>{data.company.contact_email}</p><p>{data.company.phone??""}</p><p>{data.company.business_address??""}</p><p>Payment terms: {data.company.payment_terms??"Not specified"}</p>
    <form className="mt-5 space-y-3 border-t pt-4" onSubmit={async e=>{
      e.preventDefault();const saved=await action("updateCompany",profileEdit);
      if(saved)setProfileEdit({});
     }}>
      <p className="text-sm font-extrabold">Update company contact information</p>
      {(["name","contact_name","contact_email","phone","business_address"] as const).map(key=><label key={key} className="block text-sm font-bold">
       {({name:"Company name",contact_name:"Primary contact",contact_email:"Business email",phone:"Phone",business_address:"Business address"} as Record<string,string>)[key]}
       <input className={input} type={key==="contact_email"?"email":"text"} required={key==="name"||key==="contact_email"} value={profileEdit[key]??data.company[key]??""}
        onChange={e=>setProfileEdit(v=>({...v,[key]:e.target.value}))}/></label>)}
      <button className={primary} disabled={busy||!Object.keys(profileEdit).length}>Save company information</button>
     </form>
    <p className="mt-3 text-xs text-neutral-500">Legal, tax, insurance and contract records are reviewed by StudioScrubz Operations.</p></PortalPanel>
    <PortalPanel title="Company documents"><p className="mb-3 text-xs text-neutral-600">Secure company tax, insurance and agreement files. Upload PDF, PNG, JPEG or WebP files up to 4 MB. Tax documents are visible only to company administrators and StudioScrubz Operations.</p>
     <div className="space-y-2">{data.documents.filter(d=>!d.opportunity_id).map(d=><a key={d.id} className="block text-sm text-[#143d1a] underline" href={`/api/contractors/files?id=${d.id}`}>{d.file_name} ({d.category})</a>)}</div>
     {data.role==="Company Admin"&&<div className="mt-4 space-y-2">
      <label className="block text-sm font-bold">Document category<select className={input} value={companyCategory} onChange={e=>setCompanyCategory(e.target.value)}>
       {["Insurance","Tax","Agreement","Other"].map(k=><option key={k}>{k}</option>)}</select></label>
      <label className="block text-sm font-bold">Private file<input type="file" className={input} accept=".pdf,image/png,image/jpeg,image/webp" onChange={e=>setCompanyFile(e.target.files?.[0]??null)}/></label>
      <button type="button" className={secondary} disabled={busy||!companyFile} onClick={async()=>{
       if(!companyFile)return;setBusy(true);setError("");
       try{const form=new FormData();form.set("file",companyFile);form.set("category",companyCategory);
        const r=await fetch("/api/contractors/files",{method:"POST",body:form});const body=await r.json();
        if(!r.ok)throw new Error(body.error||"Upload failed");await reload();setCompanyFile(null);setNotice("Company document uploaded securely.");
       }catch(e){setError(e instanceof Error?e.message:"Company document upload failed");}finally{setBusy(false);}
      }}>Upload secure document</button>
     </div>}
    </PortalPanel>
   </div>}
  </div>
 </main>;

 async function upload(oppId:string){
  if(!file)return;setBusy(true);setError("");
  try{const form=new FormData();form.set("file",file);form.set("opportunityId",oppId);form.set("category",file.type.startsWith("image/")?"Photo":"Scope");
   const r=await fetch("/api/contractors/files",{method:"POST",body:form});const b=await r.json();if(!r.ok)throw new Error(b.error||"Upload failed");await reload();setFile(null);setNotice("Attachment uploaded securely.");
  }catch(e){setError(e instanceof Error?e.message:"Upload failed");}finally{setBusy(false);}
 }
}
function PortalPanel({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-xl border bg-white p-5"><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">{title}</h2>{children}</section>}
function PortalField({label,value,set,type="text",required=false}:{label:string;value:string;set:(x:string)=>void;type?:string;required?:boolean}){return <label className="block text-sm font-bold">{label}<input className={input} type={type} min={type==="number"?0:undefined} step={type==="number"?"any":undefined} required={required} value={value} onChange={e=>set(e.target.value)}/></label>}


function JobCheckboxes({label,help,options,value,set}:{label:string;help:string;options:readonly string[];value:string[];set:(value:string[])=>void}){
 return <fieldset className="rounded-lg border border-neutral-300 p-3 md:col-span-2">
  <legend className="px-1 text-sm font-bold">{label}</legend>
  <p className="mb-2 text-sm text-neutral-600">{help}</p>
  <div className="grid gap-2 sm:grid-cols-2">
   {options.map(option=><label className="flex items-center gap-2 text-sm" key={option}>
    <input type="checkbox" checked={value.includes(option)} onChange={event=>set(event.target.checked?[...value,option]:value.filter(item=>item!==option))}/>{option}
   </label>)}
  </div>
 </fieldset>;
}
