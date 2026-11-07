"use client";
import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {getSupabaseClient} from "@/lib/supabase/client";
import {StudioScrubzLogo} from "@/components/branding/StudioScrubzLogo";
type Opportunity={id:string;opportunity_number:string;service_type:string;property_address:string;scope_of_work:string;requested_date:string;requested_time:string|null;proposed_amount:number;agreed_amount:number|null;status:string;final_scope:string|null;linked_job_id:string|null;partner_confirmed_at:string|null};
type Offer={id:string;opportunity_id:string;offered_by_side:string;amount:number;scope_text:string;created_at:string};
type Msg={id:string;opportunity_id:string|null;sender_side:string;body:string;created_at:string};
type Invoice={id:string;job_id:string;invoice_number:string;status:string;total:number;amount_paid:number;due_date:string|null};
type Job={id:string;status:string;scheduled_date:string|null;start_time:string|null;completed_at:string|null};
type Document={id:string;opportunity_id:string|null;file_name:string;category:string};
type Portal={role:string;company:{id:string;name:string;contractor_code:string;contact_name:string;contact_email:string;phone:string|null;business_address:string|null;status:string;payment_terms:string|null};opportunities:Opportunity[];offers:Offer[];messages:Msg[];members:Array<{id:string;email:string;member_role:string;is_active:boolean}>;jobs:Job[];invoices:Invoice[];documents:Document[];unread:Record<string,number>};
const input="mt-1 w-full rounded-lg border border-neutral-300 bg-white p-3 text-neutral-900";
const primary="rounded-lg bg-[#143d1a] px-4 py-2.5 font-bold text-white disabled:opacity-50";
const secondary="rounded-lg border border-[#143d1a]/30 bg-white px-4 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-50";
const currency=(x:number|null)=>x==null?"Pending":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(x));
type Tab="dashboard"|"submit"|"jobs"|"messages"|"company";
export function ContractorPortal(){
 const router=useRouter();
 const [data,setData]=useState<Portal|null>(null),[tab,setTab]=useState<Tab>("dashboard");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [opportunityId,setOpportunityId]=useState(""),[message,setMessage]=useState(""),[staffEmail,setStaffEmail]=useState("");
 const [profileEdit,setProfileEdit]=useState<Record<string,string>>({});
 const [submissionKey,setSubmissionKey]=useState(()=>crypto.randomUUID());
 const [serviceType,setServiceType]=useState("Standard Cleaning"),[address,setAddress]=useState(""),[propertyType,setPropertyType]=useState("Residential");
 const [squareFeet,setSquareFeet]=useState(""),[bedrooms,setBedrooms]=useState(""),[bathrooms,setBathrooms]=useState("");
 const [scope,setScope]=useState(""),[condition,setCondition]=useState(""),[requestedDate,setRequestedDate]=useState(""),[requestedTime,setRequestedTime]=useState(""),[hours,setHours]=useState("");
 const [cleaners,setCleaners]=useState("2"),[amount,setAmount]=useState(""),[basis,setBasis]=useState("Flat Price"),[instructions,setInstructions]=useState(""),[access,setAccess]=useState("");
 const [file,setFile]=useState<File|null>(null),[counterAmount,setCounterAmount]=useState(""),[counterScope,setCounterScope]=useState(""),[exceptionReason,setExceptionReason]=useState("");
 const [companyFile,setCompanyFile]=useState<File|null>(null),[companyCategory,setCompanyCategory]=useState("Insurance");
 const [approvedPhotos,setApprovedPhotos]=useState<Array<{id:string;category:string;caption:string|null;url:string}>>([]);
 const reload=useCallback(async()=>{
  const res=await fetch("/api/contractors",{cache:"no-store"});const body=await res.json();
  if(res.status===401){router.replace("/contractor/login");return;}
  if(!res.ok)throw new Error(body.error??"Company account unavailable");
  if(!["Member","Company Admin"].includes(body.role)){router.replace("/contractors");return;}
  setData(body);setOpportunityId(current=>current||body.opportunities?.[0]?.id||"");
 },[router]);
 useEffect(()=>{let alive=true;void reload().catch(e=>{if(alive)setError(e instanceof Error?e.message:"Portal unavailable")}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false};},[reload]);
 const action=async(name:string,args:Record<string,unknown>)=>{
  setBusy(true);setError("");setNotice("");
  try{const r=await fetch("/api/contractors",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({action:name,...args})});const result=await r.json();
   if(!r.ok)throw new Error(result.error??"Request failed");
   setNotice("Saved successfully.");await reload();return result;
  }catch(e){setError(e instanceof Error?e.message:"Request failed");return null;}finally{setBusy(false);}
 };
 const chosen=data?.opportunities.find(x=>x.id===opportunityId);
 const currentJob=data?.jobs.find(x=>x.id===chosen?.linked_job_id);
 const currentInvoices=data?.invoices.filter(x=>x.job_id===chosen?.linked_job_id)??[];
 if(loading)return <main className="grid min-h-screen place-items-center">Loading private contractor portal…</main>;
 return <main className="min-h-screen bg-[#f5f6f4] text-neutral-900">
  <header className="bg-[#143d1a] px-4 py-4 text-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
   <div className="flex items-center gap-4"><StudioScrubzLogo size={72}/><div><h1 className="text-xl font-extrabold">Contractor Partner Portal</h1><p className="text-sm text-white/85">{data?.company.name??"StudioScrubz"}</p></div></div>
   <button className="rounded border border-white/60 px-3 py-2 text-sm" onClick={async()=>{await getSupabaseClient().auth.signOut();router.replace("/contractor/login")}}>Sign out</button>
  </div></header>
  <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
   <div className="flex flex-wrap gap-2">{(["dashboard","submit","jobs","messages","company"] as Tab[]).map(t=><button key={t} className={tab===t?primary:secondary} onClick={()=>setTab(t)}>{({dashboard:"Dashboard",submit:"Submit New Job",jobs:"My Jobs",messages:"Messages",company:"Company Profile"} as Record<Tab,string>)[t]}</button>)}</div>
   {error&&<p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</p>}
   {notice&&<p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-[#143d1a]">{notice}</p>}
   {!data&&<p>Company membership is not active. Contact StudioScrubz Operations to request access.</p>}
   {data&&tab==="dashboard"&&<><div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    {[["Submitted opportunities",data.opportunities.length],["Pending decisions",data.opportunities.filter(x=>["New Opportunity","Information Requested","Negotiating","Awaiting Approval"].includes(x.status)).length],
     ["Accepted jobs",data.opportunities.filter(x=>Boolean(x.linked_job_id)).length],["Outstanding invoices",currency(data.invoices.reduce((sum,x)=>sum+Math.max(0,Number(x.total)-Number(x.amount_paid)),0))]].map(([label,value])=><div key={String(label)} className="rounded-xl border bg-white p-4"><p className="text-xs text-neutral-600">{label}</p><p className="mt-2 text-2xl font-extrabold text-[#143d1a]">{value}</p></div>)}</div>
    <PortalPanel title="Recent opportunities">{data.opportunities.slice(0,15).map(x=><button key={x.id} className="flex w-full flex-wrap items-center justify-between gap-2 border-b p-3 text-left hover:bg-neutral-50" onClick={()=>{setOpportunityId(x.id);setTab("jobs")}}><span><b>{x.opportunity_number}</b><small className="block">{x.service_type} · {x.property_address}</small></span><span>{x.status}</span></button>)}</PortalPanel></>}
   {data&&tab==="submit"&&<PortalPanel title="Submit a cleaning opportunity">
    <p className="mb-4 text-sm text-neutral-600">Submitted prices and scope are proposals until StudioScrubz Operations confirms the final terms.</p>
    <form className="grid gap-4 md:grid-cols-2" onSubmit={async e=>{e.preventDefault();const r=await action("submitOpportunity",{serviceType,address,propertyType,squareFeet:squareFeet||null,bedrooms:bedrooms||null,bathrooms:bathrooms||null,scope,condition,requestedDate,requestedTime:requestedTime||null,estimatedHours:Number(hours),cleaners:Number(cleaners),amount:Number(amount),pricingBasis:basis,instructions,access,externalReference:submissionKey});if(r){setSubmissionKey(crypto.randomUUID());setAddress("");setScope("");setAmount("");setTab("jobs");setOpportunityId(r.opportunity.id);}}}>
     <PortalField label="Service type" value={serviceType} set={setServiceType} required/>
     <label className="text-sm font-bold">Property type<select className={input} value={propertyType} onChange={e=>setPropertyType(e.target.value)}><option>Residential</option><option>Commercial</option></select></label>
     <PortalField label="Property address" value={address} set={setAddress} required/>
     <PortalField label="Square footage, if known" value={squareFeet} set={setSquareFeet} type="number"/>
     {propertyType==="Residential"&&<><PortalField label="Bedrooms" value={bedrooms} set={setBedrooms} type="number"/><PortalField label="Bathrooms" value={bathrooms} set={setBathrooms} type="number"/></>}
     <PortalField label="Property condition" value={condition} set={setCondition}/>
     <PortalField label="Requested service date" value={requestedDate} set={setRequestedDate} type="date" required/>
     <PortalField label="Requested start time" value={requestedTime} set={setRequestedTime} type="time"/>
     <PortalField label="Estimated total person-hours" value={hours} set={setHours} type="number" required/>
     <PortalField label="Suggested cleaners" value={cleaners} set={setCleaners} type="number" required/>
     <PortalField label="Proposed payment amount ($)" value={amount} set={setAmount} type="number" required/>
     <PortalField label="Pricing basis" value={basis} set={setBasis} required/>
     <label className="block text-sm font-bold md:col-span-2">Scope of work<textarea className={input} rows={4} required minLength={10} value={scope} onChange={e=>setScope(e.target.value)}/></label>
     <label className="block text-sm font-bold">Special instructions<textarea className={input} rows={2} value={instructions} onChange={e=>setInstructions(e.target.value)}/></label>
     <label className="block text-sm font-bold">Access arrangements<textarea className={input} rows={2} value={access} onChange={e=>setAccess(e.target.value)}/></label>
     <div className="md:col-span-2"><button className={primary} disabled={busy}>Submit opportunity</button></div>
    </form>
   </PortalPanel>}
   {data&&tab==="jobs"&&<div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
    <PortalPanel title="My opportunities">{data.opportunities.map(x=><button key={x.id} type="button" className={`mb-2 block w-full rounded-lg border p-3 text-left text-sm ${opportunityId===x.id?"border-[#143d1a] bg-green-50":"bg-white"}`} onClick={()=>setOpportunityId(x.id)}>
     <b>{x.opportunity_number}</b><span className="mt-1 block">{x.service_type} · {x.status}</span></button>)}
     {!data.opportunities.length&&<p className="text-sm text-neutral-600">No opportunities submitted yet.</p>}</PortalPanel>
    <PortalPanel title={chosen?.opportunity_number??"Select an opportunity"}>{chosen&&<div className="space-y-3 text-sm">
     <p><b>Service:</b> {chosen.service_type}</p><p><b>Address:</b> {chosen.property_address}</p>
     <p><b>Requested:</b> {chosen.requested_date}</p><p><b>Status:</b> {chosen.status}</p>
     <p><b>Original compensation:</b> {currency(chosen.proposed_amount)}</p><p><b>Agreed compensation:</b> {currency(chosen.agreed_amount)}</p>
     <p><b>Scope:</b> {chosen.final_scope??chosen.scope_of_work}</p>
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
      <button className={primary} disabled={busy} onClick={()=>void action("confirmOffer",{opportunityId:chosen.id,confirmed:true})}>Confirm final scope and compensation</button></div>}
     <h3 className="pt-3 font-extrabold">Authorized attachments</h3>
     <div>{data.documents.filter(d=>d.opportunity_id===chosen.id).map(d=><button key={d.id} type="button" className="mr-3 text-[#143d1a] underline" onClick={()=>void openFile(d.id)}>{d.file_name} ({d.category})</button>)}</div>
     <label className="block font-bold">Upload photo or scope PDF<input className={input} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
     <button className={secondary} type="button" disabled={busy||!file} onClick={()=>void upload(chosen.id)}>Upload attachment</button>
    </div>}</PortalPanel>
   </div>}
   {data&&tab==="messages"&&<div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
    <PortalPanel title="Conversation"><select className={input} value={opportunityId} onChange={e=>setOpportunityId(e.target.value)}><option value="">Company-wide messages</option>{data.opportunities.map(x=><option key={x.id} value={x.id}>{x.opportunity_number}</option>)}</select></PortalPanel>
    <PortalPanel title="Messages"><p className="mb-2 text-sm">Unread from StudioScrubz: <b>{data.unread?.[data.company.id]??0}</b></p>
     <button type="button" className={secondary} disabled={busy} onClick={()=>void action("markMessagesRead",{})}>Mark messages read</button>
     <div className="mt-3 max-h-96 space-y-2 overflow-auto">{data.messages.filter(x=>x.opportunity_id===(opportunityId||null)).map(x=><div key={x.id} className="rounded-lg bg-neutral-50 p-3 text-sm"><b>{x.sender_side}</b><p className="text-xs text-neutral-500">{new Date(x.created_at).toLocaleString()}</p><p>{x.body}</p></div>)}</div>
     <label className="mt-3 block font-bold">Your message<textarea className={input} rows={3} value={message} onChange={e=>setMessage(e.target.value)}/></label>
     <button className={primary} disabled={busy||!message.trim()} onClick={async()=>{const r=await action("message",{opportunityId:opportunityId||null,message});if(r)setMessage("");}}>Send to StudioScrubz</button>
    </PortalPanel></div>}
   {data&&tab==="company"&&<div className="grid gap-4 lg:grid-cols-2">
    <PortalPanel title="Company profile"><p className="text-sm"><b>{data.company.name}</b> · {data.company.contractor_code}</p><p>{data.company.contact_email}</p><p>{data.company.phone??""}</p><p>{data.company.business_address??""}</p><p>Payment terms: {data.company.payment_terms??"Not specified"}</p>
    {data.role==="Company Admin"&&<form className="mt-5 space-y-3 border-t pt-4" onSubmit={async e=>{
      e.preventDefault();await action("updateCompany",{
       contact_name:profileEdit.contact_name??data.company.contact_name,
       contact_email:profileEdit.contact_email??data.company.contact_email,
       phone:profileEdit.phone??data.company.phone,
       business_address:profileEdit.business_address??data.company.business_address,
      });
     }}>
      <p className="text-sm font-extrabold">Update company contact information</p>
      {(["contact_name","contact_email","phone","business_address"] as const).map(key=><label key={key} className="block text-sm font-bold">
       {({contact_name:"Primary contact",contact_email:"Business email",phone:"Phone",business_address:"Business address"} as Record<string,string>)[key]}
       <input className={input} type={key==="contact_email"?"email":"text"} value={profileEdit[key]??data.company[key]??""}
        onChange={e=>setProfileEdit(v=>({...v,[key]:e.target.value}))}/></label>)}
      <button className={primary} disabled={busy}>Save contact details</button>
     </form>}
    <p className="mt-3 text-xs text-neutral-500">Legal, tax, insurance and contract records are reviewed by StudioScrubz Operations.</p></PortalPanel>
    <PortalPanel title="Company documents"><p className="mb-3 text-xs text-neutral-600">Secure company tax, insurance and agreement files. Tax documents are visible only to company administrators and StudioScrubz Operations.</p>
     <div className="space-y-2">{data.documents.filter(d=>!d.opportunity_id).map(d=><button key={d.id} type="button" className="block text-sm text-[#143d1a] underline" onClick={()=>void openFile(d.id)}>{d.file_name} ({d.category})</button>)}</div>
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
    <PortalPanel title="Authorized contacts">{data.members.map(m=><p key={m.id} className="border-b p-2 text-sm">{m.email} · {m.member_role} · {m.is_active?"Active":"Inactive"}</p>)}
     {data.role==="Company Admin"&&<><div className="mt-3"><PortalField label="Request additional staff access" value={staffEmail} set={setStaffEmail} type="email"/></div>
     <button className={primary} disabled={busy||!staffEmail.includes("@")} onClick={()=>void action("requestStaff",{email:staffEmail})}>Request StudioScrubz approval</button></>}
    </PortalPanel>
   </div>}
  </div>
 </main>;
 async function openFile(id:string){
  try{const r=await fetch(`/api/contractors/files?id=${id}`,{cache:"no-store"});const b=await r.json();if(!r.ok)throw new Error(b.error||"File unavailable");window.open(b.url,"_blank","noopener,noreferrer");}catch(e){setError(e instanceof Error?e.message:"File unavailable");}
 }
 async function upload(oppId:string){
  if(!file)return;setBusy(true);setError("");
  try{const form=new FormData();form.set("file",file);form.set("opportunityId",oppId);form.set("category",file.type.startsWith("image/")?"Photo":"Scope");
   const r=await fetch("/api/contractors/files",{method:"POST",body:form});const b=await r.json();if(!r.ok)throw new Error(b.error||"Upload failed");await reload();setFile(null);setNotice("Attachment uploaded securely.");
  }catch(e){setError(e instanceof Error?e.message:"Upload failed");}finally{setBusy(false);}
 }
}
function PortalPanel({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-xl border bg-white p-5"><h2 className="mb-4 text-xl font-extrabold text-[#143d1a]">{title}</h2>{children}</section>}
function PortalField({label,value,set,type="text",required=false}:{label:string;value:string;set:(x:string)=>void;type?:string;required?:boolean}){return <label className="block text-sm font-bold">{label}<input className={input} type={type} min={type==="number"?0:undefined} step={type==="number"?"any":undefined} required={required} value={value} onChange={e=>set(e.target.value)}/></label>}
