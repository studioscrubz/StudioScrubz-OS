"use client";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { CreateInvoiceModal } from "@/components/invoices/CreateInvoiceModal";
import { CreateConsolidatedInvoiceModal } from "@/components/invoices/CreateConsolidatedInvoiceModal";
import { InvoicesPage } from "@/components/invoices/InvoicesPage";
import { hasPermission } from "@/lib/auth/permissions";

export function InvoicesWorkspace(){
  const{profile}=useAuth();
  const[creating,setCreating]=useState<"standalone"|"consolidated"|null>(null);
  const[revision,setRevision]=useState(0);
  return <div className="relative">
    {hasPermission(profile,"invoices.create")&&<div className="mb-5 flex flex-wrap gap-2 sm:absolute sm:right-0 sm:top-5 sm:z-10 sm:mb-0"><button onClick={()=>setCreating("consolidated")} className="rounded-lg border border-[#143d1a]/25 bg-white px-4 py-2.5 text-sm font-bold text-[#143d1a]">Create Consolidated Invoice</button><button onClick={()=>setCreating("standalone")} className="rounded-lg bg-[#143d1a] px-5 py-2.5 text-sm font-bold text-white shadow-sm">+ New Invoice</button></div>}
    <InvoicesPage key={revision}/>
    {creating==="standalone"&&<CreateInvoiceModal close={()=>setCreating(null)} saved={async()=>{setCreating(null);setRevision(value=>value+1)}}/>}
    {creating==="consolidated"&&<CreateConsolidatedInvoiceModal close={()=>setCreating(null)} saved={async()=>{setCreating(null);setRevision(value=>value+1)}}/>}
  </div>;
}
