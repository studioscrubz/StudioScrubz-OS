"use client";
import {useEffect,useState,type ReactNode} from "react";
import {canCreateJobInvoice,createInvoiceFromJob,getInvoiceForJob} from "@/lib/services/invoices";
import type {InvoiceWithRelations} from "@/types/invoice";
import {useOperationalRealtime} from "@/components/realtime/OperationalRealtimeProvider";
import {ContractServiceRecordAction} from "@/components/jobs/ContractServiceRecord";

export function JobInvoiceAction({jobId,children}:{jobId:string;children:ReactNode}){
  const[invoice,setInvoice]=useState<InvoiceWithRelations|null>(null),[eligible,setEligible]=useState(true),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null);
  function load(){return Promise.all([getInvoiceForJob(jobId),canCreateJobInvoice(jobId)]).then(([nextInvoice,allowed])=>{setInvoice(nextInvoice);setEligible(allowed);setError(null)}).catch(cause=>{console.error("Invoice relationship load failed",cause);setError(errorMessage(cause,"Unable to check Invoice status."))}).finally(()=>setLoading(false))}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void load()},[jobId]);
  useOperationalRealtime(["invoices","service_occurrences","service_agreements"],load);
  async function create(){setSaving(true);setError(null);try{const created=await createInvoiceFromJob(jobId);setInvoice(await getInvoiceForJob(jobId)??created)}catch(cause){console.error("Invoice creation failed",cause);setError(errorMessage(cause,"Unable to create invoice."))}finally{setSaving(false)}}
  if(invoice)return null;
  if(!eligible)return <article className="mb-3 rounded-xl bg-white p-4 shadow-sm">{children}<div className="mt-3 border-t pt-3"><ContractServiceRecordAction jobId={jobId}/></div></article>;
  return <article className="mb-3 rounded-xl bg-white p-4 shadow-sm">{children}<div className="mt-3 border-t pt-3">{loading?<span className="text-xs text-neutral-400">Checking invoice...</span>:<button disabled={saving} onClick={()=>void create()} className="rounded bg-[#143d1a] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{saving?"Creating Invoice...":"Create Invoice"}</button>}{error&&<span className="ml-2 text-xs font-bold text-red-700">{error}</span>}</div></article>
}
function errorMessage(cause:unknown,fallback:string){if(cause instanceof Error)return cause.message;if(cause&&typeof cause==="object"&&"message" in cause&&typeof cause.message==="string")return cause.message;return fallback}
