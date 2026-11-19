"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {getSupabaseClient} from "@/lib/supabase/client";
import {StudioScrubzLogo} from "@/components/branding/StudioScrubzLogo";
import {contractorPage} from "@/lib/contractors/host";

const EMAIL="management@bravahomecleaning.com";
export function BravaEmailCodeLogin(){
  const router=useRouter();
  const [code,setCode]=useState(""),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  useEffect(()=>{
    let active=true;
    void getSupabaseClient().auth.getUser().then(async({data:{user}})=>{
      if(!user||!active)return;
      const response=await fetch("/api/contractors/session",{cache:"no-store"});
      if(active&&response.ok){router.replace(contractorPage("/"));router.refresh();}
    }).catch(()=>undefined);
    return()=>{active=false};
  },[router]);
  async function send(){
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/contractors/brava-otp",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Could not send verification code.");
      setSent(true);setNotice("A six-digit code has been sent to Brava management's email.");
    }catch(e){setError(e instanceof Error?e.message:"Could not send code.");}finally{setBusy(false);}
  }
  async function verify(e:React.FormEvent){
    e.preventDefault();
    if(!/^[0-9]{6}$/.test(code)){setError("Enter the six-digit code.");return;}
    setBusy(true);setError("");setNotice("");
    try{
      const auth=getSupabaseClient();
      const {data,error:otpError}=await auth.auth.verifyOtp({email:EMAIL,token:code,type:"email"});
      if(otpError||!data.user)throw otpError??new Error("Verification failed.");
      if(data.user.email?.toLowerCase()!==EMAIL){await auth.auth.signOut({scope:"local"});throw new Error("This email is not authorized.");}
      const {error:activationError}=await auth.rpc("activate_brava_email_invitation" as never);
      if(activationError){await auth.auth.signOut({scope:"local"});throw activationError;}
      const session=await fetch("/api/contractors/session",{cache:"no-store"});
      if(!session.ok){await auth.auth.signOut({scope:"local"});throw new Error("Brava membership could not be verified.");}
      router.replace(contractorPage("/"));router.refresh();
    }catch(e){setError(e instanceof Error?e.message:"Code verification failed.");}finally{setBusy(false);}
  }
  return <main className="grid min-h-screen place-items-center bg-[#f5f6f4] p-5"><section className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
    <div className="text-center"><StudioScrubzLogo size={116} className="mx-auto"/><h1 className="mt-3 text-2xl font-extrabold text-[#143d1a]">Brava Contractor Access</h1>
    <p className="mt-2 text-sm text-neutral-600">Secure email verification for BRAVA Home Cleaning</p></div>
    <p className="mt-6 text-sm font-bold">Verified account</p><p className="mt-1 break-all rounded-lg bg-neutral-100 p-3 text-sm">{EMAIL}</p>
    {!sent?<button type="button" disabled={busy} onClick={()=>void send()} className="mt-5 w-full rounded-lg bg-[#143d1a] p-3 font-bold text-white disabled:opacity-50">{busy?"Sending…":"Email my six-digit code"}</button>
      :<form className="mt-5 space-y-3" onSubmit={e=>void verify(e)}>
        <label className="block text-sm font-bold">Six-digit verification code<input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} className="mt-2 w-full rounded-lg border p-3 text-center text-2xl tracking-widest"/></label>
        <button type="submit" disabled={busy||code.length!==6} className="w-full rounded-lg bg-[#143d1a] p-3 font-bold text-white disabled:opacity-50">{busy?"Verifying…":"Verify and open Brava profile"}</button>
        <button type="button" disabled={busy} onClick={()=>void send()} className="w-full text-sm text-[#143d1a] underline">Send another code</button>
      </form>}
    {notice&&<p role="status" className="mt-4 text-sm text-[#143d1a]">{notice}</p>}
    {error&&<p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    <p className="mt-5 text-xs text-neutral-500">Codes are one-time use. Only authorized Brava accounts can access Brava's profile. StudioScrubz Operations controls access.</p>
  </section></main>;
}
