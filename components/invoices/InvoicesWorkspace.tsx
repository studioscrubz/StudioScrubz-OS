"use client";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { CreateInvoiceModal } from "@/components/invoices/CreateInvoiceModal";
import { InvoicesPage } from "@/components/invoices/InvoicesPage";
import { hasPermission } from "@/lib/auth/permissions";

export function InvoicesWorkspace(){
  const{profile}=useAuth();
  const[creating,setCreating]=useState(false);
  const[revision,setRevision]=useState(0);
  return <div className="relative">
    {hasPermission(profile,"invoices.create")&&<button onClick={()=>setCreating(true)} className="mb-5 rounded-lg bg-[#143d1a] px-5 py-2.5 text-sm font-bold text-white shadow-sm sm:absolute sm:right-0 sm:top-5 sm:z-10 sm:mb-0">+ New Invoice</button>}
    <InvoicesPage key={revision}/>
    {creating&&<CreateInvoiceModal close={()=>setCreating(false)} saved={async()=>{setCreating(false);setRevision(value=>value+1)}}/>}
  </div>;
}
