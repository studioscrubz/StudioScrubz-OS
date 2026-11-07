"use client";
import {useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {getSupabaseClient} from "@/lib/supabase/client";
import {StudioScrubzLogo} from "@/components/branding/StudioScrubzLogo";
export function ContractorLogin(){
 const router=useRouter();const [email,setEmail]=useState(""),[password,setPassword]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function signIn(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError("");
  try{const {error}=await getSupabaseClient().auth.signInWithPassword({email,password});if(error)throw error;
   router.replace("/contractor");router.refresh();
  }catch(e){setError(e instanceof Error?e.message:"Unable to sign in.");}finally{setBusy(false);}
 }
 async function recover(){
  if(!email.includes("@"))return setError("Enter your email before requesting recovery.");
  setBusy(true);setError("");
  try{const {error}=await getSupabaseClient().auth.resetPasswordForEmail(email,{redirectTo:`${process.env.NODE_ENV==="production"?"https://partners.studioscrubz.com":window.location.origin}/contractor/reset-password`});
    if(error)throw error;setNotice("If this account exists, password recovery instructions have been requested.");}
  catch(e){setError(e instanceof Error?e.message:"Recovery request failed.");}finally{setBusy(false);}
 }
 return <main className="grid min-h-screen place-items-center bg-[#f5f6f4] p-5"><section className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
  <div className="text-center"><StudioScrubzLogo size={124} className="mx-auto"/>
  <h1 className="mt-2 text-2xl font-extrabold text-[#143d1a]">Contractor Partner Portal</h1>
  <p className="mt-2 text-sm text-neutral-600">Invitation-only access for authorized partner companies.</p></div>
  <form className="mt-6 space-y-4" onSubmit={signIn}><label className="block text-sm font-bold">Email<input type="email" autoComplete="email" required className="mt-1 w-full rounded-lg border p-3" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label className="block text-sm font-bold">Password<input type="password" autoComplete="current-password" required className="mt-1 w-full rounded-lg border p-3" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-[#143d1a]">{notice}</p>}
   <button disabled={busy} className="w-full rounded-lg bg-[#143d1a] p-3 font-bold text-white">{busy?"Signing in…":"Sign in"}</button></form>
  <button type="button" disabled={busy} onClick={()=>void recover()} className="mt-4 text-sm text-[#143d1a] underline">Forgot your password?</button>
  <p className="mt-6 text-xs text-neutral-500">No public registration. Contact StudioScrubz Operations to request a company invitation.</p>
  <Link href="https://app.studioscrubz.com/login" className="mt-3 block text-sm text-[#143d1a] underline">StudioScrubz employee sign-in</Link></section></main>;
}
