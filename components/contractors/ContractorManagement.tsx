"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
type Company={id:string;contractor_code:string;name:string;contact_email:string;contact_name:string;phone:string|null;status:string;payment_terms:string|null;internal_notes:string|null};
type Opportunity={id:string;opportunity_number:string;company_id:string;service_type:string;property_address:string;scope_of_work:string;requested_date:string;proposed_amount:number;agreed_amount:number|null;final_scope:string|null;status:string;partner_confirmed_at:string|null;linked_job_id:string|null};
type Offer={id:string;opportunity_id:string;offered_by_side:string;amount:number;scope_text:string;created_at:string};
type Message={id:string;company_id:string;opportunity_id:string|null;sender_side:string;body:string;created_at:string};
type Assessment={opportunity_id:string;minimum_price:number|null;projected_margin:number|null;cost_complete:boolean;override_approved_by:string|null;override_reason:string|null;projection:Record<string,unknown>};
type Invite={id:string;company_id:string;invited_email:string;status:string;delivery_status:string;expires_at:string;member_role:string};
type Job={id:string;status:string;scheduled_date:string|null;start_time:string|null;assigned_crew_id:string|null};
type Invoice={id:string;job_id:string;invoice_number:string;status:string;total:number;amount_paid:number;due_date:string|null};
type Document={id:string;company_id:string;opportunity_id:string|null;file_name:string;category:string};
type Data={role:string;companies:Company[];opportunities:Opportunity[];offers:Offer[];messages:Message[];assessments:Assessment[];invitations:Invite[];jobs:Job[];invoices:Invoice[];documents:Document[]};
export type ContractorView="dashboard"|"companies"|"opportunities"|"jobs"|"messages"|"invitations";
const currency=(n:number|null|undefined)=>n==null?"Unavailable":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n));
const input="mt-1 w-full rounded-lg border border-neutral-300 bg-white p-2.5 text-sm text-neutral-900";
const button="rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary="rounded-lg border border-[#143d1a]/30 bg-white px-3 py-2 text-sm font-semibold text-[#143d1a]";
const titles:Record<ContractorView,string>={dashboard:"Contractor Dashboard",companies:"Partner Companies",opportunities:"Job Opportunities",jobs:"Subcontracted Jobs",messages:"Contractor Communications",invitations:"Invitations & Access"};
export function ContractorManagement({view}: {view:ContractorView}){
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [notice,setNotice]=useState(""),[error,setError]=useState("");
 const [companyId,setCompanyId]=useState(""),[opportunityId,setOpportunityId]=useState("");
 const [status,setStatus]=useState("All"),[query,setQuery]=useState("");
 const [companyName,setCompanyName]=useState(""),[companyEmail,setCompanyEmail]=useState(""),[companyContact,setCompanyContact]=useState("");
 const [inviteEmail,setInviteEmail]=useState(""),[inviteRole,setInviteRole]=useState("Company Admin");
 const [offeredAmount,setOfferedAmount]=useState(""),[offerScope,setOfferScope]=useState(""),[message,setMessage]=useState("");
 const [reviewReason,setReviewReason]=useState(""),[cleaners,setCleaners]=useState(2),[hours,setHours]=useState(4);
 const [roundTripMiles,setRoundTripMiles]=useState(""),[roundTripMinutes,setRoundTripMinutes]=useState("");
 const [supplies,setSupplies]=useState("0"),[equipment,setEquipment]=useState("0"),[overhead,setOverhead]=useState("0");
 const [attachment,setAttachment]=useState<File|null>(null);
 const refresh=useCallback(async()=>{
  const response=await fetch("/api/contractors",{cache:"no-store"});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error??"Contractor data unavailable");
  setData(result);
  setCompanyId(current=>current||result.companies?.[0]?.id||"");
  setOpportunityId(current=>current||result.opportunities?.[0]?.id||"");
 },[]);
 useEffect(()=>{let alive=true;void refresh().catch(e=>{if(alive)setError(String(e.message));}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false};},[refresh]);
 const run=async(action:string,payload:Record<string,unknown>={})=>{
  setBusy(true);setError("");setNotice("");
  try{
   const response=await fetch("/api/contractors",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action,...payload})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error??"Request failed");
   setNotice(`${action} completed.`);await refresh();
   return result;
  }catch(e){setError(e instanceof Error?e.message:"Request failed");return null;}
  finally{setBusy(false);}
 };
 const invite=async(action:string,payload:Record<string,unknown>)=>{
  setBusy(true);setError("");setNotice("");
  try{
   const response=await fetch("/api/contractors/invitations",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action,...payload})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error??"Invitation failed");
   setNotice(result.status==="Sent"?"Email provider confirmed invitation delivery.":"Invitation updated.");
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Invitation failed");}finally{setBusy(false);}
 };
 const companies=data?.companies??[],allOpportunities=data?.opportunities??[];
 const selectedCompany=companies.find(x=>x.id===companyId);
 const filtered=useMemo(()=>allOpportunities.filter(o=>(companyId?o.company_id===companyId:true)
  &&(status==="All"||o.status===status)
  &&(!query||[o.opportunity_number,o.service_type,o.property_address,o.status].join(" ").toLowerCase().includes(query.toLowerCase()))),[allOpportunities,companyId,status,query]);
 const selected=allOpportunities.find(x=>x.id===opportunityId);
 const assessment=data?.assessments.find(x=>x.opportunity_id===selected?.id);
 const job=data?.jobs.find(x=>x.id===selected?.linked_job_id);
 const selectedInvoices=data?.invoices.filter(x=>x.job_id===selected?.linked_job_id)??[];
 const count=(values:string[])=>allOpportunities.filter(x=>values.includes(x.status)).length;
 const cards=[
  ["New opportunities",count(["New Opportunity","Information Requested"])],
  ["Negotiating / awaiting reply",count(["Negotiating","Awaiting Approval"])],
  ["Awaiting crew",count(["Accepted","Crew Assignment"])],
  ["Upcoming subcontracted jobs",data?.jobs.filter(x=>["Scheduled","Crew Assigned","Ready to Schedule"].includes(x.status)).length??0],
  ["Pending quality review",count(["Pending Quality Review"])],
  ["Completed / awaiting invoicing",allOpportunities.filter(x=>x.linked_job_id&&data?.jobs.find(j=>j.id===x.linked_job_id)?.status==="Completed"
    &&!data.invoices.some(inv=>inv.job_id===x.linked_job_id)).length],
  ["Outstanding receivables",currency(data?.invoices.reduce((n,x)=>n+Math.max(0,Number(x.total)-Number(x.amount_paid)),0))],
 ];
 const companySelect=<label className="block text-sm font-semibold">Partner company
 <select className={input} value={companyId} onChange={e=>{setCompanyId(e.target.value);setOpportunityId("");}}>
 <option value="">All companies</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>;
 if(loading)return <p className="p-8">Loading Contractor Management…</p>;
 return <main className="space-y-6 p-4 md:p-7">
  <header><p className="text-xs font-extrabold uppercase tracking-wider text-[#a08020]">Operations / Contractor Management</p>
  <h1 className="mt-1 text-3xl font-extrabold text-[#143d1a]">{titles[view]}</h1>
  <p className="mt-2 text-sm text-neutral-600">Subcontracting partner relationships and job delivery, integrated with StudioScrubz operations.</p></header>
  {error&&<p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-[#143d1a]">{notice}</p>}
  <div className="flex flex-wrap gap-2">{(Object.keys(titles) as ContractorView[]).map((v)=><Link key={v}
   href={v==="dashboard"?"/contractors":`/contractors/${v==="companies"?"companies":v==="opportunities"?"opportunities":v==="jobs"?"jobs":v==="messages"?"messages":"invitations"}`}
   className={view===v?button:secondary}>{titles[v]}</Link>)}</div>
  {view==="dashboard"&&<><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value])=><div key={String(label)} className="rounded-xl border bg-white p-4 shadow-sm"><p className="text-xs font-semibold text-neutral-600">{label}</p><p className="mt-2 text-2xl font-extrabold text-[#143d1a]">{value}</p></div>)}</div>
  <h2 className="text-lg font-extrabold">Recent opportunities</h2><OpportunityTable rows={allOpportunities.slice(0,20)} companies={companies} select={setOpportunityId}/></>}
  {view==="companies"&&<section className="grid gap-5 lg:grid-cols-2">
   <Panel title="Create partner company"><form className="space-y-3" onSubmit={async e=>{e.preventDefault();const r=await run("createCompany",{name:companyName,email:companyEmail,contactName:companyContact});if(r){setCompanyName("");setCompanyEmail("");setCompanyContact("");setCompanyId(r.companyId);}}}>
    <Field label="Company name" value={companyName} set={setCompanyName} required/>
    <Field label="Primary email" value={companyEmail} set={setCompanyEmail} type="email" required/>
    <Field label="Primary contact" value={companyContact} set={setCompanyContact}/>
    <button disabled={busy} className={button}>Create Company</button></form></Panel>
   <Panel title="Partner directory"><div className="space-y-2">{companies.map(c=><button key={c.id} type="button" onClick={()=>setCompanyId(c.id)}
     className="flex w-full items-center justify-between rounded-lg border bg-white p-3 text-left hover:border-[#143d1a]"><span><b>{c.name}</b><small className="block text-neutral-500">{c.contractor_code} · {c.contact_email}</small></span><span>{c.status}</span></button>)}</div></Panel>
   {selectedCompany&&<Panel title={`Manage ${selectedCompany.name}`}><div className="space-y-3 text-sm">
    <p>Contact: {selectedCompany.contact_name||"Not supplied"}</p><p>Email: {selectedCompany.contact_email}</p><p>Terms: {selectedCompany.payment_terms||"Not specified"}</p>
    <p>Status: <b>{selectedCompany.status}</b></p>
    {data?.role==="Master Admin"&&<div className="flex flex-wrap gap-2">{["Active","Pending","Suspended","Archived"].map(status=><button key={status} type="button" disabled={busy||status===selectedCompany.status}
     onClick={()=>void run("updateCompany",{companyId:selectedCompany.id,status})} className={secondary}>{status}</button>)}</div>}
    <p className="text-xs text-neutral-500">Company status and access controls require Master Admin authorization.</p></div></Panel>}
  </section>}
  {(view==="opportunities"||view==="jobs")&&<>
   <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">{companySelect}
    <label className="text-sm font-semibold">Status<select className={input} value={status} onChange={e=>setStatus(e.target.value)}>
     {["All",...new Set(allOpportunities.map(x=>x.status))].map(x=><option key={x}>{x}</option>)}</select></label>
    <Field label="Search" value={query} set={setQuery}/></div>
   <OpportunityTable rows={view==="jobs"?filtered.filter(x=>Boolean(x.linked_job_id)):filtered} companies={companies} select={setOpportunityId}/>
   {selected&&<Panel title={`Review ${selected.opportunity_number}`}>
    <div className="grid gap-4 lg:grid-cols-2"><div className="space-y-2 text-sm">
     <p><b>Company:</b> {companies.find(x=>x.id===selected.company_id)?.name}</p>
     <p><b>Service:</b> {selected.service_type}</p><p><b>Property:</b> {selected.property_address}</p>
     <p><b>Requested:</b> {selected.requested_date}</p><p><b>Status:</b> {selected.status}</p>
     <p><b>Original offer:</b> {currency(selected.proposed_amount)}</p>
     <p><b>Agreed compensation:</b> {currency(selected.agreed_amount)}</p>
     <p><b>Partner written confirmation:</b> {selected.partner_confirmed_at?"Received":"Required"}</p>
     <p><b>Scope:</b> {selected.final_scope??selected.scope_of_work}</p>
     {job&&<p><b>Linked operational job:</b> {job.status} · {job.scheduled_date||"Schedule pending"} <Link className="text-[#143d1a] underline" href="/jobs">Open Jobs</Link></p>}
     {selectedInvoices.map(x=><p key={x.id}><b>Invoice:</b> {x.invoice_number}, {x.status}, {currency(x.total)} total / {currency(x.amount_paid)} paid</p>)}
     <h3 className="font-extrabold">Negotiation history</h3>
     {data?.offers.filter(x=>x.opportunity_id===selected.id).map(x=><p key={x.id} className="rounded border p-2">{x.offered_by_side}: {currency(x.amount)} · {x.scope_text}</p>)}
    </div><div className="space-y-4">
     <h3 className="font-extrabold text-[#143d1a]">Pricing & negotiation</h3>
     <Field label="Counteroffer amount" value={offeredAmount} set={setOfferedAmount} type="number"/>
     <label className="block text-sm font-semibold">Proposed final scope<textarea className={input} value={offerScope} onChange={e=>setOfferScope(e.target.value)} rows={3}/></label>
     <button className={secondary} type="button" disabled={busy||!offeredAmount||!offerScope} onClick={()=>void run("offer",{opportunityId:selected.id,amount:Number(offeredAmount),scope:offerScope})}>Send counteroffer</button>
     <h3 className="font-extrabold text-[#143d1a]">Internal profitability</h3>
     <div className="grid grid-cols-2 gap-2"><NumberField label="Cleaners" value={cleaners} set={setCleaners}/><NumberField label="Hours per cleaner" value={hours} set={setHours}/>
     <Field label="Verified round-trip miles" value={roundTripMiles} set={setRoundTripMiles} type="number"/>
     <Field label="Verified travel minutes" value={roundTripMinutes} set={setRoundTripMinutes} type="number"/>
     <Field label="Supplies $" value={supplies} set={setSupplies} type="number"/>
     <Field label="Equipment $" value={equipment} set={setEquipment} type="number"/>
     <Field label="Overhead $" value={overhead} set={setOverhead} type="number"/></div>
     <button type="button" className={secondary} disabled={busy} onClick={()=>void run("assess",{opportunityId:selected.id,
      cleaners,hoursPerCleaner:hours,travelMode:roundTripMiles!==""&&roundTripMinutes!==""?"Manual":"Unavailable",
      roundTripMiles:Number(roundTripMiles),roundTripMinutes:Number(roundTripMinutes),supplies:Number(supplies),equipment:Number(equipment),overhead:Number(overhead)})}>Calculate internal profitability</button>
     {assessment&&<div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
      <p>Minimum acceptable price: <b>{currency(assessment.minimum_price)}</b></p>
      <p>Projected gross margin: <b>{assessment.projected_margin==null?"Unavailable":`${assessment.projected_margin}%`}</b></p>
      <p>Cost coverage: <b>{assessment.cost_complete?"Complete":"Incomplete – cannot accept without Master Admin override"}</b></p>
      <p>Override: {assessment.override_approved_by?"Approved with audited reason":"Not approved"}</p></div>}
     <Field label="Decision / override reason" value={reviewReason} set={setReviewReason}/>
     {data?.role==="Master Admin"&&<button className={secondary} disabled={busy||reviewReason.length<12} type="button"
      onClick={()=>void run("approveOverride",{opportunityId:selected.id,reason:reviewReason})}>Master Admin: approve override</button>}
     <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy||!selected.partner_confirmed_at||!assessment} onClick={()=>void run("accept",{opportunityId:selected.id,reason:reviewReason})}>Accept & create operational Job</button>
      <button className={secondary} disabled={busy||!reviewReason} onClick={()=>void run("decline",{opportunityId:selected.id,reason:reviewReason})}>Decline</button>
      {selected.status==="Accepted"&&!selected.linked_job_id&&<button className={secondary} disabled={busy} onClick={()=>void run("retryJobConversion",{opportunityId:selected.id})}>Retry Job handoff</button>}</div>
    </div></div>
    <h3 className="mt-5 font-bold">Scope documents and photos</h3>
    <div className="mt-2 flex flex-wrap items-center gap-2"><input type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={e=>setAttachment(e.target.files?.[0]??null)}/>
    <button type="button" className={secondary} disabled={!attachment||busy} onClick={async()=>{
     if(!attachment)return;setBusy(true);setError("");
     try{const form=new FormData();form.set("file",attachment);form.set("companyId",selected.company_id);
      form.set("opportunityId",selected.id);form.set("category",attachment.type.startsWith("image/")?"Photo":"Scope");
      const res=await fetch("/api/contractors/files",{method:"POST",body:form});const result=await res.json();
      if(!res.ok)throw new Error(result.error||"Upload failed");await refresh();setAttachment(null);setNotice("Attachment uploaded.");
     }catch(e){setError(e instanceof Error?e.message:"Upload failed");}finally{setBusy(false);}
    }}>Upload attachment</button></div>
    {data?.documents.filter(x=>x.opportunity_id===selected.id).map(x=><button key={x.id} type="button" className="mr-2 mt-2 text-sm text-[#143d1a] underline" onClick={()=>void openDocument(x.id)}>{x.file_name}</button>)}
   </Panel>}
  </>}
  {view==="messages"&&<section className="grid gap-4 lg:grid-cols-[1fr_2fr]"><Panel title="Partner">{companySelect}<label className="mt-3 block text-sm font-semibold">Opportunity
   <select className={input} value={opportunityId} onChange={e=>setOpportunityId(e.target.value)}><option value="">Company-wide conversation</option>{allOpportunities.filter(x=>x.company_id===companyId).map(o=><option key={o.id} value={o.id}>{o.opportunity_number}</option>)}</select></label></Panel>
   <Panel title="Contractor thread"><div className="max-h-96 space-y-2 overflow-y-auto">{data?.messages.filter(x=>x.company_id===companyId&&x.opportunity_id===(opportunityId||null)).map(x=><div key={x.id} className="rounded-lg bg-neutral-50 p-3 text-sm"><b>{x.sender_side}</b><p className="text-xs text-neutral-500">{new Date(x.created_at).toLocaleString()}</p><p>{x.body}</p></div>)}</div>
    <label className="mt-3 block text-sm font-semibold">Message<textarea className={input} value={message} onChange={e=>setMessage(e.target.value)} rows={3}/></label>
    <button className={button} disabled={busy||!companyId||!message.trim()} onClick={async()=>{const r=await run("message",{companyId,opportunityId:opportunityId||null,message});if(r)setMessage("");}}>Send message</button></Panel></section>}
  {view==="invitations"&&<section className="space-y-4">
   <Panel title="Send secure seven-day invitation"><div className="grid gap-3 sm:grid-cols-3">{companySelect}
    <Field label="Invited email" value={inviteEmail} set={setInviteEmail} type="email"/>
    <label className="text-sm font-semibold">Company role<select className={input} value={inviteRole} onChange={e=>setInviteRole(e.target.value)}><option>Company Admin</option><option>Member</option></select></label></div>
    <button type="button" className={button} disabled={busy||!companyId||!inviteEmail.trim()} onClick={()=>void invite("invite",{companyId,email:inviteEmail,memberRole:inviteRole})}>Send invitation</button>
    <p className="mt-2 text-xs text-neutral-600">Invite is single-use, emailed by the configured provider, and expires after seven days. External staff additions require StudioScrubz approval.</p>
   </Panel>
   <Panel title="Invitation status">{data?.invitations.map(i=><div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-3 text-sm">
    <div><b>{i.invited_email}</b><p>{companies.find(c=>c.id===i.company_id)?.name} · {i.member_role} · {i.status} / {i.delivery_status}</p><small>Expires: {new Date(i.expires_at).toLocaleDateString()}</small></div>
    {i.status==="Pending"&&<div className="flex gap-2"><button className={secondary} disabled={busy} onClick={()=>void invite("revoke",{invitationId:i.id})}>Revoke</button><button className={secondary} disabled={busy} onClick={()=>void invite("resend",{companyId:i.company_id,email:i.invited_email,memberRole:i.member_role})}>Resend new token</button></div>}
   </div>)}</Panel>
  </section>}
 </main>;
 async function openDocument(id:string){
  try{const res=await fetch(`/api/contractors/files?id=${id}`,{cache:"no-store"});const body=await res.json();if(!res.ok)throw new Error(body.error||"File unavailable");window.open(body.url,"_blank","noopener,noreferrer");}
  catch(e){setError(e instanceof Error?e.message:"Cannot access file");}
 }
}
function Panel({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-xl border bg-white p-4 shadow-sm"><h2 className="mb-4 text-lg font-extrabold text-[#143d1a]">{title}</h2>{children}</section>}
function Field({label,value,set,type="text",required=false}:{label:string;value:string;set:(v:string)=>void;type?:string;required?:boolean}){return <label className="block text-sm font-semibold">{label}<input required={required} type={type} min={type==="number"?0:undefined} step={type==="number"?"any":undefined} value={value} onChange={e=>set(e.target.value)} className={input}/></label>}
function NumberField({label,value,set}:{label:string;value:number;set:(v:number)=>void}){return <label className="text-sm font-semibold">{label}<input type="number" min="0.1" step="0.1" value={value} onChange={e=>set(Number(e.target.value))} className={input}/></label>}
function OpportunityTable({rows,companies,select}:{rows:Opportunity[];companies:Company[];select:(id:string)=>void}){
 return <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-[#143d1a] text-white"><tr>{["Opportunity","Partner","Service","Requested","Status","Compensation"].map(x=><th key={x} className="p-3">{x}</th>)}</tr></thead>
 <tbody>{rows.map(o=><tr key={o.id} className="border-t hover:bg-neutral-50"><td className="p-3"><button type="button" className="font-bold text-[#143d1a] underline" onClick={()=>{select(o.id);document.getElementById("opportunity-detail")?.scrollIntoView({behavior:"smooth"});}}>{o.opportunity_number}</button></td><td className="p-3">{companies.find(x=>x.id===o.company_id)?.name}</td><td className="p-3">{o.service_type}</td><td className="p-3">{o.requested_date}</td><td className="p-3">{o.status}</td><td className="p-3">{currency(o.agreed_amount??o.proposed_amount)}</td></tr>)}</tbody></table>
 {!rows.length&&<p className="p-5 text-sm text-neutral-500">No opportunities match these filters.</p>}</div>
}
