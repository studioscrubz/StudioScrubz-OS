"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {getSupabaseClient} from "@/lib/supabase/client";
export function ContractorResetPassword(){
 const [password,setPassword]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const router=useRouter();
 return <main className="grid min-h-screen place-items-center bg-[#f5f6f4] p-5"><form className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6" onSubmit={async e=>{
  e.preventDefault();setBusy(true);setError("");
  try{const {error}=await getSupabaseClient().auth.updateUser({password});if(error)throw error;router.replace("/contractor/login");}
  catch(e){setError(e instanceof Error?e.message:"Password update failed");}finally{setBusy(false);}
 }}><h1 className="text-xl font-bold text-[#143d1a]">Set a new contractor password</h1>
 <input type="password" minLength={12} required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded border p-3"/>
 {error&&<p role="alert" className="text-red-700">{error}</p>}
 <button className="w-full rounded-lg bg-[#143d1a] p-3 text-white" disabled={busy}>Update password</button></form></main>;
}
