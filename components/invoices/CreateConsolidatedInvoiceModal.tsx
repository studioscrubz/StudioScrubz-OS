"use client";

import { useEffect, useMemo, useState } from "react";
import { getBusinessSettings } from "@/lib/services/businessSettings";
import { getClients } from "@/lib/services/clients";
import { createContractorConsolidatedInvoice, getContractorInvoiceEligibleJobs } from "@/lib/services/invoices";
import type { Client } from "@/types/client";
import type { ContractorInvoiceEligibleJob, InvoiceWithRelations } from "@/types/invoice";

export function CreateConsolidatedInvoiceModal({close,saved}:{close:()=>void;saved:(invoice:InvoiceWithRelations)=>Promise<void>}) {
  const [clients,setClients]=useState<Client[]>([]),[jobs,setJobs]=useState<ContractorInvoiceEligibleJob[]>([]);
  const [clientId,setClientId]=useState(""),[selected,setSelected]=useState<string[]>([]);
  const [issueDate,setIssueDate]=useState(localDate()),[dueDate,setDueDate]=useState("");
  const [loading,setLoading]=useState(true),[loadingJobs,setLoadingJobs]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null);
  useEffect(()=>{let active=true;void Promise.all([getClients(),getBusinessSettings()]).then(([rows,settings])=>{if(!active)return;setClients(rows.filter(row=>row.client_type==="Contractor"&&!row.archived_at));const due=new Date(`${localDate()}T12:00:00`);due.setDate(due.getDate()+settings.default_invoice_due_days);setDueDate(localDate(due))}).catch(cause=>setError(message(cause))).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
  const total=useMemo(()=>jobs.filter(job=>selected.includes(job.id)).reduce((sum,job)=>sum+job.amount,0),[jobs,selected]);
  const groups=useMemo(()=>jobs.reduce((map,job)=>{const rows=map.get(job.service_date)??[];rows.push(job);map.set(job.service_date,rows);return map},new Map<string,ContractorInvoiceEligibleJob[]>()),[jobs]);
  async function chooseClient(id:string){setClientId(id);setSelected([]);setJobs([]);setError(null);if(!id)return;setLoadingJobs(true);try{setJobs(await getContractorInvoiceEligibleJobs(id))}catch(cause){setError(message(cause))}finally{setLoadingJobs(false)}}
  async function submit(){if(!clientId)return setError("Select a Contractor client.");if(!selected.length)return setError("Select at least one completed Job.");setSaving(true);setError(null);try{await saved(await createContractorConsolidatedInvoice({clientId,jobIds:selected,issueDate,dueDate:dueDate||null}))}catch(cause){setError(message(cause));setSaving(false)}}
  return <div className="fixed inset-0 z-[90] overflow-y-auto bg-[#07190a]/70 p-5"><section className="mx-auto my-4 max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6">
    <button onClick={close} className="float-right text-xl" aria-label="Close consolidated Invoice">×</button>
    <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#9a7a17]">Contractor billing</p><h2 className="mt-1 text-xl font-extrabold text-[#143d1a]">Create Consolidated Invoice</h2><p className="mt-2 text-sm text-neutral-600">Select completed, uninvoiced Jobs from one Contractor. Each Job and service location remains itemized.</p>
    {error&&<p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
    {loading?<div className="mt-6 h-48 animate-pulse rounded-xl bg-neutral-100"/>:<div className="mt-6 space-y-5">
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Contractor Client *"><select className={input} value={clientId} onChange={event=>void chooseClient(event.target.value)}><option value="">Select Contractor</option>{clients.map(client=><option key={client.id} value={client.id}>{clientName(client)}</option>)}</select></Field><Field label="Issue Date *"><input className={input} type="date" value={issueDate} onChange={event=>setIssueDate(event.target.value)}/></Field><Field label="Due Date"><input className={input} type="date" value={dueDate} onChange={event=>setDueDate(event.target.value)}/></Field></div>
      <section className="rounded-xl border"><header className="flex items-center justify-between border-b bg-neutral-50 p-4"><div><h3 className="font-extrabold text-[#143d1a]">Eligible completed Jobs</h3><p className="text-xs text-neutral-500">Contract-billed, cancelled, archived, and actively invoiced Jobs are excluded.</p></div>{jobs.length>0&&<button className={secondary} onClick={()=>setSelected(selected.length===jobs.length?[]:jobs.map(job=>job.id))}>{selected.length===jobs.length?"Clear all":"Select all"}</button>}</header>
        {loadingJobs?<div className="m-4 h-32 animate-pulse rounded-lg bg-neutral-100"/>:clientId&&!jobs.length?<p className="p-8 text-center text-sm text-neutral-500">No eligible completed Jobs for this Contractor.</p>:<div className="divide-y">{Array.from(groups.entries()).map(([date,rows])=><div key={date} className="p-4"><h4 className="text-xs font-extrabold uppercase tracking-wide text-[#9a7a17]">{formatDate(date)}</h4><div className="mt-2 space-y-2">{rows.map(job=><label key={job.id} className="grid cursor-pointer gap-2 rounded-lg border p-3 sm:grid-cols-[auto_110px_1fr_1fr_120px] sm:items-center"><input type="checkbox" checked={selected.includes(job.id)} onChange={()=>setSelected(current=>current.includes(job.id)?current.filter(id=>id!==job.id):[...current,job.id])}/><b className="text-sm text-[#143d1a]">{job.job_number}</b><span className="text-sm"><b>{job.property_name}</b><small className="block text-neutral-500">{job.property_address}</small></span><span className="text-sm">{job.service_name}</span><b className="text-right text-sm">{money(job.amount)}</b></label>)}</div></div>)}</div>}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f2f5f1] p-4"><div><p className="text-xs font-bold uppercase text-neutral-500">Selected Jobs</p><p className="text-2xl font-extrabold text-[#143d1a]">{selected.length} · {money(total)}</p></div><div className="flex gap-3"><button disabled={saving} onClick={close} className={secondary}>Cancel</button><button disabled={saving||!selected.length} onClick={()=>void submit()} className={primary}>{saving?"Creating…":"Create Consolidated Invoice"}</button></div></div>
    </div>}
  </section></div>
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="text-sm font-bold">{label}<span className="mt-2 block">{children}</span></label>}
function clientName(client:Client){return client.company_name?.trim()||[client.first_name,client.last_name].filter(Boolean).join(" ")||"Unnamed Contractor"}
function localDate(value=new Date()){return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`}
function formatDate(value:string){return new Date(`${value}T12:00:00`).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}
function money(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value)}
function message(cause:unknown){if(cause instanceof Error)return cause.message;if(cause&&typeof cause==="object"&&"message" in cause&&typeof cause.message==="string")return cause.message;return"Consolidated Invoice operation failed."}
const input="h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm";
const primary="rounded-lg bg-[#143d1a] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary="rounded-lg border border-neutral-200 px-4 py-2.5 text-sm font-bold text-[#143d1a] disabled:opacity-50";
