"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {useAuth} from "@/components/auth/AuthProvider";
import {hasPermission} from "@/lib/auth/permissions";
import {ContractorJobAssignment} from "@/components/contractors/ContractorJobAssignment";
type Company={id:string;contractor_code:string;name:string;contact_email:string;contact_name:string;phone:string|null;status:string;payment_terms:string|null;internal_notes:string|null;territories:string[];service_types:string[];proposed_rates:Record<string,unknown>;negotiated_rates:Record<string,unknown>;assigned_manager_id:string|null};
type DirectoryEntry={clientId:string;companyId:string;name:string;contactName:string;email:string|null;phone:string|null;portalStatus:string};
type Opportunity={id:string;opportunity_number:string;company_id:string;manager_id?:string|null;service_type:string;property_address:string;property_name:string|null;property_condition:string|null;scope_of_work:string;requested_date:string;proposed_amount:number;agreed_amount:number|null;final_scope:string|null;status:string;partner_confirmed_at:string|null;linked_job_id:string|null;quality_approved_at?:string|null};
type Offer={id:string;opportunity_id:string;offered_by_side:string;amount:number;scope_text:string;created_at:string};
type Message={id:string;company_id:string;partner_user_id:string;read_at:string|null;opportunity_id:string|null;sender_side:string;body:string;created_at:string};
type Assessment={opportunity_id:string;minimum_price:number|null;projected_margin:number|null;cost_complete:boolean;override_approved_by:string|null;override_reason:string|null;projection:Record<string,unknown>};
type Invite={id:string;company_id:string;invited_email:string;status:string;delivery_status:string;expires_at:string;member_role:string};
type ContractorMember={id:string;company_id:string;user_id:string;email:string;member_role:string;is_active:boolean;joined_at:string};
type Job={id:string;status:string;scheduled_date:string|null;start_time:string|null;estimated_duration:number|null;assigned_crew_id:string|null};
type Invoice={id:string;job_id:string;invoice_number:string;status:string;total:number;amount_paid:number;due_date:string|null};
type Document={id:string;company_id:string;opportunity_id:string|null;file_name:string;category:string};
type ContactAttempt={id:string;company_id:string;opportunity_id:string|null;method:string;outcome:string;notes:string|null;attempted_at:string};
type Followup={id:string;company_id:string;opportunity_id:string|null;assigned_manager_id:string;note:string;due_at:string;status:string;created_at:string};
type Data={role:string;viewerId:string;managers:Array<{id:string;display_name:string|null;email:string|null;role:string}>;companies:Company[];directory:DirectoryEntry[];opportunities:Opportunity[];offers:Offer[];messages:Message[];assessments:Assessment[];invitations:Invite[];members:ContractorMember[];jobs:Job[];invoices:Invoice[];documents:Document[];attempts:ContactAttempt[];followups:Followup[]};
export type ContractorView="dashboard"|"companies"|"opportunities"|"jobs"|"messages";
const currency=(n:number|null|undefined)=>n==null?"Unavailable":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n));
const input="mt-1 w-full rounded-lg border border-neutral-300 bg-white p-2.5 text-sm text-neutral-900";
const button="rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary="rounded-lg border border-[#143d1a]/30 bg-white px-3 py-2 text-sm font-semibold text-[#143d1a]";
const ContractorCalendar=dynamic(()=>import("@/components/jobs/SchedulePage").then(module=>module.SchedulePage),{loading:()=> <p role="status">Loading contractor calendar…</p>});
const titles:Record<ContractorView,string>={dashboard:"Contractor Dashboard",companies:"Contractors",opportunities:"Job Opportunities",jobs:"Scheduled Jobs",messages:"Contractor Communications"};
export function ContractorManagement({view}: {view:ContractorView}){
 const {profile}=useAuth();
 const canManagePortalAccess=hasPermission(profile,"contractors.manage");
 const portalAccessRef=useCallback((section:HTMLDivElement|null)=>{
  if(section&&window.location.hash==="#manage-portal-access")section.scrollIntoView();
 },[]);
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [notice,setNotice]=useState(""),[error,setError]=useState("");
 const [companyId,setCompanyId]=useState(""),[opportunityId,setOpportunityId]=useState("");
 const [status,setStatus]=useState("All"),[query,setQuery]=useState("");
 const [serviceFilter,setServiceFilter]=useState("All"),[managerFilter,setManagerFilter]=useState("All"),[fromDate,setFromDate]=useState(""),[toDate,setToDate]=useState("");
 const [companyName,setCompanyName]=useState(""),[companyEmail,setCompanyEmail]=useState(""),[companyContact,setCompanyContact]=useState("");
 const [companyEdit,setCompanyEdit]=useState<Record<string,string>>({});
 useEffect(()=>{setCompanyEdit({});},[companyId]);
 const [inviteEmail,setInviteEmail]=useState(""),[inviteRole,setInviteRole]=useState("Company Admin");
 const [offeredAmount,setOfferedAmount]=useState(""),[offerScope,setOfferScope]=useState(""),[message,setMessage]=useState("");
 const [messagePartnerId,setMessagePartnerId]=useState("");
 const [reviewReason,setReviewReason]=useState(""),[cleaners,setCleaners]=useState(2),[hours,setHours]=useState(4);
 const [roundTripMiles,setRoundTripMiles]=useState(""),[roundTripMinutes,setRoundTripMinutes]=useState("");
 const [supplies,setSupplies]=useState("0"),[equipment,setEquipment]=useState("0"),[overhead,setOverhead]=useState("0");
 const [attachment,setAttachment]=useState<File|null>(null);
 const [contactMethod,setContactMethod]=useState("Phone"),[contactOutcome,setContactOutcome]=useState(""),[contactNotes,setContactNotes]=useState("");
 const [followupNote,setFollowupNote]=useState(""),[followupDue,setFollowupDue]=useState("");
 const refresh=useCallback(async()=>{
  const response=await fetch("/api/contractors",{cache:"no-store"});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error??"Contractor data unavailable");
  setData(result);
  const requestedId=view==="opportunities"?new URLSearchParams(window.location.search).get("opportunityId"):null;
  const requested=result.opportunities?.find((opportunity:Opportunity)=>opportunity.id===requestedId);
  setCompanyId(current=>current||requested?.company_id||result.companies?.[0]?.id||"");
  setOpportunityId(current=>current||requested?.id||result.opportunities?.[0]?.id||"");
 },[view]);
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
 const directoryCompanyIds=new Set(data?.directory.map(entry=>entry.companyId));
 const dashboardCompanies=companies.filter(company=>directoryCompanyIds.has(company.id));
 const selectedCompany=companies.find(x=>x.id===companyId);
 const filtered=useMemo(()=>allOpportunities.filter(o=>(companyId?o.company_id===companyId:true)
  &&(status==="All"||o.status===status)
  &&(serviceFilter==="All"||o.service_type===serviceFilter)
  &&(managerFilter==="All"||(o.manager_id??companies.find(c=>c.id===o.company_id)?.assigned_manager_id)===managerFilter)
  &&(!fromDate||o.requested_date>=fromDate)&&(!toDate||o.requested_date<=toDate)
  &&(!query||[o.opportunity_number,o.property_name,o.service_type,o.property_address,o.status].join(" ").toLowerCase().includes(query.toLowerCase()))),[allOpportunities,companies,companyId,status,serviceFilter,managerFilter,fromDate,toDate,query]);
 const calendarJobIds=useMemo(()=>{
  const ids=new Set<string>();
  if(view==="jobs"){
   for(const opportunity of filtered){
    if(opportunity.linked_job_id)ids.add(opportunity.linked_job_id);
   }
  }
  return ids;
 },[filtered,view]);
 const selected=allOpportunities.find(x=>x.id===opportunityId);
 const assessment=data?.assessments.find(x=>x.opportunity_id===selected?.id);
 const job=data?.jobs.find(x=>x.id===selected?.linked_job_id);
 const selectedInvoices=data?.invoices.filter(x=>x.job_id===selected?.linked_job_id)??[];
 const count=(values:string[])=>allOpportunities.filter(x=>values.includes(x.status)).length;
 const cards=[
  ["New opportunities",count(["New Opportunity","Information Requested"])],
  ["Negotiating / awaiting reply",count(["Negotiating","Awaiting Approval"])],
  ["Awaiting crew",count(["Accepted","Crew Assignment"])],
  ["Upcoming contractor jobs",data?.jobs.filter(x=>["Scheduled","Crew Assigned","Ready to Schedule"].includes(x.status)).length??0],
  ["Pending quality review",count(["Pending Quality Review"])],
  ["Completed / awaiting invoicing",allOpportunities.filter(x=>x.linked_job_id&&data?.jobs.find(j=>j.id===x.linked_job_id)?.status==="Completed"
    &&!data.invoices.some(inv=>inv.job_id===x.linked_job_id)).length],
  ["Outstanding receivables",currency(data?.invoices.reduce((n,x)=>n+Math.max(0,Number(x.total)-Number(x.amount_paid)),0))],
  ["Pending follow-ups",data?.followups.filter(x=>x.status==="Pending").length??0],
  ["Overdue follow-ups",data?.followups.filter(x=>x.status==="Pending"&&Date.parse(x.due_at)<Date.now()).length??0],
 ];
 const canMessagePartner=selectedCompany?.status==="Active"&&selectedCompany.assigned_manager_id===data?.viewerId;
 const messagePartners=canMessagePartner?(data?.members.filter(m=>m.company_id===companyId&&m.is_active)??[]):[];
 const messagePartner=messagePartners.find(m=>m.user_id===messagePartnerId);
 const privateMessages=messagePartner?(data?.messages.filter(m=>m.company_id===companyId&&m.partner_user_id===messagePartner.user_id)??[]):[];
 const companySelect=<label className="block text-sm font-semibold">Contractor company
 <select className={input} value={companyId} onChange={e=>{setCompanyId(e.target.value);setOpportunityId("");setMessagePartnerId("");setMessage("");}}>
 <option value="">All companies</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>;
 if(loading)return <p className="p-8">Loading Contractor Management…</p>;
 return <main className="space-y-6 p-4 md:p-7">
  <header><p className="text-xs font-extrabold uppercase tracking-wider text-[#a08020]">Operations / Contractor Management</p>
  <h1 className="mt-1 text-3xl font-extrabold text-[#143d1a]">{titles[view]}</h1>
  <p className="mt-2 text-sm text-neutral-600">{view==="jobs"?"View scheduled contractor work on the OS calendar and manage accepted jobs that still need scheduling.":view==="opportunities"?"Review incoming contractor requests, negotiate terms, and approve work for scheduling.":"Contractor relationships and job delivery, integrated with StudioScrubz operations."}</p></header>
  {error&&<p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-[#143d1a]">{notice}</p>}
  <div className="flex flex-wrap gap-2">{(Object.keys(titles) as ContractorView[]).map((v)=><Link key={v}
   href={v==="dashboard"?"/contractors":`/contractors/${v}`}
   className={view===v?button:secondary}>{titles[v]}</Link>)}</div>
  {view==="dashboard"&&<><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value])=><div key={String(label)} className="rounded-xl border bg-white p-4 shadow-sm"><p className="text-xs font-semibold text-neutral-600">{label}</p><p className="mt-2 text-2xl font-extrabold text-[#143d1a]">{value}</p></div>)}</div>
  <h2 className="text-lg font-extrabold">Upcoming and overdue contractor follow-ups</h2>
   <div className="rounded-xl border bg-white p-4">{data?.followups.filter(f=>f.status==="Pending").slice(0,15).map(f=><div key={f.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
    <span><b>{companies.find(c=>c.id===f.company_id)?.name}</b> · {f.note}
     <small className="block text-neutral-600">Due: {new Date(f.due_at).toLocaleString()}</small></span>
    <button className={secondary} type="button" disabled={busy} onClick={()=>void run("resolveFollowup",{followupId:f.id})}>Mark complete</button>
   </div>)}</div>
   <h2 className="text-lg font-extrabold">Contractor performance & receivables</h2>
   <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[670px] text-left text-sm">
   <thead className="bg-[#143d1a] text-white"><tr>{["Contractor","Opportunities","Accepted Jobs","Completed Jobs","Invoiced Revenue","Outstanding","Projected Gross Profit"].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead>
   <tbody>{dashboardCompanies.map(c=>{
    const opps=allOpportunities.filter(o=>o.company_id===c.id),jobIds=new Set(opps.map(o=>o.linked_job_id).filter(Boolean));
    const linkedInvoices=data?.invoices.filter(inv=>jobIds.has(inv.job_id))??[];
    const completed=opps.filter(o=>data?.jobs.some(job=>job.id===o.linked_job_id&&job.status==="Completed")).length;
    const projectedGrossProfit=opps.reduce((total,op)=>{
     const profit=data?.assessments.find(a=>a.opportunity_id===op.id)?.projection.grossProfit;
     return total+(typeof profit==="number"&&Number.isFinite(profit)?profit:0);
    },0);
    return <tr key={c.id} className="border-t"><td className="p-3 font-bold">{c.name}</td><td className="p-3">{opps.length}</td>
     <td className="p-3">{opps.filter(o=>Boolean(o.linked_job_id)).length}</td><td className="p-3">{completed}</td>
     <td className="p-3">{currency(linkedInvoices.reduce((t,inv)=>t+Number(inv.total),0))}</td>
     <td className="p-3">{currency(linkedInvoices.reduce((t,inv)=>t+Math.max(0,Number(inv.total)-Number(inv.amount_paid)),0))}</td>
     <td className="p-3">{currency(projectedGrossProfit)} <span className="text-xs text-neutral-500">(estimate)</span></td></tr>;
   })}</tbody></table>
   {!dashboardCompanies.length&&<p className="p-4 text-sm text-neutral-500">No active contractors to report.</p>}</div>
   <h2 className="text-lg font-extrabold">Recent opportunities</h2><OpportunityTable rows={allOpportunities.slice(0,20)} companies={companies} select={setOpportunityId}/></>}
  {view==="companies"&&<section className="grid gap-5 lg:grid-cols-2">
   <Panel title="Create contractor company"><form className="space-y-3" onSubmit={async e=>{e.preventDefault();const r=await run("createCompany",{name:companyName,email:companyEmail,contactName:companyContact});if(r){setCompanyName("");setCompanyEmail("");setCompanyContact("");setCompanyId(r.companyId);}}}>
    <Field label="Company name" value={companyName} set={setCompanyName} required/>
    <Field label="Primary email" value={companyEmail} set={setCompanyEmail} type="email" required/>
    <Field label="Primary contact" value={companyContact} set={setCompanyContact}/>
    <button disabled={busy} className={button}>Create Company</button></form></Panel>
   <Panel title="Active contractor directory"><div className="space-y-2">
    {data?.directory.map(entry=><button key={entry.clientId} type="button" className="block w-full rounded-lg border bg-white p-3 text-left hover:border-[#143d1a]" onClick={()=>setCompanyId(entry.companyId)}>
     <b>{entry.name}</b><small className="block text-neutral-500">{[entry.contactName,entry.email,entry.phone].filter(Boolean).join(" · ")}</small>
     <small className="block text-neutral-500">Portal access: {entry.portalStatus}</small>
    </button>)}
    {!data?.directory.length&&<p className="text-sm text-neutral-500">No active contractor clients found.</p>}
   </div></Panel>
   {canManagePortalAccess&&<div id="manage-portal-access" ref={portalAccessRef} className="scroll-mt-20">
    <Panel title="Manage portal access">
     <div className="space-y-4">
      <h3 className="font-extrabold">Invitations &amp; Access</h3>
      <Panel title="Send secure seven-day invitation"><div className="grid gap-3 sm:grid-cols-3">{companySelect}
       <Field label="Invited email" value={inviteEmail} set={setInviteEmail} type="email"/>
       <label className="text-sm font-semibold">Company role<select className={input} value={inviteRole} onChange={e=>setInviteRole(e.target.value)}><option>Company Admin</option><option>Member</option></select></label></div>
       <button type="button" className={button} disabled={busy||!companyId||!inviteEmail.trim()} onClick={()=>void invite("invite",{companyId,email:inviteEmail,memberRole:inviteRole})}>Send invitation</button>
       <p className="mt-2 text-xs text-neutral-600">Invite is single-use, emailed by the configured provider, and expires after seven days. External staff additions require StudioScrubz approval.</p>
      </Panel>
      <Panel title="Authorized contractor users">{data?.members.map(member=><div key={member.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-3 text-sm">
       <div><b>{member.email}</b><p>{companies.find(c=>c.id===member.company_id)?.name} · {member.member_role} · {member.is_active?"Active":"Deactivated"}</p></div>
       <button type="button" className={secondary} disabled={busy} onClick={()=>void run("setMemberAccess",{memberId:member.id,isActive:!member.is_active})}>
         {member.is_active?"Deactivate portal access":"Restore portal access"}</button>
      </div>)}</Panel>
      <Panel title="Invitation status">{data?.invitations.map(i=><div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-3 text-sm">
       <div><b>{i.invited_email}</b><p>{companies.find(c=>c.id===i.company_id)?.name} · {i.member_role} · {i.status} / {i.delivery_status}</p><small>Expires: {new Date(i.expires_at).toLocaleDateString()}</small></div>
       {i.status==="Pending"&&<div className="flex gap-2"><button className={secondary} disabled={busy} onClick={()=>void invite("revoke",{invitationId:i.id})}>Revoke</button><button className={secondary} disabled={busy} onClick={()=>void invite("resend",{companyId:i.company_id,email:i.invited_email,memberRole:i.member_role})}>Resend new token</button></div>}
      </div>)}</Panel>
     </div>
    </Panel>
   </div>}
   {selectedCompany&&<Panel title={`Manage ${selectedCompany.name}`}><div className="space-y-3 text-sm">
    <p>Contact: {selectedCompany.contact_name||"Not supplied"}</p><p>Email: {selectedCompany.contact_email}</p><p>Terms: {selectedCompany.payment_terms||"Not specified"}</p>
    <p><b>Company documents:</b></p>
    {data?.documents.filter(d=>d.company_id===selectedCompany.id&&!d.opportunity_id).map(d=><a key={d.id} className="mr-3 text-sm text-[#143d1a] underline" href={`/api/contractors/files?id=${d.id}`}>{d.file_name} ({d.category})</a>)}

    <p>Status: <b>{selectedCompany.status}</b></p>
    <details className="rounded-lg border p-3"><summary className="cursor-pointer font-bold">Edit contractor terms, territory and rates</summary>
     <form className="mt-3 space-y-3" onSubmit={async e=>{
      e.preventDefault();
      try{
       const rates=JSON.parse(companyEdit.proposed_rates??JSON.stringify(selectedCompany.proposed_rates??{}));
       const negotiated=JSON.parse(companyEdit.negotiated_rates??JSON.stringify(selectedCompany.negotiated_rates??{}));
       await run("updateCompany",{companyId:selectedCompany.id,
        contact_name:companyEdit.contact_name??selectedCompany.contact_name,
        phone:companyEdit.phone??selectedCompany.phone,
        payment_terms:companyEdit.payment_terms??selectedCompany.payment_terms,
        territories:(companyEdit.territories??selectedCompany.territories.join(",")).split(",").map(x=>x.trim()).filter(Boolean),
        service_types:(companyEdit.service_types??selectedCompany.service_types.join(",")).split(",").map(x=>x.trim()).filter(Boolean),
        proposed_rates:rates,negotiated_rates:negotiated,
        assigned_manager_id:companyEdit.assigned_manager_id??selectedCompany.assigned_manager_id,
       });
      }catch(e){setError(e instanceof Error?e.message:"Check rate-card JSON format");}
     }}>
      {(["contact_name","phone","payment_terms","territories","service_types"] as const).map(key=><label key={key} className="block text-xs font-bold">
       {({contact_name:"Primary contact",phone:"Phone",payment_terms:"Payment terms",territories:"Service territories (comma-separated)",service_types:"Cleaning work types (comma-separated)"} as Record<string,string>)[key]}
       <input className={input} value={companyEdit[key]??(Array.isArray(selectedCompany[key])?selectedCompany[key].join(","):selectedCompany[key]??"")} onChange={e=>setCompanyEdit(v=>({...v,[key]:e.target.value}))}/></label>)}
      <label className="block text-xs font-bold">Assigned Operations Manager<select className={input}
       value={companyEdit.assigned_manager_id??selectedCompany.assigned_manager_id??""}
       onChange={e=>setCompanyEdit(v=>({...v,assigned_manager_id:e.target.value}))}>
       <option value="">Unassigned</option>{data?.managers.map(m=><option key={m.id} value={m.id}>{m.display_name||m.email} ({m.role})</option>)}</select></label>
      {(["proposed_rates","negotiated_rates"] as const).map(key=><label key={key} className="block text-xs font-bold">
       {key==="proposed_rates"?"Proposed rates (JSON)":"Negotiated rates (JSON)"}
       <textarea rows={3} className={input} value={companyEdit[key]??JSON.stringify(selectedCompany[key]??{},null,2)}
        onChange={e=>setCompanyEdit(v=>({...v,[key]:e.target.value}))}/></label>)}
      <button className={button} disabled={busy}>Save company details</button>
     </form>
    </details>
    {data?.role==="Master Admin"&&<div className="flex flex-wrap gap-2">{["Active","Pending","Suspended","Archived"].map(status=><button key={status} type="button" disabled={busy||status===selectedCompany.status}
     onClick={()=>void run("updateCompany",{companyId:selectedCompany.id,status})} className={secondary}>{status}</button>)}</div>}
    {data?.role==="Manager"&&selectedCompany.status==="Pending"&&<button className={secondary} disabled={busy} onClick={()=>void run("updateCompany",{companyId:selectedCompany.id,status:"Active"})}>Activate verified company</button>}
    <p className="text-xs text-neutral-500">Operations Managers may activate pending contractors. Suspension, archiving, and access revocation require Master Admin authorization.</p></div></Panel>}
  </section>}
  {(view==="opportunities"||view==="jobs")&&<>
   <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3">{companySelect}
    <label className="text-sm font-semibold">Status<select className={input} value={status} onChange={e=>setStatus(e.target.value)}>
     {["All",...new Set(allOpportunities.map(x=>x.status))].map(x=><option key={x}>{x}</option>)}</select></label>
    <Field label="Search" value={query} set={setQuery}/>
    <label className="text-sm font-semibold">Service type<select className={input} value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)}>
     {["All",...new Set(allOpportunities.map(x=>x.service_type))].map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="text-sm font-semibold">Assigned manager<select className={input} value={managerFilter} onChange={e=>setManagerFilter(e.target.value)}>
     <option value="All">All managers</option>{data?.managers.map(m=><option key={m.id} value={m.id}>{m.display_name||m.email}</option>)}</select></label>
    <Field label="From date" value={fromDate} set={setFromDate} type="date"/>
    <Field label="To date" value={toDate} set={setToDate} type="date"/>
   </div>
   {view==="jobs"&&<ContractorCalendar scheduledJobIds={calendarJobIds}/>}
   <OpportunityTable rows={view==="jobs"?filtered.filter(x=>Boolean(x.linked_job_id)):filtered} companies={companies} select={setOpportunityId}/>
   {selected&&<Panel title={`Review ${selected.opportunity_number}`}>
    <div className="grid gap-4 lg:grid-cols-2"><div className="space-y-2 text-sm">
     <p><b>Company:</b> {companies.find(x=>x.id===selected.company_id)?.name}</p>
     {selected.property_name&&<p><b>Name:</b> {selected.property_name}</p>}
     <p><b>Service:</b> {selected.service_type}</p><p><b>Property:</b> {selected.property_address}</p>
     <p><b>Requested:</b> {selected.requested_date}</p><p><b>Status:</b> {selected.status}</p>
     <p><b>Original offer:</b> {currency(selected.proposed_amount)}</p>
     <p><b>Agreed compensation:</b> {currency(selected.agreed_amount)}</p>
     <p><b>Contractor written confirmation:</b> {selected.partner_confirmed_at?"Received":"Required"}</p>
     {selected.property_condition&&<p><b>Property condition:</b> {selected.property_condition}</p>}
     <p className="whitespace-pre-line"><b>Scope:</b> {selected.final_scope??selected.scope_of_work}</p>
     {job&&<p><b>Linked operational job:</b> {job.status} · {job.scheduled_date||"Schedule pending"} <Link className="text-[#143d1a] underline" href="/jobs">Open Jobs</Link></p>}
     {job&&!["Completed","Cancelled","Archived"].includes(job.status)&&
      <ContractorJobAssignment key={job.id} jobId={job.id} date={job.scheduled_date}
        startTime={job.start_time} duration={job.estimated_duration} onAssigned={refresh}/>}
     {job?.status==="Completed"&&<div className="flex flex-wrap gap-2">
       {!selected.quality_approved_at&&<button type="button" className={secondary} disabled={busy} onClick={()=>void run("approveQuality",{opportunityId:selected.id})}>Approve completed work</button>}
       {selected.quality_approved_at&&<button type="button" className={secondary} disabled={busy} onClick={()=>void run("invoiceJob",{opportunityId:selected.id})}>Create / reconcile existing Job invoice</button>}
     </div>}
     {selectedInvoices.map(x=><div key={x.id} className="flex flex-wrap items-center gap-3">
       <p><b>Invoice:</b> {x.invoice_number}, {x.status}, {currency(x.total)} total / {currency(x.amount_paid)} paid</p>
       {Number(x.total)>Number(x.amount_paid)&&<button type="button" disabled={busy} className={secondary}
        onClick={()=>void run("sendPaymentReminder",{opportunityId:selected.id,invoiceId:x.id})}>Send payment reminder</button>}
      </div>)}
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
      {assessment.minimum_price!==null&&Number(selected.agreed_amount??selected.proposed_amount)<Number(assessment.minimum_price)&&
       <p role="alert" className="mt-2 font-extrabold text-red-700">UNDERBID — Contractor compensation is below the required profitability minimum. Master Admin exception approval is mandatory.</p>}
      {!assessment.cost_complete&&<p role="alert" className="mt-2 font-bold text-red-700">Travel or other required costs remain unverified; the opportunity cannot be accepted without a documented Master Admin exception.</p>}
      <p>Projected gross margin: <b>{assessment.projected_margin==null?"Unavailable":`${assessment.projected_margin}%`}</b></p>
      <p>Cost coverage: <b>{assessment.cost_complete?"Complete":"Incomplete – cannot accept without Master Admin override"}</b></p>
      <p>Override: {assessment.override_approved_by?"Approved with audited reason":"Not approved"}</p></div>}
     <Field label="Decision / override reason" value={reviewReason} set={setReviewReason}/>
     {!selected.linked_job_id&&!["Accepted","Declined","Cancelled","Disputed"].includes(selected.status)&&
      <div className="flex flex-wrap gap-2">
       <button type="button" className={secondary} disabled={busy||!reviewReason.trim()} onClick={()=>void run("requestInformation",{opportunityId:selected.id,reason:reviewReason})}>Request more information</button>
       <button type="button" className={secondary} disabled={busy||!reviewReason.trim()} onClick={()=>void run("markNegotiating",{opportunityId:selected.id,reason:reviewReason})}>Mark negotiating</button>
      </div>}
     {data?.role==="Master Admin"&&<button className={secondary} disabled={busy||reviewReason.length<12} type="button"
      onClick={()=>void run("approveOverride",{opportunityId:selected.id,reason:reviewReason})}>Master Admin: approve override</button>}
     <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy||!selected.partner_confirmed_at||!assessment} onClick={()=>void run("accept",{opportunityId:selected.id,reason:reviewReason})}>Accept & create operational Job</button>
      <button className={secondary} disabled={busy||!reviewReason} onClick={()=>void run("decline",{opportunityId:selected.id,reason:reviewReason})}>Decline</button>
      {selected.status==="Accepted"&&!selected.linked_job_id&&<button className={secondary} disabled={busy} onClick={()=>void run("retryJobConversion",{opportunityId:selected.id})}>Retry Job handoff</button>}
      {!selected.linked_job_id&&<button className={secondary} disabled={busy||reviewReason.trim().length<8} onClick={()=>void run("cancelOpportunity",{opportunityId:selected.id,reason:reviewReason})}>Cancel opportunity</button>}
      <button className={secondary} disabled={busy||reviewReason.trim().length<8} onClick={()=>void run("requestReschedule",{opportunityId:selected.id,reason:reviewReason})}>Log reschedule request</button>
      <button className={secondary} disabled={busy||reviewReason.trim().length<8} onClick={()=>void run("disputeOpportunity",{opportunityId:selected.id,reason:reviewReason})}>Record dispute</button></div>
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
    {data?.documents.filter(x=>x.opportunity_id===selected.id).map(x=><a key={x.id} className="mr-2 mt-2 text-sm text-[#143d1a] underline" href={`/api/contractors/files?id=${x.id}`}>{x.file_name}</a>)}
   </Panel>}
  </>}
  {view==="messages"&&<section className="grid gap-4 lg:grid-cols-[1fr_2fr]"><Panel title="Contractor">{companySelect}
   {canMessagePartner&&<label className="mt-3 block text-sm font-semibold">Contractor profile
    <select className={input} value={messagePartner?.user_id??""} onChange={e=>{setMessagePartnerId(e.target.value);setMessage("");}}>
     <option value="">Select a contractor</option>{messagePartners.map(member=><option key={member.user_id} value={member.user_id}>{member.email}</option>)}
    </select></label>}</Panel>
   <Panel title="Private contractor conversation">
    {!canMessagePartner&&<p className="text-sm text-neutral-600">Private messages are available only to the Operations Manager assigned to an active contractor company.</p>}
    {canMessagePartner&&!messagePartner&&<p className="text-sm text-neutral-600">Select an active contractor profile to start a private conversation.</p>}
    {messagePartner&&<>
     <p className="mb-2 text-sm text-neutral-600">Unread from contractor: <b>{privateMessages.filter(x=>x.sender_side==="Contractor"&&!x.read_at).length}</b></p>
     <button type="button" className={secondary} disabled={busy} onClick={()=>void run("markMessagesRead",{companyId,partnerUserId:messagePartner.user_id})}>Mark messages read</button>
     <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">{privateMessages.map(x=><div key={x.id} className="rounded-lg bg-neutral-50 p-3 text-sm"><b>{x.sender_side==="Contractor"?messagePartner.email:"You"}</b><p className="text-xs text-neutral-500">{new Date(x.created_at).toLocaleString()}</p><p>{x.body}</p></div>)}</div>
     <label className="mt-3 block text-sm font-semibold">Message<textarea className={input} value={message} onChange={e=>setMessage(e.target.value)} rows={3}/></label>
     <button className={button} disabled={busy||!message.trim()} onClick={async()=>{const r=await run("message",{companyId,partnerUserId:messagePartner.user_id,message});if(r)setMessage("");}}>Send private message</button>
    </>}
    <div className="mt-6 space-y-3 border-t pt-4"><h3 className="font-extrabold">Contact attempts & follow-ups</h3>
     <label className="block text-xs font-semibold">Contact method<select className={input} value={contactMethod} onChange={e=>setContactMethod(e.target.value)}>
      {["Phone","Email","SMS","Other"].map(m=><option key={m}>{m}</option>)}</select></label>
     <Field label="Outcome" value={contactOutcome} set={setContactOutcome}/>
     <Field label="Notes" value={contactNotes} set={setContactNotes}/>
     <button type="button" className={secondary} disabled={busy||!companyId||contactOutcome.trim().length<2}
      onClick={async()=>{const r=await run("logContactAttempt",{companyId,opportunityId:opportunityId||null,method:contactMethod,outcome:contactOutcome,notes:contactNotes});if(r){setContactOutcome("");setContactNotes("");}}}>Log contact attempt</button>
     {data?.attempts.filter(a=>a.company_id===companyId&&(a.opportunity_id??null)===(opportunityId||null)).slice(0,10).map(a=><p key={a.id} className="rounded border p-2 text-xs">
      {a.method}: {a.outcome} · {new Date(a.attempted_at).toLocaleString()}<span className="block">{a.notes}</span></p>)}
     <Field label="Follow-up note" value={followupNote} set={setFollowupNote}/>
     <Field label="Follow-up date and time" value={followupDue} set={setFollowupDue} type="datetime-local"/>
     <button type="button" className={secondary} disabled={busy||!companyId||followupNote.trim().length<3||!followupDue}
      onClick={async()=>{const r=await run("createFollowup",{companyId,opportunityId:opportunityId||null,note:followupNote,dueAt:new Date(followupDue).toISOString()});if(r){setFollowupNote("");setFollowupDue("");}}}>Schedule follow-up</button>
    </div></Panel></section>}

 </main>;

}
function Panel({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-xl border bg-white p-4 shadow-sm"><h2 className="mb-4 text-lg font-extrabold text-[#143d1a]">{title}</h2>{children}</section>}
function Field({label,value,set,type="text",required=false}:{label:string;value:string;set:(v:string)=>void;type?:string;required?:boolean}){return <label className="block text-sm font-semibold">{label}<input required={required} type={type} min={type==="number"?0:undefined} step={type==="number"?"any":undefined} value={value} onChange={e=>set(e.target.value)} className={input}/></label>}
function NumberField({label,value,set}:{label:string;value:number;set:(v:number)=>void}){return <label className="text-sm font-semibold">{label}<input type="number" min="0.1" step="0.1" value={value} onChange={e=>set(Number(e.target.value))} className={input}/></label>}
function OpportunityTable({rows,companies,select}:{rows:Opportunity[];companies:Company[];select:(id:string)=>void}){
 return <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-[#143d1a] text-white"><tr>{["Opportunity","Contractor","Service","Requested","Status","Compensation"].map(x=><th key={x} className="p-3">{x}</th>)}</tr></thead>
 <tbody>{rows.map(o=><tr key={o.id} className="border-t hover:bg-neutral-50"><td className="p-3"><button type="button" className="font-bold text-[#143d1a] underline" onClick={()=>{select(o.id);document.getElementById("opportunity-detail")?.scrollIntoView({behavior:"smooth"});}}>{o.opportunity_number}</button>{o.property_name&&<span className="block">{o.property_name}</span>}</td><td className="p-3">{companies.find(x=>x.id===o.company_id)?.name}</td><td className="p-3">{o.service_type}</td><td className="p-3">{o.requested_date}</td><td className="p-3">{o.status}</td><td className="p-3">{currency(o.agreed_amount??o.proposed_amount)}</td></tr>)}</tbody></table>
 {!rows.length&&<p className="p-5 text-sm text-neutral-500">No opportunities match these filters.</p>}</div>
}
